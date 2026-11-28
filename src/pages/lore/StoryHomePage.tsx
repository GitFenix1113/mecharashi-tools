import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LoreHallHero } from '../../components/lore/LoreHallHero'
import { PILOT_HERO_POOL, pickHeroCard } from '../../components/lore/loreHeroCast'
import { STORY_CATALOG, STORY_KIND_LABEL } from '../../components/lore/story/storyData'
import { storyProgress } from '../../components/lore/story/storyProgress'
import { scenePath } from '../../components/lore/story/storyScenes'
import { StorySelectStage } from '../../components/lore/story/StorySelectStage'
import { readHomeView, writeHomeView, type StoryHomeView } from '../../components/lore/story/storyStage'
import { useStoryProgressVersion } from '../../components/lore/story/useStoryProgress'
import type { StoryCatalogEntry, StoryKind } from '../../components/lore/story/storyTypes'
import { pilotCardArt, pilotGameArt } from '../../utils/gameArt'
import { assetUrl } from '../../utils/assets'

/**
 * 劇情故事館的館首頁（/lore/story）：主線章節、活動劇情、機師回憶三個分頁（?tab=event／memory，主線不寫）。
 *
 * 只讀靜態目錄（src/data/story/index.json，幾 KB），不碰 Firestore；每本書的全文在 StoryBookPage 才 lazy 載入。
 * 資料是台版客戶端的遊戲設定（scripts/import-story.mjs 匯入），版本寫在頁尾。
 *
 * 主線區預設是選章舞台（PLAN-042-K，StorySelectStage），旁邊的「舞台／清單」切換是逃生口，選擇記在本機。
 * 活動與機師回憶維持卡片（D1）；卡片的縮圖是匯入腳本挑的代表圖（index.json 的 cover）。
 */
export default function StoryHomePage() {
  const [heroCard] = useState(() => pickHeroCard(PILOT_HERO_POOL))
  const groups = useMemo(() => {
    const by = new Map<StoryKind, StoryCatalogEntry[]>()
    for (const b of STORY_CATALOG.books) by.set(b.kind, [...(by.get(b.kind) ?? []), b])
    return KINDS.map((k) => ({ kind: k, books: by.get(k) ?? [] })).filter((g) => g.books.length)
  }, [])
  const totalLines = STORY_CATALOG.books.reduce((n, b) => n + b.lines, 0)
  // 閱讀進度只在本機（PLAN-042-I B-5）；訂閱是為了別的分頁讀完回來時數字跟著變
  useStoryProgressVersion()
  const [view, setView] = useState<StoryHomeView>(readHomeView)
  const changeView = (v: StoryHomeView) => {
    writeHomeView(v)
    setView(v)
  }

  // 三種劇情改成分頁（2026-11-28 站長：不要一直往下滾）。分頁寫在網址 ?tab=event（主線不寫），replace：
  // 從劇情頁按上一頁回到同一個分頁；與選章舞台的 ?focus= 並存（兩邊都用函式型更新，不會互相洗掉）
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: StoryKind = groups.some((g) => g.kind === tabParam) ? (tabParam as StoryKind) : groups[0]?.kind ?? 'main'
  const current = groups.find((g) => g.kind === tab)
  const setTab = (k: StoryKind) => {
    setParams((p) => {
      const q = new URLSearchParams(p)
      if (k === 'main') q.delete('tab')
      else q.set('tab', k)
      return q
    }, { replace: true, preventScrollReset: true })
  }
  // 分頁的鍵盤操作（WAI-ARIA tabs）：← → 換分頁、Home／End 到頭尾；焦點跟著移到新分頁
  const tabRefs = useRef(new Map<StoryKind, HTMLButtonElement>())
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = groups.findIndex((g) => g.kind === tab)
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: groups.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    const k = groups[(next + groups.length) % groups.length].kind
    setTab(k)
    tabRefs.current.get(k)?.focus()
  }

  return (
    <div className="lore-story mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <LoreHallHero
        script="Story"
        title="劇情故事館"
        lead={<>收錄主線、活動與機師回憶的關卡對白<br />共 {STORY_CATALOG.books.length} 篇、{totalLines.toLocaleString()} 行</>}
        card={heroCard ? pilotCardArt({ gameId: heroCard }) : undefined}
      />

      <div className="lore-story-tabbar">
        <div className="lore-story-tabs" role="tablist" aria-label="劇情種類" onKeyDown={onTabKey}>
          {groups.map((g) => (
            <button
              key={g.kind} ref={(el) => { if (el) tabRefs.current.set(g.kind, el) }}
              type="button" role="tab" id={`story-tab-${g.kind}`} aria-controls={`story-panel-${g.kind}`}
              aria-selected={g.kind === tab} tabIndex={g.kind === tab ? 0 : -1}
              className="lore-story-tab" onClick={() => setTab(g.kind)}
            >
              {STORY_KIND_LABEL[g.kind]}
              <span className="lore-story-tab__n">{g.books.length}</span>
            </button>
          ))}
        </div>
        {tab === 'main' && (
          <span className="lore-story-view" role="group" aria-label="主線的顯示方式">
            {VIEWS.map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => changeView(v)}>{label}</button>
            ))}
          </span>
        )}
      </div>

      {current && (
        <section role="tabpanel" id={`story-panel-${current.kind}`} aria-labelledby={`story-tab-${current.kind}`}>
          <p className="mb-4 text-xs text-text-dim">{KIND_HINT[current.kind]}</p>
          {current.kind === 'main' && view === 'stage' ? (
            <StorySelectStage books={current.books} />
          ) : (
            <div className={current.kind === 'memory' ? MEMORY_GRID : GRID}>
              {current.books.map((b) => (current.kind === 'memory' ? <MemoryCard key={b.id} book={b} /> : <BookCard key={b.id} book={b} />))}
            </div>
          )}
        </section>
      )}

      <p className="mt-10 border-t border-border pt-4 text-[11px] leading-relaxed text-text-dim">
        文字取自台版遊戲客戶端（{STORY_CATALOG.source.build}，{STORY_CATALOG.source.buildTime.split(' ')[0]}），
        依關卡整理開場過場、戰鬥中與結尾過場的對白；復刻活動與後來併入主線的章節只收一次。
        劇情著作權屬遊戲官方所有。
      </p>
    </div>
  )
}

const KINDS: StoryKind[] = ['main', 'event', 'memory']

const KIND_HINT: Record<StoryKind, string> = {
  main: '世界地圖上的主線章節，含支線與遭遇戰的對白',
  event: '限時活動的劇情關卡（復刻只收一次）',
  memory: '機師個人的回憶篇章',
}

const VIEWS: [StoryHomeView, string][] = [['stage', '舞台'], ['list', '清單']]

const GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
const MEMORY_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'

function BookCard({ book }: { book: StoryCatalogEntry }) {
  return (
    <Link to={`/lore/story/${book.id}`} className={book.cover ? 'lore-story-card has-cover' : 'lore-story-card'}>
      {book.cover && (
        <img
          className="lore-story-card__cover" src={assetUrl(scenePath(book.cover))} alt="" aria-hidden="true"
          width={1920} height={592} loading="lazy" decoding="async"
        />
      )}
      <span className="lore-story-card__k">{book.kind === 'main' ? book.title : STORY_KIND_LABEL[book.kind]}</span>
      <span className="lore-story-card__t">{book.name}</span>
      {book.desc && <span className="lore-story-card__d">{book.desc}</span>}
      <span className="lore-story-card__m">
        {book.stages} 關 · {book.lines.toLocaleString()} 行
        {book.aka && <> · 曾以活動「{book.aka.join('」「')}」推出</>}
        <ReadMark book={book} />
      </span>
    </Link>
  )
}

/** 機師回憶：用機師卡（Icon_item，方形）當縮圖；站上沒有這張卡就只剩名字 */
function MemoryCard({ book }: { book: StoryCatalogEntry }) {
  const art = pilotGameArt({ gameId: book.gameId }, 'card')
  return (
    <Link to={`/lore/story/${book.id}`} className="lore-story-card lore-story-card--pilot">
      {art && <img className="lore-story-card__img" src={assetUrl(art)} alt="" loading="lazy" decoding="async" />}
      <span className="lore-story-card__t">{book.name}</span>
      <span className="lore-story-card__m">
        {book.stages} 關 · {book.lines.toLocaleString()} 行
        <ReadMark book={book} />
      </span>
    </Link>
  )
}

/** 「已讀 3／24」：讀過才出現。數字以目錄的關數封頂（改版拿掉的關，key 還留在進度裡也不會超過） */
function ReadMark({ book }: { book: StoryCatalogEntry }) {
  const n = Math.min(storyProgress.readCount(book.id), book.stages)
  if (!n) return null
  return <span className="lore-story-card__read">已讀 {n}／{book.stages}</span>
}
