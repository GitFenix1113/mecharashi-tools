// 官配（機師 ↔ 機甲）推導 —— PLAN-054
//
// ── 一句話 ──────────────────────────────────────────────────────────────────
// **官配只存機師側**（`Pilot.pairedMechId`），機甲側一律從這裡推導。
//
// ── 為什麼不兩邊都存 ────────────────────────────────────────────────────────
// 兩邊都存就得兩邊同步：後台改了機師忘了機甲，畫面上兩頁說法不一，而且沒有任何東西會報錯。
// 推導則不會壞——機甲頁要讀 pilots 集合，但它本來就在 GameDataContext 的版本快取裡，
// 不增加 Firestore read。
//
// ── 資料來源 ────────────────────────────────────────────────────────────────
// v3 定版對照（2026-10-03）：v1.1 起每版 2 S 機師＋2 S 機甲同上線、「機師執照＝機甲裝甲」
// 唯一配對 47 組，加上開服 v1.0 站長指定 14 組，共 61 組、61／61 對稱。
// 不存「為什麼沒有官配」（賽文是贈送角色、帕斯卡／信仰之眼是聯動、凜騎士是塗裝）——畫面上不顯示該列即可。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import type { Pilot } from '../types/pilot.ts'

type PairSide = Pick<Pilot, 'id' | 'pairedMechId'>

/**
 * 機甲的官配機師：找 `pairedMechId === mechId` 的那位。
 *
 * 資料錯誤（兩位以上機師配到同一台）時回**文件 ID 最小**的那位——結果穩定、不隨陣列順序跳動；
 * 錯誤本身由 `duplicatePairs()` 抓出來給後台與守門測試看，不在這裡靜默吞掉。
 */
export function pairedPilotOf<P extends PairSide>(mechId: string, pilots: readonly P[]): P | undefined {
  let found: P | undefined
  for (const p of pilots) {
    if (p.pairedMechId !== mechId) continue
    if (!found || p.id < found.id) found = p
  }
  return found
}

/**
 * 被兩位以上機師配到的機甲 → 那些機師的 ID（依 ID 排序）。
 * 官配是 1:1，正常資料回空 Map；後台存檔前與資料檢查用。
 */
export function duplicatePairs(pilots: readonly PairSide[]): Map<string, string[]> {
  const byMech = new Map<string, string[]>()
  for (const p of pilots) {
    if (!p.pairedMechId) continue
    const list = byMech.get(p.pairedMechId)
    if (list) list.push(p.id)
    else byMech.set(p.pairedMechId, [p.id])
  }
  const dup = new Map<string, string[]>()
  for (const [mechId, ids] of byMech) {
    if (ids.length > 1) dup.set(mechId, [...ids].sort())
  }
  return dup
}
