import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoreHallHero } from '../../components/lore/LoreHallHero'
import { PILOT_HERO_POOL, pickHeroCard } from '../../components/lore/loreHeroCast'
import { STORY_CATALOG, STORY_KIND_LABEL } from '../../components/lore/story/storyData'
import { storyProgress } from '../../components/lore/story/storyProgress'
import { useStoryProgressVersion } from '../../components/lore/story/useStoryProgress'
import type { StoryCatalogEntry, StoryKind } from '../../components/lore/story/storyTypes'
import { pilotCardArt, pilotGameArt } from '../../utils/gameArt'
import { assetUrl } from '../../utils/assets'

/**
 * 劇情故事館的館首頁（/lore/story）：主線章節、活動劇情、機師回憶三區。
 *
 * 只讀靜態目錄（src/data/story/index.json，幾 KB），不碰 Firestore；每本書的全文在 StoryBookPage 才 lazy 載入。
 * 資料是台版客戶端的遊戲設定（scripts/import-story.mjs 匯入），版本寫在頁尾。
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

  return (
    <div className="lore-story mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <LoreHallHero
        script="Story"
        title="劇情故事館"
        lead={<>收錄主線、活動與機師回憶的關卡對白<br />共 {STORY_CATALOG.books.length} 篇、{totalLines.toLocaleString()} 行</>}
        card={heroCard ? pilotCardArt({ gameId: heroCard }) : undefined}
      />

      {groups.map((g) => (
        <section key={g.kind} className="mb-10 last:mb-0">
          <h2 className="mb-1 flex items-center gap-2">
            <span aria-hidden className="h-4 w-[3px] bg-[#b10000]" />
            <span className="text-sm font-bold text-text-primary">{STORY_KIND_LABEL[g.kind]}</span>
            <span className="text-xs text-text-dim">{g.books.length}</span>
          </h2>
          <p className="mb-4 text-xs text-text-dim">{KIND_HINT[g.kind]}</p>
          <div className={g.kind === 'memory' ? MEMORY_GRID : GRID}>
            {g.books.map((b) => (g.kind === 'memory' ? <MemoryCard key={b.id} book={b} /> : <BookCard key={b.id} book={b} />))}
          </div>
        </section>
      ))}

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

const GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
const MEMORY_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'

function BookCard({ book }: { book: StoryCatalogEntry }) {
  return (
    <Link to={`/lore/story/${book.id}`} className="lore-story-card">
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
