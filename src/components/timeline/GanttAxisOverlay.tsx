// PLAN-048 Phase 1（任務 1-4）：共用軸線層 —— 週格線 / 上下半分界 / 今日線
import { todayPct } from './ganttGeometry'

/**
 * 日精度長條的必要配套：長條左緣不再貼齊週界之後，若沒有格線，
 * 「8/09 起的活動從第一欄三分之一處開始」看起來就只像跑版。
 *
 * 這一層絕對定位在甘特的長條區之上（pointer-events-none），左側偏移必須與
 * 表格的標籤欄同寬，才會與上方固定資訊表的欄界對齊。
 */
export default function GanttAxisOverlay({
  allWeeks,
  upperCount,
  labelColPx,
}: {
  allWeeks: Date[]
  /** 上半版本佔幾欄；用來畫上下半的分界線 */
  upperCount: number
  /** 左側標籤欄寬度（px），與 Colgroup 的第一欄一致 */
  labelColPx: number
}) {
  const total = allWeeks.length
  if (total === 0) return null

  const today = todayPct(allWeeks)

  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-0"
      style={{ left: `${labelColPx}px` }}
      aria-hidden
    >
      {/* 週格線 */}
      {allWeeks.map((_, i) =>
        i === 0 ? null : (
          <div
            key={i}
            className="absolute inset-y-0 w-px bg-[#1d2230]"
            style={{ left: `${(i / total) * 100}%` }}
          />
        ),
      )}

      {/* 上下半版本分界（比週格線重，因為它是語意邊界不只是刻度） */}
      {upperCount > 0 && upperCount < total && (
        <div
          className="absolute inset-y-0 w-px bg-accent-cyan/35"
          style={{ left: `${(upperCount / total) * 100}%` }}
        />
      )}

      {/* 今日線：站上第一次有「今天在哪」的錨點 */}
      {today !== null && (
        <div
          className="absolute inset-y-0 w-px bg-accent-orange/75"
          style={{ left: `${today}%` }}
        >
          <span className="absolute top-0 left-1 text-[9px] leading-none text-accent-orange/90 whitespace-nowrap">
            今日
          </span>
        </div>
      )}
    </div>
  )
}
