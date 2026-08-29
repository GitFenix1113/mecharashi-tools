// 攜帶技能的候選池 —— PLAN-052-L Phase D / D-4
//
// ── 這一支在回答什麼 ────────────────────────────────────────────────────────
// 「這位機師的九個技能裡，哪幾個是玩家**選得動**的？」
//
// 答案由技能文件自己的 `unitType` 給（後台那顆下拉選單的三個值）：
//
//   `'6'` 職業單元（初始被動能力）  **天生自帶、不用攜帶、不佔格** ⇒ 不進池子
//   `'0'` 核心單元                  一般技能，可選
//   未填  一般技能                  一般技能，可選
//
// 使用者裁決逐字（2026-08-30）：「天生自帶的技能，我們歸類為『職業單元』。
// 職業單元是不用攜帶的，其他一般技能都是選擇性技能。」
//
// ⚠ **職業單元濾掉就好，不必回傳給 UI 顯示**（使用者裁決 2026-08-30 第二次）：
//   曾經在三格下方列一行「職業單元 ／ 天生自帶，不佔上面的三格」，已移除 ——
//   使用者逐字：「這個不用顯示，這遊戲但凡有點腦子的，真的有玩的玩家不會不知道」。
//   那一行是在替玩家解釋一件他本來就知道的事，而且它與上面三格長得夠像，
//   反而要多花一眼才確認得出「這個點不動」。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import type { Pilot, PilotSkillDoc } from '../types'
import { resolvePilotSkills } from './pilotSkills.ts'

/**
 * 職業單元的 `unitType`。**唯一不佔格的那一種。**
 *
 * 全庫 853 筆技能只有 7 筆帶它（七個職業共用），而 89／89 機師恰好各命中 1 筆 ——
 * 含那 7 位沒有 `biometicComputer` 的 3.3+ 新機師。
 */
const JOB_UNIT_TYPE = '6'

/**
 * 這位機師**帶得動**的技能，順序沿用 `pilot.skills`。
 *
 * 實測（2026-08-30，89 位）每位 6～9 個 —— 三格一律填得滿，沒有空池的機師。
 *
 * ⚠ **判準只有 `unitType === '6'` 一條，不要再加第二條。** 尤其**不可以用
 *   `PilotSkillDoc.manual` 當「天生」的判準** —— 那個旗標記的是「這筆資料是誰建的」
 *   （後台手建 vs 爬蟲），與「要不要攜帶」無關。實測（2026-08-30）：3.3+ 的七位機師
 *   官網還沒放、整份資料由後台手建，於是**九筆技能全部帶著 `manual: true`**，
 *   拿它過濾會讓那七位的候選池整個歸零 —— 而畫面上只會說「沒有可選的技能」，
 *   一句看起來像資料沒建好、實際上是我們自己濾掉的話。
 *
 * ⚠ 也**不可以改用 `unitType === '0'`（核心單元）當候選池**：全庫 853 筆技能有 706 筆
 *   **根本沒有這個欄位**（後台那顆下拉的預設值就是「一般技能（無）」），
 *   用 0 過濾會讓每一位機師的池子只剩不到兩成。要濾掉的是 `'6'`，不是留下 `'0'`。
 *
 * ⚠ **`skillMap` 是空的時候回空陣列**（＝ `pilotSkills` 還沒載入，不是「這位機師
 *   沒有技能」）。呼叫端一律連 loading 一起判斷：`reconcile()` 據此**跳過**驗證，
 *   照著武器那套「查不到就刪」做，症狀是貼一次分享碼、技能就被靜默清空一次
 *   （052-D 的元件正是踩過這個坑）。
 */
export function carriableSkills(
  pilot: Pilot | null | undefined,
  skillMap: ReadonlyMap<string, PilotSkillDoc>,
): PilotSkillDoc[] {
  if (!pilot) return []
  return resolvePilotSkills(pilot.skills, skillMap).filter((d) => d.unitType !== JOB_UNIT_TYPE)
}

/**
 * 這幾個技能 id 裡，哪些是這位機師**帶得動**的（保持原順序、去重）。
 *
 * `reconcile()` 與挑選器共用這一支 —— 各查一次的下場是「面板讓你選、reconcile 又把它掃掉」，
 * 而那看起來像點了沒反應。
 *
 * ⚠ **`skillMap` 空的時候原樣回傳**：那是「還沒載入」，不是「這些技能不存在」。見 `carriableSkills()`。
 */
export function keepCarriableSkills(
  ids: readonly string[],
  pilot: Pilot | null | undefined,
  skillMap: ReadonlyMap<string, PilotSkillDoc>,
): string[] {
  if (skillMap.size === 0) return [...ids]
  const allowed = new Set(carriableSkills(pilot, skillMap).map((d) => d.id))
  const seen = new Set<string>()
  return ids.filter((id) => allowed.has(id) && !seen.has(id) && (seen.add(id), true))
}
