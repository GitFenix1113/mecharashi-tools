import type { Weapon } from '../types'

/**
 * 「不適用」的顯示字串（PLAN-040 決策七）。
 * 用全形破折號而非 '-'，與數值欄位的等寬字體並排時不會被誤讀成負號或空值。
 */
export const NA_STAT_TEXT = '—'

/**
 * 依 `weapon.naStats` 決定某個數值欄位要顯示真值還是「—」。
 *
 * 為什麼需要這層而不是直接填 0（決策七）：
 *   `ammoCount === 0` 在本專案**已被佔用為「無限彈藥 ∞」**
 *   （WeaponsPage / WeaponDetailPage 皆為 `ammoCount === 0 ? '∞'`，172 筆中 129 筆靠這條規則），
 *   所以純封鎖型固定武裝若照舊填 0，「沒有彈藥」會被渲染成「無限彈藥」——
 *   一個與遊戲**相反的肯定陳述**。DB 仍存 0，只在渲染層攔下來。
 *
 * @param keys 可傳多個欄位名：任一列入 naStats 即視為不適用。
 *   射程是 minRange + maxRange 合成的單一顯示欄位，必須整組判斷，
 *   否則「minRange 不適用但 maxRange 適用」會渲染出半真半假的 `—-0`。
 *
 * ⚠ naStats 只標「**不適用**」，不標「**未知**」。衝擊炮的 `ammoCount: 1` 與射程 1-3
 *   是真值（可由戰術家［裝填］補充），不在 naStats 內，照常顯示數字。
 */
export function naOr<T>(weapon: Pick<Weapon, 'naStats'>, keys: string | string[], value: T): T | string {
  if (!weapon.naStats?.length) return value
  const ks = typeof keys === 'string' ? [keys] : keys
  return weapon.naStats.some((k) => ks.includes(k)) ? NA_STAT_TEXT : value
}

/** 該欄位是否為「不適用」（需要條件式隱藏附屬資訊時用，如射程不適用就別顯示射程型態） */
export function isNaStat(weapon: Pick<Weapon, 'naStats'>, keys: string | string[]): boolean {
  if (!weapon.naStats?.length) return false
  const ks = typeof keys === 'string' ? [keys] : keys
  return weapon.naStats.some((k) => ks.includes(k))
}

/**
 * 該欄位是否「無固定值」（隨當下裝備的武器變動）→ 渲染層**整格不顯示**。
 *
 * 與 isNaStat 的分工（見 Weapon.variableStats 註解）：
 *   naStats       = 有欄位、沒有值 → 顯示「—」
 *   variableStats = 有值、但不固定 → 收掉整格，另以 variableStatNote 交代
 * 兩者若同時列到同一個 key，本函式優先（該格根本不渲染，naOr 不會被呼叫）。
 */
export function isVariableStat(weapon: Pick<Weapon, 'variableStats'>, keys: string | string[]): boolean {
  if (!weapon.variableStats?.length) return false
  const ks = typeof keys === 'string' ? [keys] : keys
  return weapon.variableStats.some((k) => ks.includes(k))
}

/**
 * 被收掉的數值格的統一說明句。
 *
 * 為什麼收成一支函式：同一句話要出現在武器詳情頁、圖鑑 hover 浮窗、手機 BottomSheet 三處，
 * 各寫一份必然慢慢漂移成三種說法。空陣列回空字串，呼叫端可直接用它當顯示 gate。
 */
export function variableStatNote(hiddenLabels: string[]): string {
  if (!hiddenLabels.length) return ''
  return `※ ${hiddenLabels.join('・')} 隨機甲當下裝備的武器變動，無固定值，故不顯示。`
}

/** 空間不足處（圖鑑卡片）用的極短版說明，與 variableStatNote 同一件事。 */
export const VARIABLE_STAT_SHORT_NOTE = '※ 數值隨裝備的武器變動'
