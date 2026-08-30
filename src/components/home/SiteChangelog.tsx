import { useState, type ReactNode } from 'react'
import { SITE_CHANGELOG } from '../../data/siteChangelog'
import type { ChangelogEntry, ChangelogType } from '../../data/siteChangelog'

const TYPE_META: Record<ChangelogType, { label: string; color: string }> = {
  feat:     { label: '新功能', color: 'text-accent-green' },
  fix:      { label: '修正',   color: 'text-accent-orange' },
  perf:     { label: '效能',   color: 'text-accent-cyan' },
  style:    { label: '外觀',   color: 'text-accent-purple' },
  refactor: { label: '重構',   color: 'text-accent-yellow' },
}

const PREVIEW_COUNT = 3

interface MonthGroup {
  month: string              // YYYY-MM
  entries: ChangelogEntry[]
}
interface YearGroup {
  year: string               // YYYY
  months: MonthGroup[]
}

// 展開檢視的分頁來源：年 → 月 兩層，皆依時間倒序（每月內 entries 亦倒序）
const YEARS: YearGroup[] = (() => {
  const months = [...SITE_CHANGELOG]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map(m => ({
      month: m.month,
      entries: [...m.entries].sort((a, b) => b.date.localeCompare(a.date)),
    }))
  const years: YearGroup[] = []
  for (const m of months) {
    const year = m.month.slice(0, 4)
    let yg = years.find(y => y.year === year)
    if (!yg) {
      yg = { year, months: [] }
      years.push(yg)
    }
    yg.months.push(m)
  }
  return years
})()

/** 通用分頁按鈕 */
function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded border px-2 py-0.5 font-mono text-[0.65rem] tabular-nums transition-colors ${
        active
          ? 'border-accent-orange/50 bg-accent-orange/15 text-accent-orange'
          : 'border-border/40 text-text-secondary hover:border-border-accent hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * 履歷正文只允許 <b>（強調）與 <br>（分段）兩種標籤——來源是版控裡的靜態 TS 檔，
 * 不是使用者輸入。仍不走 dangerouslySetInnerHTML：自行切成 React 節點，
 * 日後就算有人往 summary 塞了別的標籤，也只會被當成純文字印出來，不會執行。
 */
function renderSummary(summary: string, expanded: boolean): ReactNode[] {
  const nodes: ReactNode[] = []
  let bold = false
  summary.split(/(<b>|<\/b>|<br\s*\/?>)/i).forEach((part, i) => {
    if (!part) return
    const tag = part.toLowerCase()
    if (tag === '<b>') { bold = true; return }
    if (tag === '</b>') { bold = false; return }
    if (/^<br\s*\/?>$/.test(tag)) {
      // 折疊預覽是單行 truncate，換行會撐破版面 → 退化成一個空白
      nodes.push(expanded ? <br key={i} /> : ' ')
      return
    }
    nodes.push(bold ? <b key={i} className="font-semibold text-text-primary">{part}</b> : part)
  })
  return nodes
}

/** 單筆履歷列 */
function ChangelogRow({ entry, expanded }: { entry: ChangelogEntry; expanded: boolean }) {
  const meta = TYPE_META[entry.type]
  // 展開時已用年／月分頁，日期只需顯示「日」；折疊預覽時顯示 MM-DD
  const dateLabel = expanded ? entry.date.slice(8) : entry.date.slice(5)
  return (
    <div
      className={`group flex gap-2.5 px-3 py-1.5 border-b border-border/30 last:border-b-0 hover:bg-white/[0.04] transition-colors ${
        expanded ? 'items-start' : 'items-center'
      }`}
    >
      <span className={`font-mono tabular-nums shrink-0 text-accent-orange/85 ${expanded ? 'pt-0.5 w-5 text-right' : ''}`}>{dateLabel}</span>
      <span className={`shrink-0 font-semibold w-9 text-center ${meta.color} ${expanded ? 'pt-0.5' : ''}`}>{meta.label}</span>
      <span className={`flex-1 text-text-secondary ${expanded ? 'break-words leading-relaxed' : 'truncate'}`}>{renderSummary(entry.summary, expanded)}</span>
      {!expanded && (
        <span className="shrink-0 text-text-dim group-hover:text-text-secondary transition-colors">›</span>
      )}
    </div>
  )
}

export default function SiteChangelog() {
  const [expanded, setExpanded] = useState(false)
  const [activeYear, setActiveYear] = useState(YEARS[0]?.year ?? '')
  const [activeMonth, setActiveMonth] = useState(YEARS[0]?.months[0]?.month ?? '')

  const preview = SITE_CHANGELOG
    .flatMap(m => m.entries)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, PREVIEW_COUNT)

  const yearGroup = YEARS.find(y => y.year === activeYear) ?? YEARS[0]
  const monthGroup = yearGroup?.months.find(m => m.month === activeMonth) ?? yearGroup?.months[0]

  // 切換年份時，自動跳到該年最新月份
  const selectYear = (yg: YearGroup) => {
    setActiveYear(yg.year)
    setActiveMonth(yg.months[0]?.month ?? '')
  }

  return (
    <div className="rounded-r-lg border border-border/40 border-l-2 border-l-accent-orange bg-bg-dark/60 text-xs overflow-hidden backdrop-blur-sm">
      {/* Header — live dot + label, with 查看全部 toggle on the right */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.13em] text-accent-orange">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-orange animate-pulse" />
          網站更新履歷
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="font-mono text-[0.6rem] tracking-wider text-text-dim hover:text-text-secondary transition-colors"
        >
          {expanded ? '收合 ▲' : '查看全部 →'}
        </button>
      </div>

      {/* 折疊：最新數筆預覽 */}
      {!expanded && preview.map((entry, i) => (
        <ChangelogRow key={i} entry={entry} expanded={false} />
      ))}

      {/* 展開：年份分頁（跨年度才顯示）＋ 月份分頁 ＋ 該月內容 */}
      {expanded && yearGroup && monthGroup && (
        <>
          {/* 年份 tab：只有跨年度時才出現 */}
          {YEARS.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border/40">
              {YEARS.map(yg => (
                <TabButton
                  key={yg.year}
                  label={`${yg.year} 年`}
                  active={yg.year === yearGroup.year}
                  onClick={() => selectYear(yg)}
                />
              ))}
            </div>
          )}

          {/* 月份 tab */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border/40">
            {yearGroup.months.map(mg => (
              <TabButton
                key={mg.month}
                label={`${parseInt(mg.month.slice(5), 10)} 月`}
                active={mg.month === monthGroup.month}
                onClick={() => setActiveMonth(mg.month)}
              />
            ))}
          </div>

          {/* 該月份履歷列表 */}
          <div className="max-h-72 overflow-y-auto">
            {monthGroup.entries.map((entry, i) => (
              <ChangelogRow key={i} entry={entry} expanded />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
