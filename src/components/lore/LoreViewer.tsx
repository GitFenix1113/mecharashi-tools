import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 全身立繪鑑賞模式（PLAN-042-D B-5）：舞台預設只取頭到大腿，全身留在這裡看。
 * 點一下放大 2.1 倍、滑鼠移動平移，再點一下縮回；Esc 由 PilotLorePage 的全域鍵盤處理（關閉的優先序最高）。
 *
 * ⚠ 主圖的尺寸規則只能套 `.lore-viewer > img`：外觀列（children）裡的小頭像也是 <img>，
 *   模擬頁曾因為寫成 `.lore-viewer img` 把它們撐成 800px 高、只露出一角。
 */
export interface LoreViewerProps {
  src: string
  name: string
  onClose: () => void
  /** 外觀列（鑑賞時也能換） */
  children?: ReactNode
}

export default function LoreViewer({ src, name, onClose, children }: LoreViewerProps) {
  const [zoom, setZoom] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // 開啟時把焦點交給關閉鈕，鍵盤使用者不會迷路在背後的頁面裡
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }) }, [])

  // 換外觀時圖換了：縮回、重播淡入
  const [shownSrc, setShownSrc] = useState(src)
  if (shownSrc !== src) {
    setShownSrc(src)
    setZoom(false)
  }

  const origin = (clientX: number, clientY: number) => {
    const r = imgRef.current?.getBoundingClientRect()
    if (!r) return
    imgRef.current!.style.transformOrigin = `${((clientX - r.left) / r.width) * 100}% ${((clientY - r.top) / r.height) * 100}%`
  }

  return (
    <div
      className={`lore-viewer${zoom ? ' is-zoom' : ''}`}
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
      <img key={src} ref={imgRef} src={src} alt={`${name} 全身立繪`} decoding="async" />
      <div className="lore-viewer__cap"><b>{name}</b><span>點一下放大，移動滑鼠檢視細節 · Esc 關閉</span></div>
      {children && <div className="lore-viewer__skins">{children}</div>}
      <button ref={closeRef} type="button" className="lore-viewer__close" onClick={onClose}>關閉 ✕</button>
    </div>
  )
}
