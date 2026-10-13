import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import LoreStage from '../../components/lore/LoreStage'
import LoreDossier from '../../components/lore/LoreDossier'
import LoreChapterPager from '../../components/lore/LoreChapterPager'
import LoreChapterBody from '../../components/lore/LoreChapterBody'
import LoreSkinPicker from '../../components/lore/LoreSkinPicker'
import LoreViewer from '../../components/lore/LoreViewer'
import LoreSwitcher, { type LoreSwitcherHandle } from '../../components/lore/LoreSwitcher'
import { buildLoreGroups, readLoreSort, withLoreNames, writeLoreSort, type LoreSort } from '../../components/lore/loreRoster'
import { publishedChapters } from '../../components/lore/loreText'
import { defaultStageArt, loreSideOf, preloadStageArt, skinStageArt, type StageArt } from '../../components/lore/loreStageArt'
import { pilotSkins, type PilotSkinArt } from '../../utils/gameArt'
import { useFactionEmblems, usePilotLore, usePilots } from '../../hooks/useFirestore'
import { emblemTitle, emblemsById } from '../../utils/factionEmblems'
import type { LoreDoc, Pilot } from '../../types'

/**
 * 機師故事館的扉頁與章節頁（PLAN-042-A D-3；PLAN-042-D 改版成「舞台＋卷宗」）。
 *
 * `/lore/pilots/:id` 是檔案（扉頁），`/lore/pilots/:id/:part` 是閱讀模式 —— **同一個元件**、同一棵樹：
 * 換章、換人、進出閱讀模式都不會卸載舞台，動畫才接得起來。外觀放在 `?skin=<立繪鍵>`。
 *
 * ── 三件事必須照著做，錯了都不會有錯誤訊息 ──────────────────────────────
 * ① **守衛順序是 error → loading → 內容**（地雷 M-04）：抓取失敗時 loading 恆為 true。
 * ② **pilotLore 不擋整頁**：整頁只等 pilots（舞台、名冊、換人都只要身分欄位）。pilotLore 的 error／loading
 *   只交給卷宗（LoreDossier 的 status）——PLAN-042-E 起簡介與個人資料也住 pilotLore，讀不到時卷宗要明講
 *   「載入失敗」，不能退化成看起來像空白資料的扉頁；同樣先判 error 再判 loading（失敗時 loading 恆為 true）。
 * ③ **構圖在渲染前決定**（loreStage.ts）：直式全身／橫式半身／官網圖層／場景插畫的取景不同，等圖載完再換會跳。
 *
 * 草稿章（LoreChapter.draft）一律經 `publishedChapters()` 濾掉：目錄、‹ ›、章節網址都看不到，
 * 草稿章（或打錯）的章節網址導回扉頁。
 *
 * ── 換人的過場（A-6）──────────────────────────────────────────────────────
 * 「顯示中的機師」（state.shownId）**落後網址一拍**：網址先變，舊的那位播 0.3 秒退場、同時預載新的那位的立繪，
 * decode 完才換成新的、播精簡進場（線稿閃一下＋依方向擦入、卡片間隔 70ms）。瀏覽器上一頁／下一頁也走同一條。
 * 完整開場（置中顯影 → 移到一側 → 卡片逐張進場）只在**進入詳情頁**時播一次：從館首頁或外部連結進來時元件是新掛載的。
 *
 * ⚠ 館內唯一的 scrollport 是 LoreLayout 的 `.lore-scroll`（M-08），本頁不開任何 overflow-y；
 *   舞台是 sticky 全高層＋負 margin，卷宗在同一個 scrollport 裡疊上去。
 */

// ── 過場狀態 ────────────────────────────────────────────────────────────────

interface Phase {
  /** 顯示中的機師（落後網址一拍） */
  shownId: string | undefined
  intro: boolean
  revealFull: boolean
  revealQuick: boolean
  revealed: boolean
  ready: boolean
  quick: boolean
  leaving: boolean
  entering: boolean
  introDone: boolean
  dir: 1 | -1
}
const FINISHED: Partial<Phase> = { intro: false, revealFull: false, revealed: true, ready: true, introDone: true }
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 同一個分頁裡，每位機師最後選的外觀（換人再回來還記得） */
const rememberedSkins = new Map<string, string>()
const skinQs = (pid: string) => {
  const k = rememberedSkins.get(pid)
  return k ? `?skin=${encodeURIComponent(k)}` : ''
}

/** 外觀的名稱、隱藏、順序在 pilotLore（PLAN-042-E E-1）；lore 讀不到時照圖檔層原樣列 */
function stageArtFor(pilot: Pilot, skinKey: string, lore: LoreDoc | undefined): { art: StageArt | null; skins: PilotSkinArt[]; skin: PilotSkinArt | null } {
  const skins = pilotSkins(pilot, lore)
  const skin = skinKey ? skins.find((s) => s.key === skinKey) ?? null : null
  return { art: skin ? skinStageArt(pilot, skin) : defaultStageArt(pilot), skins, skin }
}

export default function PilotLorePage() {
  const { id, part } = useParams<{ id: string; part?: string }>()
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const { data: pilots, loading, error } = usePilots()
  // 只交給卷宗，不擋整頁：見檔頭第 ② 條
  const { data: loreDocs, loading: loreLoading, error: loreError } = usePilotLore()
  const loreById = useMemo(() => new Map(loreDocs.map((d) => [d.id, d])), [loreDocs])
  // 徽章名稱（PLAN-042-F）只是滑鼠提示：讀不到就退回陣營文字，loading／error 都不看
  const { data: emblems } = useFactionEmblems()
  const logoLabel = useMemo(() => {
    const byId = emblemsById(emblems)
    return (key: string) => emblemTitle(key, byId)
  }, [emblems])

  const rootRef = useRef<HTMLDivElement>(null)
  const switcherRef = useRef<LoreSwitcherHandle>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  // ── 名冊順序（＝館首頁的排序；A-2）─────────────────────────────────────────
  const [sort, setSortState] = useState<LoreSort>(readLoreSort)
  const setSort = useCallback((s: LoreSort) => { setSortState(s); writeLoreSort(s) }, [])
  // 名冊成員帶 pilotLore 的英文名（搜尋、title 要用；PLAN-042-E 起它不在 pilots 上）
  const groups = useMemo(() => buildLoreGroups(withLoreNames(pilots, loreDocs), sort), [pilots, loreDocs, sort])
  const order = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const chapterCounts = useMemo(() => new Map(loreDocs.map((d) => [d.id, publishedChapters(d.chapters).length])), [loreDocs])
  const skinCounts = useMemo(() => new Map(pilots.map((p) => [p.id, pilotSkins(p, loreById.get(p.id)).length])), [pilots, loreById])
  const chapterCount = useCallback((pid: string) => chapterCounts.get(pid) ?? 0, [chapterCounts])
  const skinCount = useCallback((p: Pilot) => skinCounts.get(p.id) ?? 0, [skinCounts])

  // ── 外觀：網址是正本；顯示中的那位若還不是網址那位（退場中），用記住的 ───────────────
  const skinParam = search.get('skin') ?? ''
  useEffect(() => {
    if (!id) return
    if (skinParam) rememberedSkins.set(id, skinParam)
    else rememberedSkins.delete(id)
  }, [id, skinParam])

  // ── 過場狀態機 ───────────────────────────────────────────────────────────
  const [t, setT] = useReducer((s: Phase, patch: Partial<Phase>) => ({ ...s, ...patch }), undefined, (): Phase => ({
    shownId: id, intro: !part, revealFull: false, revealQuick: false, revealed: !!part, ready: !!part, quick: false,
    leaving: false, entering: false, introDone: !!part, dir: 1,
  }))
  const timers = useRef<number[]>([])
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => () => clearTimers(), [])

  const shown = useMemo(() => pilots.find((p) => p.id === t.shownId) ?? null, [pilots, t.shownId])
  const shownSkinKey = t.shownId === id ? skinParam : (t.shownId ? rememberedSkins.get(t.shownId) ?? '' : '')
  const lore = t.shownId ? loreById.get(t.shownId) : undefined
  const { art, skins, skin } = useMemo(
    () => (shown ? stageArtFor(shown, shownSkinKey, lore) : { art: null, skins: [], skin: null }),
    [shown, shownSkinKey, lore],
  )
  // 給只在特定時機跑的 effect 讀「現在的」值（render 期間不寫 ref：react-hooks/refs）
  const artRef = useRef(art)
  useLayoutEffect(() => { artRef.current = art })

  // 開場（C-1）：資料到了、立繪 decode 完才開演；之後照模擬頁的時間軸推進
  const introPending = useRef(!part)
  const hasShown = !!shown
  useEffect(() => {
    if (!hasShown || !introPending.current) return
    introPending.current = false
    let cancelled = false
    preloadStageArt(artRef.current).then(() => {
      if (cancelled) return
      if (reduced()) { setT(FINISHED); return }
      setT({ revealFull: true })
      const at = (ms: number, patch: Partial<Phase>) => timers.current.push(window.setTimeout(() => setT(patch), ms))
      at(1050, { revealed: true })
      at(1250, { intro: false })            // 立繪滑到一側、漸隱帶打開（950ms）
      at(1600, { ready: true })             // 卷宗逐張進場（間隔 120ms）
      at(3200, { introDone: true, revealFull: false })
    })
    return () => { cancelled = true }
  }, [hasShown])

  // 開場中任何操作都快轉（C-2）：不讓常客被 3 秒動畫綁住
  useEffect(() => {
    if (t.introDone || !t.revealFull) return
    const ff = () => { clearTimers(); setT(FINISHED) }
    const evs = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, ff, { passive: true, capture: true }))
    return () => evs.forEach((e) => window.removeEventListener(e, ff, { capture: true }))
  }, [t.introDone, t.revealFull])

  // 換人（A-6）：網址變了 → 舊的退場、預載新的 → 換上新的、精簡進場
  const pendingDir = useRef<1 | -1 | null>(null)
  const orderRef = useRef(order)
  const loreByIdRef = useRef(loreById)
  useLayoutEffect(() => { orderRef.current = order; loreByIdRef.current = loreById })
  useEffect(() => {
    if (!id || id === t.shownId) return
    const target = pilots.find((p) => p.id === id)
    if (!target) { setT({ shownId: id }); return }   // 查無 → 交給「找不到機師」
    clearTimers()
    introPending.current = false
    const idxOf = (pid?: string) => orderRef.current.findIndex((p) => p.id === pid)
    const dir = pendingDir.current ?? (idxOf(id) >= idxOf(t.shownId) ? 1 : -1)
    pendingDir.current = null
    setT({ ...FINISHED, leaving: true, dir })
    let cancelled = false
    const next = stageArtFor(target, rememberedSkins.get(id) ?? '', loreByIdRef.current.get(id)).art
    Promise.all([preloadStageArt(next), sleep(reduced() ? 0 : 300)]).then(() => {
      if (cancelled) return
      setT({ shownId: id, leaving: false, entering: true, quick: true, revealQuick: false, revealFull: false, revealed: false })
    })
    return () => { cancelled = true }
  }, [id, t.shownId, pilots])

  // 進場起點的樣式先生效（強制 reflow），再拿掉 is-entering——卡片與立繪才會從起點補間過來
  useLayoutEffect(() => {
    if (!t.entering) return
    void rootRef.current?.offsetWidth
    setT({ entering: false, revealQuick: !reduced(), revealed: true })
  }, [t.entering])
  // 精簡顯影跑完就拿掉 class：不然之後換外觀插進來的新圖層會被它搶走動畫
  useEffect(() => {
    if (!t.revealQuick) return
    const timer = window.setTimeout(() => setT({ revealQuick: false }), 900)
    return () => clearTimeout(timer)
  }, [t.revealQuick])

  // 閒置時預載前後兩位（A-5）
  useEffect(() => {
    if (!t.ready || t.leaving || !id) return
    const i = order.findIndex((p) => p.id === id)
    if (i < 0) return
    const timer = window.setTimeout(() => {
      for (const p of [order[(i + 1) % order.length], order[(i - 1 + order.length) % order.length]]) {
        void preloadStageArt(stageArtFor(p, rememberedSkins.get(p.id) ?? '', loreById.get(p.id)).art)
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [t.ready, t.leaving, id, order, loreById])

  // ── 換人／換章／換外觀（寫網址）────────────────────────────────────────────
  const selectPilot = useCallback((pid: string, dir: 1 | -1) => {
    if (pid === id) return
    pendingDir.current = dir
    // replace：換一百位按上一頁也只要一下就回館首頁（LoreLayout 會還原牆面的捲動位置）
    navigate(`/lore/pilots/${encodeURIComponent(pid)}${skinQs(pid)}`, { replace: true })
  }, [id, navigate])
  const stepPilot = useCallback((delta: 1 | -1) => {
    const i = order.findIndex((p) => p.id === id)
    if (i < 0 || order.length < 2) return
    selectPilot(order[(i + delta + order.length) % order.length].id, delta)
  }, [order, id, selectPilot])

  const [chapterDir, setChapterDir] = useState(0)
  const chapters = useMemo(() => publishedChapters(lore?.chapters), [lore])
  const paramIndex = part ? chapters.findIndex((c) => c.key === part) : -1
  const activeIndex = paramIndex >= 0 ? paramIndex : 0
  const isReading = paramIndex >= 0 && t.shownId === id
  const qs = skinParam ? `?skin=${encodeURIComponent(skinParam)}` : ''
  const fileHref = `/lore/pilots/${encodeURIComponent(id ?? '')}${qs}`
  // 草稿章、已移除或打錯的章節網址 → 導回扉頁（D-5）。等 pilotLore 有結果再判：載入中 chapters 一定是空的
  const loreSettled = !!loreError || !loreLoading
  useEffect(() => {
    if (part && loreSettled && t.shownId === id && paramIndex < 0) navigate(fileHref, { replace: true })
  }, [part, loreSettled, t.shownId, id, paramIndex, fileHref, navigate])
  const chapterHref = useCallback((key: string) => `/lore/pilots/${encodeURIComponent(id ?? '')}/${encodeURIComponent(key)}${qs}`, [id, qs])

  /** 換章：扉頁 → 章節用 push（上一頁回扉頁）；章節之間用 replace（讀完 8 章不必按 8 次上一頁）。 */
  const selectChapter = useCallback((key: string, index: number) => {
    setChapterDir(part ? Math.sign(index - activeIndex) : 0)
    navigate(chapterHref(key), { replace: Boolean(part) })
  }, [part, activeIndex, chapterHref, navigate])

  const pickSkin = useCallback((key: string) => {
    if (!shown || key === (skin?.key ?? '')) return
    const target = key ? skins.find((s) => s.key === key) : null
    // 先 decode 再換：換裝動畫一開始新圖就要在
    const url = target ? skinStageArt(shown, target) : defaultStageArt(shown)
    void preloadStageArt(url).then(() => {
      setSearch((prev) => {
        const nextParams = new URLSearchParams(prev)
        if (key) nextParams.set('skin', key)
        else nextParams.delete('skin')
        return nextParams
      }, { replace: true })
    })
  }, [shown, skin, skins, setSearch])

  // ── 鑑賞模式、名冊開關 ───────────────────────────────────────────────────
  const [viewerOpen, setViewerOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  // 換人時鑑賞模式一併收起（看的是上一位的圖）
  const [viewerFor, setViewerFor] = useState(t.shownId)
  if (viewerFor !== t.shownId) {
    setViewerFor(t.shownId)
    if (viewerOpen) setViewerOpen(false)
  }

  // ── 鍵盤（← → 依模式分流、/ 名冊、Esc）──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (rosterOpen) return   // 名冊自己處理 Esc；開著時 ← → 不換人
      if (e.key === 'Escape') {
        if (viewerOpen) { setViewerOpen(false); return }
        if (isReading) navigate(fileHref)
        return
      }
      if (viewerOpen) return
      if (e.key === '/') { e.preventDefault(); switcherRef.current?.open(true); return }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const d = e.key === 'ArrowRight' ? 1 : -1
      e.preventDefault()
      if (isReading) {
        const n = activeIndex + d
        if (n >= 0 && n < chapters.length) selectChapter(chapters[n].key, n)
      } else {
        stepPilot(d)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rosterOpen, viewerOpen, isReading, activeIndex, chapters, selectChapter, stepPilot, navigate, fileHref])

  // ── 捲動：立繪輕微視差（--sy）＋閱讀進度條 ─────────────────────────────────
  // ⚠ 這裡要知道館內唯一的 scrollport 在哪：從根元素往上找 .lore-scroll（LoreLayout 提供）
  useEffect(() => {
    const root = rootRef.current
    const scroller = root?.closest<HTMLElement>('.lore-scroll')
    if (!root || !scroller) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        root.style.setProperty('--sy', String(scroller.scrollTop))
        const bar = progressRef.current
        if (bar) {
          const max = scroller.scrollHeight - scroller.clientHeight
          bar.style.width = `${max > 0 ? (scroller.scrollTop / max) * 100 : 0}%`
        }
      })
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [hasShown, isReading])

  // ── 手機：在封面上左右滑換人（閱讀模式裡左右滑是換章，交給 LoreChapterPager）──────
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0]
    const stage = rootRef.current?.querySelector('.lore-stage')?.getBoundingClientRect()
    touch.current = p && stage && p.clientY < stage.bottom && !isReading ? { x: p.clientX, y: p.clientY } : null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current
    touch.current = null
    const p = e.changedTouches[0]
    if (!start || !p) return
    const dx = p.clientX - start.x, dy = p.clientY - start.y
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) stepPilot(dx < 0 ? 1 : -1)
  }

  // ① error → ② loading → ③ 查無（順序不可調換，見檔頭）
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-sm text-accent-red">資料載入失敗：{error.message}</div>
        <Link to="/lore" className="mt-4 inline-block text-sm text-accent-orange no-underline">← 回故事館</Link>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="h-96 bg-bg-card border border-border rounded-xl animate-pulse" />
      </div>
    )
  }
  if (!shown) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-text-dim">
        <p>找不到機師資料</p>
        <Link to="/lore" className="text-accent-orange no-underline text-sm mt-4 inline-block">← 回故事館</Link>
      </div>
    )
  }

  const cls = [
    'lore-page',
    t.intro && 'is-intro', t.revealFull && 'is-reveal-full', t.revealQuick && 'is-reveal-quick', t.revealed && 'is-revealed',
    t.ready && 'is-ready', t.quick && 'is-quick', t.leaving && 'is-leaving', t.entering && 'is-entering',
    t.introDone && 'is-intro-done', isReading && 'is-reading',
  ].filter(Boolean).join(' ')

  // 回圖鑑（PLAN-042-G）：指向「顯示中的那位」而不是網址的 id——換人時網址先變、舞台與卷宗落後一拍，
  // 點下去應該去畫面上看到的那位
  const codexHref = `/pilots/${encodeURIComponent(shown.id)}`

  const tools = (
    <>
      <LoreSkinPicker pilot={shown} skins={skins} current={skin?.key ?? ''} onPick={pickSkin} />
      {art && (
        <button type="button" className="lore-pill" onClick={() => setViewerOpen(true)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /></svg>
          全身立繪
        </button>
      )}
    </>
  )

  return (
    <div
      ref={rootRef}
      className={cls}
      data-side={loreSideOf(shown)}
      data-variant={art?.variant ?? 'wide'}
      data-dir={t.dir}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="lore-stage-wrap">
        <LoreStage pilot={shown} art={art} nameEn={lore?.nameEn} tools={tools} />
      </div>

      <main className="lore-dossier">
        {isReading ? (
          <LoreChapterPager chapters={chapters} activeKey={chapters[activeIndex].key} onSelect={selectChapter} backHref={fileHref}>
            {/* key＝章節 key：換章重掛，稿紙的進場動畫才會重播。⚠ 不得 {...chapter} spread（見 LoreChapterBody 檔頭） */}
            <LoreChapterBody
              key={chapters[activeIndex].key}
              chapter={chapters[activeIndex]}
              index={activeIndex}
              prev={chapters[activeIndex - 1]}
              next={chapters[activeIndex + 1]}
              onSelect={selectChapter}
              backHref={fileHref}
              pilotName={shown.name}
              dir={chapterDir}
            />
          </LoreChapterPager>
        ) : (
          <LoreDossier
            pilot={shown}
            lore={lore ?? null}
            status={loreError ? 'error' : loreLoading ? 'loading' : 'ready'}
            chapters={chapters}
            chapterHref={chapterHref}
            logoLabel={logoLabel}
            codexHref={codexHref}
          />
        )}
      </main>

      {isReading && <div ref={progressRef} className="lore-progress" aria-hidden="true" />}

      {order.length > 1 && id && (
        <LoreSwitcher
          ref={switcherRef}
          groups={groups}
          order={order}
          currentId={id}
          sort={sort}
          onSortChange={setSort}
          chapterCount={chapterCount}
          skinCount={skinCount}
          onSelect={selectPilot}
          onOpenChange={setRosterOpen}
          codexHref={codexHref}
          codexName={shown.name}
          onHover={(p) => { void preloadStageArt(stageArtFor(p, rememberedSkins.get(p.id) ?? '', loreById.get(p.id)).art) }}
        />
      )}

      {viewerOpen && art && (
        <LoreViewer src={art.full} name={shown.name} onClose={() => setViewerOpen(false)}>
          <LoreSkinPicker pilot={shown} skins={skins} current={skin?.key ?? ''} onPick={pickSkin} className="lore-skins" />
        </LoreViewer>
      )}
    </div>
  )
}
