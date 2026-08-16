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

/** 半版本的預設長度。官方慣例，實測全程如此；例外由 PatchHalf.weeks 覆寫。 */
export const DEFAULT_HALF_WEEKS = 3

/**
 * 一段半版本的週軸。
 *
 * 長度來源的優先序（**活動不在其中**，見下）：
 *   ① endStr —— 下一段的開始日，是實際日期而非慣例，最可靠（上半用下半的開始日）
 *   ② explicitWeeks（PatchHalf.weeks）—— 維護者手動指定的例外
 *   ③ DEFAULT_HALF_WEEKS
 *
 * ⚠ **週軸絕不被活動撐長。** 舊版會拿最長的活動去延伸軸尾，於是 v3.1 下半
 * （7/30 起、3 週）因為一條 6 週的戰令而長出 8/20～9/3 三欄 —— 那三週實際上
 * 屬於 v3.2，甘特卻把它們畫成 v3.1 的一部分。跨版本的活動改由 activityGeometry
 * 在軸尾切平（clipEnd，長條右緣不收圓角），這才是「延續到下個版本」的正確表達；
 * 把軸拉長是拿顯示錯誤去遷就一條長條。
 */
export function generateWeeks(
  startStr: string,
  endStr: string | null,
  explicitWeeks?: number,
): Date[] {
  if (!startStr) return []
  const start = parseDate(startStr)
  const end = halfEndDate(startStr, endStr, explicitWeeks)
  if (!end) return []

  const weeks: Date[] = []
  let cur = start
  while (cur < end) {
    weeks.push(cur)
    cur = addDays(cur, 7)
  }
  return weeks
}

/**
 * 半版本的結束日（exclusive，即下一段的第一天）。長度來源同 `generateWeeks`。
 *
 * 抽出來是因為它有第二個用途：後台要用「半版本結束日 − 活動起始日」替
 * 只寫「⟨日期⟩ 起」的卡池算出**建議**週數。兩處必須是同一條規則 ——
 * 否則會出現「後台建議 3 週、甘特卻畫成 2 週」這種自相矛盾。
 */
export function halfEndDate(
  startStr: string,
  endStr: string | null,
  explicitWeeks?: number,
): Date | null {
  if (!startStr) return null
  const start = parseDate(startStr)

  if (endStr) {
    const end = parseDate(endStr)
    // 下一段的開始日若早於起點（資料填錯），退回慣例長度而不是產出空軸
    if (end > start) return end
  }
  const w = Number.isFinite(explicitWeeks) && (explicitWeeks ?? 0) > 0
    ? Math.round(explicitWeeks!)
    : DEFAULT_HALF_WEEKS
  return addDays(start, w * 7)
}

/**
 * 依「檔期到半版本結束為止」推算建議週數。回傳 null ＝ 推不出來，別顯示建議。
 *
 * ⚠ 這是**建議值，不是資料**。卡池公告常常只寫「起」，因為它跟著半版本結束
 * （遊戲內畫面可佐證：v3.1 下半的佐伊池顯示「卡池結束於 2026/8/20 10:00」，
 * 而 8/20 正是 v3.2 上半的開始日）。但官方偶爾會變動，所以維護者明確要求
 * **不自動填**——這個值只能顯示給人看、由人按下才寫入。
 */
export function suggestWeeksUntilHalfEnd(activityStart: string, halfEnd: Date | null): number | null {
  if (!activityStart || !halfEnd) return null
  const s = parseDate(activityStart)
  if (Number.isNaN(s.getTime())) return null
  const days = (halfEnd.getTime() - s.getTime()) / DAY_MS
  if (days <= 0) return null           // 活動起始日晚於半版本結束 → 資料有問題，不猜
  return Math.max(1, Math.round(days / 7))
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
