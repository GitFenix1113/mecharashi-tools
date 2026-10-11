// PLAN-048 Phase 0：活動的衍生狀態（零新增欄位）
import type { VisibleActivity } from '../../data/patchVersions/types'
// 帶 .ts 副檔名：本檔受 node --test 覆蓋，Node 原生 ESM 解析需要明確副檔名
// （同 src/utils/ 下受測模組的既有慣例）
import { DAY_MS, parseDate } from './ganttGeometry.ts'

export interface ActivityStatus {
  start: Date
  /** 結束時刻，**exclusive**（＝活動最後一天的隔天 00:00），與全站既有慣例一致 */
  endExclusive: Date
  /**
   * 跨了幾個週次（整數）。官方寫明的非整週檔期（如「預熱衝刺」週六開、37 天＝5.29 週）
   * 會無條件進位成 6 —— 卡片上寫「第 2/5.29 週」沒有意義，而且「末週」永遠判定不到。
   */
  totalWeeks: number
  phase: 'upcoming' | 'ongoing' | 'ended'
  /** 進行到第幾週（1-based）；非進行中為 0 */
  weekIndex: number
  /** 到結束還有幾天（含今天）；非進行中為 0 */
  daysLeft: number
  isFinalWeek: boolean
  /** 0–1，卡片上的細進度條用 */
  progress: number
}

/**
 * 全部從既有的 `startDate + weeks` 導出，**不新增任何欄位**。
 *
 * 設計原則：**凡是能算的，就不要問維護者。**
 * 玩家最常問的三個問題（這週有什麼／這活動什麼時候結束／這版有誰）裡有
 * 兩個半完全不需要新資料，而衍生值是唯一「零維護成本、上線當天 100%
 * 覆蓋率」的資訊來源——對照 0/5 定律（集合會被填滿、選填欄位不會），
 * 能算的東西開成選填欄位只會得到一堆空值。
 *
 * `now` 可注入，讓測試不依賴系統時間。
 */
export function activityStatus(act: VisibleActivity, now: Date = new Date()): ActivityStatus {
  const weeks = Math.max(act.weeks, 1)
  const start = parseDate(act.startDate)
  // 天數取整：小數週是 spanToWeeks 四捨五入到 0.01 的結果（37 天 → 5.29 → 37.03 天），
  // 不取整的話結束時刻會多出 40 分鐘的零頭
  const endExclusive = new Date(start.getTime() + Math.round(weeks * 7) * DAY_MS)
  const totalWeeks = Math.ceil(weeks - 1e-9)

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const t = today.getTime()

  const phase: ActivityStatus['phase'] =
    t < start.getTime() ? 'upcoming'
    : t >= endExclusive.getTime() ? 'ended'
    : 'ongoing'

  const elapsedDays = Math.floor((t - start.getTime()) / DAY_MS)
  const totalDays = Math.round(weeks * 7)
  const weekIndex = phase === 'ongoing' ? Math.floor(elapsedDays / 7) + 1 : 0
  const daysLeft = phase === 'ongoing'
    ? Math.ceil((endExclusive.getTime() - t) / DAY_MS)
    : 0

  return {
    start,
    endExclusive,
    totalWeeks,
    phase,
    weekIndex,
    daysLeft,
    isFinalWeek: phase === 'ongoing' && weekIndex === totalWeeks,
    progress: phase === 'ended' ? 1 : Math.max(0, Math.min(1, elapsedDays / totalDays)),
  }
}
