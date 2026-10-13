import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { LoreChapter } from '../../types'

/**
 * 閱讀模式的章節軸（PLAN-042-A C-2；PLAN-042-D D-1 改成膠囊樣式）。
 *
 * 職責只有一件事：把「現在要看哪一章」的**離散**輸入收攏成一次 `onSelect`。
 * 章節內容由呼叫端以 children 傳進來（`LoreChapterBody`），本元件不碰內容。
 * ← → 換章改由 PilotLorePage 的全域鍵盤處理（檔案模式換人、閱讀模式換章，同一組按鍵依模式分流）。
 *
 * ⚠ **絕不接滾輪事件。** PLAN-050 拆掉舊輪播的四個理由裡，唯一會在故事館重現的
 *   就是滾輪劫持——館內只有一個 scrollport，把滾輪吃掉的話使用者在正文中段往下捲會突然跳章。
 *   章間一律靠「點按鈕／按方向鍵／水平滑動」這三種**明確意圖**的輸入。
 * ⚠ 不做切章捲頂：由 `LoreLayout` 監聽 pathname 統一處理（決策 (I)）。
 * ⚠ 內部不開第二層垂直捲動容器（地雷 M-08）。章節軸本身是橫向捲動（overflow-y: hidden，不違反 M-08）。
 */
export interface LoreChapterPagerProps {
  chapters: readonly LoreChapter[]
  /** 目前章節的 key。**由網址推導的純衍生值**，元件內不得持有 activeIndex state。 */
  activeKey: string
  /** 使用者選了另一章。寫網址是呼叫端的事。 */
  onSelect: (key: string, index: number) => void
  /** 「‹ 返回檔案」的網址 */
  backHref: string
  /** 當前章節的內容（由父層渲染 LoreChapterBody） */
  children: React.ReactNode
}

/** 水平滑動門檻：位移夠大、且明顯偏水平，才算換章意圖。 */
const SWIPE_MIN_PX = 48
const SWIPE_AXIS_RATIO = 1.5

export default function LoreChapterPager({ chapters, activeKey, onSelect, backHref, children }: LoreChapterPagerProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const touchRef = useRef<{ x: number; y: number } | null>(null)

  /**
   * 章節軸自動對位：只對本列 `scrollTo`、不用 `scrollIntoView`——後者會沿著所有可捲祖先動作，
   * 在館內就等於順手把館內唯一的 scrollport 一起捲掉（沿用 VersionRail.tsx 的做法）。
   */
  useEffect(() => {
    const rail = railRef.current
    const el = activeRef.current
    if (!rail || !el) return
    const left = el.offsetLeft - rail.clientWidth / 2 + el.offsetWidth / 2
    rail.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [activeKey])

  const index = Math.max(0, chapters.findIndex((c) => c.key === activeKey))
  const last = chapters.length - 1
  const go = (delta: number) => {
    const next = index + delta
    if (next < 0 || next > last) return
    onSelect(chapters[next].key, next)
  }

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0]
    touchRef.current = t ? { x: t.clientX, y: t.clientY } : null
  }
  /** ⚠ 不 preventDefault：垂直捲動是館內唯一的閱讀方式；門檻本身就是守門員。 */
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

  return (
    <div role="group" aria-label="章節導覽">
      {/* sticky 相對 LoreLayout 提供的館內唯一 scrollport */}
      <div className="lore-rail">
        <Link to={backHref} className="lore-rail__back">‹ 返回檔案</Link>
        {chapters.length > 1 && (
          <div ref={railRef} className="lore-rail__chips">
            {chapters.map((ch, i) => (
              <button
                key={ch.key}
                ref={i === index ? activeRef : undefined}
                type="button"
                className="lore-rail__chip"
                aria-current={i === index ? 'true' : undefined}
                onClick={() => onSelect(ch.key, i)}
              >
                {/* 標籤 fallback 三處一致（契約 §2.8）：章節軸只顯示序號＋標題 */}
                <b>{String(i + 1).padStart(2, '0')}</b><span>{ch.title}</span>
              </button>
            ))}
          </div>
        )}
        {chapters.length > 1 && <span className="lore-rail__count">{index + 1} / {chapters.length}</span>}
      </div>

      {/* 滑動只掛在正文區：章節軸自己就是水平可捲的，疊在一起會讓「捲章節軸」被判成「換章」 */}
      <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {children}
      </div>
    </div>
  )
}
