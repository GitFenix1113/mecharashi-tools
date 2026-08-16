// PLAN-048 Phase 0（任務 0-2）：甘特長條的日精度幾何計算
import type { VisibleActivity } from '../../data/patchVersions/types'

export const DAY_MS = 86_400_000

export function parseDate(str: string): Date {
  const cleaned = str.replace(/^[^0-9]+/, '')
  // 字元類別內 `-` 放最前面即為字面值，不必跳脫（跳脫會被 no-useless-escape 擋）
  const [y, m, d] = cleaned.split(/[-/]/).map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS)
}

export interface BarGeom {
  /** 相對整條週軸的左緣百分比 */
  leftPct: number
  /** 相對整條週軸的寬度百分比 */
  widthPct: number
  /** 起點早於軸首 → 左緣切平，示意「從更早以前延續過來」 */
  clipStart: boolean
  /** 終點晚於軸尾 → 右緣切平 */
  clipEnd: boolean
}

/**
 * 把活動換算成「相對整條週軸」的百分比。
 *
 * 為什麼取代舊的 activityToColumns：舊版用
 * `allWeeks.findIndex(w => w >= startDt)` 把起點量化到**下一個週界**，
 * 1 週活動於是塌成單格，只畫得出一個 12px 圓點（連名稱都放不下）。
 * 實測 75 筆活動裡有 27 筆（36%）正好是 1 週，這是最高 CP 值的一刀。
 *
 * 為什麼是百分比而不是 px：長條層住在 `colSpan={totalWeeks}` 的單一 td 裡，
 * 該 td 寬度＝週欄總寬，會隨容器變動（Tab 展開／視窗縮放／橫捲）。
 * 用 % 就不必量測 DOM、不必 ResizeObserver，也不會有一幀錯位。
 */
export function activityGeometry(act: VisibleActivity, allWeeks: Date[]): BarGeom | null {
  if (allWeeks.length === 0) return null
  const axisStart = allWeeks[0].getTime()
  const totalDays = allWeeks.length * 7
  const axisEnd = axisStart + totalDays * DAY_MS

  const s = parseDate(act.startDate).getTime()
  if (Number.isNaN(s)) return null
  // 結束時刻為 exclusive：weeks=1 代表當週四到下週三，隔週四 00:00 結束
  const e = s + Math.max(act.weeks, 1) * 7 * DAY_MS
  if (e <= axisStart || s >= axisEnd) return null   // 完全落在軸外

  const clampedStart = Math.max(s, axisStart)
  const clampedEnd = Math.min(e, axisEnd)
  const leftPct = ((clampedStart - axisStart) / DAY_MS / totalDays) * 100
  const rawPct = ((clampedEnd - clampedStart) / DAY_MS / totalDays) * 100
  const minPct = (2 / totalDays) * 100               // 至少 2 天寬，避免退化成 0

  return {
    leftPct,
    widthPct: Math.min(Math.max(rawPct, minPct), 100 - leftPct),
    clipStart: s < axisStart,
    clipEnd: e > axisEnd,
  }
}

/**
 * 今日在整條週軸上的百分比位置；不在軸內回 null。
 * Phase 1 的今日線會用到，Phase 0 先建立並納入測試，避免之後補時漏掉邊界。
 */
export function todayPct(allWeeks: Date[], now: Date = new Date()): number | null {
  if (allWeeks.length === 0) return null
  const axisStart = allWeeks[0].getTime()
  const totalDays = allWeeks.length * 7
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const offsetDays = (d.getTime() - axisStart) / DAY_MS
  return offsetDays < 0 || offsetDays > totalDays ? null : (offsetDays / totalDays) * 100
}
