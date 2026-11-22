import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { usePageTitle } from '../../contexts/PageTitleContext'
import { usePilots } from '../../hooks/useFirestore'
import { StoryLines } from '../../components/lore/story/StoryLines'
import {
  hasStoryBook, loadStoryBook, storyDisplayName, storyEntry, storyNeighbors, STORY_KIND_LABEL,
} from '../../components/lore/story/storyData'
import type { StoryBook, StoryCrossRef, StoryPart, StoryStage } from '../../components/lore/story/storyTypes'

/**
 * 劇情故事館的一本書（/lore/story/:id）：主線一章、一個活動、或一位機師的回憶。
 *
 * 全文是 src/data/story/<種類>/<ID>.json，lazy 載入（一章約 50–300 KB、gzip 後約四分之一）。
 * 每關三段——開場過場／戰鬥中／結尾過場——各是一個 <details>，預設展開；
 * 「全部收合」可先看關卡清單。目錄點下去會展開那一關並捲過去。
 *
 * ⚠ 本頁不得開 overflow-y：全館唯一的 scrollport 是 LoreLayout 的 .lore-scroll（見該檔）。
 *   所以長對白不做內捲框，靠收合控制長度。
 */
export default function StoryBookPage() {
  const { id } = useParams<{ id: string }>()
  if (!hasStoryBook(id)) return <Navigate to="/lore/story" replace />
  // key：換書時整頁重掛，載入狀態與展開狀態都從頭來
  return <StoryBookView key={id} id={id} />
}

function StoryBookView({ id }: { id: string }) {
  const entry = storyEntry(id)
  const [book, setBook] = useState<StoryBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openAll, setOpenAll] = useState(true)
  usePageTitle(entry ? `${storyDisplayName(entry)} 劇情` : null)

  useEffect(() => {
    let alive = true
    loadStoryBook(id).then(
      (b) => { if (alive) setBook(b) },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { alive = false }
  }, [id])

  const { prev, next } = storyNeighbors(id)

  return (
    <div className="lore-story mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <nav className="mb-6 text-xs text-text-dim">
        <Link to="/lore/story" className="no-underline text-text-secondary hover:text-text-primary">劇情故事館</Link>
        <span className="mx-1.5">/</span>
        {entry && STORY_KIND_LABEL[entry.kind]}
      </nav>

      {entry && (
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
      )}

      {error && (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
          劇情載入失敗：{error}
        </div>
      )}
      {!book && !error && <BookSkeleton />}
      {book && (
        <>
          <Toc stages={book.stages} openAll={openAll} onToggleAll={() => setOpenAll((v) => !v)} />
          <Stages stages={book.stages} openAll={openAll} />
        </>
      )}

      <nav className="mt-12 grid grid-cols-2 gap-3 border-t border-border pt-6 text-sm">
        <div>{prev && <NeighborLink to={prev.id} dir="prev" label={storyDisplayName(prev)} />}</div>
        <div className="text-right">{next && <NeighborLink to={next.id} dir="next" label={storyDisplayName(next)} />}</div>
      </nav>
    </div>
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

// ─── 目錄 ────────────────────────────────────────────────────────────────────

function Toc({ stages, openAll, onToggleAll }: { stages: StoryStage[]; openAll: boolean; onToggleAll: () => void }) {
  const jump = (key: string) => {
    const el = document.getElementById(key)
    if (!el) return
    el.querySelectorAll('details').forEach((d) => { d.open = true })
    // 不用 smooth：關卡掛著 content-visibility:auto，平滑捲動途經的關卡會從估計高度（900px）變成實際高度，
    // 終點在出發時就算好了，抵達時會偏掉一截（實測 Chapter-II 跳 2-5 偏 98px）。
    // 瞬間跳過去只有目標附近會排版；再等兩個 frame 補一次，吸收目標上一關展開後的高度變化。
    el.scrollIntoView({ block: 'start' })
    requestAnimationFrame(() => requestAnimationFrame(() => el.scrollIntoView({ block: 'start' })))
  }
  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-bold tracking-widest text-text-secondary">關卡</span>
        <button type="button" className="lore-story-btn" onClick={onToggleAll}>
          {openAll ? '全部收合' : '全部展開'}
        </button>
      </div>
      <ol className="lore-story-toc">
        {stages.map((s) => (
          <li key={s.key}>
            <button type="button" onClick={() => jump(s.key)} title={s.place ? `${s.name}（${s.place}）` : s.name}>
              {s.code && <span className="lore-story-toc__code">{s.code}</span>}
              {s.name}
              {s.branch && <span className="lore-story-tag">支線</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─── 關卡 ────────────────────────────────────────────────────────────────────

const PART_LABEL: Record<StoryPart['at'], string> = { start: '開場', battle: '戰鬥中', end: '結尾' }

function Stages({ stages, openAll }: { stages: StoryStage[]; openAll: boolean }) {
  return (
    <div>
      {stages.map((s, i) => (
        <div key={s.key}>
          {/* 活動分幕：換幕時插一行幕名 */}
          {s.group && s.group !== stages[i - 1]?.group && <h2 className="lore-story-group">{s.group}</h2>}
          <section id={s.key} className="lore-story-stage">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {s.code && <span className="lore-story-stage__code">{s.code}</span>}
              <h3 className="lore-story-stage__name">{s.name}</h3>
              {s.place && <span className="text-xs text-text-dim">{s.place}</span>}
              {s.branch && <span className="lore-story-tag">支線</span>}
            </header>
            {s.desc && <p className="lore-story-brief">{s.desc}</p>}
            {s.parts.map((p) => (
              <details key={p.at} className="lore-story-part" open={openAll}>
                <summary>
                  <span className="lore-story-part__label">{PART_LABEL[p.at]}</span>
                  <span className="text-[11px] text-text-dim">{p.lines.filter(Boolean).length} 行</span>
                </summary>
                <StoryLines lines={p.lines} />
              </details>
            ))}
          </section>
        </div>
      ))}
    </div>
  )
}

// ─── 雜項 ────────────────────────────────────────────────────────────────────

function NeighborLink({ to, dir, label }: { to: string; dir: 'prev' | 'next'; label: string }) {
  return (
    <Link to={`/lore/story/${to}`} className="no-underline text-text-secondary hover:text-text-primary">
      <span className="block text-[11px] text-text-dim">{dir === 'prev' ? '‹ 上一篇' : '下一篇 ›'}</span>
      {label}
    </Link>
  )
}

function BookSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-bg-card" />
      ))}
    </div>
  )
}
