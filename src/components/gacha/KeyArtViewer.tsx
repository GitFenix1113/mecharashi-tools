import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import GachaFxLive from '../lore/gacha/GachaFxLive'
import { useGachaFxPref } from '../lore/gacha/gachaFxPref'

/**
 * 招募插畫的全景鑑賞（PLAN-063 決策 6）：從卡池橫條那條裁切圖「長」成整張，收回時反向縮回去。
 *
 * ── 為什麼不用 LoreViewer ──────────────────────────────────────────────────
 * LoreViewer 的開場是「等高 FLIP」：把整張圖縮到舞台那張的高度再飛到中央——起點必須是完整的一張圖。
 * 橫條是 object-fit: cover 裁出來的一條，等高縮放會先跳成一張很小的完整圖。這裡改用 transform＋clip-path：
 * 起點把整張圖放到「cover 裁切時它實際所在的位置與大小」，再用 clip-path 只露出橫條那一塊，兩者一起內插到全景。
 * 另外圖鑑是暗色主題、故事館是紙色舞台，硬塞分支兩邊都難改（同 PLAN-042-B 決策 B-12 的理由）。
 *
 * ── 版面三層 ─────────────────────────────────────────────────────────────────
 *   .kav-pan   手機直向的左右拖曳（translateX）
 *   .kav-zoom  桌機點一下放大 2.1 倍、滑鼠移動平移（scale＋transform-origin）
 *   .kav-frame 開場／收回的動畫（WAAPI 的 transform＋clip-path）
 * 三種位移各自一層，彼此不搶同一個 transform。
 *
 * ── 動態層 ───────────────────────────────────────────────────────────────────
 * 沿用 LoreViewer 的規則：開場動畫播完才掛 GachaFxLive（WebGL 的第一格不必跟著飛）、關閉一開始就卸載。
 * 「動態／靜態」偏好與故事館共用（useGachaFxPref）。
 *
 * ⚠ 一定要 portal 到 body：機甲圖鑑的外框有 backdrop-blur，backdrop-filter 會讓裡面的 position: fixed 改以外框定位。
 */

export interface KeyArtViewerProps {
  src: string
  /** 標題（機甲名・池名） */
  name: string
  /** 標題旁的狀態（與橫條同一份） */
  status?: ReactNode
  /** 卡池動態的登錄鍵（gachaFxRegistry）；這張沒有動態就不給 */
  fxKey?: string
  /** 收合時那張圖：展開從它的裁切位置長出來、收回縮回它 */
  origin: HTMLImageElement
  /** 收回動畫播完（或不需要動畫）才呼叫——父層這時才卸載本元件 */
  onClosed: () => void
}

const OPEN_MS = 640
const CLOSE_MS = 520
const EASE_OPEN = 'cubic-bezier(0.7, 0, 0.2, 1)'
const EASE_CLOSE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const FULL: Keyframe = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px 0px 0px round 6px)' }
/** 拖曳超過這個距離才算拖，否則算點一下 */
const TAP_SLOP = 6

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** 手機直向：橫圖在直螢幕只佔中間一條，改成填滿高度＋左右拖曳 */
const isPortraitPhone = () => typeof window !== 'undefined' && window.innerWidth < 768 && window.innerWidth < window.innerHeight

/** object-position 的百分比（只認 %；其他單位當置中） */
function objectPosition(img: HTMLImageElement): [number, number] {
  const parts = getComputedStyle(img).objectPosition.split(/\s+/)
  const pct = (s: string | undefined) => (s?.endsWith('%') ? parseFloat(s) / 100 : 0.5)
  return [pct(parts[0]), pct(parts[1])]
}

/**
 * 收合那張（object-fit: cover）換算到展開框座標的樣子：把整張圖放到 cover 時它實際的位置與大小，
 * 再用 clip-path 只露出橫條那一塊。`frame` 要量**沒有動畫套著**的版面位置。
 */
function coverKeyframe(img: HTMLImageElement, frame: DOMRect): Keyframe | null {
  const s = img.getBoundingClientRect()
  if (!s.width || !s.height || !frame.width || !frame.height) return null
  const [px, py] = objectPosition(img)
  const k = Math.max(s.width / frame.width, s.height / frame.height)
  const left = s.left + (s.width - frame.width * k) * px
  const top = s.top + (s.height - frame.height * k) * py
  const lc = (s.left - left) / k
  const tc = (s.top - top) / k
  const rc = frame.width - lc - s.width / k
  const bc = frame.height - tc - s.height / k
  const radius = parseFloat(getComputedStyle(img.parentElement ?? img).borderTopLeftRadius) || 0
  return {
    transform: `translate(${left - frame.left}px, ${top - frame.top}px) scale(${k})`,
    clipPath: `inset(${tc}px ${rc}px ${bc}px ${lc}px round ${radius / k}px)`,
  }
}

export default function KeyArtViewer({ src, name, status, fxKey, origin, onClosed }: KeyArtViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openAnim = useRef<Animation | null>(null)
  const [landed, setLanded] = useState(false)
  const [closing, setClosing] = useState(false)
  const [fxOn, setFxOn] = useGachaFxPref()
  const [fill, setFill] = useState(isPortraitPhone)
  const [zoom, setZoom] = useState(false)
  const [panX, setPanX] = useState(0)
  const drag = useRef<{ x: number; pan: number; moved: boolean; id: number } | null>(null)
  /** 剛結束的那次拖曳有沒有拖動（click 在 pointerup 之後才來，要靠它分辨點一下與拖曳） */
  const dragged = useRef(false)

  // 收回前把放大與拖曳歸零：先關掉過場再改 class，免得「縮回原尺寸」與「縮回橫條」兩段動畫打架
  const close = useCallback(() => {
    if (zoomRef.current) zoomRef.current.style.transition = 'none'
    setZoom(false)
    setPanX(0)
    setClosing(true)
  }, [])

  // 開場：從橫條的裁切位置長成全景。layout effect：第一次繪製前就疊回橫條原位，不會先在中央閃一下
  useLayoutEffect(() => {
    const frame = frameRef.current
    let cancelled = false
    const land = () => { if (!cancelled) setLanded(true) }
    const from = frame && !reducedMotion() ? coverKeyframe(origin, frame.getBoundingClientRect()) : null
    if (!frame || !from) { queueMicrotask(land); return () => { cancelled = true } }
    const a = frame.animate([from, FULL], { duration: OPEN_MS, easing: EASE_OPEN })
    openAnim.current = a
    a.finished.then(land, () => {})
    return () => { cancelled = true; a.cancel() }
    // 只在開啟當下跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 收回：縮回橫條（放大與拖曳已在 close() 歸零）；播完才通知父層卸載
  const closedRef = useRef(onClosed)
  useEffect(() => { closedRef.current = onClosed })
  useEffect(() => {
    if (!closing) return
    const done = () => closedRef.current()
    openAnim.current?.cancel()   // 飛行途中就關：先回到原尺寸再量
    const frame = frameRef.current
    const to = frame && !reducedMotion() ? coverKeyframe(origin, frame.getBoundingClientRect()) : null
    if (!frame || !to) { done(); return }
    const a = frame.animate([FULL, to], { duration: CLOSE_MS, easing: EASE_CLOSE, fill: 'forwards' })
    a.finished.then(done, () => {})
    return () => a.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing])

  // 焦點：開啟交給關閉鈕、關閉還給橫條；背後的頁面不能捲
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const restore = origin.closest('button')
    return () => {
      document.body.style.overflow = prev
      restore?.focus({ preventScroll: true })
    }
  }, [origin])

  // Esc 掛在 window：點過圖片後焦點會落到 body，掛在對話框上的 onKeyDown 就收不到了
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  // 轉向／縮放視窗：直向手機改成填滿高度
  useEffect(() => {
    const onResize = () => { setFill(isPortraitPhone()); setPanX(0); setZoom(false) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    // focus trap：只有幾顆按鈕，Tab 到底就繞回來
    const items = rootRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])')
    if (!items?.length) return
    const first = items[0], last = items[items.length - 1]
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  }

  /** 桌機放大：原點跟著滑鼠走（動態層與插畫在同一個 .kav-zoom 裡，自然同步） */
  const setOrigin = (clientX: number, clientY: number) => {
    const el = zoomRef.current
    const r = frameRef.current?.getBoundingClientRect()
    if (!el || !r) return
    el.style.transformOrigin = `${((clientX - r.left) / r.width) * 100}% ${((clientY - r.top) / r.height) * 100}%`
  }

  // 直向手機：左右拖曳；沒拖動就算點一下（切換「填滿高度／看整張」）
  const maxPan = () => {
    const w = frameRef.current?.offsetWidth ?? 0
    return Math.max(0, (w - window.innerWidth) / 2)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    dragged.current = false
    if (!fill || !landed) return
    drag.current = { x: e.clientX, pan: panX, moved: false, id: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) {
      if (zoom && e.pointerType === 'mouse') setOrigin(e.clientX, e.clientY)
      return
    }
    const dx = e.clientX - d.x
    if (Math.abs(dx) > TAP_SLOP) d.moved = true
    const m = maxPan()
    setPanX(Math.max(-m, Math.min(m, d.pan + dx)))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    dragged.current = !!d && d.id === e.pointerId && d.moved
  }
  const onFrameClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!landed || closing) return
    if (dragged.current) { dragged.current = false; return }
    if (isPortraitPhone()) { setFill((f) => !f); setPanX(0); return }
    if (!zoom) setOrigin(e.clientX, e.clientY)
    if (zoomRef.current) zoomRef.current.style.transition = ''
    setZoom((z) => !z)
  }

  const showLive = !!fxKey && fxOn && landed && !closing

  return createPortal(
    <div
      ref={rootRef}
      className={`kav${closing ? ' is-closing' : ''}${fill ? ' is-fill' : ''}${zoom ? ' is-zoomed' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} 招募插畫全景`}
      onClick={close}
      onKeyDown={onKeyDown}
    >
      <div className="kav__bg" aria-hidden="true" />
      <div className="kav-pan" style={fill ? { transform: `translateX(${panX}px)` } : undefined}>
        <div ref={zoomRef} className={`kav-zoom${zoom ? ' is-zoom' : ''}`}>
          <div
            ref={frameRef}
            className="kav-frame"
            onClick={onFrameClick}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { drag.current = null }}
          >
            <img src={src} alt={`${name} 招募插畫`} decoding="async" draggable={false} />
            {showLive && <GachaFxLive fxKey={fxKey} background={src} zoom={zoom} />}
          </div>
        </div>
      </div>
      <div className="kav__cap" onClick={(e) => e.stopPropagation()}>
        <b>{name}</b>
        {status}
      </div>
      <div className="kav__tools" onClick={(e) => e.stopPropagation()}>
        {fxKey && (
          <span className="kav-seg" role="radiogroup" aria-label="卡池動態">
            {([[true, '動態'], [false, '靜態']] as const).map(([v, t]) => (
              <button key={t} type="button" role="radio" aria-checked={fxOn === v} onClick={() => setFxOn(v)}>{t}</button>
            ))}
          </span>
        )}
        <button ref={closeRef} type="button" className="kav-close" onClick={close}>關閉 ✕</button>
      </div>
      <p className="kav__hint" aria-hidden="true">{fill ? '左右拖曳看全景・點一下看整張' : '點一下放大・Esc 關閉'}</p>
    </div>,
    document.body,
  )
}
