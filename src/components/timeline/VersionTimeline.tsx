import { useState, useRef, useEffect, useCallback } from 'react'
import { flushSync } from 'react-dom'
import type { PatchVersion } from '../../data/patchVersions'
import VersionDetailView from './VersionDetailView'

interface Props {
  versions: PatchVersion[]
  loading: boolean
}

// 每個項目中心之間的垂直距離（px）與最多顯示的前後鄰居數
const SPACING = 78
const VISIBLE = 3

export default function VersionTimeline({ versions, loading }: Props) {
  const [mode, setMode] = useState<'timeline' | 'detail'>('timeline')
  const [activeIndex, setActiveIndex] = useState(0)
  const [origin, setOrigin] = useState({ x: 0, y: 0 })
  const [clipOpen, setClipOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const focusedItemRef = useRef<HTMLButtonElement>(null)
  const didInit = useRef(false)

  // 初次載入時，把焦點對到台服當前版本
  useEffect(() => {
    if (didInit.current || versions.length === 0) return
    didInit.current = true
    const idx = versions.findIndex(v => v.isTwCurrent)
    if (idx >= 0) setActiveIndex(idx)
  }, [versions])

  const step = useCallback((dir: number) => {
    setActiveIndex(i => Math.min(versions.length - 1, Math.max(0, i + dir)))
  }, [versions.length])

  const openDetail = useCallback((idx: number, rect: DOMRect) => {
    const container = containerRef.current
    if (!container) return
    const cr = container.getBoundingClientRect()
    flushSync(() => {
      setOrigin({
        x: Math.round(rect.left + rect.width / 2 - cr.left),
        y: Math.round(rect.top + rect.height / 2 - cr.top),
      })
      setActiveIndex(idx)
      setClipOpen(false)
      setMode('detail')
    })
    requestAnimationFrame(() => requestAnimationFrame(() => setClipOpen(true)))
  }, [])

  function closeDetail() {
    setClipOpen(false)
    setTimeout(() => setMode('timeline'), 460)
  }

  // 滾輪：在焦點輪播中上下切換選擇（攔截避免觸發頁面 snap 捲動）
  useEffect(() => {
    if (mode !== 'timeline') return
    const el = viewportRef.current
    if (!el) return
    let accum = 0
    const THRESH = 36
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      e.stopPropagation()
      accum += e.deltaY
      if (accum > THRESH) { step(1); accum = 0 }
      else if (accum < -THRESH) { step(-1); accum = 0 }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode, step])

  // 鍵盤：方向鍵切換、Enter/空白開啟詳情
  useEffect(() => {
    if (mode !== 'timeline') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      else if (e.key === 'Enter' || e.key === ' ') {
        const rect = focusedItemRef.current?.getBoundingClientRect()
        if (rect) { e.preventDefault(); openDetail(activeIndex, rect) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, step, activeIndex, openDetail])

  const currentVersion = versions.find(v => v.isTwCurrent)
  const currentBannerSrc = currentVersion?.bannerImage
    ? `${import.meta.env.BASE_URL}${currentVersion.bannerImage.replace(/^\//, '')}`
    : null

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Outer container: overflow-hidden required for clip-path to animate within bounds.
          flex-1 fills the available tab-content height so detail/timeline never overflow it. */}
      <div ref={containerRef} className="relative border border-border rounded-2xl overflow-hidden bg-bg-card flex-1 min-h-0 flex flex-col">
        {/* Current TW version banner as subtle background */}
        {currentBannerSrc && (
          <div className="absolute inset-0 pointer-events-none select-none z-0">
            <img
              src={currentBannerSrc}
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-top opacity-20"
              draggable={false}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-bg-card/40 via-bg-card/60 to-bg-card/90" />
          </div>
        )}

        {loading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 z-20 overflow-hidden">
            <div className="h-full bg-accent-orange animate-pulse w-full opacity-60" />
          </div>
        )}

        {/* ── Timeline (focus carousel) ── 焦點永遠停在中央，滾動改變選擇 */}
        <div className={`relative z-10 flex-1 min-h-0 transition-opacity duration-200 ${mode !== 'timeline' ? 'opacity-0 pointer-events-none' : ''}`}>
          <div ref={viewportRef} className="relative w-full h-full overflow-hidden">
            {/* 中央焦點區提示帶 */}
            <div className="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[60px] border-y border-accent-orange/20 bg-accent-orange/[0.04]" />

            {/* 上/下切換鈕 */}
            <button
              onClick={() => step(-1)}
              disabled={activeIndex === 0}
              className="absolute top-2 left-1/2 -translate-x-1/2 z-30 w-8 h-7 flex items-center justify-center rounded-md text-text-dim
                         hover:text-accent-orange disabled:opacity-20 transition-colors"
              aria-label="上一個版本"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button
              onClick={() => step(1)}
              disabled={activeIndex === versions.length - 1}
              className="absolute bottom-7 left-1/2 -translate-x-1/2 z-30 w-8 h-7 flex items-center justify-center rounded-md text-text-dim
                         hover:text-accent-orange disabled:opacity-20 transition-colors"
              aria-label="下一個版本"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>

            {/* 版本項目 */}
            {versions.map((version, i) => {
              const offset = i - activeIndex
              const abs = Math.abs(offset)
              if (abs > VISIBLE) return null

              const isFocus = offset === 0
              const isCurrent = version.isTwCurrent
              const isPredicted = !isCurrent && (version.upper.twIsPredicted || version.lower.twIsPredicted)
              const bannerSrc = version.bannerImage
                ? `${import.meta.env.BASE_URL}${version.bannerImage.replace(/^\//, '')}`
                : null
              const opacity = abs === 3 ? 0.18 : abs === 2 ? 0.45 : abs === 1 ? 0.75 : 1

              return (
                <button
                  key={version.version}
                  ref={isFocus ? focusedItemRef : undefined}
                  onClick={(e) =>
                    isFocus
                      ? openDetail(i, e.currentTarget.getBoundingClientRect())
                      : setActiveIndex(i)
                  }
                  className={`absolute left-1/2 top-1/2 w-[clamp(280px,72%,440px)] flex items-center gap-4 px-4 py-3 rounded-2xl border backdrop-blur-sm transition-all duration-300 ease-out
                    ${isFocus
                      ? 'border-accent-orange/60 bg-bg-dark/70 shadow-[0_0_24px_rgba(255,107,43,0.18)]'
                      : 'border-border/40 bg-bg-dark/30 hover:border-border hover:bg-bg-dark/50'
                    }`}
                  style={{
                    transform: `translate(-50%, -50%) translateY(${offset * SPACING}px) scale(${isFocus ? 1 : 0.86})`,
                    opacity,
                    zIndex: 20 - abs,
                  }}
                  aria-label={`v${version.version}${version.name ? ` ${version.name}` : ''}`}
                >
                  {/* Banner circle */}
                  <span className={`relative shrink-0 w-12 h-12 rounded-full overflow-hidden border ${
                    isCurrent ? 'border-accent-green' : isPredicted ? 'border-dashed border-accent-cyan/70' : 'border-border'
                  }`}>
                    {bannerSrc && (
                      <img
                        src={bannerSrc}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        draggable={false}
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold font-[Orbitron,sans-serif] text-text-dim">
                      v{version.version}
                    </span>
                  </span>

                  {/* Info */}
                  <span className="flex-1 text-left min-w-0">
                    <span className={`block font-bold font-[Orbitron,sans-serif] leading-tight truncate ${
                      isFocus ? 'text-base' : 'text-sm'
                    } ${isCurrent ? 'text-accent-green' : isPredicted ? 'text-accent-cyan' : 'text-text-primary'}`}>
                      v{version.version}{version.name ? ` ${version.name}` : ''}
                    </span>
                    <span className="block text-[11px] text-text-dim mt-0.5 font-[JetBrains_Mono,monospace]">
                      台 {version.upper.twDate ?? '—'}
                    </span>
                    {(isCurrent || isPredicted) && (
                      <span className="flex gap-1 mt-1">
                        {isCurrent && (
                          <span className="text-[9px] bg-accent-green/10 text-accent-green border border-accent-green/30 px-1.5 rounded">★ 當前</span>
                        )}
                        {isPredicted && (
                          <span className="text-[9px] border border-accent-cyan/40 text-accent-cyan px-1 rounded">預測</span>
                        )}
                      </span>
                    )}
                  </span>

                  {/* Play / expand affordance (focus only) */}
                  {isFocus && (
                    <span className="shrink-0 w-8 h-8 rounded-full bg-accent-orange/90 flex items-center justify-center text-bg-dark">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M4 3l7 4-7 4z" /></svg>
                    </span>
                  )}
                </button>
              )
            })}

            {/* Hint */}
            <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-text-dim/50 select-none">
              滾動切換版本 · 點擊中央項目開啟詳情
            </div>
          </div>
        </div>

        {/* ── Detail overlay ── clip-path circle animates from focused item position */}
        {mode !== 'timeline' && (
          <div
            className="absolute inset-0 bg-bg-card/10 backdrop-blur-md"
            style={{
              clipPath: clipOpen
                ? `circle(200% at ${origin.x}px ${origin.y}px)`
                : `circle(22px at ${origin.x}px ${origin.y}px)`,
              transition: 'clip-path 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <VersionDetailView
              versions={versions}
              activeIndex={activeIndex}
              onNavigate={setActiveIndex}
              onClose={closeDetail}
            />
          </div>
        )}
      </div>
    </div>
  )
}
