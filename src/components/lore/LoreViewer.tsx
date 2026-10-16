import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 全身立繪鑑賞模式（PLAN-042-D B-5）：舞台預設只取頭到大腿，全身留在這裡看。
 * 點一下放大 2.1 倍、滑鼠移動平移，再點一下縮回；Esc 由 PilotLorePage 的全域鍵盤處理（關閉的優先序最高）。
 *
 * ── 進出場（2026-10-16）──────────────────────────────────────────────────────
 * 立繪不是憑空出現在中央：開啟時從舞台上那張的位置與大小（`originRect`）飛到中央，關閉時飛回去（FLIP）。
 * 卷宗退開、舞台淡出由 PilotLorePage 掛在 `.lore-page` 的 `is-viewing`／`is-unviewing` 負責（index.css）。
 * 兩邊交棒時都用淡入淡出接：舞台那張有側邊與底部的漸隱遮罩，這張沒有，硬切會跳一下。
 * 關閉要等動畫跑完才卸載，所以關閉是兩段：`closing` 變 true → 飛回去 → `onClosed()`。
 * 用 Web Animations 而不是 CSS：起點要量舞台那張的實際位置，CSS 寫不出來。reduced-motion 時直接開關。
 *
 * ⚠ 主圖的尺寸規則只能套 `.lore-viewer > img`：外觀列（children）裡的小頭像也是 <img>，
 *   模擬頁曾因為寫成 `.lore-viewer img` 把它們撐成 800px 高、只露出一角。
 */
export interface LoreViewerProps {
  src: string
  name: string
  /** 使用者要關（關閉鈕）。真正卸載由父層在 `onClosed` 之後做 */
  onClose: () => void
  /** 外觀列（鑑賞時也能換） */
  children?: ReactNode
  /** 舞台上那張立繪目前的位置。沒有（未建檔、量不到）就退回原本的縮放淡入 */
  originRect?: () => DOMRect | null
  /** 父層已決定關閉：播放飛回舞台的動畫 */
  closing?: boolean
  /** 飛回去的動畫播完（或不必播） */
  onClosed?: () => void
}

const OPEN_MS = 680
const CLOSE_MS = 520
/**
 * 交棒的淡入淡出另開一段線性動畫，不放進位移的關鍵影格：WAAPI 的 easing 套在整段進度上，
 * 關鍵影格的 offset 落在「緩動後」的進度，時間點會漂（實測開啟的淡入晚了快一倍，兩張同時半透明、人暗一下）。
 * 數字要跟 index.css 的 is-viewing／is-unviewing 舞台淡出淡入對齊。
 */
const OPEN_FADE_MS = 110
const CLOSE_FADE_DELAY_MS = 400
const CLOSE_FADE_MS = 100
/** 開啟：慢起步（交棒的淡入發生在舞台原位）→ 加速到中央。＝ --lore-ease-io */
const EASE_OPEN = 'cubic-bezier(0.7, 0, 0.2, 1)'
/** 關閉：快起步、慢落地（落地前舞台那張已在原位淡入接手）。＝ --lore-ease-out */
const EASE_CLOSE = 'cubic-bezier(0.16, 1, 0.3, 1)'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 不含 transform 的版面位置（放大中的圖也量得到原尺寸）。offsetParent＝.lore-viewer（fixed） */
function layoutRect(img: HTMLElement): DOMRect {
  const p = (img.offsetParent as HTMLElement | null)?.getBoundingClientRect()
  return new DOMRect((p?.left ?? 0) + img.offsetLeft, (p?.top ?? 0) + img.offsetTop, img.offsetWidth, img.offsetHeight)
}

/** 把 `to` 疊到 `from` 上的 transform（以頂部中央為原點：等高、頂邊對齊、水平置中） */
function flipTransform(from: DOMRect, to: DOMRect): string {
  const s = from.height / to.height
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top - to.top
  return `translate(${dx}px, ${dy}px) scale(${s})`
}

export default function LoreViewer({ src, name, onClose, children, originRect, closing = false, onClosed }: LoreViewerProps) {
  const [zoom, setZoom] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // 只有開啟時那張走 FLIP；換外觀後的新圖用 CSS 的縮放淡入
  const [flipSrc, setFlipSrc] = useState<string | null>(originRect ? src : null)

  // 開啟時把焦點交給關閉鈕，鍵盤使用者不會迷路在背後的頁面裡
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }) }, [])

  // 換外觀時圖換了：縮回、重播淡入
  const [shownSrc, setShownSrc] = useState(src)
  if (shownSrc !== src) {
    setShownSrc(src)
    setZoom(false)
    setFlipSrc(null)
  }

  // 開啟：舞台 → 中央。layout effect：第一次繪製前就把圖疊回舞台原位，不會先在中央閃一下
  useLayoutEffect(() => {
    const img = imgRef.current
    const from = originRect?.()
    if (!img || !from || !from.height || reducedMotion()) return
    const anims: Animation[] = []
    let cancelled = false
    const run = () => {
      if (cancelled) return
      img.style.opacity = ''
      const to = layoutRect(img)
      if (!to.width || !to.height) return
      anims.push(
        img.animate([
          { transform: flipTransform(from, to), transformOrigin: '50% 0' },
          { transform: 'none', transformOrigin: '50% 0' },
        ], { duration: OPEN_MS, easing: EASE_OPEN }),
        // 先在舞台那張上面淡到全不透明，舞台那張才在底下消失
        img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_FADE_MS }),
      )
    }
    if (img.complete && img.naturalWidth) run()
    else {
      // 鑑賞圖與舞台圖不是同一張（官網 8 位、場景外觀）且還沒載完：量不到寬度，等 decode 完再飛
      img.style.opacity = '0'
      img.decode().catch(() => {}).finally(run)
    }
    return () => { cancelled = true; anims.forEach((a) => a.cancel()) }
    // 只在開啟當下跑一次；originRect 是父層每次 render 新建的函式，不能進依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 關閉：中央 → 舞台，播完才通知父層卸載
  const closedRef = useRef(onClosed)
  useEffect(() => { closedRef.current = onClosed })
  useEffect(() => {
    if (!closing) return
    const done = () => closedRef.current?.()
    const img = imgRef.current
    const from = originRect?.()
    if (!img || !from || !from.height || reducedMotion()) { done(); return }
    // 沒放大時原點固定在頂部中央：從預設的中心點一路內插到頂部，飛回去的途中頂邊會先往上衝一段
    const cs = getComputedStyle(img)
    const start = zoom ? { transform: cs.transform, transformOrigin: cs.transformOrigin } : { transform: 'none', transformOrigin: '50% 0' }
    const move = img.animate([
      start,
      { transform: flipTransform(from, layoutRect(img)), transformOrigin: '50% 0' },
    ], { duration: CLOSE_MS, easing: EASE_CLOSE, fill: 'forwards' })
    // 舞台那張先在底下淡回來（is-unviewing），這張快落地才淡掉
    const fade = img.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_FADE_MS, delay: CLOSE_FADE_DELAY_MS, fill: 'forwards' })
    move.finished.then(done, () => {})
    return () => { move.cancel(); fade.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing])

  const origin = (clientX: number, clientY: number) => {
    const r = imgRef.current?.getBoundingClientRect()
    if (!r) return
    imgRef.current!.style.transformOrigin = `${((clientX - r.left) / r.width) * 100}% ${((clientY - r.top) / r.height) * 100}%`
  }

  return (
    <div
      className={`lore-viewer${zoom ? ' is-zoom' : ''}${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} 全身立繪`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.lore-viewer__skins, .lore-viewer__close')) return
        if (!zoom) origin(e.clientX, e.clientY)
        setZoom((z) => !z)
      }}
      onMouseMove={(e) => { if (zoom) origin(e.clientX, e.clientY) }}
    >
      <img key={src} ref={imgRef} src={src} alt={`${name} 全身立繪`} decoding="async" data-flip={src === flipSrc ? '' : undefined} />
      <div className="lore-viewer__cap"><b>{name}</b><span>點一下放大，移動滑鼠檢視細節 · Esc 關閉</span></div>
      {children && <div className="lore-viewer__skins">{children}</div>}
      <button ref={closeRef} type="button" className="lore-viewer__close" onClick={onClose}>關閉 ✕</button>
    </div>
  )
}
