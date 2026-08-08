// 橫條排行（PLAN-046 Phase B-3）
//
// 長度一律以「本表最大值」為基準而非總和：統計要看的是相對熱度，
// 用佔比會讓長尾全部擠成看不見的細線，反而讀不出第 5 名跟第 10 名差多少。

export interface BarItem {
  key: string
  label: string
  value: number
  /** 次要數值（如頁面熱度的原始 pv），顯示在主值右側 */
  sub?: string
}

export function BarList({
  items,
  empty = '尚無資料',
  accent = 'cyan',
  max: maxOverride,
}: {
  items: BarItem[]
  empty?: string
  accent?: 'cyan' | 'purple' | 'green' | 'orange'
  max?: number
}) {
  if (items.length === 0) {
    return <div className="text-xs text-text-dim py-3">{empty}</div>
  }
  const max = maxOverride ?? Math.max(...items.map((i) => i.value), 1)
  const bar = {
    cyan: 'bg-accent-cyan/60',
    purple: 'bg-accent-purple/60',
    green: 'bg-accent-green/60',
    orange: 'bg-accent-orange/60',
  }[accent]

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-2 text-xs">
          <div className="w-28 shrink-0 truncate text-text-secondary" title={item.label}>
            {item.label}
          </div>
          <div className="flex-1 h-4 bg-bg-dark rounded overflow-hidden">
            <div
              className={`h-full ${bar} rounded transition-[width] duration-300`}
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
          <div className="w-20 shrink-0 text-right font-mono text-text-primary">
            {item.value.toLocaleString()}
            {item.sub && <span className="text-text-dim ml-1">{item.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
