// 神經驅動算力 → BUFF 階覆寫層（PLAN-034 Phase B）
//
// 核心命題：「凝勢是第幾階」不是引用點上的常數，而是**配裝狀態的函數**。
// 同一個 buff 家族的階會隨神經驅動算力提升，而這件事在資料裡只存一份——
// NeuralDriveAbility.buffUpgrades（規則）× Pilot.neuralDrive[].levels[].minSum（門檻）。
//
// 機師頁依當前算力算出一張 Map<buffId, { level, name }>，chip 顯示名、浮窗內容、
// （Slice 2 起）數值 token 都問這張表。全頁只有一張表 →「天賦說 III、技能說 I」
// 在結構上不可能發生。
//
// ⚠ 這裡的「不可能發生」保證的是**本站呈現的內部一致性**，不是「官方也這樣顯示」。
//   實機確認過：不同角色的文案由不同人撰寫，有些機師的技能敘述會隨算力改寫、有些不會。
//   官方不改寫的引用點必須逐筆 EntityRef.fixedLevel 釘死。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type { NeuralDrive, NeuralDriveAbility, GameBuff, EntityRef, DescriptionRefs } from '../types'
import { parseBuffRef } from './buffRef.ts'

// ─── 算力規則（自 PilotDetailPage 上移，使天賦與覆寫層共用同一門檻來源）────────────

export const ND_RULES = {
  /** γ 區（名稱以 γ 開頭）合計算力上限：上下16（16+7 / 7+16） */
  gammaPairCap: 23,
  /** 各區預設 Lv；未列出的區預設滿級（α/β 可並存、通常不影響天賦） */
  defaultLevels: { 'γ1': 3, 'γ2': 1 } as Record<string, number>,
}

export const isGammaZone = (name: string) => name.startsWith('γ')

/** 該區選到 Lv 時的算力值（讀該機師資料的 minSum，不寫死 1/4/7/10/13/16） */
export function zonePower(drive: NeuralDrive, lv: number): number {
  return lv > 0 ? drive.levels[lv - 1]?.minSum ?? 0 : 0
}

/**
 * 各分區的預設 Lv。
 *
 * 額外規則（PLAN-034）：**凡該區任一級的能力帶 buffUpgrades → 預設 Lv1**。
 * 原邏輯對 ND_RULES.defaultLevels 未列出的分區給**滿級**，那會讓覆寫在首屏就全開，
 * 而使用者根本不知道畫面上那些階名是算力衍生值。給 Lv1 才能讓「點動算力 → 字跟著變」
 * 這件事被看見。
 *
 * abilityOf 省略時退化為原行為（Phase C 接線前、以及後台等不需要覆寫的呼叫點）。
 */
export function defaultNdLevels(
  drives: NeuralDrive[] | undefined,
  abilityOf?: (id: string) => NeuralDriveAbility | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of drives ?? []) {
    const max = d.levels?.length ?? 0
    const hasUpgrade = abilityOf
      ? (d.levels ?? []).some(lv => (lv.abilityId ? abilityOf(lv.abilityId)?.buffUpgrades?.length : 0))
      : false
    out[d.name] = hasUpgrade ? Math.min(1, max) : Math.min(ND_RULES.defaultLevels[d.name] ?? max, max)
  }
  return out
}

// ─── 取級：以 level 值比對，不用陣列索引 ──────────────────────────────────────────

/**
 * 從 levels[] 取指定級。
 *
 * 為什麼不是 `levels[n - 1]`：實測正式資料已有**非連號／亂序**的 levels
 * （buff_迴避率提升 levels=[3,4]、buff_迴避率降低 levels=[2,3,5,4]），索引式取級已經是錯的。
 * 既有兩處原本不同調——numRefs.ts 用索引、EntityRefView.tsx 用 find——此函式是唯一出口。
 */
export function pickLevel<T extends { level: number }>(
  levels: T[] | undefined,
  n: number | undefined,
): T | undefined {
  if (!levels?.length || n == null) return undefined
  return levels.find(l => l.level === n)
}

// ─── 覆寫表 ─────────────────────────────────────────────────────────────────────

export interface NdOverrideEntry {
  /** 本機師頁上該 buff 家族的生效階 */
  level: number
  /** 該階顯示名（來自 BuffLevel.name；沒有階名的家族填的是 buff.name 原字） */
  name: string
  /**
   * 促成此階的分區名（如 'γ2'）。純為了讓抬升標記能說出
   * 「已由 γ2 算力自 Lv1 提升至 Lv3」——只講「已由算力提升」使用者不知道該去動哪一條。
   */
  zone: string
}

/** 覆寫表的查詢介面。無 provider 的頁面走 EMPTY_ND_OVERRIDES = 恆等今日行為。 */
export interface NdBuffOverrides {
  entryOf(buffId: string): NdOverrideEntry | undefined
}

/** 模組級常數：identity 穩定，不會讓底下的 RefChip 因 context value 每次新建而失去 memo。 */
export const EMPTY_ND_OVERRIDES: NdBuffOverrides = { entryOf: () => undefined }

/** 建表時被擋下的家族與原因（供 dev 警告；刻意不在此 console，保持純函式可測） */
export interface NdOverrideRejection {
  buffId: string
  reason:
    | 'no-level'        // buffUpgrades 元素沒帶 @N，無法得知要升到第幾階
    | 'buff-missing'    // buffs 尚未載入，或該 id 查無（含斷鏈）
    | 'not-tiered'      // 目標不是階梯 buff（沒有 levels[]）
    | 'level-missing'   // 該階不存在
    | 'level-unnamed'   // 該階沒填 BuffLevel.name → 換不出字
    | 'minsum-zero'     // 掛載級 minSum 為 0（PilotAdmin 新增級的預設值，視為「未設定」）
    | 'not-self-buff'   // debuff / control：敵我混用無解，硬性排除
  detail: string
}

/**
 * 可被覆寫的 buff 型別白名單（決策五第四條、地雷二）。
 *
 * 覆寫粒度是「buff 家族 × 整頁」，分不清敵我也分不清來源。實測 buff_失穩／護甲降低／
 * 命中率降低／迴避率降低 都是對敵 debuff 且被十數支技能共用——一旦誤開，
 * 使用者會看到「我方對敵施加的減益自己升階了」這種完全錯誤的資訊。
 * 這是硬性限縮，不是只寫在文件裡的約定。
 */
const SELF_BUFF_TYPES = new Set(['statBoost', 'resource', 'state'])

export const isSelfBuff = (buff: GameBuff): boolean => SELF_BUFF_TYPES.has(String(buff.buffType))

interface Candidate {
  buffId: string
  level: number | null
  /** 掛載該能力的那一級的門檻 */
  minSum: number
  /** 當前算力是否已達門檻 */
  active: boolean
  /** 掛載所在分區名，供抬升標記顯示 */
  zone: string
  origin: string
}

/**
 * 依當前算力配置建出覆寫表。**建表時即驗證**，七道閘門任一不過 → 該 buff 家族**整族**不進表。
 *
 * 為什麼是「整族」而不是「該筆」：若 lv2 合格而 lv3 缺 name，點到高算力時會渲染成
 * 「字面是凝勢Ⅱ、實際取 lv3 數值」——字面與數字自相矛盾，比修改前更難察覺。
 * 整族退場的話，使用者看到的是「點了沒反應」（可回報、dev 有 rejection），而不是錯誤資訊。
 *
 * 驗證對象是該家族**所有**宣告，含尚未達門檻者：一個 Lv5 才生效的壞宣告，
 * 在 Lv4 時就要讓整族退場，否則使用者會在拉高算力時遇到「字突然不動了」。
 */
export function buildNdBuffOverrides(args: {
  drives: NeuralDrive[] | undefined
  /** 分區名 → 選定 Lv（PilotDetailPage 的 ndLevels） */
  levels: Record<string, number>
  abilityOf: (id: string) => NeuralDriveAbility | undefined
  buffOf: (id: string) => GameBuff | undefined
  /** 建表被擋下時的回報；呼叫端自行決定 dev 才 console.warn（保持本函式純粹） */
  onReject?: (r: NdOverrideRejection) => void
}): Map<string, NdOverrideEntry> {
  const { drives, levels, abilityOf, buffOf, onReject } = args
  const out = new Map<string, NdOverrideEntry>()
  if (!drives?.length) return out

  // ── ① 收集宣告 ────────────────────────────────────────────────────────────
  const byBuff = new Map<string, Candidate[]>()
  for (const drive of drives) {
    const power = zonePower(drive, levels[drive.name] ?? 0)
    for (const ndLevel of drive.levels ?? []) {
      // 只認 abilityId：升階規則住在 neuralDriveAbilities 集合，嵌入式舊格式沒有這個欄位。
      // ⚠ 爬蟲補丁若重寫 neuralDrive 陣列會洗掉 abilityId（地雷七），屆時覆寫恆為空。
      if (!ndLevel.abilityId) continue
      const ability = abilityOf(ndLevel.abilityId)
      if (!ability?.buffUpgrades?.length) continue
      for (const raw of ability.buffUpgrades) {
        const { buffId, level } = parseBuffRef(raw)
        const list = byBuff.get(buffId) ?? []
        list.push({
          buffId,
          level: level ?? null,
          minSum: ndLevel.minSum ?? 0,
          active: power >= (ndLevel.minSum ?? 0),
          zone: drive.name,
          origin: `${ability.id}（${drive.name} Lv${ndLevel.level}, minSum=${ndLevel.minSum}）`,
        })
        byBuff.set(buffId, list)
      }
    }
  }

  // ── ② 逐族驗證，原子退場 ──────────────────────────────────────────────────
  for (const [buffId, candidates] of byBuff) {
    const reject = (reason: NdOverrideRejection['reason'], detail: string) => {
      onReject?.({ buffId, reason, detail })
      return null
    }

    const buff = buffOf(buffId)
    let failed = false
    for (const c of candidates) {
      if (failed) break
      if (c.level == null) { reject('no-level', `${c.origin} 的 buffUpgrades 元素沒帶 @N`); failed = true; break }
      // 閘門①：buffs 尚未載入時 buffOf 一律回 undefined → 整族不進表 → chip 維持原字面，無中間態閃爍
      if (!buff) { reject('buff-missing', `${c.origin} 指向的 ${buffId} 查無（buffs 未載入或斷鏈）`); failed = true; break }
      if (!buff.levels?.length) { reject('not-tiered', `${buffId} 沒有 levels[]，不是階梯 buff`); failed = true; break }
      const lv = pickLevel(buff.levels, c.level)
      if (!lv) { reject('level-missing', `${buffId} 沒有第 ${c.level} 級（來自 ${c.origin}）`); failed = true; break }
      if (!lv.name) { reject('level-unnamed', `${buffId} 第 ${c.level} 級沒填 name，換不出字（來自 ${c.origin}）`); failed = true; break }
      // 閘門④：PilotAdmin 新增級的預設值就是 0，視為「尚未設定門檻」而非「零門檻恆真」
      if (c.minSum <= 0) { reject('minsum-zero', `${c.origin} 的 minSum 為 0，視為未設定`); failed = true; break }
      if (!isSelfBuff(buff)) { reject('not-self-buff', `${buffId} 是 ${buff.buffType}，敵我混用無解，硬性排除`); failed = true; break }
    }
    if (failed || !buff) continue

    // ── ③ 取當前算力下已達門檻者的最高階 ─────────────────────────────────────
    let best: Candidate | null = null
    for (const c of candidates) {
      if (!c.active) continue
      if (!best || (c.level ?? 0) > (best.level ?? 0)) best = c
    }
    if (!best?.level) continue
    const lv = pickLevel(buff.levels, best.level)
    if (!lv?.name) continue // 上面已驗證過，這裡只是讓型別收斂
    out.set(buffId, { level: best.level, name: lv.name, zone: best.zone })
  }

  return out
}

// ─── BuffLevel.name 的軟驗證（後台 E-2 用）──────────────────────────────────────

/** 值 → 正規全形羅馬單碼（U+2160–U+216B）。 */
const ROMAN_FULLWIDTH = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ']

/** 逐字印出 code point。這是唯一能讓人看見「ⅠⅠ」與「Ⅱ」差在哪的方式。 */
export const codePointsOf = (s: string): string =>
  [...s].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')

export interface BuffLevelNameCheck {
  ok: boolean
  /** 不 ok 時的說明；ok 時為提示語（例如「與 buff.name 相同 = 此級顯示原名」）。 */
  message: string
  /** 建議值；無法建議時 undefined。 */
  suggestion?: string
}

/**
 * 檢查 BuffLevel.name 是否符合慣例。**軟驗證**——只警示不擋存檔，
 * 因為「沒有階名的家族填 buff.name 原字」是合法的編輯決策（決策六）。
 *
 * ⚠ 字形基準是**全形羅馬**（Ⅰ Ⅱ Ⅲ…），不是計畫書 E-2 原本寫的 ASCII I/V/X。
 *   Phase A 已把全站字面正規化為全形（實測全形 82 : 半形 29，且半形那側多為
 *   「虛粒子矩陣EX」這類把羅馬字母誤計為階的雜訊）。若這裡改用 ASCII 當基準，
 *   後台會鼓勵管理員填出與正文字面不一致的階名，等於把剛統一好的字形再拆回去。
 */
export function checkBuffLevelName(
  buffName: string,
  level: number,
  name: string | undefined,
  /**
   * 領域專屬的文案覆寫（PLAN-043）。背包技能的 levels[] 與 BuffLevel 同構，
   * 值得共用這裡的全形羅馬字檢查——那才是本函式的價值所在（'失穩ⅠⅠⅠ' 這類
   * 重複 U+2160 靠肉眼看不出來）。但「未填」的後果兩邊不同：buff 是覆寫表失效，
   * 背包技能只是前台顯示不出階名。故把兩句領域文案參數化，其餘邏輯完全共用——
   * 複製一份 checkXxxLevelName 的代價是兩份實作各自漂移。
   */
  opts?: { missingMessage?: string; sameAsBaseMessage?: string; baseLabel?: string },
): BuffLevelNameCheck {
  const base = String(buffName ?? '')
  const baseLabel = opts?.baseLabel ?? 'buff 名稱'
  if (!name) {
    return {
      ok: false,
      message: opts?.missingMessage ?? '未填 → 此級不會進覆寫表（建表閘門③），算力抬升對整族失效',
      suggestion: `${base}${ROMAN_FULLWIDTH[level] ?? ''}`,
    }
  }
  if (!name.startsWith(base)) {
    return { ok: false, message: `應以${baseLabel}「${base}」為前綴`, suggestion: `${base}${ROMAN_FULLWIDTH[level] ?? ''}` }
  }
  const suffix = name.slice(base.length).trim()
  if (!suffix) {
    return {
      ok: true,
      message: opts?.sameAsBaseMessage ?? '與 buff 名稱相同 → 明示此級顯示為原名（官方無階名的家族適用，如幹勁）',
    }
  }
  const expected = ROMAN_FULLWIDTH[level]
  if (expected && suffix === expected) return { ok: true, message: '' }
  return {
    ok: false,
    message: `尾綴「${suffix}」（${codePointsOf(suffix)}）不是第 ${level} 級的全形羅馬字「${expected ?? '—'}」`
      + (expected ? `（${codePointsOf(expected)}）` : ''),
    suggestion: expected ? `${base}${expected}` : undefined,
  }
}

// ─── 解析單一引用的生效階 ────────────────────────────────────────────────────────

export interface EffectiveLevel {
  /** 實際該用的階；未被抬升時 byte-identical 等於 ref.level */
  level: number | undefined
  /** true = 確實被算力抬升了（呼叫端據此換字並加視覺標記） */
  lifted: boolean
  /** lifted 時該階的顯示名。回在這裡是為了不讓呼叫端各自再查一次 entryOf 而查出不同答案。 */
  name?: string
}

/**
 * 換字條件是「**確實抬升**」，不是「有值」。
 *
 * 這是全案最容易寫錯、也最致命的一行。若寫成「覆寫表有值就換字」，由於
 * eff = max(ref.level, override) 在無覆寫時也等於 ref.level，只要 BuffLevel.name 一填，
 * 全站 20 個 RefText 站點近 100 個 chip 的字面都會被靜默替換成 BuffLevel.name。
 *
 * 靜態 level:3 不會被 lv2 覆寫**降級**——覆寫是下限不是等號。
 */
export function effectiveLevel(ref: EntityRef, ov: NdBuffOverrides): EffectiveLevel {
  if (ref.refType !== 'buff') return { level: ref.level, lifted: false }
  if (ref.fixedLevel) return { level: ref.level, lifted: false }
  const entry = ov.entryOf(ref.refId)
  if (!entry) return { level: ref.level, lifted: false }
  if (entry.level <= (ref.level ?? 0)) return { level: ref.level, lifted: false }
  return { level: entry.level, lifted: true, name: entry.name }
}

// ─── 數值 token 的取級裁決（PLAN-034 F-1）────────────────────────────────────────

/** 情境層對一個 `<refId.lvN.attr>` token 的裁決。未抬升時 level byte-identical 等於 token 自帶的 N。 */
export interface NumLevelDecision {
  /** 實際該取的級；undefined = token 沒有 lv 段（取頂層） */
  level: number | undefined
  /** true = 確實被算力抬升（呼叫端據此在 title 標明來源） */
  lifted: boolean
  /** lifted 時促成此階的分區（如 'γ2'）；只講「已由算力提升」使用者不知道該去動哪一條 */
  zone?: string
}

export type NumLevelOf = (refId: string, baseLevel: number | undefined) => NumLevelDecision

/**
 * 由「該段正文的引用側錄表 + 覆寫表」建出數值 token 的取級函式。
 *
 * **為什麼要吃 refs**：`fixedLevel` 是掛在 `EntityRef` 上的，而數值 token 是裸字串、
 * 沒有自己的引用記錄。若不看 refs，同一句話會出現
 * 「獲得1層[凝勢Ⅰ]（chip 被釘死）…可疊加7層（token 照抬）」——
 * 決策四明訂**絕不允許「不換字但數值照抬」**，那比不改更難察覺。
 * 故只要該段 refs 裡**任何**指向此 buff 的引用被釘死，整個 refId 的數值 token 一併釘死
 * （取保守側：寧可維持今日行為，也不要字面與數字互相矛盾）。
 *
 * **為什麼繞 effectiveLevel 而不自己判斷**：抬升與否的規則只能有一份。
 * 這裡合成一個等價的 EntityRef 餵進去，chip 與 token 就不可能對同一個 buff 給出不同的階。
 */
export function buildNumLevelOf(refs: DescriptionRefs | undefined, ov: NdBuffOverrides): NumLevelOf {
  const pinned = new Set<string>()
  for (const ref of Object.values(refs ?? {})) {
    if (ref?.refType === 'buff' && ref.fixedLevel && ref.refId) pinned.add(ref.refId)
  }
  return (refId, baseLevel) => {
    const eff = effectiveLevel(
      { refType: 'buff', refId, level: baseLevel, fixedLevel: pinned.has(refId) },
      ov,
    )
    // zone 純為顯示；判定本身完全由 effectiveLevel 決定，不在這裡重寫一次條件
    return eff.lifted
      ? { level: eff.level, lifted: true, zone: ov.entryOf(refId)?.zone }
      : { level: baseLevel, lifted: false }
  }
}
