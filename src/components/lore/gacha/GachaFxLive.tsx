import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { assetUrl } from '../../../utils/assets'
import { loadGachaFx } from './gachaFxRegistry'
import type { GachaFxHandle } from './gachaFxEngine'

/**
 * 招募插畫的卡池動態（PLAN-042-B Phase J）：疊在鑑賞模式那張招募插畫正上方的 <canvas>。
 *
 * 由 LoreViewer 的 `live` 掛載（開場飛行播完才掛、關閉一開始就卸載），本元件只負責：
 *   ① 動態載入引擎與這台的資料（不開鑑賞的人一個 byte 都不下載），
 *   ② 第一格畫好才淡入——背景就是同一張插畫，淡入時看起來只是「特效浮現」，
 *   ③ 任何一步失敗（沒有 WebGL2、貼圖讀不到、GPU 收回 context）就把自己拿掉，底下的靜態插畫照常。
 *
 * 尺寸：canvas 的固有比例＝插畫比例（65:27），CSS 套跟主圖同一套規則（index.css .lore-viewer__live），
 * 所以版面位置、object-fit 留邊、放大縮小都和 <img> 完全重疊。繪圖解析度另外依顯示寬度×DPR 決定，放大時提高。
 */
const RATIO_W = 65, RATIO_H = 27   // 2600×1080 約分；解析度一律取整數倍，比例才不會因為取整而漂
const MAX_K = 40                   // 原尺寸 2600×1080：再大也只是放大貼圖
const ZOOM = 2.1                   // ＝ index.css .lore-viewer.is-zoom 的 scale

export default function GachaFxLive({ wap, background, zoom }: { wap: string; background: string; zoom: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let handle: GachaFxHandle | null = null
    let cancelled = false
    const fail = (err: unknown) => {
      console.warn('[卡池動態] 無法播放，維持靜態插畫：', err)
      if (!cancelled) setFailed(true)
    }
    Promise.all([loadGachaFx(wap), import('./gachaFxEngine')])
      .then(([data, { startGachaFx }]) => {
        if (cancelled) return
        return startGachaFx(canvas, data, {
          background,
          texUrl: (name) => assetUrl(`/images/game/fx/${name}.png`),
          onFirstFrame: () => { if (!cancelled) setReady(true) },
          onLost: () => fail('WebGL context lost'),
        }).then((h) => { if (cancelled) h.destroy(); else handle = h })
      })
      .catch(fail)
    return () => { cancelled = true; handle?.destroy() }
  }, [wap, background])

  // 繪圖解析度：顯示寬度×DPR（放大時再×2.1），上限原尺寸。clientWidth 不受 transform 影響，量到的是版面大小
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const fit = () => {
      const contentW = Math.min(canvas.clientWidth, (canvas.clientHeight * RATIO_W) / RATIO_H)
      if (!contentW) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const k = Math.max(4, Math.min(MAX_K, Math.round((contentW * dpr * (zoom ? ZOOM : 1)) / RATIO_W)))
      if (canvas.width !== k * RATIO_W) { canvas.width = k * RATIO_W; canvas.height = k * RATIO_H }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [zoom])

  if (failed) return null
  return (
    <canvas
      ref={ref}
      className={`lore-viewer__live${ready ? ' is-ready' : ''}`}
      width={MAX_K * RATIO_W}
      height={MAX_K * RATIO_H}
      aria-hidden="true"
    />
  )
}
