import {
  createContext, useContext, useState, useCallback, useRef, useEffect, useLayoutEffect,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import type { EntityRef } from '../types'
import { useIsMobile } from '../hooks/useIsMobile'
import { BottomSheet } from '../components/common/BottomSheet'
import { EntityRefView } from '../components/refs/EntityRefView'
import { NdOverrideContext } from './NdOverrideContext'
import { EMPTY_ND_OVERRIDES, type NdBuffOverrides } from '../utils/ndOverrides'

/**
 * PLAN-019 Layer 1 — 引用互動 Context。
 *
 * 桌面：hover 引用 → 浮窗預覽（不可互動，移開即收）；click → 釘選浮窗（可互動，
 *       內部巢狀引用可 drill 向下鑽，附返回／關閉，點外部或 ESC 關閉）。
 * 手機：tap → BottomSheet（可互動，可 drill / 返回）。
 */

type Rect = { top: number; bottom: number; left: number; right: number }
function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
}

interface ReferenceContextValue {
  /**
   * ndOverrides：發起端（機師頁的 RefChip）的算力覆寫快照（PLAN-034 地雷一）。
   * EntityRefView 是本 provider 的子節點、與 <Routes> 平行，機師頁內部包的
   * NdOverrideContext 永遠不可能成為它的祖先——只能由發起端把表**送過來**。
   */
  hoverRef: (ref: EntityRef, el: HTMLElement, ndOverrides?: NdBuffOverrides) => void
  leaveRef: () => void
  pinRef: (ref: EntityRef, el: HTMLElement, ndOverrides?: NdBuffOverrides) => void
  drillRef: (ref: EntityRef) => void
  back: () => void
  close: () => void
  canBack: boolean
}

const ReferenceContext = createContext<ReferenceContextValue | null>(null)

const PREVIEW_W = 300
const PINNED_W = 340

// ── 桌面浮動卡片（定位） ───────────────────────────────────────────────────────
function FloatingCard({ rect, width, interactive, containerRef, children }: {
  rect: Rect
  width: number
  interactive: boolean
  containerRef?: (el: HTMLDivElement | null) => void
  children: ReactNode
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 6 })

  // 內容高度會在掛載後才變（例：機甲卡的模組清單等 modules 載入），只在掛載時量一次會讓
  // 卡片長出視窗底部 —— 以 ResizeObserver 跟著尺寸重新定位。
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const place = () => {
      const h = el.offsetHeight
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      let top = rect.bottom + 6
      if (top + h > window.innerHeight - 8) {
        const above = rect.top - h - 6
        top = above >= 8 ? above : Math.max(8, window.innerHeight - h - 8)
      }
      setPos(p => (p.left === left && p.top === top ? p : { left, top }))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rect, width])

  return createPortal(
    <div
      ref={(el) => { innerRef.current = el; containerRef?.(el) }}
      // data-floating＝「浮動層」共同記號：其他浮窗（如模組各等級一覽）的「點外部關閉」
      // 會略過帶此記號的元素，否則點這張卡會把底下的視窗一起關掉。
      data-floating
      className={`fixed z-[60] ${interactive ? '' : 'pointer-events-none'}`}
      style={{ left: pos.left, top: pos.top, width }}
    >
      <div
        className="border border-border-accent rounded-xl shadow-2xl max-h-[70vh] overflow-hidden backdrop-blur-md"
        style={{ backgroundColor: 'rgb(15 18 25 / 0.97)' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function ReferenceProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile()

  const [preview, setPreview] = useState<{ ref: EntityRef; rect: Rect; nd?: NdBuffOverrides } | null>(null)
  // 釘選浮窗：以 stack 表達向下鑽的歷史，當前 ref = stack 最後一項（純更新，StrictMode 安全）
  const [pinned, setPinned] = useState<{ rect: Rect; stack: EntityRef[]; nd?: NdBuffOverrides } | null>(null)

  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const hideTimer = useRef<number | undefined>(undefined)
  const pinnedCardEl = useRef<HTMLDivElement | null>(null)
  /** hover 預覽的發起元素；它被拔出 DOM 時 mouseleave 不會來，要靠下面的 pointermove 補收 */
  const previewAnchor = useRef<HTMLElement | null>(null)
  /**
   * 「游標還沒真的動過」——為 true 時不理會 hover。
   *
   * 浮窗收起或換頁的瞬間，游標底下會冒出另一個元素，瀏覽器會補發 mouseenter 給它（游標其實沒動）。
   * 照單全收的後果（2026-10-09 回報）：版本速覽點背包 → 浮窗「查看完整詳情」，收窗那一刻底下剛好是
   * 〈君權〉→ 補發的 hover 在舊頁開了預覽 → 接著換頁把〈君權〉整個拔掉，mouseleave 永遠不會來，
   * 預覽就卡在武器頁上。瀏覽器的補發只有邊界事件、沒有 pointermove，所以拿 pointermove 當解除訊號。
   */
  const awaitingMove = useRef(false)

  const hoverRef = useCallback((ref: EntityRef, el: HTMLElement, nd?: NdBuffOverrides) => {
    if (isMobile || pinnedRef.current || awaitingMove.current) return
    window.clearTimeout(hideTimer.current)
    previewAnchor.current = el
    setPreview({ ref, rect: rectOf(el), nd })
  }, [isMobile])

  const leaveRef = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setPreview(null), 140)
  }, [])

  const pinRef = useCallback((ref: EntityRef, el: HTMLElement, nd?: NdBuffOverrides) => {
    window.clearTimeout(hideTimer.current)
    setPreview(null)
    setPinned({ rect: rectOf(el), stack: [ref], nd })
  }, [])

  const drillRef = useCallback((ref: EntityRef) => {
    setPinned(s => (s ? { ...s, stack: [...s.stack, ref] } : s))
  }, [])

  const back = useCallback(() => {
    setPinned(s => (s && s.stack.length > 1 ? { ...s, stack: s.stack.slice(0, -1) } : s))
  }, [])

  const close = useCallback(() => {
    awaitingMove.current = true
    setPinned(null)
    setPreview(null)
  }, [])

  /**
   * 換頁一律收掉兩種浮窗：它們掛在 <Routes> 外面，不會跟著舊頁一起卸載，
   * 留著只會指向一個已經不存在的元素（瀏覽器上一頁、側鍵返回都會走到這裡）。
   * 用 render 期間調整 state 而非 effect，換頁那一幀就不會畫出舊浮窗。
   */
  const { pathname } = useLocation()
  const [shownPath, setShownPath] = useState(pathname)
  if (shownPath !== pathname) {
    setShownPath(pathname)
    setPreview(null)
    setPinned(null)
  }
  // 新頁面在靜止的游標底下長出來，同樣會收到補發的 mouseenter。
  // 首次掛載不設：那會連使用者在這頁的第一次 hover 都吃掉（進入元素的邊界事件可能早於 pointermove）
  const lastPath = useRef(pathname)
  useLayoutEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    awaitingMove.current = true
  }, [pathname])

  useEffect(() => {
    const onMove = () => {
      awaitingMove.current = false
      // 錨點被拔掉（換頁、清單重繪）時不會有 mouseleave；一動滑鼠就收，不必等它
      const anchor = previewAnchor.current
      if (anchor && !anchor.isConnected) {
        previewAnchor.current = null
        window.clearTimeout(hideTimer.current)
        setPreview(null)
      }
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => document.removeEventListener('pointermove', onMove)
  }, [])

  // ESC 關閉釘選浮窗 / sheet
  useEffect(() => {
    if (!pinned) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned, close])

  // 點外部關閉（桌面釘選浮窗）；ref chip 已 stopPropagation，不會誤關
  useEffect(() => {
    if (!pinned || isMobile) return
    const onDown = (e: MouseEvent) => {
      if (pinnedCardEl.current && !pinnedCardEl.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pinned, isMobile, close])

  const pinnedRefCurrent = pinned ? pinned.stack[pinned.stack.length - 1] : null
  /**
   * 覆寫快照只套用在**發起的那一層**。往下 drill 之後（stack.length > 1）就離開了原本的
   * 引用情境——那時看的是「另一個 buff 的詳情」，再沿用機師頁的算力表只會讓人搞不清楚
   * 眼前的階是誰決定的。此為明訂的已知限制（計畫書「不在範圍內」）。
   */
  const pinnedNd = pinned && pinned.stack.length === 1 ? pinned.nd ?? EMPTY_ND_OVERRIDES : EMPTY_ND_OVERRIDES
  const value: ReferenceContextValue = {
    hoverRef, leaveRef, pinRef, drillRef, back, close,
    canBack: pinned ? pinned.stack.length > 1 : false,
  }

  return (
    <ReferenceContext.Provider value={value}>
      {children}

      {/* 桌面：hover 預覽（不可互動） */}
      {!isMobile && preview && !pinned && (
        <FloatingCard rect={preview.rect} width={PREVIEW_W} interactive={false}>
          <NdOverrideContext.Provider value={preview.nd ?? EMPTY_ND_OVERRIDES}>
            <EntityRefView entityRef={preview.ref} interactive={false} />
          </NdOverrideContext.Provider>
        </FloatingCard>
      )}

      {/* 桌面：釘選浮窗（可互動 / drill / 關閉） */}
      {!isMobile && pinned && pinnedRefCurrent && (
        <FloatingCard
          rect={pinned.rect}
          width={PINNED_W}
          interactive
          containerRef={(el) => { pinnedCardEl.current = el }}
        >
          <NdOverrideContext.Provider value={pinnedNd}>
            <EntityRefView entityRef={pinnedRefCurrent} interactive showClose />
          </NdOverrideContext.Provider>
        </FloatingCard>
      )}

      {/* 手機：BottomSheet */}
      {isMobile && (
        <BottomSheet open={!!pinned} onClose={close}>
          {pinnedRefCurrent && (
            <NdOverrideContext.Provider value={pinnedNd}>
              <EntityRefView entityRef={pinnedRefCurrent} interactive />
            </NdOverrideContext.Provider>
          )}
        </BottomSheet>
      )}
    </ReferenceContext.Provider>
  )
}

export function useReference(): ReferenceContextValue {
  const ctx = useContext(ReferenceContext)
  if (!ctx) throw new Error('useReference must be used within ReferenceProvider')
  return ctx
}
