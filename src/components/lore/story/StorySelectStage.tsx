import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { assetUrl } from '../../../utils/assets'
import { scenePath } from './storyScenes'
import { stageLabel, stageOutline, stagePath, resolveStageIndex } from './storyNav'
import { storyProgress } from './storyProgress'
import { useStoryProgressVersion } from './useStoryProgress'
import {
  defaultFocus, focusIndex, outlineStages, WHEEL_IDLE, wheelCapture, wheelStep, type WheelState,
} from './storyStage'
import type { StoryCatalogEntry, StoryOutline, StoryStage as Stage } from './storyTypes'

/**
 * 選章舞台（PLAN-042-K）：館首頁主線區的音遊選曲式換章。
 *
 *   ┌───────────┬──────────────────────────────────────┐
 *   │  Ch-II    │                 ［代表圖：交叉淡入］  │
 *   │ ▶Ch-III ◀ │                                      │
 *   │  Ch-IV    │  章名、簡介、關數／已讀               │
 *   │  …        │  ▶ 繼續閱讀 3-5   從頭讀   直接跳關…  │
 *   └───────────┴──────────────────────────────────────┘
 *
 * 三條護欄（計畫書決策一，版本時間線捨棄焦點輪播的教訓）：
 *   · 一步進入：舞台上直接繼續閱讀／從頭讀／跳關，不做展開動畫；點旁邊的章換焦點、點中央的章就進入。
 *   · 焦點寫在網址 ?focus=main-4（replace）：從閱讀器按上一頁會落在同一章。焦點由網址推導，元件不存 state。
 *   · 清單逃生口在 StoryHomePage（舞台／清單切換）。
 *
 * 輸入只接明確意圖：滾輪的接管規則在 storyStage.ts（整塊可見、不是頁面捲動的延續、頭尾放行）；
 * 方向鍵只在章節列取得焦點時作用（VersionRail 的教訓）。手機（< 768px）改成橫向滑條，不碰垂直捲動。
 * ⚠ 不得開 overflow-y：館內唯一的 scrollport 是 .lore-scroll（M-08）。
 */
export function StorySelectStage({ books }: { books: StoryCatalogEntry[] }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  useStoryProgressVersion()
  const ids = useMemo(() => books.map((b) => b.id), [books])
  const index = focusIndex(ids, params.get('focus'), defaultFocus(books, (id) => storyProgress.readCount(id)))
  const book = books[index]
  const uid = useId()

  const setFocus = useCallback((i: number) => {
    const next = Math.min(Math.max(i, 0), ids.length - 1)
    setParams((p) => {
      const q = new URLSearchParams(p)
      q.set('focus', ids[next])
      return q
    }, { replace: true, preventScrollReset: true })
  }, [ids, setParams])

  // 關卡大綱：舞台掛上才載（16 KB），給「繼續閱讀」的關名與「直接跳關」
  const [outline, setOutline] = useState<StoryOutline | null>(null)
  useEffect(() => {
    let alive = true
    import('../../../data/story/outline.json').then((m) => { if (alive) setOutline(m.default as unknown as StoryOutline) })
    return () => { alive = false }
  }, [])

  // ── 滾輪：規則在 storyStage.ts；這裡只負責量「整塊可見」與「頁面多久前捲過」 ──
  const stageRef = useRef<HTMLDivElement>(null)
  // 監聽器只掛一次，最新的焦點從 ref 讀（render 後才寫，不在 render 中改 ref）
  const live = useRef({ index, count: ids.length, setFocus })
  useEffect(() => { live.current = { index, count: ids.length, setFocus } })
  useEffect(() => {
    const el = stageRef.current
    const scroller = el?.closest('.lore-scroll')
    if (!el || !scroller) return
    let lastPageScroll = -Infinity
    let wheel: WheelState = WHEEL_IDLE
    const onScroll = () => { lastPageScroll = performance.now() }
    const onWheel = (e: WheelEvent) => {
      if (!window.matchMedia('(min-width: 768px)').matches || e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
      const now = performance.now()
      const box = el.getBoundingClientRect()
      const port = scroller.getBoundingClientRect()
      const { index: i, count, setFocus: go } = live.current
      const capture = wheelCapture({
        dir: e.deltaY > 0 ? 1 : -1, index: i, count,
        fullyVisible: box.top >= port.top - 1 && box.bottom <= port.bottom + 1,
        msSincePageScroll: now - lastPageScroll,
      })
      if (!capture) { wheel = WHEEL_IDLE; return }
      e.preventDefault()
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      const r = wheelStep(wheel, delta, now)
      wheel = r.state
      if (r.step) go(i + r.step)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  // 手機滑條：把焦點那顆捲到中間。直接對滑條 scrollTo（不用 scrollIntoView，免得連館內 scrollport 一起捲——VersionRail 的做法）
  const listRef = useRef<HTMLDivElement>(null)
  const centered = useRef(false)
  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-i="${index}"]`)
    if (!list || !item || list.scrollWidth <= list.clientWidth) return
    list.scrollTo({ left: item.offsetLeft - list.clientWidth / 2 + item.offsetWidth / 2, behavior: centered.current ? 'smooth' : 'auto' })
    centered.current = true
  }, [index])

  if (!book) return null
  const stages = outline?.[book.id] ? outlineStages(outline[book.id]) : null
  const href = (bookId: string) => `/lore/story/${bookId}`
  const progress = storyProgress.progressOf(book.id)
  const readN = Math.min(storyProgress.readCount(book.id), book.stages)
  const resumeIdx = stages && progress.last ? resolveStageIndex(stages, progress.last) : -1
  const resumeHref = progress.last ? (stages && resumeIdx >= 0 ? stagePath(book.id, stages, resumeIdx) : `${href(book.id)}/${progress.last}`) : null

  const onListKey = (e: React.KeyboardEvent) => {
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, PageUp: -5, PageDown: 5 }[e.key]
    if (step) { e.preventDefault(); setFocus(index + step) }
    else if (e.key === 'Home') { e.preventDefault(); setFocus(0) }
    else if (e.key === 'End') { e.preventDefault(); setFocus(ids.length - 1) }
    else if (e.key === 'Enter') { e.preventDefault(); navigate(resumeHref ?? href(book.id)) }
  }

  return (
    <div ref={stageRef} className="lore-stage">
      {/* 代表圖：焦點與前後各一章掛著（預載＋淡出），其餘不載 */}
      <div className="lore-stage__bgs" aria-hidden="true">
        {books.map((b, i) => (Math.abs(i - index) <= 1 && b.cover ? (
          <div key={b.id} className={i === index ? 'lore-stage__bg is-on' : 'lore-stage__bg'}>
            <img className="lore-stage__blur" src={assetUrl(scenePath(b.cover))} alt="" decoding="async" />
            <img className="lore-stage__hero" src={assetUrl(scenePath(b.cover))} alt="" decoding="async" width={1920} height={592} />
          </div>
        ) : null))}
      </div>

      <div className="lore-stage__wheel">
        <button type="button" className="lore-stage__arrow is-up" aria-label="上一章" disabled={index <= 0} onClick={() => setFocus(index - 1)}>︿</button>
        <div
          ref={listRef} className="lore-stage__list" role="listbox" tabIndex={0} aria-label="主線章節（↑↓ 換章、Enter 進入）"
          aria-activedescendant={`${uid}-${index}`} onKeyDown={onListKey}
        >
          {books.map((b, i) => {
            const off = i - index
            const far = Math.abs(off) > 3
            return (
              <button
                key={b.id} id={`${uid}-${i}`} data-i={i} type="button" role="option" aria-selected={i === index} tabIndex={-1}
                className={i === index ? 'lore-stage__item is-focus' : 'lore-stage__item'}
                style={{
                  transform: `translateY(calc(-50% + ${off * 62}px)) scale(${i === index ? 1 : 0.94})`,
                  opacity: far ? 0 : [1, 0.7, 0.42, 0.18][Math.abs(off)],
                  visibility: far ? 'hidden' : undefined,
                }}
                onClick={() => (i === index ? navigate(resumeHref ?? href(b.id)) : setFocus(i))}
              >
                <span className="lore-stage__item-k">{b.title}</span>
                <span className="lore-stage__item-n">{b.name}</span>
                <ReadDot book={b} />
              </button>
            )
          })}
        </div>
        <button type="button" className="lore-stage__arrow is-down" aria-label="下一章" disabled={index >= ids.length - 1} onClick={() => setFocus(index + 1)}>﹀</button>
        <p className="lore-stage__hint">滾輪或 ↑↓ 換章 · 點中間進入</p>
      </div>

      <div className="lore-stage__info">
        <p className="lore-stage__eyebrow">{book.title}<span>{index + 1}／{books.length}</span></p>
        <h3 className="lore-stage__title" aria-live="polite">{book.name}</h3>
        {book.desc && <p className="lore-stage__desc">{book.desc}</p>}
        <p className="lore-stage__meta">
          {book.stages} 關 · {book.lines.toLocaleString()} 行
          {readN > 0 && (
            <span className="lore-stage__read">
              <span className="lore-stage__bar"><i style={{ width: `${(readN / book.stages) * 100}%` }} /></span>
              已讀 {readN}／{book.stages}
            </span>
          )}
        </p>
        <div className="lore-stage__acts">
          {resumeHref ? (
            <>
              <Link to={resumeHref} className="lore-stage__btn is-primary">
                ▶ 繼續閱讀{stages && resumeIdx >= 0 && <small>{stageLabel(stages[resumeIdx])}</small>}
              </Link>
              <Link to={href(book.id)} className="lore-stage__btn">從頭讀</Link>
            </>
          ) : (
            <Link to={href(book.id)} className="lore-stage__btn is-primary">▶ 開始閱讀</Link>
          )}
        </div>
        {stages && <JumpChips key={book.id} bookId={book.id} stages={stages} read={progress.read} />}
      </div>
    </div>
  )
}

/** 章節列上的小紅點：這章讀過一點＝空心、讀完＝實心 */
function ReadDot({ book }: { book: StoryCatalogEntry }) {
  const n = storyProgress.readCount(book.id)
  if (!n) return null
  const done = n >= book.stages
  return <span className={done ? 'lore-stage__dot is-done' : 'lore-stage__dot'} title={done ? '已讀完' : `已讀 ${Math.min(n, book.stages)}／${book.stages}`} />
}

/** 直接跳關：正關與支線（遭遇戰照 042-I 的關卡列收在正關底下，這裡不列）；預設兩行，多的收起來 */
function JumpChips({ bookId, stages, read }: { bookId: string; stages: Stage[]; read: string[] }) {
  const [all, setAll] = useState(false)
  const readSet = new Set(read)
  const entries = stageOutline(stages).flatMap((sec) => sec.entries.map((e) => ({ i: e.index, branch: sec.key === 'branch' })))
  // 「全部 N 關」只在兩排真的放不下時出現：放得下幾顆看寬度與字級，不能用固定的「超過 8 關」判斷
  const chipsRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const el = chipsRef.current
    if (!el || all) return
    const measure = () => setOverflow(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [all, entries.length])
  return (
    <div className="lore-stage__jump">
      <p className="lore-stage__jump-h">直接跳關</p>
      <div ref={chipsRef} className={all ? 'lore-stage__chips is-all' : 'lore-stage__chips'}>
        {entries.map(({ i, branch }) => {
          const s = stages[i]
          return (
            <Link key={s.key} to={stagePath(bookId, stages, i)} className={readSet.has(s.key) ? 'lore-stage__chip is-read' : 'lore-stage__chip'}>
              {s.code ? <span className="lore-stage__chip-c">{s.code}</span> : branch && <span className="lore-stage__chip-c">支線</span>}
              {s.name}
            </Link>
          )
        })}
      </div>
      {(overflow || all) && (
        <button type="button" className="lore-stage__more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '收起' : `全部 ${entries.length} 關 ▾`}
        </button>
      )}
    </div>
  )
}
