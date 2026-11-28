import { useId } from 'react'
import { Link } from 'react-router-dom'
import { BottomSheet } from '../../common/BottomSheet'
import { locateStage, stageLabel, type OutlineSection } from './storyNav'
import type { StoryCatalogEntry, StoryStage } from './storyTypes'

/**
 * 劇情書頁的關卡導覽（PLAN-042-I B-2／B-4）：桌機常駐關卡列 ＋ 手機底部換關列與關卡清單。
 *
 * 兩邊共用同一份 `StoryStageList`，差別只在收納：
 *   · 桌機（關卡列）：遭遇戰只展開目前所在那一組、活動只展開目前那一幕（計畫書決策三）——
 *     收納後最長的一本也放得進桌機視窗，關卡列不必自己捲動（館內不開第二層 overflow-y，地雷 M-08）。
 *   · 手機（BottomSheet 抽屜）：全部攤開，抽屜本身可以捲。
 *
 * 換關一律 `replace`：照 LoreChapterPager「章節之間用 replace」的慣例——一本二十幾關，
 * 用 push 的話上一頁要一關一關退回去；捲回頂端由 LoreLayout 統一處理（決策 (I)）。
 * ⚠ 不接滾輪（同 LoreChapterPager）。
 */

interface ListProps {
  stages: readonly StoryStage[]
  outline: readonly OutlineSection[]
  index: number
  read: ReadonlySet<string>
  hrefOf: (index: number) => string
  /** 手機抽屜：全部攤開 */
  expandAll?: boolean
  onPick?: () => void
}

export function StoryStageList({ stages, outline, index, read, hrefOf, expandAll, onPick }: ListProps) {
  const here = locateStage(outline, index)
  const row = (i: number, sub: boolean, more = 0) => {
    const s = stages[i]
    const cur = i === index
    return (
      <li key={s.key}>
        <Link
          to={hrefOf(i)}
          replace
          onClick={onPick}
          className={`lore-story-nav__row${sub ? ' is-sub' : ''}${cur ? ' is-cur' : ''}${read.has(s.key) ? ' is-read' : ''}`}
          aria-current={cur ? 'page' : undefined}
          title={s.place ? `${stageLabel(s)}（${s.place}）` : stageLabel(s)}
        >
          <span className="lore-story-nav__code">{sub ? '└' : s.code || '·'}</span>
          <span className="lore-story-nav__name">{s.name}</span>
          {more > 0 && <span className="lore-story-nav__more">＋{more}</span>}
          <span className="lore-story-nav__ck" aria-label={read.has(s.key) ? '已讀' : undefined} />
        </Link>
      </li>
    )
  }
  return (
    <ol className="lore-story-nav__list">
      {outline.map((sec) => {
        const open = expandAll || !sec.foldable || here?.section === sec
        if (!open) {
          // 收合的段（活動分幕、長串切開的一截）：一列標題，點了到該段第一關
          const first = sec.entries[0].index
          const count = sec.entries.reduce((n, e) => n + 1 + e.minors.length, 0)
          return (
            <li key={sec.key}>
              <Link to={hrefOf(first)} replace onClick={onPick} className="lore-story-nav__sec is-folded">
                <span>{sec.label}</span><span className="lore-story-nav__more">{count} 關</span>
              </Link>
            </li>
          )
        }
        return (
          <li key={sec.key}>
            {sec.label && <div className="lore-story-nav__sec">{sec.label}</div>}
            <ol className="lore-story-nav__list">
              {sec.entries.map((e) => {
                const expanded = expandAll || here?.entry === e
                return [
                  row(e.index, false, expanded ? 0 : e.minors.length),
                  ...(expanded ? e.minors.map((m) => row(m, true)) : []),
                ]
              })}
            </ol>
          </li>
        )
      })}
    </ol>
  )
}

// ─── 桌機：常駐關卡列 ────────────────────────────────────────────────────────

interface RailProps extends Omit<ListProps, 'expandAll' | 'onPick'> {
  book: StoryCatalogEntry
  readCount: number
  prevBook?: StoryCatalogEntry
  nextBook?: StoryCatalogEntry
}

export function StoryStageRail({ book, readCount, prevBook, nextBook, ...list }: RailProps) {
  const total = list.stages.length
  return (
    <nav className="lore-story-rail" aria-label="關卡">
      <div className="lore-story-rail__head">
        <span className="lore-story-eyebrow">{book.kind === 'main' ? book.title : '劇情'}</span>
        <Link to={`/lore/story/${book.id}`} replace className="lore-story-rail__title">{book.name}</Link>
        <div className="lore-story-rail__prog">
          <span>已讀 {readCount}／{total}</span>
          <span className="lore-story-rail__bar"><i style={{ width: `${total ? (readCount / total) * 100 : 0}%` }} /></span>
        </div>
      </div>
      <StoryStageList {...list} />
      {(prevBook || nextBook) && (
        <div className="lore-story-rail__foot">
          {prevBook ? <Link to={`/lore/story/${prevBook.id}`}>‹ {railBookLabel(prevBook)}</Link> : <span />}
          {nextBook && <Link to={`/lore/story/${nextBook.id}`}>{railBookLabel(nextBook)} ›</Link>}
        </div>
      )}
    </nav>
  )
}

/** 關卡列底部空間窄：主線只放 Chapter 編號，其餘放名稱 */
const railBookLabel = (b: StoryCatalogEntry) => (b.kind === 'main' ? b.title : b.name)

// ─── 手機：底部換關列＋關卡清單 ──────────────────────────────────────────────

/** 上一關／下一關的連結。同一本書內換關用 replace；跨到隔壁那一本是換書，用 push */
export interface StepLink {
  href: string
  replace: boolean
  label: string
}

interface BarProps extends Omit<ListProps, 'expandAll' | 'onPick'> {
  prev?: StepLink
  next?: StepLink
  /** 抽屜開關由頁面持有：開著時頁面的 ← → 要停用 */
  sheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
}

/**
 * `position: sticky; bottom: 0`，放在頁面容器最後面：黏在館內 scrollport（.lore-scroll）的底部。
 * 不用 fixed——館內的定位層一律留在 .lore-scroll 裡（iOS 觸控捲動，見 LoreLayout 的註解 ①）。
 */
export function StoryStageBar({ prev, next, sheetOpen, onSheetOpenChange, ...list }: BarProps) {
  const s = list.stages[list.index]
  const countId = useId()
  const step = (link: StepLink | undefined, glyph: string, dir: string) =>
    link
      ? <Link to={link.href} replace={link.replace} className="lore-story-bar__step" aria-label={`${dir}：${link.label}`}>{glyph}</Link>
      : <span className="lore-story-bar__step is-off" aria-hidden="true">{glyph}</span>
  return (
    <>
      <nav className="lore-story-bar" aria-label="換關">
        {step(prev, '‹', '上一關')}
        <button type="button" className="lore-story-bar__pick" onClick={() => onSheetOpenChange(true)} aria-haspopup="dialog" aria-describedby={countId}>
          {s.code && <span className="lore-story-nav__code">{s.code}</span>}
          <span className="lore-story-bar__name">{s.name}</span>
          <span id={countId} className="lore-story-bar__count">{list.index + 1}/{list.stages.length} ▾</span>
        </button>
        {step(next, '›', '下一關')}
      </nav>
      <BottomSheet open={sheetOpen} onClose={() => onSheetOpenChange(false)} title="關卡" className="lore-portal">
        <div className="lore-story lore-story-nav--sheet">
          <StoryStageList {...list} expandAll onPick={() => onSheetOpenChange(false)} />
        </div>
      </BottomSheet>
    </>
  )
}
