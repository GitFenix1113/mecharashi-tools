// 每日趨勢折線（PLAN-046 Phase B-3）
//
// 手刻 SVG，不引進圖表函式庫（理由見 StatCard.tsx）。
//
// ⚠ 本元件的重點不是好看，是**不要說謊**：
//   · 缺漏的日子由 API 端補零後傳進來，這裡不做任何「跳過空值」的平滑處理——
//     把沒有流量的日子連成一條直線，看起來就像那幾天有穩定流量。
//   · 資料被熔斷截斷的日子畫成**紅色空心點**並在圖例標明，因為截斷後的曲線
//     看起來完全正常，不標就是拿少了半天的數字在做趨勢判斷。

const W = 600
const H = 150
const PAD_X = 8
const PAD_TOP = 14
const PAD_BOTTOM = 18

export interface TrendPoint {
  date: string
  value: number
  truncated?: boolean
}

const mmdd = (date: string) => date.slice(5).replace('-', '/')

export function TrendChart({
  points,
  accent = 'var(--color-accent-cyan)',
}: {
  points: TrendPoint[]
  accent?: string
}) {
  if (points.length === 0) return null

  const max = Math.max(...points.map((p) => p.value), 1)
  const innerW = W - PAD_X * 2
  const innerH = H - PAD_TOP - PAD_BOTTOM
  const x = (i: number) =>
    points.length === 1 ? W / 2 : PAD_X + (i / (points.length - 1)) * innerW
  const y = (v: number) => PAD_TOP + innerH - (v / max) * innerH

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${PAD_TOP + innerH} L${x(0).toFixed(1)},${PAD_TOP + innerH} Z`

  // x 軸只標首／中／末三個日期：全部標會擠成一團，而趨勢圖要看的是形狀不是逐日值
  const labelIdx = points.length <= 2 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1]
  const truncatedPts = points.filter((p) => p.truncated)

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[150px] overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label="每日趨勢"
      >
        {/* 基準線：頂端是最大值、底端是 0。只畫兩條，多了會蓋過資料本身 */}
        <line x1={PAD_X} y1={PAD_TOP} x2={W - PAD_X} y2={PAD_TOP} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="3 4" />
        <line x1={PAD_X} y1={PAD_TOP + innerH} x2={W - PAD_X} y2={PAD_TOP + innerH} stroke="var(--color-border)" strokeWidth="1" />

        <path d={area} fill={accent} opacity="0.12" />
        <path d={line} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <circle
            key={p.date}
            cx={x(i)}
            cy={y(p.value)}
            r={p.truncated ? 4 : 2.5}
            fill={p.truncated ? 'var(--color-bg-dark)' : accent}
            stroke={p.truncated ? 'var(--color-accent-red)' : 'none'}
            strokeWidth={p.truncated ? 2 : 0}
          >
            <title>
              {p.date}：{p.value.toLocaleString()}
              {p.truncated ? '（資料不完整——當日因寫入預算熔斷而中止記錄）' : ''}
            </title>
          </circle>
        ))}
      </svg>

      <div className="flex justify-between text-[10px] text-text-dim px-1 -mt-3">
        {labelIdx.map((i) => (
          <span key={i}>{mmdd(points[i].date)}</span>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-1 text-[10px] text-text-dim">
        <span>最大值 {max.toLocaleString()}</span>
        {truncatedPts.length > 0 && (
          <span className="text-accent-red">
            ○ 紅圈 = 資料不完整（{truncatedPts.length} 天）
          </span>
        )}
      </div>
    </div>
  )
}
