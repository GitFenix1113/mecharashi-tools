// 有效出力 —— PLAN-052-A Phase A / A-2
//
// ── 出力是「每個形態各一份」的 ──────────────────────────────────────────────
// 官方整備畫面的 3675 ＝ 3375（軀幹出力）＋ 300（強襲者背包）。換句話說**出力會隨背包變動**，
// 而海莉絲四個形態各有獨立背包 → 呼叫端必須傳入**該形態自己的那一套 set**，
// 不可以傳整份 Build，也不可以只算一次就套用到四個形態。
//
// ── 為什麼加成表要硬編 ────────────────────────────────────────────────────
// 實測（2026-08-23）：`bpskill_出力增幅` 與 `bpskill_強襲者驅動·增傷` 兩支背包技能的
// `effects` 都是**空陣列**，三個等級也一樣 —— 出力加成的數值全庫沒有落盤。
// 現行 SkillEffect 也表達不了「+N 出力」這個維度。所以本檔硬編一張 id → 加成表，
// 並用測試鎖住；等哪天 effects 真的填了，改成讀 effects 再刪掉這張表即可。
//
// ── 計算順序（與 loadoutWeight 的循環）──────────────────────────────────────
// 背包同時吃重量又給出力，看似循環，其實兩邊都只讀「已選定的背包」這一個事實，沒有先後依賴。
// 全站一律 `totalWeight(set, chassis) <= effectiveOutput(chassis, set, modules).total`，
// 各算各的、最後比大小，**不做任何迭代**。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type { Module } from '../types'
import { BackpackType } from '../types/enums.ts'

/**
 * 背包出力加成表（doc id → +出力）。
 *
 * ⚠ 只列**已由官方畫面確認數值**的四筆。其餘 15 筆「出力干擾背包·◯◯」「出力強化背包·◯◯」
 *   （皆 `type: 'PowerAdd'`、weight 150）雖然名字帶出力、也確實會給出力，
 *   但本站尚未取得數值 → 一律回 0 並由 `hasUnknownBackpackBonus()` 標成「未知」，
 *   **不要**用 weight 150 去猜成 +300：那是把猜測寫成事實。
 */
export const BACKPACK_OUTPUT_BONUS: Readonly<Record<string, number>> = {
  '60100102': 200,  // 出力背包Ⅰ（weight 100）· bpskill_出力增幅@1
  '60100103': 250,  // 出力背包Ⅱ（weight 125）· bpskill_出力增幅@2
  '60100104': 300,  // 出力背包Ⅲ（weight 150）· bpskill_出力增幅@3
  '60101706': 300,  // 強襲者背包（weight 150）· bpskill_強襲者驅動·增傷；同時給備用武器槽
}

/** 背部掛載物（背包 **XOR** 背部武器，同一格）。武器沒有出力加成，只有背包會命中加成表。 */
export interface BackMount {
  id?: string
  /** 背包為 BackpackType；武器為 WeaponType（射擊／格鬥／…），兩者值域不重疊 */
  type?: string
}

/** 出力計算需要的裝備組。與 `LoadoutWeightSet` 共用同一個 `back` 欄位，一格一個名字。 */
export interface OutputSet {
  back?: BackMount | null
}

/** 有效出力的逐項拆解。UI 要講出「3375 ＋ 背包 300 ＝ 3675」時用這支。 */
export interface OutputBreakdown {
  /** 軀幹出力（chassisOutput()） */
  base: number
  backpack: number
  modules: number
  total: number
  /**
   * 背包已知會給出力、但本站尚未建檔數值 → UI 應標「未知」而不是把 total 當成準確值。
   * 讓「未知」與「沒有加成」分得開，是這個旗標存在的全部理由。
   */
  hasUnknownBackpackBonus: boolean
}

/** 背包出力加成；非背包（背部武器）或不在表內一律 0。 */
export function backpackOutputBonus(back: BackMount | null | undefined): number {
  return (back?.id && BACKPACK_OUTPUT_BONUS[back.id]) || 0
}

/** 該背部掛載物是否「已知會給出力、但數值未建檔」（15 筆複合出力背包）。 */
export function hasUnknownBackpackBonus(back: BackMount | null | undefined): boolean {
  if (!back?.id) return false
  if (back.id in BACKPACK_OUTPUT_BONUS) return false
  return back.type === BackpackType.POWERADD
}

/**
 * 一顆已裝上的模組，**連同它在這套配裝下的生效等級**。
 *
 * ⚠ 等級一定要由呼叫端算好傳進來（`moduleRules.ts` 的 `moduleStacks()` ＋ `stackLevelOf()`）。
 *   本檔刻意**不自己推等級**：接口上的模組是「同族堆疊」制——裝一顆通用Ⅱ 是 Lv2、
 *   裝兩顆才是 Lv4（052-G C-7），而那件事只有看得到四個接口的呼叫端答得出來。
 */
export interface ModuleAtLevel {
  mod: Pick<Module, 'output_bonus' | 'levels'>
  /** 生效等級（1-based，對應 `levels[].level`）。省略 ⇒ 取滿級 */
  level?: number
}

/**
 * 單一模組的出力加成。
 *
 * 實測 **241 筆模組有 3 筆非 0**（2026-08-28 直讀正式庫重數，訂正原註解的「242 筆 2 筆」）：
 * `mod_4026` 出力模組Ⅰ（A・商店）／`mod_4026_2` 出力模組Ⅱ（S・商店）／
 * `sub_mod_出力模組`（機甲副模組），`levels[]` 皆為 `[25,50,75,100]`。
 * ⚠ **前兩筆在 186 筆候選池裡、玩家裝得到**；副模組那筆是機甲天生自帶，不進候選池。
 * 原註解漏掉的正是「出力模組Ⅰ」——少算一筆會讓人以為這條路徑只影響一顆 S 級模組。
 *
 * ⚠ **`level` 不是選填的方便參數，而是這支函式唯一會算錯的地方。**
 *   2026-08-28 本機實測：接口上裝一顆出力模組Ⅱ，右欄的已裝效果彙總印「出力 +50」（Lv2），
 *   而這裡若取滿級會給 +100 —— 同一頁兩個數字互相打臉。
 *   省略 `level` 只適用於「本來就以滿級計」的呼叫（例如單測與尚未接上堆疊的路徑）。
 *
 * ⚠ 走 `levels[]` 而不是頂層 `output_bonus`：頂層值在多數集合裡是「某一階的快照」，
 *   等級化之後（PLAN-024）唯一可信的是 levels。levels 缺席時才退回頂層。
 */
export function moduleOutputBonus(
  mod: Pick<Module, 'output_bonus' | 'levels'> | null | undefined,
  level?: number,
): number {
  if (!mod) return 0
  const levels = mod.levels ?? []
  if (levels.length > 0) {
    if (level != null) return levels.find((l) => l.level === level)?.output_bonus ?? 0
    const top = levels.reduce((a, b) => (b.level > a.level ? b : a))
    return top.output_bonus ?? 0
  }
  return mod.output_bonus ?? 0
}

/**
 * 有效出力 ＝ 軀幹出力 ＋ 背包加成 ＋ Σ 模組加成。
 *
 * @param chassis 走 `chassisOutput(mech.parts)` 取得的軀幹出力（**不是** `mech.output` 頂層欄位）
 * @param set     **該形態**的裝備組（見檔頭）
 * @param modules 已裝載的模組**與其生效等級**（順序無關）。
 *                ⚠ 每一族只傳**一筆**：同族兩顆是「疊成一個更高的等級」，不是兩份加成
 *                （`moduleStacks()` 回的就是每族一筆，直接餵它即可）。
 *                傳兩筆同族會把 +50 算成 +100，而畫面上完全看不出來。
 */
export function effectiveOutput(
  chassis: { output: number },
  set: OutputSet,
  modules: readonly (ModuleAtLevel | null | undefined)[] = [],
): OutputBreakdown {
  const base = chassis?.output ?? 0
  const backpack = backpackOutputBonus(set.back)
  const mods = modules.reduce((acc, m) => acc + (m ? moduleOutputBonus(m.mod, m.level) : 0), 0)
  return {
    base,
    backpack,
    modules: mods,
    total: base + backpack + mods,
    hasUnknownBackpackBonus: hasUnknownBackpackBonus(set.back),
  }
}
