import { useEffect, useRef } from 'react'
import type { LoreChapter } from '../../types'

/**
 * 章節導覽底盤（PLAN-042-A / C-2）。
 *
 * 職責只有一件事：把「現在要看哪一章」的**離散**輸入收攏成一次 `onSelect`。
 * 章節內容由呼叫端以 children 傳進來（`LoreChapterBody`），本元件不碰內容。
 *
 * ⚠ **絕不接滾輪事件。** PLAN-050 拆掉舊輪播的四個理由裡，唯一會在故事館重現的
 *   就是滾輪劫持——館內只有一個 scrollport，一旦把滾輪吃掉，使用者在正文中段
 *   往下捲會突然跳章，而且沒有任何錯誤訊息。
 *   章間一律靠「點按鈕／按方向鍵／水平滑動」這三種**明確意圖**的輸入。
 *
 * ⚠ 不做切章捲頂（決策 (I)）：館首頁→扉頁、扉頁→章節、章節→章節三條路徑都要重置，
 *   而 `LoreLayout` 全程不卸載、又是唯一知道館內 scrollport 在哪的人，捲頂統一由它
 *   監聽 pathname 負責。本元件因此不去 DOM 上反查那個 scrollport——少一個對
 *   DOM 結構的隱性耦合。
 *
 * ⚠ 內部不開第二層垂直捲動容器（地雷 M-08）：兩條垂直捲軸並存時外層永遠捲不動，
 *   而 sticky 章節軸會相對錯誤的 scrollport，症狀是「有時黏有時不黏」，桌機短內容看不出來。
 */
export interface LoreChapterPagerProps {
  chapters: LoreChapter[]
  /** 目前章節的 key。**由網址推導的純衍生值**，元件內不得持有 activeIndex state。 */
  activeKey: string
  /** 使用者選了另一章。寫網址是呼叫端的事。 */
  onSelect: (key: string, index: number) => void
  /** 當前章節的內容（由父層渲染 LoreChapterBody） */
  children: React.ReactNode
  className?: string
}

/** 水平滑動門檻：位移夠大、且明顯偏水平，才算換章意圖。 */
const SWIPE_MIN_PX = 48
const SWIPE_AXIS_RATIO = 1.5

export default function LoreChapterPager({
  chapters,
  activeKey,
  onSelect,
  children,
  className,
}: LoreChapterPagerProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const touchRef = useRef<{ x: number; y: number } | null>(null)

  /**
   * 章節軸自動對位：窄視窗放不下所有章節時，當前章可能落在可視範圍外。
   *
   * 沿用 `VersionRail.tsx:30-48` 的做法，**只對本列 `scrollTo`、不用 `scrollIntoView`**——
   * 後者會沿著所有可捲祖先動作，在館內就等於順手把館內唯一的 scrollport 一起捲掉，
   * 使用者一進章節就發現正文開在中段。
   */
  useEffect(() => {
    const rail = railRef.current
    const el = activeRef.current
    if (!rail || !el) return
    const left = el.offsetLeft - rail.clientWidth / 2 + el.offsetWidth / 2
    rail.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [activeKey])

  // ⚠ 早退必須排在所有 hook 之後（hook 呼叫順序不可隨 chapters 長度改變）。
  //
  // N<=1 時整套底盤（章節軸／◀▶／頁碼／下一章列）全部不掛，只留一層 className 容器。
  // **上線初期 N<=1 是主路徑不是邊界情況**：pilotLore 現有 34 筆都是 `chapters: []` 的空殼，
  // 89 位機師今天全部走這條。
  if (chapters.length <= 1) {
    return <div className={className}>{children}</div>
  }

  const index = Math.max(
    0,
    chapters.findIndex((c) => c.key === activeKey),
  )
  const last = chapters.length - 1

  /** `activeKey` 查不到時本元件不自行 fallback（那是呼叫端的事），只確保 ◀▶ 不會從 -1 起算。 */
  const go = (delta: number) => {
    const next = index + delta
    if (next < 0 || next > last) return
    onSelect(chapters[next].key, next)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(1)
    }
  }

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0]
    touchRef.current = t ? { x: t.clientX, y: t.clientY } : null
  }

  /**
   * ⚠ **不 preventDefault**：這條路徑上的垂直捲動是館內唯一的閱讀方式，
   *   吃掉預設行為等於讓正文捲不動。門檻本身就是「只在明顯水平時才動作」的守門員。
   */
  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchRef.current
    touchRef.current = null
    const t = e.changedTouches[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy) * SWIPE_AXIS_RATIO) return
    go(dx < 0 ? 1 : -1)
  }

  // ⚠ 變體順序照既有先例 `hover:enabled:`（VersionDetailView.tsx:93），不要寫成 `enabled:hover:`。
  const arrowClass = `shrink-0 w-7 h-7 flex items-center justify-center rounded-md border
                      text-sm leading-none transition-colors cursor-pointer
                      border-border/60 text-text-secondary
                      hover:enabled:text-text-primary hover:enabled:border-border-accent
                      disabled:opacity-30 disabled:cursor-default`

  return (
    <div
      className={className}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label="章節導覽"
    >
      {/* sticky 相對 LoreLayout 提供的館內唯一 scrollport，故 top-0 有效 */}
      <div className="sticky top-0 z-10 bg-bg-dark/90 backdrop-blur-sm border-b border-border-subtle">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <button
            type="button"
            className={arrowClass}
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="上一章"
          >
            ◀
          </button>

          {/*
            常駐具名章節軸。手機放不下時水平捲動，捲軸本身藏起來（沿用 SubNavTabs.tsx:30-32）。
            ⚠ 那個 overflow-y-hidden 是必要的不是保險：CSS 規定橫向 auto 會把另一軸
              一併算成 auto，那條垂直捲軸會從這條細列裡再吃掉高度、把字切一半。
              它是 hidden 不是 auto，與 M-08「館內只有一個垂直 scrollport」不衝突。
          */}
          <div
            ref={railRef}
            className="flex-1 min-w-0 flex items-center gap-1
                       overflow-x-auto overflow-y-hidden overscroll-x-contain
                       [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {chapters.map((ch, i) => {
              const isActive = i === index
              return (
                <button
                  key={ch.key}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => onSelect(ch.key, i)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`shrink-0 px-2.5 py-1 rounded-md border text-xs whitespace-nowrap
                              transition-colors cursor-pointer ${
                                isActive
                                  ? 'border-border-accent bg-bg-card text-text-primary shadow-[inset_0_-2px_0_0_#b10000]'
                                  : 'border-transparent text-text-dim hover:text-text-primary hover:border-border/60'
                              }`}
                >
                  {/* 標籤 fallback 三處必須一致（§2.8）：index 是 0-based 陣列索引，不是 key */}
                  {`${ch.label ?? `PART ${i + 1}`} · ${ch.title}`}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            className={arrowClass}
            onClick={() => go(1)}
            disabled={index === last}
            aria-label="下一章"
          >
            ▶
          </button>

          <span className="shrink-0 text-xs tabular-nums text-text-dim">
            {index + 1} / {chapters.length}
          </span>
        </div>
      </div>

      {/*
        滑動只掛在正文區，不掛整個根容器：章節軸自己就是水平可捲的，
        兩者疊在一起會讓「捲章節軸」同時被判成「換章」。
      */}
      <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {children}
      </div>

      {index < last && (
        <div className="mt-8 pt-4 border-t border-border-subtle">
          <button
            type="button"
            onClick={() => go(1)}
            className="w-full text-left px-3 py-3 rounded-lg border border-border/60
                       text-text-secondary transition-colors cursor-pointer
                       hover:text-text-primary hover:border-border-accent hover:bg-bg-card"
          >
            <span className="block text-xs text-text-dim">下一章</span>
            <span className="block mt-0.5 text-sm">
              {`${chapters[index + 1].label ?? `PART ${index + 2}`} · ${chapters[index + 1].title}`}
              {' ▸'}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
