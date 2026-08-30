// 天賦對配裝的修正 —— PLAN-052-N Phase A
//
// ── 這支存在的理由：規則被填進去之前，得先有人知道「要填」──────────────────
// `PilotTalent.loadoutMods` 是**純人工維護**的欄位（官方 API 沒有這份資料），
// 而新機師上線時沒有任何東西會提醒管理者「這個天賦會改裝備」。實測的失敗路徑很短：
// 爬蟲把正文抓進來 → 管理者填完 buffIds 就關掉頁面 → 三個月後玩家回報數字不對。
//
// 所以本檔先提供**偵測**（正文像是在講裝備嗎），供後台即時提示（A-4）與
// 批次健檢腳本（A-5）共用。解析與套用（`resolveTalentMods` / `statOf` / `allowsEquip`）
// 屬 Phase B，屆時加在本檔下方。
//
// ⚠ **這是提醒，不是把關。** 關鍵字必然會漏 —— 本計畫評估期間就漏過一整類
//   （用「射程+1」「彈倉容量+2」表達的 9 筆，關鍵字掃描一筆都沒抓到）。
//   官方文案對同一件事有多種說法（「負重降低」／「重量降低」／「負重-360」），
//   而下一個新機師會用第四種。漏報＝回到現狀、不會更糟；誤報＝多一行可忽略的提示。
//   要「確定沒漏」只有一條路：全量傾印逐條讀（`_local-notes/2026-08/2026-08-30_dump-all-talents.mjs`）。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type { Backpack, EquipStat, EquipTarget, Pilot, PilotTalent, TalentLoadoutMod, Weapon } from '../types'

/**
 * 「這段正文可能在講裝備」的關鍵字。**刻意放寬**——這裡的成本不對稱：
 * 誤報只是多一行字，漏報是三個月後才被玩家發現的錯數字。
 *
 * ⚠ **只有這一份。** `scripts/check-talent-loadout-mods.mjs` 直接
 *   `import … from '../src/utils/talentLoadoutMods.ts'` —— Node 24 的型別剝離讓 `.mjs`
 *   吃得下 `.ts`（先例：`check-nd-minsum-drift.mjs` 之於 `neuralDriveLevels.ts`）。
 *   **不要為了腳本另外複製一份關鍵字** —— 後台提示與批次健檢用不同的判準，
 *   等於兩個地方對「要不要填」給出不同答案，而管理者只看得到其中一個。
 */
export const LOADOUT_MOD_HINT_RE = /負重|重量|射程|彈倉|彈藥|耐久|額外裝備|可裝備/

/**
 * 命中的關鍵字（去重、依出現順序）。UI 用它講出「正文提到**負重**」而不是泛泛的一句提示 ——
 * 管理者要能一眼看出提示在指哪一段，否則只會學會忽略它。
 */
export function loadoutModHintWords(talent: Pick<PilotTalent, 'description' | 'descriptionMax'>): string[] {
  const text = `${talent.description ?? ''}\n${talent.descriptionMax ?? ''}`
  const hits: string[] = []
  for (const w of LOADOUT_MOD_HINT_RE.source.split('|')) {
    if (text.includes(w) && !hits.includes(w)) hits.push(w)
  }
  return hits
}

/**
 * 該不該提示「這個天賦可能要填 loadoutMods」。
 *
 * ⚠ 判準是「**一條都沒填**」而不是「填得夠不夠」：填了一條之後就不再提示，
 *   因為此時管理者已經知道這個欄位存在，而「夠不夠」是關鍵字答不出來的問題
 *   （維娜一段正文要兩條、羅斯瑪麗一段只要一條）。繼續提示只會變成永遠關不掉的紅點。
 */
export function needsLoadoutModsHint(talent: Pick<PilotTalent, 'description' | 'descriptionMax' | 'loadoutMods'>): boolean {
  if ((talent.loadoutMods ?? []).length > 0) return false
  return LOADOUT_MOD_HINT_RE.test(`${talent.description ?? ''}\n${talent.descriptionMax ?? ''}`)
}

// ─── 解析與套用（PLAN-052-N Phase B）────────────────────────────────────────

/**
 * 潛能第幾階解鎖「天賦能力加強」。
 *
 * 使用者裁決（2026-08-30）逐字：「天賦加強**絕對**在第三階，這是遊戲目前為止沒有破例過的。」
 * ⇒ 寫死常數而**不開資料欄位**：依 0/5 定律，一個「每位機師都填 3」的欄位只會變成漂移來源。
 * 日後真的出現破例，改的是這一行。
 */
export const TALENT_BOOST_POTENTIAL = 3

/** 潛能上限（0–5 六階）。`resolveTalentMods` 未給潛能時的預設 —— 站上資料本身就是滿潛快照 */
export const MAX_POTENTIAL = 5

/** 一件裝備的某個屬性被天賦改過之後的樣子。`reducedBy > 0` ＝ 變輕了 */
export interface StatAdjust {
  /** 修正後的值（已 clamp 到 ≥ 0） */
  value: number
  /** 原值 */
  base: number
  /** 減少了多少（負數代表反而增加）。UI 印「−360」用它 */
  reducedBy: number
  /** 來源天賦名（多條規則同時命中時取第一條）。UI 印「· 罪業信條」用它 */
  talentName: string | null
}

export interface ResolvedTalentMods {
  /** 這位機師一條規則都沒有（89 位裡有 71 位）。呼叫端可據此走 fast path */
  readonly empty: boolean
  /** 這把武器可以無視 `mechRestriction` 的裝甲類型 gate 嗎 */
  allowsWeapon(w: Pick<Weapon, 'id' | 'kind'> | null | undefined): boolean
  /** 這個背包可以無視 `assemblableArmorType` 嗎 */
  allowsBackpack(b: Pick<Backpack, 'id' | 'type'> | null | undefined): boolean
  /** 武器的修正後重量（熱路徑用，只回數字） */
  weaponWeight(w: Pick<Weapon, 'id' | 'kind' | 'weight'> | null | undefined): number
  /** 背包的修正後重量 */
  backpackWeight(b: Pick<Backpack, 'id' | 'type' | 'weight'> | null | undefined): number
  /** 武器重量的完整拆解（UI 說明用）。**沒有任何修正時回 null** —— 呼叫端據此決定要不要印那一句 */
  weaponWeightInfo(w: Pick<Weapon, 'id' | 'kind' | 'weight'> | null | undefined): StatAdjust | null
  /** 背包重量的完整拆解（UI 說明用） */
  backpackWeightInfo(b: Pick<Backpack, 'id' | 'type' | 'weight'> | null | undefined): StatAdjust | null
  /** 任意屬性的修正（B 類的彈量／射程／耐久；Phase E 之後才有資料） */
  weaponStat(w: Pick<Weapon, 'id' | 'kind'> | null | undefined, stat: EquipStat, base: number): StatAdjust | null
}

/** 空集合的共用實例 —— 71 位機師都指向它，不必每次配置一組閉包 */
const EMPTY_MODS: ResolvedTalentMods = {
  empty: true,
  allowsWeapon:       () => false,
  allowsBackpack:     () => false,
  weaponWeight:       (w) => w?.weight ?? 0,
  backpackWeight:     (b) => b?.weight ?? 0,
  weaponWeightInfo:   () => null,
  backpackWeightInfo: () => null,
  weaponStat:         () => null,
}

/** 這條規則的對象命中這件武器嗎 */
function hitsWeapon(t: EquipTarget, w: Pick<Weapon, 'id' | 'kind'>): boolean {
  return t.on === 'weaponKind' ? t.kind === w.kind
    : t.on === 'weaponId'      ? t.id === w.id
    : false
}

function hitsBackpack(t: EquipTarget, b: Pick<Backpack, 'id' | 'type'>): boolean {
  return t.on === 'backpackType' && t.type === b.type
}

/**
 * 把一組命中的規則套到一個基準值上。
 *
 * ⚠ **百分比一律基於原值 `base`，不是基於「加完 flat 之後的值」**：兩者都對同一件事給出
 *   不同答案，而順序無關的那一個才不會在未來多一條規則時默默改變既有機師的數字。
 *   （今天全庫每個對象至多一條規則，這個選擇看不出差別 —— 正因為看不出，
 *   才要現在就定死並測起來。）
 */
function applyMods(base: number, mods: { mod: TalentLoadoutMod; talentName: string }[]): StatAdjust | null {
  let flat = 0
  let pct = 0
  let talentName: string | null = null
  for (const { mod, talentName: name } of mods) {
    if (mod.kind !== 'stat') continue
    if (mod.mode === 'pct') pct += mod.amount
    else flat += mod.amount
    talentName ??= name
  }
  if (flat === 0 && pct === 0) return null
  const value = Math.max(0, base * (1 + pct) + flat)
  return { value, base, reducedBy: base - value, talentName }
}

/**
 * 這位機師的天賦對配裝的全部修正。
 *
 * @param potential 潛能等級 0–5。**未給 ＝ 滿潛**（站上的機師資料本身就是滿潛快照：
 *   `ap.init − apBase.init = 2` 佔 54/89、`masterLevel` 存的是第 4 階才有的「大師Ⅲ」）。
 *   Phase C 之後由 `LoadoutDraft.potential` 供給。
 */
export function resolveTalentMods(pilot: Pilot | null | undefined, potential: number = MAX_POTENTIAL): ResolvedTalentMods {
  const boosted = potential >= TALENT_BOOST_POTENTIAL
  const all: { mod: TalentLoadoutMod; talentName: string }[] = []
  for (const t of pilot?.talents ?? []) {
    for (const mod of t.loadoutMods ?? []) {
      // 未提升時，`since:'max'` 的規則整條不存在 —— 不是「值變成 0」，
      // 而是連 allowEquip 都不生效（今天 0 筆 max 版的 allowEquip，但語意要一致）
      if (mod.since === 'max' && !boosted) continue
      all.push({ mod, talentName: t.name })
    }
  }
  if (all.length === 0) return EMPTY_MODS

  const forWeapon = (w: Pick<Weapon, 'id' | 'kind'>) => all.filter((e) => hitsWeapon(e.mod.target, w))
  const forBackpack = (b: Pick<Backpack, 'id' | 'type'>) => all.filter((e) => hitsBackpack(e.mod.target, b))

  const weaponStatInfo = (w: Pick<Weapon, 'id' | 'kind'> | null | undefined, stat: EquipStat, base: number) =>
    w ? applyMods(base, forWeapon(w).filter((e) => e.mod.kind === 'stat' && e.mod.stat === stat)) : null

  const backpackWeightInfo = (b: Pick<Backpack, 'id' | 'type' | 'weight'> | null | undefined) =>
    b ? applyMods(b.weight ?? 0, forBackpack(b).filter((e) => e.mod.kind === 'stat' && e.mod.stat === 'weight')) : null

  return {
    empty: false,
    allowsWeapon:   (w) => !!w && forWeapon(w).some((e) => e.mod.kind === 'allowEquip'),
    allowsBackpack: (b) => !!b && forBackpack(b).some((e) => e.mod.kind === 'allowEquip'),
    weaponWeight:   (w) => weaponStatInfo(w, 'weight', w?.weight ?? 0)?.value ?? w?.weight ?? 0,
    backpackWeight: (b) => backpackWeightInfo(b)?.value ?? b?.weight ?? 0,
    weaponWeightInfo: (w) => weaponStatInfo(w, 'weight', w?.weight ?? 0),
    backpackWeightInfo,
    weaponStat: weaponStatInfo,
  }
}
