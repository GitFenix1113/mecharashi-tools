import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * 立繪柱的滑鼠微視差（PLAN-042-C F-6，選做）。
 *
 * 只把滑鼠相對位置寫成 CSS 變數 `--lore-px` / `--lore-py`（-1 … 1），位移量與方向全在 index.css
 * （立繪 ±6px、名字層反向 ±3px）——元件端不碰 style，才能讓 reduced-motion 在 CSS 一處關掉。
 * rAF 節流：pointermove 一秒可達上百次，每次都寫 style 會讓 layout thrash。
 * 桌機限定（pointer: fine）：觸控沒有 hover，寫了也沒意義。
 *
 * `key`：立繪柱要等資料載入才會掛到 DOM，第一次跑 effect 時 `ref.current` 還是 null。
 * 呼叫端把會在「元素出現」時改變的值（機師 id）傳進來，effect 才會在那之後重跑一次把事件掛上。
 */
export function useLoreParallax(ref: RefObject<HTMLElement | null>, key?: string) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof matchMedia === 'function' && !matchMedia('(pointer: fine)').matches) return
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let nx = 0
    let ny = 0
    const apply = () => {
      raf = 0
      el.style.setProperty('--lore-px', nx.toFixed(3))
      el.style.setProperty('--lore-py', ny.toFixed(3))
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
      ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1))
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const onLeave = () => {
      nx = 0
      ny = 0
      if (!raf) raf = requestAnimationFrame(apply)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
      el.style.removeProperty('--lore-px')
      el.style.removeProperty('--lore-py')
    }
  }, [ref, key])
}
