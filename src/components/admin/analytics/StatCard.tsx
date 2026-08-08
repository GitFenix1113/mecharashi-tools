// 總量卡片（PLAN-046 Phase B-3）
//
// 刻意不引進圖表函式庫：為了幾張長條圖與一條折線付出約 100 KB gzip 不划算，
// 對中國訪客的載入成本尤其不利（整個 PLAN-029 就是為了他們做的）。
// 站上的視覺風格本來就適合純 CSS/SVG。

export function StatCard({
  label,
  value,
  hint,
  accent = 'cyan',
}: {
  label: string
  value: string | number
  hint?: string
  accent?: 'cyan' | 'purple' | 'green' | 'orange'
}) {
  const color = {
    cyan: 'text-accent-cyan',
    purple: 'text-accent-purple',
    green: 'text-accent-green',
    orange: 'text-accent-orange',
  }[accent]

  return (
    <div className="bg-bg-card border border-border rounded-xl px-4 py-3">
      <div className="text-[11px] text-text-dim tracking-wider">{label}</div>
      <div className={`text-2xl font-bold font-[Orbitron,sans-serif] ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-text-dim mt-0.5 leading-snug">{hint}</div>}
    </div>
  )
}
