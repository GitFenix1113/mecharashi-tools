import { useEffect, useCallback, useState } from 'react'
import type { PatchVersion } from '../../data/patchVersions'
import VersionExpandedPanel from './VersionExpandedPanel'

interface Props {
  versions: PatchVersion[]
  activeIndex: number
  onNavigate: (idx: number) => void
  onClose: () => void
}

export default function VersionDetailView({ versions, activeIndex, onNavigate, onClose }: Props) {
  const version = versions[activeIndex]
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex < versions.length - 1

  /**
   * 預設看哪一服：**未來版本看陸版，當前與過去看台版**。
   *
   * 理由是哪一邊的資料才是「查得到的事實」：台服還沒到的版本，它的檔期是社群依陸版
   * 反推的（`twIsPredicted`），而同一段期間的陸版早就跑完、公告俱在。
   * 預設攤開推估值而不是既成事實，等於讓讀者先看到最不確定的那一份。
   *
   * 用 `isTwCurrent` 當分界而不是自己比日期：那個旗標由 usePatchVersions 統一計算
   * （`applyTwCurrent`），且**支援後台手動覆寫** —— 兩邊各算一次遲早會不一致。
   * 找不到當前版本（資料未標）時全部維持台版，與改動前同行為。
   */
  const twCurrentIndex = versions.findIndex(v => v.isTwCurrent)
  const isFutureVersion = twCurrentIndex >= 0 && activeIndex > twCurrentIndex
  const autoSide: 'tw' | 'cn' = isFutureVersion ? 'cn' : 'tw'

  /**
   * 手動切換只在「停留在這個版本時」有效，一換版本就回到自動判斷。
   *
   * 曾經做成「記住每個版本各自的選擇」，實測後改掉：那會讓同一個版本這次開是陸版、
   * 下次開是台版，取決於使用者稍早做過什麼 —— 自動行為一旦不可預測就比沒有更糟。
   * 現在的規則只有一句話：**換版本 ＝ 重置為自動**。
   *
   * 用包一層 navigate 而不是在 effect 裡重設 state（後者會多一次 render，
   * 也是 react-hooks/set-state-in-effect 明文反對的寫法）。
   */
  const [manualSide, setManualSide] = useState<'tw' | 'cn' | null>(null)
  const side = manualSide ?? autoSide
  const toggleSide = () => setManualSide(side === 'tw' ? 'cn' : 'tw')

  const navigate = useCallback((idx: number) => {
    setManualSide(null)
    onNavigate(idx)
  }, [onNavigate])

  // Keyboard navigation（走 navigate 而不是 onNavigate，方向鍵切版本一樣要重置服別）
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && hasPrev) {
      e.preventDefault(); navigate(activeIndex - 1)
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && hasNext) {
      e.preventDefault(); navigate(activeIndex + 1)
    }
  }, [activeIndex, hasPrev, hasNext, navigate, onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  const NavBtn = ({ dir }: { dir: 'prev' | 'next' }) => {
    const disabled = dir === 'prev' ? !hasPrev : !hasNext
    const label = dir === 'prev' ? '上版' : '下版'
    const d = dir === 'prev'
      ? 'M9 3L5 7L9 11'
      : 'M5 3L9 7L5 11'
    return (
      <button
        onClick={() => !disabled && navigate(dir === 'prev' ? activeIndex - 1 : activeIndex + 1)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 rounded border border-border text-xs text-text-dim
                   disabled:opacity-30 hover:enabled:border-accent-orange/50 hover:enabled:text-accent-orange
                   transition-colors"
        aria-label={label}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {label}
      </button>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-bg-card/40 backdrop-blur-md">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          時間線
        </button>

        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-accent-orange font-[Orbitron,sans-serif]">
            v{version.version}{version.name ? ` ${version.name}` : ''}
          </span>
          {version.isTwCurrent && (
            <span className="text-[10px] bg-accent-green/10 text-accent-green border border-accent-green/30 px-1.5 py-0.5 rounded">
              ★ 台服當前
            </span>
          )}
          {/* 未來版本標記。沒有這一行的話，讀者只會看到畫面莫名其妙變成陸版 ——
              自動行為必須說得出理由，否則就是不可預測 */}
          {isFutureVersion && (
            <span
              className="text-[10px] bg-accent-purple/10 text-accent-purple border border-accent-purple/30 px-1.5 py-0.5 rounded"
              title="台服尚未推出，檔期由社群依陸版反推；預設顯示陸版的既成事實"
            >
              未來版本
            </span>
          )}
          <button
            onClick={toggleSide}
            title={isFutureVersion && side === 'cn'
              ? '這是未來版本，預設顯示陸版；台版檔期為社群推估'
              : undefined}
            className="px-2 py-1 text-[11px] rounded border border-accent-purple/50 bg-accent-purple/10 text-accent-purple hover:bg-accent-purple/20 transition-colors font-medium tracking-wide"
          >
            {side === 'tw' ? '台版' : '陸版'} ⇄ {side === 'tw' ? '切換陸版' : '切換台版'}
          </button>
        </div>

        <div className="flex gap-1.5">
          <NavBtn dir="prev" />
          <span className="text-xs text-text-dim self-center px-1">{activeIndex + 1}/{versions.length}</span>
          <NavBtn dir="next" />
        </div>
      </div>

      {/* 暫時註解，縮減版面 */}    
      {/* Keyboard hint */}
      {/*<div className="text-center text-[10px] text-text-dim/40 py-1 shrink-0 select-none">
        方向鍵切換版本 · Esc 返回
      </div>*/}

      {/* Detail content (folder tabs rendered as the card header) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-4 pb-4 pt-1">
        <VersionExpandedPanel
          version={version}
          // 上一個版本 —— 甘特要據此撈出「跨進本版的活動」（戰令常跨版，
          // 標在它開跑的那一版，但下一版仍在進行中，讀者需要看得到）
          prevVersion={activeIndex > 0 ? versions[activeIndex - 1] : undefined}
          isExpanded={true}
          side={side}
        />
      </div>
    </div>
  )
}
