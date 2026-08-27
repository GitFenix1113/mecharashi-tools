import type { Module } from '../../types'
import { imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'

// ─── 模組縮圖（PLAN-052-G C-8）──────────────────────────────────────────────
//
// 配裝器三處共用：四部位卡、模組面板、效果彙總。
//
// ⚠ **與圖鑑的 `ModuleCard` 那顆刻意分開**：那一顆是 `rounded-lg` 的大圖卡（圖鑑語彙），
//   這一顆是 `hud-cut-sm` 的小切角方塊（配裝器 HUD 語彙）。合併會讓其中一邊看起來像
//   從另一頁貼過來的 —— 兩邊的尺寸階與圓角本來就不同。
//
// ⚠ 載不到圖時**留一個同尺寸的框**，不是把 `<img>` 藏起來：後者會讓每一列高度不一致，
//   而四張部位卡疊在一起時那是一眼看得出來的歪。

export function ModuleIcon({ mod, size = 34, className = '' }: {
  mod: Module | null | undefined
  size?: number
  className?: string
}) {
  const box = { width: size, height: size }
  const frame = `hud-cut-sm shrink-0 bg-bg-dark border border-border-subtle ${className}`

  if (!mod?.icon) return <span className={frame} style={box} />

  return (
    <span className={`shrink-0 ${className}`} style={box}>
      <FallbackImage
        candidates={imageCandidates(mod.icon)}
        alt=""
        loading="lazy"
        className="w-full h-full object-contain"
        fallback={<span className={`block w-full h-full ${frame}`} />}
      />
    </span>
  )
}
