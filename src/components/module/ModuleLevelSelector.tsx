import type { MouseEvent } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'

/**
 * 模組等級選擇器（PLAN-044 決策一）。
 *
 * 桌機用滑桿、行動裝置改分段按鈕——range 的觸控目標太小，chip 寬度足夠且更好按。
 * 只有一級（多數通用模組）或沒有等級資料時整個不渲染，避免出現無意義的「Lv.1 / 1」。
 *
 * 所有互動一律 stopPropagation：卡片本身仍掛著點擊行為（Phase D 拆掉浮窗釘選前尤其重要），
 * 拖動滑桿不該順手觸發卡片。
 */
export function ModuleLevelSelector({
  level,
  maxLevel,
  onChange,
  className = '',
}: {
  level: number
  maxLevel: number
  onChange: (level: number) => void
  className?: string
}) {
  const isMobile = useIsMobile()

  if (maxLevel <= 1) return null

  const stop = (e: MouseEvent) => e.stopPropagation()
  const levels = Array.from({ length: maxLevel }, (_, i) => i + 1)

  if (isMobile) {
    return (
      <div className={`flex flex-wrap gap-1 ${className}`} onClick={stop}>
        {levels.map((lv) => (
          <button
            key={lv}
            onClick={(e) => { stop(e); onChange(lv) }}
            className={`px-2 py-0.5 rounded border text-[13px] font-medium transition-colors cursor-pointer ${
              lv === level
                ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
                : 'bg-bg-dark text-text-dim border-border hover:text-text-secondary'
            }`}
          >
            {lv}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2 ${className}`} onClick={stop}>
      <input
        type="range"
        min={1}
        max={maxLevel}
        step={1}
        value={level}
        onChange={(e) => onChange(Number(e.target.value))}
        onClick={stop}
        onMouseDown={stop}
        aria-label="模組等級"
        className="flex-1 min-w-0 accent-accent-orange cursor-pointer"
      />
      <span className="shrink-0 text-[13px] font-bold font-[JetBrains_Mono,monospace] text-accent-orange">
        Lv.{level}/{maxLevel}
      </span>
    </div>
  )
}
