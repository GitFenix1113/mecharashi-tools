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
// 現行 SkillEffect 也表達不了「+N 出力」這個維度。所以本檔硬編一張加成表，
// 並用測試鎖住；等哪天 effects 真的填了，改成讀 effects 再刪掉這張表即可。
//
// ── 表的鍵是「技能」而不是「背包」（PLAN-043 Phase F，2026-08-30）──────────
// 原本硬編的是背包 doc id，於是 15 筆「出力干擾／強化背包·◯◯」全部標成「未知」——
// 它們確實給出力，只是站上沒有數值。後來查清這 98 筆 S+ 複合背包的技能是可推導的
// （＝功能背包技能 ＋ 變體背包技能，官方文本 97/98 逐字相符），`skillIds` 一填，
// 15 筆複合出力背包就跟基礎款掛同一支 `bpskill_出力增幅@3`。
// 把鍵從**實例**移到**技能族**之後，這張表從 4 筆背包 id 縮成 2 支技能、
// 卻涵蓋全部 19 個會給出力的背包，而且日後官方再出複合款也自動命中。
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
 * 出力加成表（`skillIds` 的引用字串 → +出力）。
 *
 * ⚠ 只列**已由官方畫面確認數值**的技能。鍵要與背包 `skillIds` 的元素**逐字相同**
 *   （含 `@N`）——階梯技能的每一級是不同的加成，`bpskill_出力增幅` 不帶級沒有意義。
 * ⚠ 不要用 weight 去猜沒建檔的背包：那是把猜測寫成事實。查不到就讓
 *   `hasUnknownBackpackBonus()` 標成「未知」。
 */
export const SKILL_OUTPUT_BONUS: Readonly<Record<string, number>> = {
  'bpskill_出力增幅@1': 200,        // 出力背包Ⅰ（weight 100）
  'bpskill_出力增幅@2': 250,        // 出力背包Ⅱ（weight 125）
  'bpskill_出力增幅@3': 300,        // 出力背包Ⅲ（weight 150）＋ 15 筆 S+ 複合出力背包
  'bpskill_強襲者驅動·增傷': 300,   // 強襲者背包（SS，weight 150）；同時給備用武器槽
}

/**
 * 背部掛載物（背包 **XOR** 背部武器，同一格）。武器沒有出力加成，只有背包會命中加成表。
 *
 * `skillIds` 直接沿用 `Backpack` 的同名欄位，呼叫端把整個 backpack 傳進來即可
 * （`loadoutRules.ts` 從 `ctx.world.backpacks` 取的就是完整 doc）。背部武器沒有這個欄位 ⇒ 恆 0。
 */
export interface BackMount {
  id?: string
  /** 背包為 BackpackType；武器為 WeaponType（射擊／格鬥／…），兩者值域不重疊 */
  type?: string
  /** 背包掛載的技能引用（`bpskill_出力增幅@3` 這種，可能多筆；PLAN-043） */
  skillIds?: string[]
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

/**
 * 背包出力加成；非背包（背部武器）或掛的技能不在表內一律 0。
 *
 * 加總而非取第一筆：S+ 複合背包掛兩支技能，雖然現況只有功能側那支會給出力，
 * 但「哪一支給」是資料決定的，不該由讀取順序決定。
 */
export function backpackOutputBonus(back: BackMount | null | undefined): number {
  return (back?.skillIds ?? []).reduce((sum, raw) => sum + (SKILL_OUTPUT_BONUS[raw] ?? 0), 0)
}

/**
 * 該背部掛載物是否「已知會給出力、但數值未建檔」。
 *
 * 判準是 `type === PowerAdd` 卻算不出加成 —— 出力背包這條線的每一款都給出力，
 * 所以算出 0 只可能是資料沒建（技能沒掛、或掛了新技能但表裡沒有），不可能是真的沒有。
 * Phase F 回填 98 筆 `skillIds` 之後這裡實務上恆 false，但守門要留著：
 * 官方下次出新的出力背包時，它會再度亮起來，而不是靜靜地算成 0。
 */
export function hasUnknownBackpackBonus(back: BackMount | null | undefined): boolean {
  if (!back?.id) return false
  if (back.type !== BackpackType.POWERADD) return false
  return backpackOutputBonus(back) === 0
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
