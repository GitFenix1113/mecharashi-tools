// 機師形態的配裝分頁 —— PLAN-052-A Phase C / C-3
//
// 「這位機師的配裝要開幾個分頁」是模擬器（052-B）與分享碼（052-C）都要問的問題，
// 而且兩邊必須得到**同一個答案**，否則分享碼會指向一個 UI 上不存在的分頁。
// 本檔是那個答案的唯一入口。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type { MechForm } from '../types'

/**
 * 沒有獨立配裝的機師所用的單一分頁鍵。
 *
 * 刻意用一個**保留字**而不是空字串或 null：它會進到分享碼與存檔的鍵裡，
 * 空字串在字串拼接時會靜默消失（`${key}:weapon` → `:weapon`）。
 */
export const DEFAULT_EQUIP_SET_KEY = 'default'

/**
 * 這位機師的配裝分頁鍵清單，依形態的 `order` 排序。
 *
 * 有 `independentLoadout` 且 `restrict.kind === 'weaponType'` 的形態各佔一個分頁；
 * 一個都沒有就回 `['default']`。實測（2026-08-24）：海莉絲 → 3 筆（先鋒／突擊／戰術）、
 * 曜 → `['default']`、其餘 87 位機師 → `['default']`。
 *
 * ⚠ **UI 一律 map over 它，不要 map over `Object.keys(loadouts)`**：
 *   後者是「已經存過東西的分頁」，新建的配裝一個鍵都沒有，分頁會整排消失；
 *   而且鍵的順序由寫入順序決定，換一台機甲就可能重排。
 *
 * ⚠ `kind === 'fixedArmament'` 的形態**不佔分頁**：那種形態鎖死整套配裝
 *   （虛粒子、巡航），沒有東西可配，開一個分頁只會給使用者一個什麼都不能點的畫面。
 *
 * ⚠ 分頁身分用的是 **formId**，不是 `order`。`order` 只影響顯示順序，
 *   後台一次重排就會讓所有既存分享碼靜默指向另一個形態。
 */
export function equipSetKeys(
  pilotId: string,
  forms: readonly MechForm[] | null | undefined,
): string[] {
  const own = (forms ?? [])
    .filter((f) => f.pilotId === pilotId && f.independentLoadout && f.restrict?.kind === 'weaponType')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((f) => f.id)
  return own.length > 0 ? own : [DEFAULT_EQUIP_SET_KEY]
}

/** 這位機師是否有多套配裝（＝要不要渲染分頁列）。 */
export function hasIndependentLoadouts(
  pilotId: string,
  forms: readonly MechForm[] | null | undefined,
): boolean {
  const keys = equipSetKeys(pilotId, forms)
  return keys.length > 1 || keys[0] !== DEFAULT_EQUIP_SET_KEY
}

/**
 * 分頁鍵 → 顯示名。`default` 回 `null`（呼叫端該整排分頁不渲染，而不是顯示一個叫
 * 「預設」的孤兒分頁——只有一個分頁時，分頁列本身就沒有意義）。
 */
export function equipSetLabel(
  key: string,
  forms: readonly MechForm[] | null | undefined,
): string | null {
  if (key === DEFAULT_EQUIP_SET_KEY) return null
  return (forms ?? []).find((f) => f.id === key)?.name ?? null
}
