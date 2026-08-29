// 背包技能解析層（PLAN-043 Phase D）
//
// `Backpack.skillIds[]` 存的是 `bpskill_移動強化@1` 這種「id + 可選等級」的引用字串。
// 前台要顯示的則是「套用該級覆寫之後」的樣子——階名、該級正文、該級數值。
// 這層負責把兩者接起來，讓 BackpacksPage / 模擬器 / 未來的引用層都走同一份解析邏輯。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type {
  Backpack, BackpackSkillDoc, DescriptionRefs, SkillEffect,
} from '../types'
import { parseBuffRef } from './buffRef.ts'
import { parseBackpackName } from './backpackClassify.ts'

/** 解析後的單一掛載技能：已套用指定等級的覆寫，呼叫端直接拿來渲染。 */
export interface ResolvedBackpackSkill {
  /** 原始元素字串（含 @N）。React key 與除錯用；**不可**拿去比對 doc.id */
  raw: string
  /** 裸技能 id（已拆掉 @N） */
  id: string
  /** 指定的等級；未指定 = 用技能頂層欄位 */
  level?: number
  /** 技能本體（未套用等級覆寫的原始 doc，供需要看全貌的呼叫端） */
  doc: BackpackSkillDoc
  /** 顯示名。有階名時是「移動強化Ⅰ」，否則退回技能原名 */
  name: string
  description: string
  descriptionRefs?: DescriptionRefs
  icon?: string
  effects: SkillEffect[]
  buffIds: string[]
  /** 來源標籤，格式對齊 entityRefs 的 BACKPACK_SKILLS spec（模擬器 BuffSource.origin 用） */
  origin: string
  /**
   * 這支技能在背包上的角色（PLAN-043 Phase F）。
   *
   * · `base`  ＝ 本體側：`skillIds[0]`。單技能背包（A/B/S/SS，全站至 Phase F 為止都是）恆為此。
   * · `addon` ＝ 材料側：`skillIds[1..]`，只出現在 S+ 複合背包（＝功能背包 ＋ 變體背包）。
   *   材料側**不帶底線加成**（description 已由 `stripBaselineClause()` 扣掉）。
   *
   * ⚠ 角色由**順序**決定，不是另一個欄位——`derive-composite-backpack-skills.mjs`
   *   寫入時保證 `[功能, 變體]` 的順序，`backpackSkills.test.ts` 有一則釘住這件事。
   *   會這樣設計是因為 `skillIds` 的元素格式（`id@N`）是全站共用的引用字串語法，
   *   為了角色再擴一層語法（`id@N!addon`）只會讓後台挑選器與掃描器全部跟著長疣。
   */
  role: 'base' | 'addon'
  /**
   * 這是 `composeBackpackSkills()` 合成出來的顯示用條目，此欄放組成它的原始兩支
   * （順序同 `skillIds`）。未合成的條目沒有這個欄位。
   *
   * 合成後的 `id` / `raw` / `doc` 都還是**本體側**那一支的——合成名（`出力增幅Ⅲ·攻擊`）
   * 在 `backpackSkills` 裡查無此人，拿 `name` 去反查技能庫會落空，要追來源請走這裡。
   */
  composedFrom?: ResolvedBackpackSkill[]
}

/** 由技能陣列建 id→doc 對照表。 */
export const buildBackpackSkillMap = (
  skills: BackpackSkillDoc[] | undefined,
): Map<string, BackpackSkillDoc> => new Map((skills ?? []).map((s) => [s.id, s]))

/**
 * 底線行 ——「機甲／機兵軀幹耐久值提升 X%」那一句（後面可能還接「，造成傷害提升 Y%」）。
 * 也認簡體，因為爬蟲若哪天直接落官方原文就會是「躯干」。
 */
const BASELINE_CLAUSE = /[軀躯][幹干]耐久值提升/

/**
 * 裁掉描述裡的底線句（PLAN-043 Phase F）。
 *
 * S+ 複合背包 ＝ 功能背包 ＋ 變體背包，而官方的複合技能文本裡，
 * 「軀幹耐久值提升 X%」**只出現一次、且來自功能側**——變體側那份被丟掉了。
 * 2026-08-30 以官方三份文本自我比對，這條規則在 97/98 筆逐字成立
 * （唯一例外 `彈藥強化背包·首攻` 是官方少寫「對戰」二字的措辭差，非結構差）。
 *
 * 所以複合背包上的變體技能要照 S 級原文顯示、但**扣掉底線句**，
 * 否則畫面上「軀幹耐久 +10%」會出現兩次，讀起來像疊成 +20%。
 *
 * ⚠ 修理系是最好的反例：`修理裝置Ⅰ` 自己**沒有**底線句 ⇒ 9 筆修理系複合背包
 *   在官方文本裡完全沒有軀幹加成，即使變體側（如 `命中壓制Ⅲ`）有。
 *   規則寫成「取最大」或「去重」都會在這 9 筆上算錯，只有「丟棄材料側那份」是對的。
 *
 * 保留原分隔符（`;`／`；`／換行）而不統一改寫，因為顯示的是官方原文。
 */
export function stripBaselineClause(description: string): string {
  if (!description || !BASELINE_CLAUSE.test(description)) return description
  // 奇數 index 是被捕獲的分隔符；連同被丟棄片段前的那個一起丟，尾端殘留最後再收。
  const tokens = description.split(/([;；\n])/)
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i += 2) {
    if (BASELINE_CLAUSE.test(tokens[i])) continue
    kept.push(tokens[i], tokens[i + 1] ?? '')
  }
  return kept.join('').replace(/[;；\n\s]+$/, '')
}

/**
 * 解析背包掛載的技能。
 *
 * ── 等級覆寫語意（與 PLAN-024 的 BuffLevel 一致）──────────────────────────────
 * 各欄位一律 `該級的值 ?? 技能頂層的值`：填了就覆寫、沒填就沿用父層。
 * 這與 entityRefs 的 `refsFallback: []`（未填時前台回退父層）是同一個約定，
 * 兩邊若不一致，會出現「掃描器認為某處有引用、前台卻顯示父層文字」的錯位。
 *
 * ── 查不到的 id 一律略過 ─────────────────────────────────────────────────────
 * 沿用 resolvePilotSkills 的優雅降級：技能被刪或 id 打錯時前台少顯示一塊，
 * 而不是整頁炸掉。後台的挑選器則會把同樣的情況標成紅字「⚠ 找不到此技能」——
 * 該被看見的是維護者，不是使用者。
 */
export function resolveBackpackSkills(
  bp: Pick<Backpack, 'skillIds'> | null | undefined,
  skillMap: Map<string, BackpackSkillDoc>,
): ResolvedBackpackSkill[] {
  const out: ResolvedBackpackSkill[] = []
  for (const raw of bp?.skillIds ?? []) {
    if (!raw) continue
    const { buffId: id, level } = parseBuffRef(raw)   // 泛用的 `id@N` 拆解，非 buff 專用
    const doc = skillMap.get(id)
    if (!doc) continue                                // 優雅降級（見上）
    const lv = level != null ? doc.levels?.find((l) => l.level === level) : undefined
    // 角色看**已成功解析的筆數**而非原陣列 index：第一支技能斷鏈時，
    // 第二支就遞補成本體側，而不是留下一份「只有材料、底線被扣掉」的殘缺顯示。
    const role = out.length === 0 ? 'base' : 'addon'
    const description = lv?.description ?? doc.description
    out.push({
      raw,
      id,
      level,
      doc,
      name: lv?.name ?? doc.name,
      description: role === 'addon' ? stripBaselineClause(description) : description,
      descriptionRefs: lv?.descriptionRefs ?? doc.descriptionRefs,
      icon: lv?.icon ?? doc.icon,
      // ⚠ `effects` 刻意**還沒有**套底線裁剪：全庫 46 筆技能的 effects 至今都是空陣列，
      //   「軀幹耐久」該用哪個 stat 名沒有任何資料佐證，現在編一個出來等於把猜測寫進程式。
      //   等 effects 真的落盤，材料側必須比照 description 扣掉底線那筆，否則模擬會多算一份。
      effects: lv?.effects ?? doc.effects ?? [],
      buffIds: lv?.buffIds ?? doc.buffIds ?? [],
      origin: lv ? `背包技能:${doc.name} Lv${lv.level}` : `背包技能:${doc.name}`,
      role,
    })
  }
  return out
}

/** 把描述拆成「特徵句」與「底線句」兩堆（保留各自的原字，只丟掉尾端分隔符）。 */
function splitBaseline(description: string): { feature: string[]; baseline: string[] } {
  const feature: string[] = []
  const baseline: string[] = []
  for (const raw of (description ?? '').split(/[;；\n]/)) {
    const seg = raw.trim()
    if (!seg) continue
    ;(BASELINE_CLAUSE.test(seg) ? baseline : feature).push(seg)
  }
  return { feature, baseline }
}

/**
 * 把 S+ 複合背包的兩支技能合成**一張卡**，形狀與遊戲內一致（PLAN-043 Phase F）。
 *
 * 遊戲把「出力干擾背包·攻擊」顯示成單一技能「出力增幅Ⅲ·攻擊」，用本體側的圖示，
 * 正文則是三段：本體特徵 → 材料特徵 → 底線。本函式就是重現這件事，
 * **而不是**新建 98 筆技能 doc —— 名字、正文、圖示全部可由那兩支既有技能組出來
 * （2026-08-30 以官方文本驗證：名字 98/98、正文 97/98 逐字相符）。
 *
 * ── 底線句的取法 ────────────────────────────────────────────────────────────
 * 一律取**本體側**那一份，材料側的丟棄。看起來像「同類取最強」是因為在
 * 出力／移動／飛行等線上，本體側恰好就是較強的那份（`出力增幅Ⅲ` 的
 * 「軀幹+10%，造成傷害+5%」蓋過 `攻擊壓制Ⅲ` 的「軀幹+10%」）——
 * 但**兩者不等價**：`修理裝置Ⅰ` 根本沒有底線句，而官方的修理系複合背包也確實
 * 一點軀幹加成都沒有。若寫成「取最強」，那 9 筆會憑空長出材料側的 +10%。
 *
 * ── 為什麼名字要現組而不是存起來 ────────────────────────────────────────────
 * `本體技能名 + '·' + 變體`，變體取自**背包名**（`parseBackpackName()`）而非材料技能名——
 * 材料技能叫「攻擊壓制Ⅲ」，官方的複合名卻是「出力增幅Ⅲ·攻擊」，尾碼是背包的變體字。
 *
 * 少於兩支（A/B/S/SS 的單技能背包）原樣返回，不做任何加工。
 */
export function composeBackpackSkills(
  bp: Pick<Backpack, 'name' | 'skillIds'> | null | undefined,
  resolved: ResolvedBackpackSkill[],
): ResolvedBackpackSkill[] {
  if (resolved.length < 2) return resolved
  const [base, ...addons] = resolved

  const variant = parseBackpackName(bp?.name ?? '').variant
  const baseParts = splitBaseline(base.description)
  // 材料側的 description 在 resolve 時已扣掉底線句，這裡再切一次是為了拆多行。
  const addonFeatures = addons.flatMap((a) => splitBaseline(a.description).feature)

  return [{
    ...base,
    // 尾碼取不到時退回本體技能原名，而不是拼出「出力增幅Ⅲ·undefined」。
    name: variant ? `${base.name}·${variant}` : base.name,
    description: [...baseParts.feature, ...addonFeatures, ...baseParts.baseline].join('；\n'),
    descriptionRefs: resolved.reduce((acc, r) => ({ ...acc, ...r.descriptionRefs }), {} as DescriptionRefs),
    effects: resolved.flatMap((r) => r.effects),
    buffIds: [...new Set(resolved.flatMap((r) => r.buffIds))],
    // origin 保留兩支的來源：模擬器要講得出某個 buff 是誰給的，而合成名在技能庫裡查無此人。
    origin: resolved.map((r) => r.origin).join(' ＋ '),
    composedFrom: resolved,
  }]
}

/**
 * 背包是否有任何可顯示的技能。
 *
 * 刻意提供這支而非讓呼叫端寫 `bp.skillIds?.length`——那個長度只代表「掛了幾個 id」，
 * 不代表解析得到。id 全部斷鏈時長度仍 > 0，gate 會開、然後渲染出一塊空白區。
 */
export const hasBackpackSkills = (
  bp: Pick<Backpack, 'skillIds'> | null | undefined,
  skillMap: Map<string, BackpackSkillDoc>,
): boolean => resolveBackpackSkills(bp, skillMap).length > 0
