import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Module, ModuleLevel } from '../../types'
import { RefText } from '../RefText'
import { BottomSheet } from '../BottomSheet'
import { ModuleStatTags } from './ModuleStatTags'
import { levelRefs } from './moduleRefs'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useDragOffset } from '../../hooks/useDragOffset'

/**
 * 「各等級效果一覽」浮窗（PLAN-044 後續優化）。
 *
 * 背景：PLAN-044 把逐級效果從 hover 浮窗改成卡片內嵌滑桿，一次只看一級。
 * 有使用者反映舊版「一眼掃完 8 級」的讀法回不來了——那是**比較**用途（想知道哪一級跳最多），
 * 與滑桿的**查閱**用途並不衝突。因此不是回退，而是把它變成明確的、需要時才開的第二個入口。
 *
 * 與舊版浮窗的差異：
 * - 只由按鈕開啟，不再 hover 觸發（hover 觸發正是舊版最吵的地方，滑過就冒出來）
 * - 不再與「點卡片釘選」耦合，卡片本身沒有點擊行為
 * - 多張卡可同時開著並排比較（舊版 pinnedTooltip 是單一值，天生互斥）
 */

const PANEL_W = 320
const PANEL_W_WIDE = 360

/** 單一等級一列。與卡片內嵌的呈現同源（RefText + ModuleStatTags），不另立一套樣式。 */
function LevelRow({ mod, lv, active }: { mod: Module; lv: ModuleLevel; active: boolean }) {
  return (
    <div
      className={`rounded-lg p-2.5 border transition-colors ${
        active
          ? 'bg-accent-orange/10 border-accent-orange/30'
          : 'bg-bg-dark border-transparent'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-[13px] px-1.5 py-0.5 rounded border text-accent-orange bg-accent-orange/10 border-accent-orange/30 font-bold flex-shrink-0">
          Lv.{lv.level}
        </span>
        {lv.description && (
          <span className="text-[14px] text-text-secondary leading-tight">
            <RefText text={lv.description} refs={levelRefs(lv) ?? mod.descriptionRefs} />
          </span>
        )}
      </div>
      <ModuleStatTags stats={lv} className="gap-x-3 gap-y-0.5 mt-1.5 pl-1" />
    </div>
  )
}

function LevelRows({ mod, currentLevel }: { mod: Module; currentLevel?: number }) {
  return (
    <div className="space-y-2">
      {(mod.levels ?? []).map((lv) => (
        <LevelRow key={lv.level} mod={mod} lv={lv} active={lv.level === currentLevel} />
      ))}
    </div>
  )
}

type Anchor = { top: number; bottom: number; left: number }

const MARGIN = 8

/** 視窗夠寬就把浮窗放寬——同一段文字換行數變少，整體高度跟著降，更容易一頁塞完 8 級。 */
function panelWidth() {
  return Math.min(window.innerWidth - MARGIN * 2, window.innerWidth >= 1024 ? PANEL_W_WIDE : PANEL_W)
}

/**
 * 桌面浮窗。定位規則沿用 ReferenceContext 的 FloatingCard（下方優先、放不下翻上方、夾在視窗內），
 * 標題列可拖曳（useDragOffset），內容區獨立捲動。
 *
 * 高度策略：上限給到「整個視窗高度」而非固定 70vh——螢幕夠高時 8 級應該一次看完，
 * 捲動是**放不下才付的代價**，不是預設。放不下時才退回捲動，並把浮窗貼齊視窗邊緣把高度用滿。
 */
function LevelsPanel({ mod, currentLevel, anchor, onClose }: {
  mod: Module
  currentLevel?: number
  anchor: Anchor
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState(() => ({
    left: anchor.left,
    top: anchor.bottom + 6,
    width: panelWidth(),
    maxH: window.innerHeight - MARGIN * 2,
  }))
  const { offset, dragging, dragHandlers } = useDragOffset(true, mod.id)

  useLayoutEffect(() => {
    const place = () => {
      const width = panelWidth()
      const maxH = window.innerHeight - MARGIN * 2
      // maxHeight 已由 style 套在卡片上，故 offsetHeight 量到的就是「夾住後的實際高度」，一次量測即可
      const h = ref.current?.offsetHeight ?? 0
      const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN))
      const below = anchor.bottom + 6
      const above = anchor.top - h - 6
      let top: number
      if (below + h <= window.innerHeight - MARGIN) top = below
      else if (above >= MARGIN) top = above
      else top = Math.max(MARGIN, window.innerHeight - h - MARGIN)  // 兩邊都放不下 → 貼齊視窗
      setBox({ left, top, width, maxH })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => {
      // 引用 chip 的浮窗（z-[60]）開在 body 上、不在本視窗內；點它不該把本視窗一起關掉。
      // 兩者都掛 data-floating 當作「浮動層」的共同記號。
      if ((e.target as HTMLElement).closest('[data-floating]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      data-floating
      className={`fixed z-50 ${dragging ? 'select-none' : ''}`}
      style={{ left: box.left + offset.dx, top: box.top + offset.dy, width: box.width, touchAction: 'none' }}
      {...dragHandlers}
    >
      <div
        className="border border-border-accent rounded-xl shadow-2xl backdrop-blur-md flex flex-col"
        style={{ backgroundColor: 'rgb(15 18 25 / 0.97)', maxHeight: box.maxH }}
      >
        {/* ✕ 必須留在 data-drag-handle **外面**：useDragOffset 在 pointerdown 就 setPointerCapture，
            被捕捉後 mouseup / click 會改派到容器上，按鈕的 onClick 永遠收不到（按了沒反應）。 */}
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2 flex-shrink-0">
          <div
            data-drag-handle
            className="flex-1 min-w-0 flex items-center gap-2 cursor-move select-none"
            title="拖曳標題可移動視窗"
          >
            <span className="text-xs font-bold text-accent-orange truncate">{mod.name}</span>
            <span className="text-[13px] text-text-dim flex-shrink-0 ml-auto">各等級效果</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-text-primary hover:bg-bg-card transition-colors text-xs leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 pr-2.5">
          <LevelRows mod={mod} currentLevel={currentLevel} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 三橫線圖示；用 SVG 而非「☰」字元，避免各平台字型渲染出的大小落差。 */
function ListIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="stroke-current">
      <g strokeWidth="1.4" strokeLinecap="round">
        <line x1="1" y1="2.5" x2="11" y2="2.5" />
        <line x1="1" y1="6"   x2="11" y2="6" />
        <line x1="1" y1="9.5" x2="11" y2="9.5" />
      </g>
    </svg>
  )
}

/**
 * 開啟「各等級效果」的小按鈕（含浮窗本體）。
 * 桌面開浮窗、行動裝置開 BottomSheet；沒有兩級以上資料時整個不渲染。
 */
export function ModuleAllLevelsButton({ mod, currentLevel, className = '' }: {
  mod: Module
  /** 目前卡片選取的等級——在一覽中高亮，讓兩個入口看得出是同一份資料 */
  currentLevel?: number
  className?: string
}) {
  const isMobile = useIsMobile()
  const btnRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const open = isMobile ? sheetOpen : anchor !== null
  const close = useCallback(() => { setAnchor(null); setSheetOpen(false) }, [])

  if ((mod.levels?.length ?? 0) <= 1) return null

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) return close()
    if (isMobile) return setSheetOpen(true)
    const r = btnRef.current!.getBoundingClientRect()
    setAnchor({ top: r.top, bottom: r.bottom, left: r.left })
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-floating
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={open}
        aria-label="檢視各等級效果"
        title="檢視各等級效果"
        className={`shrink-0 flex items-center gap-1 px-1.5 py-1 rounded border text-[13px] leading-none transition-colors cursor-pointer ${
          open
            ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
            : 'bg-bg-dark text-text-dim border-border hover:text-accent-orange hover:border-accent-orange/40'
        } ${className}`}
      >
        <ListIcon />
        <span>全部</span>
      </button>

      {!isMobile && anchor && (
        <LevelsPanel mod={mod} currentLevel={currentLevel} anchor={anchor} onClose={close} />
      )}

      {isMobile && (
        <BottomSheet open={sheetOpen} onClose={close}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-accent-orange">{mod.name}</span>
            <span className="text-[13px] text-text-dim">各等級效果</span>
          </div>
          <LevelRows mod={mod} currentLevel={currentLevel} />
        </BottomSheet>
      )}
    </>
  )
}
