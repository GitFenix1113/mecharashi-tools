import { useEffect, useRef } from 'react'
import type { PatchVersion } from '../../data/patchVersions'

/**
 * 版本選擇列（PLAN-050 C-2）。
 *
 * 取代原本的焦點輪播。輪播是**前置關卡**：它自己佔滿整個面板，要先在裡面滾到目標版本、
 * 再點中央項目才會展開甘特 —— 抵達內容需要四步，而且一次只看得到前後三個版本。
 * 現在改成一條常駐的窄列：目前在哪、還有哪些版本、跳到任一版本都在同一個平面上完成。
 *
 * 鍵盤：方向鍵**只在本列取得焦點時**才切換版本。這一點是刻意的 ——
 * 全域監聽方向鍵會把右側卡片欄的捲動吃掉，那正是本計畫要消滅的
 * 「離散狀態綁在連續輸入上」，只是換成鍵盤版本。
 */
export default function VersionRail({
  versions,
  activeIndex,
  onSelect,
}: {
  versions: PatchVersion[]
  activeIndex: number
  onSelect: (idx: number) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const didCenter = useRef(false)

  /**
   * 把目前這顆捲到本列中央。
   *
   * 直接對本列 `scrollTo` 而不是用 `scrollIntoView`，有兩個理由：
   * ① `scrollIntoView` 會沿著**所有**可捲祖先動作，稍不小心就把信箱帶或整頁一起捲掉；
   *    這裡要動的只有本列的水平捲動位置。
   * ② 首次掛載時 `behavior: 'smooth'` 實測不會生效（版面還在因為橫幅圖載入而變動，
   *    平滑捲動被取消），結果是行動版一進來停在 v1.0、當前版本在畫面外 1069px 處。
   *    首次用 `auto` 直接跳到位，之後的切換才用 `smooth`。
   *
   * 依賴帶上 `versions.length`：靜態 fallback 先到、真資料後到時版面會重排，要重新對位。
   */
  useEffect(() => {
    const rail = railRef.current
    const el = activeRef.current
    if (!rail || !el) return
    const left = el.offsetLeft - rail.clientWidth / 2 + el.offsetWidth / 2
    rail.scrollTo({ left: Math.max(0, left), behavior: didCenter.current ? 'smooth' : 'auto' })
    didCenter.current = true
  }, [activeIndex, versions.length])

  return (
    <div
      ref={railRef}
      role="tablist"
      aria-label="版本選擇"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          onSelect(Math.max(0, activeIndex - 1))
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          onSelect(Math.min(versions.length - 1, activeIndex + 1))
        } else if (e.key === 'Home') {
          e.preventDefault(); onSelect(0)
        } else if (e.key === 'End') {
          e.preventDefault(); onSelect(versions.length - 1)
        }
      }}
      className="flex items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain
                 px-3 py-1 rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-accent-orange/60
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {versions.map((v, i) => {
        const isActive = i === activeIndex
        const isCurrent = v.isTwCurrent
        const isPredicted = !isCurrent && (v.upper.twIsPredicted || v.lower.twIsPredicted)
        return (
          <button
            key={v.version}
            ref={isActive ? activeRef : undefined}
            role="tab"
            aria-selected={isActive}
            tabIndex={-1}
            onClick={() => onSelect(i)}
            title={`v${v.version}${v.name ? ` ${v.name}` : ''}${v.upper.twDate ? ` · 台 ${v.upper.twDate}` : ''}`}
            className={`shrink-0 px-2 py-0.5 rounded-md border text-[12px] font-[Orbitron,sans-serif] tracking-wide
                        transition-colors cursor-pointer whitespace-nowrap ${
              isActive
                ? 'border-accent-orange bg-accent-orange/20 text-accent-orange'
                : isCurrent
                  ? 'border-accent-green/50 bg-accent-green/10 text-accent-green hover:bg-accent-green/20'
                  : isPredicted
                    ? 'border-dashed border-accent-cyan/40 text-accent-cyan/80 hover:border-accent-cyan/70'
                    : 'border-border/60 text-text-dim hover:text-text-primary hover:border-border-accent'
            }`}
          >
            v{v.version}
            {isCurrent && <span className="ml-0.5">★</span>}
          </button>
        )
      })}
    </div>
  )
}
