import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * 釘選浮窗「抓標題列拖曳」共用邏輯（PLAN-019 圖鑑浮窗）。
 *
 * 用法：把回傳的 `dragHandlers` 展開到 portal 的固定定位容器上，位置改成
 * `left = 基準x + offset.dx`、`top = 基準top + offset.dy`；再於欲當作把手的
 * 標題列加上 `data-drag-handle` 屬性即可。
 *
 * - 只有 pointerdown 命中帶 `[data-drag-handle]` 的祖先才會啟動拖曳，
 *   因此浮窗內文的捲動、點擊引用 chip 都不受影響。
 * - `enabled` 通常帶入「是否已釘選」；hover 預覽態不給拖。
 * - `resetKey` 切換（改釘另一張卡）時，位移自動歸零回到錨點旁。
 */
export function useDragOffset(enabled: boolean, resetKey: unknown) {
  const [offset, setOffset] = useState({ dx: 0, dy: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startX: number; startY: number; baseDx: number; baseDy: number } | null>(null)

  // 換釘選對象 → 位移歸零（浮窗重新貼回新錨點旁）
  useEffect(() => { setOffset({ dx: 0, dy: 0 }) }, [resetKey])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return
    e.preventDefault()
    drag.current = { startX: e.clientX, startY: e.clientY, baseDx: offset.dx, baseDy: offset.dy }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [enabled, offset.dx, offset.dy])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    setOffset({ dx: d.baseDx + (e.clientX - d.startX), dy: d.baseDy + (e.clientY - d.startY) })
  }, [])

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 指標已釋放 */ }
  }, [])

  return {
    offset,
    dragging,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  }
}
