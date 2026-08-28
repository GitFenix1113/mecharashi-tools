// 天生模組的逐部位推導 —— PLAN-052-K Phase A
//
// ── 這個檔在回答什麼 ────────────────────────────────────────────────────────
// 「這台機甲的這個部位，天生帶了哪幾顆模組、各貢獻幾級？」
//
// 站上把天生模組存成 `mech` 頂層的三個欄位（`module4Id` / `module8Id` / `moduleFixedIds`），
// **沒有部位也沒有等級**。而遊戲裡一顆天生模組的等級是
// **四個部位各自貢獻的等級加總**（＋插槽貢獻 × 部位倍率，見 `moduleRules.ts`）——
// 所以 052-G Phase D 讓玩家能換部位之後，「自帶」那一列就開始說謊：
// 換掉滿階帕斯卡的右臂，遊戲裡〈彙編矩陣〉整顆消失、〈蓄能模組〉8→6、〈出力模組〉4→3，
// 站上卻一顆都不動 —— **而且不報錯**。
//
// ── 為什麼是算的、不是存的 ──────────────────────────────────────────────────
// 90 台 × 4 部位 × 3～7 顆 ≈ **1500 格**，而這 1500 格全部是規則的產物。
// 落盤的後果是官方改版時它會過期、而規則會自動跟上；再加上 0/5 定律
// （選填欄位不會被填滿），1500 格人工欄位必然腐爛。**通則用算的，例外才落盤**
// —— 例外的出口是 `MechPart.innateModules`（決策三）。
//
// ── 職責邊界 ────────────────────────────────────────────────────────────────
//   本檔                  ：「一個部位貢獻哪幾顆、各幾級」＋「這顆解鎖了沒」——
//                            純資料判準，不認識 `LoadoutContext`，不做加總封頂。
//   moduleRules 的 `moduleStacks()`：把四個部位的天生貢獻與四個接口的插槽貢獻
//                            **收成同一個等級池**、乘上部位倍率、封頂。
//   `resolveChassis()`    ：混搭時決定「這個部位來自哪一台」——
//                            本檔的呼叫端要傳的是**那一台**，不是基底機甲。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import { MechPartPosition, ModuleSlot } from '../types/enums.ts'
import type { Module } from '../types/module.ts'
import type { InnateModuleEntry } from '../types/mech.ts'

// ─── 規則表 ─────────────────────────────────────────────────────────────────

type PerPart = Readonly<Record<MechPartPosition, number>>
const everyPart = (n: number): PerPart => ({ torso: n, leftArm: n, rightArm: n, legs: n })

/** 一個品質階級下，三類天生模組各自的「每部位貢獻」。 */
export interface InnateRule {
  /** 機甲特性模組（`mech.module4Id`） */
  trait: PerPart
  /** 機甲8級模組（`mech.module8Id`） */
  slot8: PerPart
  /** 機甲副模組（`moduleFixedIds` 內 `slot === 機甲副模組` 的那些） */
  builtIn: PerPart
}

/**
 * **滿階**（品質 MAX）下的天生模組貢獻表。全站一律滿配假設（PLAN-052-K 決策六），
 * 所以只有這一欄；品質 LV1～LV3 的中間值官方也只給兩個端點，不在範圍內。
 *
 * ── 驗證來源（2026-08-28，官方 `aircraft_data` 全 83 台 × 兩端點 × 四部位）──
 *   · **8 級模組與副模組：57 台 SSR 全中，零例外。**
 *   · 特性位 54／57 —— 三個例外（輝龍／影虎／霸王）是**額外疊了一顆專屬模組**，
 *     不是規律錯；專屬那一份走 `exclusivePartLevel()`，兩者相加後與官方吻合。
 *   · A 級（16 台 SR）清一色 `軀幹1 ＋ 腿1、雙臂 0` —— 而且**軀幹與腿部的接口停在 Ⅰ 型**，
 *     Ⅰ 型只收 A 級模組、所有 8 級模組都是 S 級 ⇒ **A 級的 8 級模組上限是 4/8**，
 *     LV5～LV8 的效果一輩子拿不到。這是結構性的，不是資料缺漏。
 *   · B 級 10 台：官方 `ModuleCarried` 全空、連接口欄位都沒有 ⇒ 全 0。
 *
 * ⚠ 改這張表前先跑 `scripts/check-part-module-drift.mjs`（Phase E）——
 *   「一整批不符」才動這裡，「某台某格不符」該填 `MechPart.innateModules`。
 */
export const INNATE_LEVEL_RULE: Readonly<Record<string, InnateRule>> = {
  S: { trait: everyPart(1), slot8: everyPart(2), builtIn: everyPart(1) },
  A: { trait: everyPart(1), slot8: { torso: 1, leftArm: 0, rightArm: 0, legs: 1 }, builtIn: everyPart(1) },
  B: { trait: everyPart(0), slot8: everyPart(0), builtIn: everyPart(0) },
}

/** 查規則表。認不得的品質回 `null`（今天 90 台全部落在 S／A／B）。 */
export const innateRuleFor = (quality: string | null | undefined): InnateRule | null =>
  (quality && INNATE_LEVEL_RULE[quality]) || null

// ─── 專屬模組：用現有欄位推導，零新欄位 ──────────────────────────────────────

/**
 * 一顆**機甲專屬模組**在某個部位貢獻幾級。不綁這個部位回 0。
 *
 *     level = (levels.length > boundPart.length) ? 2 : 1
 *
 * 直覺是「總級數要靠幾個部位湊出來」：兩個部位各 1 就湊得出 2 級的模組，
 * 而只綁一個部位卻有 2 階的，那一格自己就要出 2 級。
 *
 * ── 驗證（站上 24 顆專屬模組，零例外）────────────────────────────────────
 *   · 帕斯卡 ×4（bp=1, lv=1）→ 各 1          · 破曉者-02 ×4（bp=1, lv=1）→ 各 1
 *   · 信仰之眼〈超限框架〉(bp=2, lv=2) → 各 1，合計 2  · 霸王〈AI火控單元〉(bp=2, lv=2) → 各 1
 *   · 破曉者-01 ×2（bp=2）→ 各 1，合計 2
 *   · 輝龍四顆龍威 ／ 影虎〈虎魄·無束〉（bp=1, lv=2）→ **各 2**
 *   · 彌造者〈帕姆斯陣列〉(bp=1, lv=2) → 各 2 —— 站長**實機確認**：
 *     軀幹 LV1～LV3 為 1 級、**LV4（彩）才變 2 級**，與滿階假設一致。
 *
 * ⚠ `levels[]` 是這條規則的**輸入**，不只是顯示用的文字。三顆專屬模組曾經只存了 1 級
 *   （而且存的是最高級的文字），修好之前這條規則會算錯 —— 見
 *   `scripts/patch-exclusive-module-levels.mjs`。
 * ⚠ `boundPart` 比對用 `includes`（集合語意）。正式庫裡
 *   `["leftArm","rightArm"]` 與 `["rightArm","leftArm"]` **兩種順序同時存在**，
 *   任何「陣列相等」的比法都會漏。
 */
export function exclusivePartLevel(
  mod: Pick<Module, 'boundPart' | 'levels'>,
  position: MechPartPosition,
): number {
  const bound = Array.isArray(mod.boundPart) ? mod.boundPart : []
  if (!bound.includes(position)) return 0
  return (mod.levels?.length ?? 0) > bound.length ? 2 : 1
}

// ─── 逐部位推導 ─────────────────────────────────────────────────────────────

/** 一顆天生模組在某個部位的貢獻，附上它是算出來的還是人工填的。 */
export interface InnateModuleLevel extends InnateModuleEntry {
  /**
   * `rule` ＝ 規則推導、`override` ＝ `MechPart.innateModules` 人工覆寫。
   *
   * ⚠ 放進回傳型別是刻意的（決策三③）：UI 必須分得出兩者，
   *   把它做進型別，呼叫端就不可能忘記標。沉默的覆寫＝沉默的技術債。
   */
  source: InnateSource
}
export type InnateSource = 'rule' | 'override'

/** `resolveInnateModules()` 的結果。 */
export interface InnateResolution {
  /** 這個部位貢獻的天生模組。**未封頂**（封頂是四部位加總後的事） */
  entries: InnateModuleLevel[]
  /** 整格是算的還是人工填的（覆寫一律整格取代，不會半算半填） */
  source: InnateSource
  /**
   * 規則表認不得這台機甲的 `quality`（今天 0 台）。
   * 此時 `entries` **只含專屬模組** —— 特性／8級／副模組三類算不出來。
   */
  unknownQuality: boolean
  /**
   * 資料缺口：這幾顆專屬模組沒填 `boundPart`，因此**不會出現在任何部位**。
   * 今天 0 顆（`mod_星夜女神_fixed_1`〈觀星者單元〉已於 Phase B-2 補上 `["torso"]`）。
   */
  missingBoundPart: string[]
  /**
   * 資料缺口：`moduleFixedIds` 裡這幾個 id **查無模組**，因此算不出部位與級數。
   *
   * ⚠ 這個欄位是 D-1 加的，理由是**不加就會製造一個回歸**：改寫前的前台把三個頂層欄位
   *   原樣列出來，斷鏈的那一顆會印紅字「模組資料已不存在」；改成走推導之後，它會
   *   **從清單裡整顆消失**。`module4Id` / `module8Id` 不受影響（它們不查表就 push，
   *   斷鏈仍會以 `mod === null` 的形式流到 UI）。今天全庫 0 筆。
   */
  unknownModuleIds: string[]
}

/** `resolveInnateModules()` 需要的機甲欄位。用結構型別，`Mech` 與測試 fixture 都餵得進來。 */
export interface InnateMechInput {
  quality?: string
  module4Id?: string
  module8Id?: string
  moduleFixedIds?: readonly string[]
  parts?: Partial<Record<MechPartPosition, { innateModules?: readonly InnateModuleEntry[] } | null>> | null
}

/**
 * 一個部位天生帶了哪幾顆模組、各貢獻幾級。
 *
 * ⚠ **混搭時要傳「這個部位實際來自哪一台」，不是基底機甲。**
 *   換掉的部位帶的是它原本那台機甲的模組（不同 id、不同組合）——
 *   傳錯的症狀是「換了部位但自帶那一列沒變」，也就是這個計畫要修的那個 bug 本身。
 *   來源在 `ResolvedChassis.parts[pos].sourceMechId`。
 *
 * ⚠ **不過濾 `unlockCondition`。** 復仇女神四顆〈模型-XX〉在條件不成立時仍要出現在結果裡，
 *   由 UI 顯示成停用態並講出原因（決策五）—— 直接讓它們消失，玩家會以為是 bug。
 *   要判斷解鎖與否請用 `unlockBlocker()`。
 */
export function resolveInnateModules(
  mech: InnateMechInput | null | undefined,
  position: MechPartPosition,
  lookup: (id: string) => Module | undefined,
): InnateResolution {
  const empty: InnateResolution = {
    entries: [], source: 'rule', unknownQuality: false, missingBoundPart: [], unknownModuleIds: [],
  }
  if (!mech) return empty

  // ① 人工覆寫優先，整格取代。
  //    ⚠ 用 `!== undefined` 而不是 truthy：`[]` 的語意是「這個部位沒有任何天生模組」，
  //      與「照規則算」是兩件事。
  const override = mech.parts?.[position]?.innateModules
  if (override !== undefined) {
    return {
      entries: override.map((e) => ({ moduleId: e.moduleId, level: e.level, source: 'override' as const })),
      source: 'override',
      unknownQuality: false,
      missingBoundPart: [],
      unknownModuleIds: [],
    }
  }

  // ② 規則推導
  const rule = innateRuleFor(mech.quality)
  const entries: InnateModuleLevel[] = []
  const missingBoundPart: string[] = []
  const unknownModuleIds: string[] = []

  const push = (id: string | undefined, level: number) => {
    if (!id || level <= 0) return
    entries.push({ moduleId: id, level, source: 'rule' })
  }

  if (rule) {
    push(mech.module4Id, rule.trait[position])
    push(mech.module8Id, rule.slot8[position])
  }

  // 副模組與專屬模組都住在 moduleFixedIds，靠 slot 分流。
  // ⚠ 專屬模組**不查規則表**——它的部位與級數完全由 boundPart / levels 決定，
  //   所以品質認不得時它照樣算得出來（`unknownQuality` 才只影響上面兩顆）。
  for (const id of mech.moduleFixedIds ?? []) {
    const mod = lookup(id)
    if (!mod) { unknownModuleIds.push(id); continue } // 算不出來，但要講出來（見該欄位註解）
    if (mod.slot === ModuleSlot.EXCLUSIVE) {
      const bound = Array.isArray(mod.boundPart) ? mod.boundPart : []
      if (bound.length === 0) { missingBoundPart.push(id); continue }
      push(id, exclusivePartLevel(mod, position))
    } else if (mod.slot === ModuleSlot.BUILT_IN && rule) {
      push(id, rule.builtIn[position])
    }
  }

  return { entries, source: 'rule', unknownQuality: !rule, missingBoundPart, unknownModuleIds }
}

/** 四個部位一次算完。`sourceOf` 回傳「這個部位來自哪一台」（混搭）。 */
export function resolveInnateByPart(
  sourceOf: (position: MechPartPosition) => InnateMechInput | null | undefined,
  lookup: (id: string) => Module | undefined,
): Record<MechPartPosition, InnateResolution> {
  const out = {} as Record<MechPartPosition, InnateResolution>
  for (const pos of Object.values(MechPartPosition)) {
    out[pos] = resolveInnateModules(sourceOf(pos), pos, lookup)
  }
  return out
}

/**
 * 把四部位的推導結果收成 `moduleStacks({ innate })` 要的形狀（部位 → 貢獻條目）。
 *
 * 存在的理由是**只讓一個地方做這件事**：`ResolvedChassis` 上留的是完整的
 * `InnateResolution`（UI 要 `source` 與資料缺口），而等級池只吃 `entries` ——
 * 各呼叫端自己攤平的話，遲早有人漏掉某個部位或順手把未解鎖的濾掉
 * （未解鎖要留在池子裡，見 `resolveInnateModules()` 的第二條 ⚠）。
 */
export function innateEntries(
  byPart: Readonly<Record<MechPartPosition, InnateResolution>>,
): Record<MechPartPosition, readonly InnateModuleEntry[]> {
  const out = {} as Record<MechPartPosition, readonly InnateModuleEntry[]>
  for (const pos of Object.values(MechPartPosition)) out[pos] = byPart[pos]?.entries ?? []
  return out
}

/**
 * 從天生模組導出**部位倍率**：帶有 `slotLevelMultiplier` 的模組，
 * 會讓它指名的那些部位的**插槽貢獻**翻倍。
 *
 * 今天只有破曉者-02 的兩顆〈匯流樞紐〉（軀幹一顆、腿部一顆），各自只點名自己那一格。
 *
 * ⚠ 同一個部位被兩顆點到時**連乘**（2×2＝4）。「翻倍」的字面意思如此，
 *   但今天沒有這種組合 —— 真的出現時請以實機為準，別把這行當已驗證的行為。
 * ⚠ 只掃**天生**模組。插槽裡裝一顆〈匯流樞紐〉不會有這個效果（它是專屬模組、進不了候選池）。
 */
export function slotMultipliers(
  byPart: Readonly<Record<MechPartPosition, InnateResolution>>,
  lookup: (id: string) => Module | undefined,
): Partial<Record<MechPartPosition, number>> {
  const out: Partial<Record<MechPartPosition, number>> = {}
  for (const res of Object.values(byPart)) {
    for (const e of res.entries) {
      const targets = lookup(e.moduleId)?.slotLevelMultiplier
      if (!targets?.length) continue
      for (const pos of targets) out[pos] = (out[pos] ?? 1) * 2
    }
  }
  return out
}

// ─── 啟用條件 ───────────────────────────────────────────────────────────────

/** `unlockBlocker()` 需要的情境。 */
export interface UnlockContext {
  /** 某顆模組在這套配裝下的生效等級（天生＋插槽，已封頂）。查無回 0 */
  levelOf: (moduleId: string) => number
  /** 某顆模組的最大等級（＝`levels[].length`）。查無回 0 */
  maxLevelOf: (moduleId: string) => number
  /** 當前機師的文件 ID；未選機師時給 null */
  pilotId?: string | null
}

/** 沒解鎖的原因。結構化而不是字串 —— 文案是 UI 的事，這一層只給事實。 */
export type UnlockBlock =
  | { kind: 'moduleAtMaxLevel'; moduleId: string; current: number; required: number }
  | { kind: 'pilotOnly'; pilotIds: string[] }

/**
 * 這顆模組**現在生不生效**。沒有 `unlockCondition` 的（241 筆裡 235 筆）恆回 `null`。
 *
 * ⚠ `required <= 0`（查不到觸發者的階數）一律**判為未解鎖**。
 *   反過來寫的話，資料斷鏈會靜默地把一顆條件模組變成無條件生效 ——
 *   而多算的加成沒有任何症狀。擋住至少會在畫面上留下一句「需要 X 達 LV.MAX」。
 */
export function unlockBlocker(
  mod: Pick<Module, 'unlockCondition'>,
  ctx: UnlockContext,
): UnlockBlock | null {
  const cond = mod.unlockCondition
  if (!cond) return null
  if (cond.kind === 'pilotOnly') {
    return ctx.pilotId && cond.pilotIds.includes(ctx.pilotId)
      ? null
      : { kind: 'pilotOnly', pilotIds: cond.pilotIds }
  }
  const required = ctx.maxLevelOf(cond.moduleId)
  const current = ctx.levelOf(cond.moduleId)
  return required > 0 && current >= required
    ? null
    : { kind: 'moduleAtMaxLevel', moduleId: cond.moduleId, current, required }
}

/** `unlockBlocker() === null` 的簡寫。 */
export const isModuleUnlocked = (mod: Pick<Module, 'unlockCondition'>, ctx: UnlockContext): boolean =>
  unlockBlocker(mod, ctx) === null
