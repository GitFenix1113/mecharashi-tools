// 橫條排行（PLAN-046 Phase B-3）
//
// 長度一律以「本表最大值」為基準而非總和：統計要看的是相對熱度，
// 用佔比會讓長尾全部擠成看不見的細線，反而讀不出第 5 名跟第 10 名差多少。
//
// ── 名稱欄寬度：整表一個 grid，讓欄寬跟著內容走 ──────────────────────────────
// 原本每列各自是 flex，名稱欄寫死 w-28（112px）。語言／來源那種短標籤綽綽有餘，
// 但實體排行的標籤是完整文件 ID（`weapon_169_天燼審判`），一律被截成 `weapon_169_天…`，
// 排行榜最需要看的「是誰」反而看不到。
//
// 改成整份清單共用一個三欄 grid、名稱欄用 minmax(0, auto)：
//   · 欄寬自動取該表最長標籤的寬度 —— 不必為每個呼叫端猜一個 w-XX 魔術數字；
//   · 短標籤的表（語言／裝置）欄位自動變窄，橫條反而更長，比原本好讀；
//   · 空間不足時仍可壓縮，配合 max-w 與 truncate 保底，不會把橫條擠成 0。
// 每列用 display:contents 攤平，讓三個儲存格直接落進同一個 grid 而不是各自成列。
import { Fragment } from 'react'

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
    <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 text-xs">
      {items.map((item) => (
        <Fragment key={item.key}>
          {/* max-w 是保底：標籤異常長時（未知的新 ID 形制）截斷它，而不是把橫條擠沒 */}
          <div className="max-w-[14rem] truncate text-text-secondary" title={item.label}>
            {item.label}
          </div>
          <div className="h-4 bg-bg-dark rounded overflow-hidden">
            <div
              className={`h-full ${bar} rounded transition-[width] duration-300`}
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
          <div className="w-20 text-right font-mono text-text-primary">
            {item.value.toLocaleString()}
            {item.sub && <span className="text-text-dim ml-1">{item.sub}</span>}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
