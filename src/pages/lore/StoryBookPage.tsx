import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { usePageTitle } from '../../contexts/PageTitleContext'
import { usePilots } from '../../hooks/useFirestore'
import { StoryLines } from '../../components/lore/story/StoryLines'
import { StorySceneShot } from '../../components/lore/story/StorySceneShot'
import {
  FACE_PREF_KEY, mapStripPath, readStoryPref, SCENE_PREF_KEY, writeStoryPref,
} from '../../components/lore/story/storyScenes'
import { StoryStageBar, StoryStageRail, type StepLink } from '../../components/lore/story/StoryStageNav'
import {
  hasStoryBook, loadStoryBook, storyDisplayName, storyEntry, storyNeighbors, STORY_KIND_LABEL,
} from '../../components/lore/story/storyData'
import {
  legacyHashStage, resolveStageIndex, stageLabel, stageNeighbors, stageOutline, stagePath, type StageTarget,
} from '../../components/lore/story/storyNav'
import { storyProgress } from '../../components/lore/story/storyProgress'
import { useStoryProgress } from '../../components/lore/story/useStoryProgress'
import type { StoryBook, StoryCrossRef, StoryPart, StoryStage } from '../../components/lore/story/storyTypes'

/**
 * 劇情故事館的一本書：主線一章、一個活動、或一位機師的回憶。PLAN-042-I 起**一次只放一關**。
 *
 *   /lore/story/:id          書根＝第一關（完整書頭）
 *   /lore/story/:id/:part    其他關（:part 是關卡 key w108／l…／m…，遊戲設定 ID）
 *
 * 目前在哪一關**由網址推導**（純衍生值），元件不持有 activeIndex——PLAN-050 與 LoreChapterPager 的同一條規則。
 * 換關只改 pathname；捲回頂端、按上一頁還原位置都交給 LoreLayout（決策 (I)），這裡不自己捲。
 *
 * 全文是 src/data/story/<種類>/<ID>.json，lazy 載入（一本約 50–300 KB）。
 * ⚠ 本頁不得開 overflow-y：全館唯一的 scrollport 是 LoreLayout 的 .lore-scroll（見該檔）。
 */
export default function StoryBookPage() {
  const { id, part } = useParams<{ id: string; part?: string }>()
  if (!hasStoryBook(id)) return <Navigate to="/lore/story" replace />
  // key 只綁書：同一本換關時書檔、續讀提示的狀態都留著，換書才整頁重掛
  return <StoryBookView key={id} id={id} part={part} />
}

/** 本機的開關偏好（storyScenes.ts）：[目前值, 切換] */
function useStoryPref(key: string) {
  const [on, setOn] = useState(() => readStoryPref(key))
  const toggle = () => {
    writeStoryPref(key, !on)
    setOn(!on)
  }
  return [on, toggle] as const
}

/** 水平滑動換關的門檻：照 LoreChapterPager（位移夠大、且明顯偏水平才算換關意圖） */
const SWIPE_MIN_PX = 48
const SWIPE_AXIS_RATIO = 1.5

function StoryBookView({ id, part }: { id: string; part: string | undefined }) {
  const entry = storyEntry(id)
  const navigate = useNavigate()
  const { hash } = useLocation()
  const [book, setBook] = useState<StoryBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // 續讀點在進書當下拍一張：之後的記錄（visit）不該讓提示列自己改來改去
  const [resumeKey] = useState(() => (part ? null : storyProgress.progressOf(id).last))
  const progress = useStoryProgress(id)
  // 「場景圖」「頭像」開關（PLAN-042-J）：個人偏好、只存本機，換書時重讀一次就夠（只有這一頁會改它）
  const [showScenes, toggleScenes] = useStoryPref(SCENE_PREF_KEY)
  const [showFaces, toggleFaces] = useStoryPref(FACE_PREF_KEY)

  useEffect(() => {
    let alive = true
    loadStoryBook(id).then(
      (b) => { if (alive) setBook(b) },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { alive = false }
  }, [id])

  const stages = useMemo(() => book?.stages ?? [], [book])
  const outline = useMemo(() => stageOutline(stages), [stages])
  const index = book ? resolveStageIndex(stages, part) : -1
  const stage: StoryStage | undefined = stages[index]
  const readSet = useMemo(() => new Set(progress.read), [progress.read])
  const readCount = stages.filter((s) => readSet.has(s.key)).length
  const books = storyNeighbors(id)
  const hrefOf = (i: number) => stagePath(id, stages, i)

  // 網址修正：舊版錨點 #w108 → 新網址；不認得的關卡 key → 書根
  useEffect(() => {
    if (!book) return
    if (!part && hash) {
      const key = legacyHashStage(book.stages, hash)
      navigate(key ? stagePath(id, book.stages, resolveStageIndex(book.stages, key)) : `/lore/story/${id}`, { replace: true })
    } else if (part && index < 0) {
      navigate(`/lore/story/${id}`, { replace: true })
    }
  }, [book, part, hash, index, id, navigate])

  // 記下「上次讀到這一關」：明確選過的關才算。直接開書根時若已經有進度就不覆寫——
  // 只是點進來看一眼，不該把「讀到 3-5」洗成「讀到 3-1」
  useEffect(() => {
    if (!stage) return
    if (part || !storyProgress.progressOf(id).last) storyProgress.visit(id, stage.key)
  }, [id, part, stage])

  // 關末出現在畫面上＝這一關讀完（短關捲不動也算得到，所以看「出現」而不是「捲過」）
  const tailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = tailRef.current
    if (!el || !stage) return
    const io = new IntersectionObserver(
      (ents) => { if (ents.some((e) => e.isIntersecting)) storyProgress.markRead(id, stage.key) },
      { root: el.closest('.lore-scroll'), rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [id, stage])

  // 上一關／下一關：同書換關 replace、跨到隔壁那一本 push（StepLink）。memo 住，← → 的監聽才不會每次重畫都重掛
  const { prev, next, crossesBook } = useMemo(() => {
    if (index < 0) return { prev: undefined, next: undefined, crossesBook: false }
    const nb = stageNeighbors(stages, index, storyNeighbors(id))
    const toLink = (t: StageTarget | undefined): StepLink | undefined =>
      !t ? undefined
        : t.kind === 'stage'
          ? { href: stagePath(id, stages, t.index), replace: true, label: stageLabel(stages[t.index]) }
          : { href: `/lore/story/${t.entry.id}`, replace: false, label: storyDisplayName(t.entry) }
    return { prev: toLink(nb.prev), next: toLink(nb.next), crossesBook: nb.next?.kind === 'book' }
  }, [id, stages, index])

  // ← → 換關（照 useLoreHall：修飾鍵與輸入框排除；關卡清單抽屜開著時不作用）
  useEffect(() => {
    if (!stage) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || sheetOpen) return
      // target 不一定是元素（直接對 window／document 發的事件），沒有 closest 就當不在輸入框裡
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const link = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : undefined
      if (!link) return
      e.preventDefault()
      navigate(link.href, { replace: link.replace })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, prev, next, sheetOpen, navigate])

  // 水平滑動換關：只掛在正文上、不 preventDefault（垂直捲動才是館內唯一的閱讀方式，門檻本身就是守門員）
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touch.current = t ? { x: t.clientX, y: t.clientY } : null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current
    touch.current = null
    const t = e.changedTouches[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy) * SWIPE_AXIS_RATIO) return
    const link = dx < 0 ? next : prev
    if (link) navigate(link.href, { replace: link.replace })
  }

  const title = entry ? `${storyDisplayName(entry)} 劇情` : null
  usePageTitle(stage && index > 0 && title ? `${stageLabel(stage)}｜${title}` : title)

  const resumeIndex = resumeKey ? resolveStageIndex(stages, resumeKey) : -1
  const showResume = !part && resumeIndex > 0

  return (
    <div className="lore-story mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 sm:pt-10">
      <nav className="mb-6 text-xs text-text-dim">
        <Link to="/lore/story" className="no-underline text-text-secondary hover:text-text-primary">劇情故事館</Link>
        <span className="mx-1.5">/</span>
        {entry && STORY_KIND_LABEL[entry.kind]}
      </nav>

      <div className="lore-story-reader">
        {entry && stage && (
          <aside className="lore-story-reader__rail">
            <StoryStageRail
              book={entry} readCount={readCount} prevBook={books.prev} nextBook={books.next}
              stages={stages} outline={outline} index={index} read={readSet} hrefOf={hrefOf}
            />
          </aside>
        )}

        <div className="lore-story-reader__main">
          {showResume && (
            <Link to={hrefOf(resumeIndex)} replace className="lore-story-resume">
              <span className="lore-story-resume__k">上次讀到</span>
              <span className="lore-story-resume__t">{stageLabel(stages[resumeIndex])}</span>
              <span className="lore-story-resume__go">繼續 ›</span>
            </Link>
          )}

          {entry && (part ? (
            // 第二關起只留精簡書頭：書名回書根，關卡標題在下面的紙面裡
            <header className="mb-5">
              <span className="lore-story-eyebrow">{entry.kind === 'main' ? entry.title : STORY_KIND_LABEL[entry.kind]}</span>
              <Link to={`/lore/story/${id}`} replace className="lore-story-h1--compact">{entry.name}</Link>
            </header>
          ) : (
            <header className="mb-8">
              <span className="lore-story-eyebrow">{entry.kind === 'main' ? entry.title : STORY_KIND_LABEL[entry.kind]}</span>
              <h1 className="lore-story-h1">{entry.name}</h1>
              {entry.desc && <p className="lore-story-desc">{entry.desc}</p>}
              <p className="mt-3 text-xs text-text-dim">
                {entry.stages} 關 · {entry.lines.toLocaleString()} 行
                {entry.aka && <> · 曾以活動「{entry.aka.join('」「')}」推出</>}
              </p>
              {book && <CrossRefs book={book} />}
            </header>
          ))}

          {error && (
            <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
              劇情載入失敗：{error}
            </div>
          )}
          {!book && !error && <BookSkeleton />}

          {book && stage && (
            <>
              <article className="lore-story-sheet" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                <StageView
                  stage={stage} book={book}
                  showScenes={showScenes} onToggleScenes={toggleScenes} showFaces={showFaces} onToggleFaces={toggleFaces}
                />
                <div ref={tailRef} className="lore-story-tail" aria-hidden="true" />
              </article>
              <EndNav prev={prev} next={next} crossesBook={crossesBook} />
            </>
          )}
        </div>
      </div>

      {stage && (
        <StoryStageBar
          prev={prev} next={next} sheetOpen={sheetOpen} onSheetOpenChange={setSheetOpen}
          stages={stages} outline={outline} index={index} read={readSet} hrefOf={hrefOf}
        />
      )}
    </div>
  )
}

// ─── 一關 ────────────────────────────────────────────────────────────────────

const PART_LABEL: Record<StoryPart['at'], string> = { start: '開場', battle: '戰鬥中', end: '結尾' }

/**
 * 三段改成段落小標，不再收合（一關最長 393 行，計畫書決策六）。
 * 場景條（PLAN-042-J）：過場依 shots 插定場鏡頭；主線的戰鬥段落開頭放該章的區域地圖——
 * 戰鬥段第一行本身就是戰中過場（有 CG）時不疊。說話者頭像畫在名字旁（StoryLines）。
 * 「場景圖」「頭像」開關只在這一關真的有那種圖時才出現，免得按了沒反應。
 */
function StageView({ stage: s, book, showScenes, onToggleScenes, showFaces, onToggleFaces }: {
  stage: StoryStage
  book: StoryBook
  showScenes: boolean
  onToggleScenes: () => void
  showFaces: boolean
  onToggleFaces: () => void
}) {
  const battleMap = (p: StoryPart) => p.at === 'battle' && !!book.map && p.shots?.[0]?.[0] !== 0
  const hasScenes = s.parts.some((p) => !!p.shots?.length || battleMap(p))
  const hasFaces = !!book.faces && s.parts.some((p) => !!p.face)
  return (
    <>
      <header className="lore-story-stagehead">
        {s.group && <span className="lore-story-stagehead__group">{s.group}</span>}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {s.code && <span className="lore-story-stage__code">{s.code}</span>}
          <h2 className="lore-story-stage__name">{s.name}</h2>
          {s.place && <span className="text-xs text-text-dim">{s.place}</span>}
          {s.branch && <span className="lore-story-tag">支線</span>}
          {(hasScenes || hasFaces) && (
            <span className="lore-story-toggles">
              {hasScenes && (
                <button
                  type="button" className="lore-story-toggle" aria-pressed={showScenes} onClick={onToggleScenes}
                  title={showScenes ? '隱藏場景圖，只看文字' : '顯示遊戲裡的場景背景'}
                >
                  場景圖
                </button>
              )}
              {hasFaces && (
                <button
                  type="button" className="lore-story-toggle" aria-pressed={showFaces} onClick={onToggleFaces}
                  title={showFaces ? '隱藏說話者頭像' : '在名字旁顯示說話者頭像'}
                >
                  頭像
                </button>
              )}
            </span>
          )}
        </div>
      </header>
      {s.desc && <p className="lore-story-brief">{s.desc}</p>}
      {s.parts.map((p) => (
        <section key={p.at} className="lore-story-part">
          <h3 className="lore-story-part__h">
            <span className="lore-story-part__label">{PART_LABEL[p.at]}</span>
            <span className="lore-story-part__n">{p.lines.filter(Boolean).length} 行</span>
          </h3>
          {showScenes && book.map && battleMap(p) && (
            <StorySceneShot
              key={book.map} map path={mapStripPath(book.map)}
              caption={book.region ? `戰場 · ${book.region}` : '戰場'}
            />
          )}
          <StoryLines
            lines={p.lines} shots={p.shots} showShots={showScenes}
            face={p.face} faces={book.faces} showFaces={showFaces}
          />
        </section>
      ))}
    </>
  )
}

/** 關末：上一關／下一關（下一關較寬、較醒目）；末關接「本章完 · 下一本」 */
function EndNav({ prev, next, crossesBook }: { prev?: StepLink; next?: StepLink; crossesBook: boolean }) {
  if (!prev && !next) return null
  return (
    <nav className="lore-story-end" aria-label="上一關／下一關">
      {prev ? (
        <Link to={prev.href} replace={prev.replace} className="lore-story-end__card">
          <small>‹ {prev.replace ? '上一關' : '上一篇'}</small>
          <span>{prev.label}</span>
        </Link>
      ) : <span className="lore-story-end__card is-ghost" aria-hidden="true" />}
      {next ? (
        <Link to={next.href} replace={next.replace} className="lore-story-end__card is-next">
          <small>{crossesBook ? '本篇完 · 下一篇 ›' : '下一關 ›'}</small>
          <span>{next.label}</span>
        </Link>
      ) : <span className="lore-story-end__card is-ghost" aria-hidden="true" />}
      <p className="lore-story-end__hint">也可以按 <kbd>←</kbd> <kbd>→</kbd> 換關</p>
    </nav>
  )
}

// ─── 書頭：互相參照 ──────────────────────────────────────────────────────────

/** 去重留下的註記：活動只收了多出來的關（其餘見主線）、主線則反過來指向活動版多出的那幾關；機師回憶連回機師故事館 */
function CrossRefs({ book }: { book: StoryBook }) {
  const pilotLink = usePilotLoreLink(book.gameId)
  const refs: { key: string; node: React.ReactNode }[] = []
  for (const r of book.seeAlso ?? []) refs.push({ key: `s${r.id}`, node: <>其餘 {r.stages} 關與 <RefLink r={r} /> 相同，不重複收錄</> })
  for (const r of book.extra ?? []) refs.push({ key: `e${r.id}`, node: <>活動版另有 {r.stages} 關，見 <RefLink r={r} /></> })
  if (pilotLink) refs.push({ key: 'pilot', node: <>人物檔案見 <Link to={pilotLink.to}>{pilotLink.name} 的機師故事館</Link></> })
  if (!refs.length) return null
  return (
    <ul className="mt-3 space-y-1 text-xs text-text-secondary">
      {refs.map((r) => <li key={r.key}>※ {r.node}</li>)}
    </ul>
  )
}

function RefLink({ r }: { r: StoryCrossRef }) {
  const e = storyEntry(r.id)
  return <Link to={`/lore/story/${r.id}`}>{e ? `〈${storyDisplayName(e)}〉` : r.id}</Link>
}

/**
 * 機師回憶 → 該機師的故事館扉頁。gameId 對 pilots.gameId；pilots 走 GameDataContext 的版本快取，
 * 從館首頁或圖鑑過來的人多半已經載過、不會再讀。讀不到就不放連結（不擋劇情本身）。
 */
function usePilotLoreLink(gameId: string | undefined): { to: string; name: string } | null {
  const { data: pilots } = usePilots()
  return useMemo(() => {
    if (!gameId) return null
    const p = pilots.find((x) => x.gameId === gameId)
    return p ? { to: `/lore/pilots/${p.id}`, name: p.name } : null
  }, [pilots, gameId])
}

// ─── 雜項 ────────────────────────────────────────────────────────────────────

function BookSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-bg-card" />
      ))}
    </div>
  )
}
