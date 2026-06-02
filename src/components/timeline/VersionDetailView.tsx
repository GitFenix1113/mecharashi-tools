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
  const [side, setSide] = useState<'tw' | 'cn'>('tw')
  const version = versions[activeIndex]
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex < versions.length - 1

  // Keyboard navigation
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && hasPrev) {
      e.preventDefault(); onNavigate(activeIndex - 1)
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && hasNext) {
      e.preventDefault(); onNavigate(activeIndex + 1)
    }
  }, [activeIndex, hasPrev, hasNext, onNavigate, onClose])

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
        onClick={() => !disabled && onNavigate(dir === 'prev' ? activeIndex - 1 : activeIndex + 1)}
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
          <button
            onClick={() => setSide(s => (s === 'tw' ? 'cn' : 'tw'))}
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
          isExpanded={true}
          side={side}
        />
      </div>
    </div>
  )
}
