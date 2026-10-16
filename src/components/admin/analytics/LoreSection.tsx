// 「故事館」區塊（PLAN-062；PLAN-042-B H-2 起分機師廳／機甲廳）
//
// Phase A：進館漏斗（館首頁 → 扉頁 → 章節）。只用 analyticsDaily.byRoute 既有的故事館 key（每館三個），
// 計算都在 lib/analytics/loreStats.ts 的純函式裡，這裡只負責排版。
//
// 只算故事館正式開放（LORE_OPEN_DATE）之後的日子：之前入口收著，混進來會稀釋佔比。
// 區間被截短時要在畫面上講清楚算了幾天，否則 30 天視圖顯示的其實是 3 天的數字。
import { useMemo } from 'react'
import { sumRoutes } from '../../../lib/firestoreApi'
import { LORE_OPEN_DATE, loreFunnel, loreShare, sinceLoreOpen, type LoreFunnel, type LoreHall } from '../../../lib/analytics/loreStats'
import type { AnalyticsDaily } from '../../../types/analytics'
import { BarList, type BarItem } from './BarList'
import { StatCard } from './StatCard'

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)
const avg = (r: number | null) => (r === null ? '—' : r.toFixed(1))
/** 原始次數多於有效瀏覽時才顯示灰字，寫法與頁面熱度一致。 */
const extra = (pv: number, upv: number) => (pv > upv ? `／${pv.toLocaleString()}` : undefined)

/** @param days 已排除資料不完整日子的區間（AdminAnalyticsPage 的 cleanDays） */
export function LoreSection({ days }: { days: AnalyticsDaily[] }) {
  const scoped = useMemo(() => sinceLoreOpen(days), [days])
  const routes = useMemo(() => sumRoutes(scoped), [scoped])
  const halls = useMemo(() => HALLS.map((h) => ({ ...h, f: loreFunnel(routes, h.hall) })), [routes])

  if (scoped.length === 0) {
    return (
      <div className="text-xs text-text-dim py-3">
        這段期間故事館還沒開放（{LORE_OPEN_DATE} 正式開放）。
      </div>
    )
  }

  const clippedNote = scoped.length < days.length && (
    <p className="text-[11px] text-text-dim mb-3">
      故事館 {LORE_OPEN_DATE} 正式開放，本區塊只計開放後的 <b className="text-text-secondary">{scoped.length} 天</b>。
    </p>
  )

  if (halls.every(({ f }) => f.home.upv + f.file.upv + f.chapter.upv === 0)) {
    return (
      <>
        {clippedNote}
        <div className="text-xs text-text-dim py-3">這段期間還沒有人進故事館</div>
      </>
    )
  }

  return (
    <>
      {clippedNote}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="佔全站有效瀏覽" value={pct(loreShare(routes))} hint="兩館六頁合計" accent="purple" />
        {halls.map(({ hall, name, f }) => (
          <StatCard key={hall} label={`${name}佔比`} value={pct(f.share)} hint={`${name}三頁合計`} accent={hall === 'pilots' ? 'cyan' : 'orange'} />
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        {halls.map((h) => <HallFunnel key={h.hall} {...h} />)}
      </div>
    </>
  )
}

const HALLS: { hall: LoreHall; name: string; noun: string }[] = [
  { hall: 'pilots', name: '機師廳', noun: '機師' },
  { hall: 'mechs', name: '機甲廳', noun: '機甲' },
]

function HallFunnel({ name, noun, f }: { name: string; noun: string; f: LoreFunnel }) {
  const steps: BarItem[] = [
    { key: 'home', label: '館首頁', value: f.home.upv, sub: extra(f.home.pv, f.home.upv) },
    { key: 'file', label: `${noun}扉頁`, value: f.file.upv, sub: extra(f.file.pv, f.file.upv) },
    { key: 'chapter', label: '章節閱讀', value: f.chapter.upv, sub: extra(f.chapter.pv, f.chapter.upv) },
  ]
  const empty = f.home.upv + f.file.upv + f.chapter.upv === 0
  return (
    <div>
      <h3 className="text-xs font-bold text-text-primary mb-2">{name}</h3>
      {empty ? (
        <div className="text-xs text-text-dim py-2">這段期間還沒有人進{name}</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <StatCard
              label="扉頁 → 章節"
              value={pct(f.fileToChapter)}
              hint={`打開${noun}後翻進章節；分享的章節連結會略過扉頁，可能偏高`}
              accent="cyan"
            />
            <StatCard label="平均開啟扉頁" value={avg(f.filesPerVisit)} hint={`每次造訪，含切換${noun}`} accent="orange" />
            <StatCard label="平均閱讀章節頁" value={avg(f.chaptersPerVisit)} hint="每次閱讀，含翻頁" accent="green" />
          </div>
          {/* 固定漏斗順序、不排序：要看的是一路流失多少，不是誰最多 */}
          <BarList items={steps} accent="purple" />
        </>
      )}
    </div>
  )
}
