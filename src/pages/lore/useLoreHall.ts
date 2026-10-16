import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { LoreSwitcherHandle } from '../../components/lore/LoreSwitcher'
import { preloadStageArt, type StageArt } from '../../components/lore/loreStageArt'
import type { LoreChapter } from '../../types'

/**
 * 故事館一個展廳的互動狀態機（PLAN-042-B C-3，從 PilotLorePage 抽出；機師廳與機甲廳共用）：
 * 開場、換人、外觀、章節、鑑賞模式、名冊開關、鍵盤、捲動、手機滑動。
 *
 * 本 hook 不認得 Pilot／Mech：實體只要有 id，立繪由頁面的 `stageOf(實體, 外觀鍵)` 算、章節由 `chaptersOf(id)` 給。
 * 網址形狀是 `${basePath}/:id` 與 `${basePath}/:id/:part`，外觀在 `?skin=<鍵>`。
 *
 * ── 換人的過場（042-D A-6）────────────────────────────────────────────────
 * 「顯示中的那位」（shownId）**落後網址一拍**：網址先變，舊的那位播 0.3 秒退場、同時預載新的那位的立繪，
 * decode 完才換成新的、播精簡進場（線稿閃一下＋依方向擦入、卡片間隔 70ms）。瀏覽器上一頁／下一頁也走同一條。
 * 完整開場（置中顯影 → 移到一側 → 卡片逐張進場）只在**進入詳情頁**時播一次：從館首頁或外部連結進來時元件是新掛載的。
 *
 * ⚠ 泛化時機師廳的 DOM 與時序要一字不差（C-4 回歸基準：_local-notes/2026-10/2026-10-16_故事館泛化回歸/）。
 *   effect 的宣告順序照搬原本的頁面——同一次 commit 裡 effect 依宣告順序執行，調換就可能改到時序。
 */

// ── 過場狀態 ────────────────────────────────────────────────────────────────

export interface LoreHallPhase {
  /** 顯示中的那位（落後網址一拍） */
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
const FINISHED: Partial<LoreHallPhase> = { intro: false, revealFull: false, revealed: true, ready: true, introDone: true }
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** `stageOf()` 回傳的最小形狀：舞台要畫的那套立繪，與網址的外觀鍵對到的那套外觀（對不到＝null，顯示預設） */
export interface LoreHallStage {
  art: StageArt | null
  skin: { key: string } | null
}

export interface UseLoreHallOptions<E extends { id: string }, S extends LoreHallStage> {
  /** 網址前綴，例 `/lore/pilots` */
  basePath: string
  /** 全部實體（查顯示中的那位、換人時找目標） */
  entities: readonly E[]
  /** 名冊順序：← →、手機滑動、方向判斷、閒置預載前後兩位都照它 */
  order: readonly E[]
  /** 這位在某套外觀下的舞台（外觀鍵 '' ＝預設）。會被反覆呼叫，要便宜 */
  stageOf: (entity: E, skinKey: string) => S
  /** 這位已發布的章節（已濾掉草稿章） */
  chaptersOf: (id: string) => LoreChapter[]
  /** 章節資料有結果了（成功或失敗）。載入中章節一定是空的，不能拿來判「打錯的章節網址」 */
  chaptersSettled: boolean
  /** 每位最後選的外觀（換人再回來還記得）。由頁面模組持有，同一個分頁裡跨掛載保留 */
  rememberedSkins: Map<string, string>
}

export function useLoreHall<E extends { id: string }, S extends LoreHallStage>(opts: UseLoreHallOptions<E, S>) {
  const { basePath, entities, order, stageOf, chaptersOf, chaptersSettled, rememberedSkins } = opts
  const { id, part } = useParams<{ id: string; part?: string }>()
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()

  const rootRef = useRef<HTMLDivElement>(null)
  const switcherRef = useRef<LoreSwitcherHandle>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  const skinQs = useCallback((sid: string) => {
    const k = rememberedSkins.get(sid)
    return k ? `?skin=${encodeURIComponent(k)}` : ''
  }, [rememberedSkins])

  // ── 外觀：網址是正本；顯示中的那位若還不是網址那位（退場中），用記住的 ───────────────
  const skinParam = search.get('skin') ?? ''
  useEffect(() => {
    if (!id) return
    if (skinParam) rememberedSkins.set(id, skinParam)
    else rememberedSkins.delete(id)
  }, [id, skinParam, rememberedSkins])

  // ── 過場狀態機 ───────────────────────────────────────────────────────────
  const [t, setT] = useReducer((s: LoreHallPhase, patch: Partial<LoreHallPhase>) => ({ ...s, ...patch }), undefined, (): LoreHallPhase => ({
    shownId: id, intro: !part, revealFull: false, revealQuick: false, revealed: !!part, ready: !!part, quick: false,
    leaving: false, entering: false, introDone: !!part, dir: 1,
  }))
  const timers = useRef<number[]>([])
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => () => clearTimers(), [])

  const shown = useMemo(() => entities.find((e) => e.id === t.shownId) ?? null, [entities, t.shownId])
  const shownSkinKey = t.shownId === id ? skinParam : (t.shownId ? rememberedSkins.get(t.shownId) ?? '' : '')
  const stage = useMemo(() => (shown ? stageOf(shown, shownSkinKey) : null), [shown, shownSkinKey, stageOf])
  const art = stage?.art ?? null
  // 給只在特定時機跑的 effect 讀「現在的」值（render 期間不寫 ref：react-hooks/refs）
  const artRef = useRef(art)
  useLayoutEffect(() => { artRef.current = art })

  // 開場（042-D C-1）：資料到了、立繪 decode 完才開演；之後照模擬頁的時間軸推進
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
      const at = (ms: number, patch: Partial<LoreHallPhase>) => timers.current.push(window.setTimeout(() => setT(patch), ms))
      at(1050, { revealed: true })
      at(1250, { intro: false })            // 立繪滑到一側、漸隱帶打開（950ms）
      at(1600, { ready: true })             // 卷宗逐張進場（間隔 120ms）
      at(3200, { introDone: true, revealFull: false })
    })
    return () => { cancelled = true }
  }, [hasShown])

  // 開場中任何操作都快轉（042-D C-2）：不讓常客被 3 秒動畫綁住
  useEffect(() => {
    if (t.introDone || !t.revealFull) return
    const ff = () => { clearTimers(); setT(FINISHED) }
    const evs = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, ff, { passive: true, capture: true }))
    return () => evs.forEach((e) => window.removeEventListener(e, ff, { capture: true }))
  }, [t.introDone, t.revealFull])

  // 換人（042-D A-6）：網址變了 → 舊的退場、預載新的 → 換上新的、精簡進場
  const pendingDir = useRef<1 | -1 | null>(null)
  const orderRef = useRef(order)
  // stageOf 會隨故事館資料載入而換身分；換人中途資料才到不該重跑整段過場，所以走 ref
  const stageOfRef = useRef(stageOf)
  useLayoutEffect(() => { orderRef.current = order; stageOfRef.current = stageOf })
  useEffect(() => {
    if (!id || id === t.shownId) return
    const target = entities.find((e) => e.id === id)
    if (!target) { setT({ shownId: id }); return }   // 查無 → 交給頁面的「找不到」
    clearTimers()
    introPending.current = false
    const idxOf = (sid?: string) => orderRef.current.findIndex((e) => e.id === sid)
    const dir = pendingDir.current ?? (idxOf(id) >= idxOf(t.shownId) ? 1 : -1)
    pendingDir.current = null
    setT({ ...FINISHED, leaving: true, dir })
    let cancelled = false
    const next = stageOfRef.current(target, rememberedSkins.get(id) ?? '').art
    Promise.all([preloadStageArt(next), sleep(reduced() ? 0 : 300)]).then(() => {
      if (cancelled) return
      setT({ shownId: id, leaving: false, entering: true, quick: true, revealQuick: false, revealFull: false, revealed: false })
    })
    return () => { cancelled = true }
  }, [id, t.shownId, entities, rememberedSkins])

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

  // 閒置時預載前後兩位（042-D A-5）
  useEffect(() => {
    if (!t.ready || t.leaving || !id) return
    const i = order.findIndex((e) => e.id === id)
    if (i < 0) return
    const timer = window.setTimeout(() => {
      for (const e of [order[(i + 1) % order.length], order[(i - 1 + order.length) % order.length]]) {
        void preloadStageArt(stageOf(e, rememberedSkins.get(e.id) ?? '').art)
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [t.ready, t.leaving, id, order, stageOf, rememberedSkins])

  // ── 換人／換章／換外觀（寫網址）────────────────────────────────────────────
  const select = useCallback((sid: string, dir: 1 | -1) => {
    if (sid === id) return
    pendingDir.current = dir
    // replace：換一百位按上一頁也只要一下就回館首頁（LoreLayout 會還原牆面的捲動位置）
    navigate(`${basePath}/${encodeURIComponent(sid)}${skinQs(sid)}`, { replace: true })
  }, [id, navigate, basePath, skinQs])
  const step = useCallback((delta: 1 | -1) => {
    const i = order.findIndex((e) => e.id === id)
    if (i < 0 || order.length < 2) return
    select(order[(i + delta + order.length) % order.length].id, delta)
  }, [order, id, select])

  const [chapterDir, setChapterDir] = useState(0)
  const chapters = useMemo(() => (t.shownId ? chaptersOf(t.shownId) : []), [t.shownId, chaptersOf])
  const paramIndex = part ? chapters.findIndex((c) => c.key === part) : -1
  const activeIndex = paramIndex >= 0 ? paramIndex : 0
  const isReading = paramIndex >= 0 && t.shownId === id
  const qs = skinParam ? `?skin=${encodeURIComponent(skinParam)}` : ''
  const fileHref = `${basePath}/${encodeURIComponent(id ?? '')}${qs}`
  // 草稿章、已移除或打錯的章節網址 → 導回扉頁（042-A D-5）。等章節資料有結果再判
  useEffect(() => {
    if (part && chaptersSettled && t.shownId === id && paramIndex < 0) navigate(fileHref, { replace: true })
  }, [part, chaptersSettled, t.shownId, id, paramIndex, fileHref, navigate])
  const chapterHref = useCallback((key: string) => `${basePath}/${encodeURIComponent(id ?? '')}/${encodeURIComponent(key)}${qs}`, [basePath, id, qs])

  /** 換章：扉頁 → 章節用 push（上一頁回扉頁）；章節之間用 replace（讀完 8 章不必按 8 次上一頁）。 */
  const selectChapter = useCallback((key: string, index: number) => {
    setChapterDir(part ? Math.sign(index - activeIndex) : 0)
    navigate(chapterHref(key), { replace: Boolean(part) })
  }, [part, activeIndex, chapterHref, navigate])

  const currentSkinKey = stage?.skin?.key ?? ''
  const pickSkin = useCallback((key: string) => {
    if (!shown || key === currentSkinKey) return
    // 先 decode 再換：換裝動畫一開始新圖就要在
    void preloadStageArt(stageOf(shown, key).art).then(() => {
      setSearch((prev) => {
        const nextParams = new URLSearchParams(prev)
        if (key) nextParams.set('skin', key)
        else nextParams.delete('skin')
        return nextParams
      }, { replace: true })
    })
  }, [shown, currentSkinKey, stageOf, setSearch])

  // ── 鑑賞模式、名冊開關 ───────────────────────────────────────────────────
  // 鑑賞模式三段（2026-10-16）：closing 期間 LoreViewer 還掛著，播完飛回舞台的動畫才卸載
  const [viewer, setViewer] = useState<'closed' | 'open' | 'closing'>('closed')
  const viewerOpen = viewer !== 'closed'
  const openViewer = useCallback(() => setViewer('open'), [])
  const closeViewer = useCallback(() => setViewer((v) => (v === 'open' ? 'closing' : v)), [])
  const onViewerClosed = useCallback(() => setViewer('closed'), [])
  const [rosterOpen, setRosterOpen] = useState(false)
  // 換人時鑑賞模式一併收起（看的是上一位的圖）——直接關、不播飛回去：舞台上已經是下一位了
  const [viewerFor, setViewerFor] = useState(t.shownId)
  if (viewerFor !== t.shownId) {
    setViewerFor(t.shownId)
    if (viewerOpen) setViewer('closed')
  }
  // 舞台上那張立繪的位置：鑑賞圖從這裡飛出去、飛回來（換外觀疊層中取上面那套）
  const stageArtRect = useCallback(() => rootRef.current?.querySelector('.lore-figure:not(.is-leaving) .lore-figure__color')?.getBoundingClientRect() ?? null, [])

  // ── 鍵盤（← → 依模式分流、/ 名冊、Esc）──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (rosterOpen) return   // 名冊自己處理 Esc；開著時 ← → 不換人
      if (e.key === 'Escape') {
        if (viewerOpen) { closeViewer(); return }
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
        step(d)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rosterOpen, viewerOpen, closeViewer, isReading, activeIndex, chapters, selectChapter, step, navigate, fileHref])

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
  const onTouchStart = (e: ReactTouchEvent) => {
    const p = e.touches[0]
    const stageRect = rootRef.current?.querySelector('.lore-stage')?.getBoundingClientRect()
    touch.current = p && stageRect && p.clientY < stageRect.bottom && !isReading ? { x: p.clientX, y: p.clientY } : null
  }
  const onTouchEnd = (e: ReactTouchEvent) => {
    const start = touch.current
    touch.current = null
    const p = e.changedTouches[0]
    if (!start || !p) return
    const dx = p.clientX - start.x, dy = p.clientY - start.y
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1)
  }

  const className = [
    'lore-page',
    t.intro && 'is-intro', t.revealFull && 'is-reveal-full', t.revealQuick && 'is-reveal-quick', t.revealed && 'is-revealed',
    t.ready && 'is-ready', t.quick && 'is-quick', t.leaving && 'is-leaving', t.entering && 'is-entering',
    t.introDone && 'is-intro-done', isReading && 'is-reading',
    viewer === 'open' && 'is-viewing', viewer === 'closing' && 'is-unviewing',
  ].filter(Boolean).join(' ')

  return {
    /** 網址上的 id（分頁標題、名冊的「目前」跟它走，不跟過場中的 shown） */
    id,
    /** 顯示中的那位（落後網址一拍）與它的舞台 */
    shown, stage, phase: t,
    rootRef, switcherRef, progressRef,
    /** 掛在根元素上的狀態 class（CSS 依此播動畫）與換人方向 */
    className, dir: t.dir,
    onTouchStart, onTouchEnd,
    select, step,
    chapters, activeIndex, chapterDir, isReading, selectChapter, chapterHref, fileHref,
    pickSkin,
    viewer, openViewer, closeViewer, onViewerClosed, stageArtRect,
    setRosterOpen,
  }
}
