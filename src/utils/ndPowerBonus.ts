// 模組給的神經驅動算力加成（PLAN-052-M）
//
// ── 這一支在回答什麼 ────────────────────────────────────────────────────────
// 「這一套配裝有沒有哪顆模組在加算力？加在哪一區？加完之後那一區是幾級？」
//
// 官方文案（強擊模組 LV.MAX）：
//   「攻擊耐久百分比高於60%的部位時，傷害提升18%；**已解鎖的神經驅動分區中最低的區域算力+3**」
//
// ── 為什麼它會打破「γ 合計 ≤ 23」這條線 ──────────────────────────────────────
// `ND_RULES.gammaPairCap = 23` 是**玩家能投入**的預算（上下 16＋7）。加成不花這個預算，
// 所以生效算力可以是 `16 ＋ 10 ＝ 26`。⇒ **23 是投入上限，不是生效上限**，
// 兩個數字從此不是同一件事，UI 上也必須分開講（見 `NdPowerBar` 的「投入」徽章）。
//
// ── 三條裁決（使用者 2026-08-30，其中一條是實機測出來的）────────────────────
//
// ① **α／β 鎖死在滿級、不開放調整。** 它們只有 3 級、取得成本低，實務上人人點滿。
//    ⇒ 加成的候選只剩 γ 區。判準寫在 `NdPowerBar`（UI）與 `reconcileNdLevels`（資料），
//    本支則直接**只看 γ**。
//    ⚠ 這條剛好與資料一致而不是硬湊：實測 178 個 α／β 分區**零個**帶 `buffUpgrades`
//      ⇒ `defaultNdLevels()` 對它們一律給滿級，鎖死之後值不會變。
//
// ② **候選只取「還能再升」的分區**（`lv < levels.length`）。α／β 恆滿級因此自動出局，
//    這也是①之所以成立的機制 —— 不是另外寫一條「排除 α／β」。
//
// ③ **平手時加在宣告順序較前的那一區**（γ1 勝過 γ2）。⚠ 這一條是**使用者實機測出來的**，
//    不是推導的：官方文案只說「最低的」，沒有講並列怎麼辦。改這一行前請先重測。
//
// ── 為什麼加成不落盤 ────────────────────────────────────────────────────────
// `draft.ndLevels` 永遠只存**玩家投入**的 Lv。加成是配裝狀態的函數（模組 → 算力），
// 落盤等於複製一份會過期的規則（同 `defaultNdLevels()` 不落盤、`partOverrides` 只存差異）。
// ⚠ 更實際的理由：`reconcileNdLevels()` 有一條「γ 投入合計 > 23 就整份丟掉」的閘門。
//   把加成寫進 draft 的話，一套合法的 26 會被那條閘門**靜默洗成預設值**。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import type { NeuralDrive } from '../types'
import type { ModuleStack } from './moduleRules.ts'
import { isGammaZone, zonePower } from './ndOverrides.ts'

/**
 * 會加算力的模組：`模組 doc id → 加多少算力`。**只在該族達 LV.MAX 時生效**。
 *
 * 全庫 241 顆模組掃出來就這兩顆（判準：頂層或任一階敘述含「算力」「神經驅動」「分區」，
 * 2026-08-30 直讀正式庫）：
 *
 *   · `mod_3041` **強擊模組**（機甲8級模組・8 階，Lv8 才有這句）
 *     ⚠ 它**今天就會自己生效**：機甲**疾嘯**的 `module8Id` 就是它，而 S 品質的天生規則是
 *       `slot8: everyPart(2)` ⇒ 四部位各 2 級 ＝ 8 ＝ LV.MAX。選了疾嘯、四部位都留著，
 *       玩家什麼都不用做加成就在。部件混搭換掉一格就掉到 6 級（不觸發）—— 這個臨界會跳。
 *   · `mod_星夜女神_fixed_1` **觀星者單元**（星夜女神專屬・2 階，Lv2 才有這句）
 *     ⚠ 它另外帶 `unlockCondition: pilotOnly [pilot_088_曜]` ⇒ 要一併看 `moduleBlocks`。
 *
 * ⚠ **用 doc id 而不是掃敘述文字**：文案是官方的、會隨改版重寫，而「有沒有這個效果」
 *   是規則。掃字串的下場是官方把「區域算力」改成「分區算力」就整條靜默失效。
 *   代價是新增這種模組時要來這裡補一行 —— 由 `ndPowerBonus.test.ts` 的守門測試提醒。
 */
export const ND_POWER_MODULES: Readonly<Record<string, number>> = {
  mod_3041: 3,
  'mod_星夜女神_fixed_1': 3,
}

export interface NdPowerBonus {
  /**
   * 加成落在哪一區。**`null` ＝ 沒有落點**（所有 γ 區都已滿級，這幾點浪費掉）。
   *
   * ⚠ `null` 不是「沒有加成」——那是本函式回 `null` 的意思。兩者要分得開：
   *   前者圖上要講一句「已滿級，加成無處可去」，後者整段不印。
   *   今天只有單一 γ 區的那 10 位老角走得到（γ 點到 Lv6 ＝ 16，仍在 23 的預算內）。
   */
  zone: string | null
  /** 加多少算力。今天恆為 3 */
  amount: number
  moduleId: string
  /** 顯示用的模組名。呼叫端不必再查一次表 */
  moduleName: string
  /** 玩家在該區**投入**的 Lv（沒有落點時為 0） */
  fromLevel: number
  /** 加成後的**生效** Lv（沒有落點時為 0） */
  level: number
  /** 加成後的**生效**算力（沒有落點時為 0） */
  power: number
}

/**
 * 這一套配裝有沒有算力加成、加在哪一區。**沒有就回 `null`**。
 *
 * @param drives  這位機師的分區（`pilot.neuralDrive`）
 * @param levels  **玩家投入**的 Lv（已疊過 `defaultNdLevels()`）。⚠ 不可傳生效值進來，
 *                否則每 render 一次就再加一次 3
 * @param stacks  `ctx.stacks`（含天生貢獻）。⚠ 不要自己再算一次 `moduleStacks()` ——
 *                疾嘯那 8 級是**天生**的，漏掉 innate 就永遠觸發不了
 * @param blocked `ctx.moduleBlocks`（族鍵 → 未解鎖原因）。觀星者單元限曜駕駛就靠它
 */
export function ndPowerBonus(
  drives: readonly NeuralDrive[] | undefined,
  levels: Record<string, number>,
  stacks: ReadonlyMap<string, ModuleStack>,
  blocked?: ReadonlyMap<string, unknown>,
): NdPowerBonus | null {
  // ── 來源：達 LV.MAX 且沒被解鎖條件擋住的那一顆 ──────────────────────────────
  //
  // ⚠ **只取一顆，不累加**。兩顆同時生效今天走不到（強擊模組只有疾嘯天生帶滿，
  //   而插槽最多湊到 4／8；觀星者單元是星夜女神專屬），而「兩個 +3 是各自挑一次最低區、
  //   還是同一區 +6」官方沒講也沒得測 —— 猜一個寫進來，錯了不會有任何症狀。
  //   真的出現時請先實機確認再改這裡。
  let source: { id: string; name: string; amount: number } | null = null
  for (const [key, st] of stacks) {
    const amount = ND_POWER_MODULES[st.mod.id]
    if (!amount) continue
    if (st.level < st.cap) continue        // 沒到 LV.MAX，那句話還沒出現
    if (blocked?.has(key)) continue        // 解鎖條件不成立（觀星者單元的「限曜駕駛」）
    source = { id: st.mod.id, name: st.mod.name, amount }
    break
  }
  if (!source) return null

  const base: NdPowerBonus = {
    zone: null, amount: source.amount, moduleId: source.id, moduleName: source.name,
    fromLevel: 0, level: 0, power: 0,
  }

  // ── 落點：γ 區裡「還能再升」而且算力最低的那一區（裁決①②）──────────────────
  //
  // ⚠ 用嚴格 `<` 比較 ⇒ **平手時留住先遇到的那一區**，也就是宣告順序較前的 γ1（裁決③）。
  //   改成 `<=` 會變成加在 γ2，而那與實機不符。
  let target: NeuralDrive | null = null
  for (const d of drives ?? []) {
    if (!isGammaZone(d.name)) continue
    const lv = levels[d.name] ?? 0
    if (lv >= (d.levels?.length ?? 0)) continue   // 已滿級，升不上去
    if (!target || zonePower(d, lv) < zonePower(target, levels[target.name] ?? 0)) target = d
  }
  if (!target) return base

  const fromLevel = levels[target.name] ?? 0
  const power = zonePower(target, fromLevel) + source.amount
  // ⚠ 用「門檻 ≤ 生效算力的最高一級」查，**不要寫成 `fromLevel + 1`**。
  //   實測全庫 minSum 間距一律 3 ⇒ 今天兩者等價（`ndPowerBonus.test.ts` 釘住這個前提），
  //   但官方哪天把某一區的間距改掉，查表法自動正確、`+1` 會靜默算錯一級。
  const level = (target.levels ?? []).reduce(
    (best, l) => (l.minSum <= power ? Math.max(best, l.level) : best), 0)

  return { ...base, zone: target.name, fromLevel, level, power }
}

/**
 * 把加成疊上去，得到**生效**的分區 Lv。
 *
 * 「哪些能力亮著」「圖上印幾級」一律問這一份；「玩家投入了多少 / γ 預算用掉多少」
 * 一律問原本那一份。兩者混用的症狀是靜默的：條上亮了第 4 格、投入徽章卻說 23／23 沒滿。
 *
 * ⚠ 沒有加成時**原樣回傳同一個物件**（不是複製一份）：呼叫端多半把它餵給 `useMemo`
 *   的下游，每次都給新參考會讓整條鏈白重算。
 */
export function effectiveNdLevels(
  levels: Record<string, number>,
  bonus: NdPowerBonus | null,
): Record<string, number> {
  if (!bonus?.zone) return levels
  return { ...levels, [bonus.zone]: bonus.level }
}
