import type { ViewMode } from '../../types'

// 圖鑑列表的「緊湊 / 詳細」切換（segmented control）
export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode
  onChange: (m: ViewMode) => void
}) {
  const btn = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
      active
        ? 'bg-accent-orange/15 text-accent-orange'
        : 'text-text-secondary hover:text-text-primary'
    }`

  return (
    <div className="inline-flex items-center gap-0.5 bg-bg-card border border-border rounded-lg p-0.5">
      <button
        type="button"
        className={btn(mode === 'compact')}
        onClick={() => onChange('compact')}
        title="緊湊檢視"
        aria-pressed={mode === 'compact'}
      >
        {/* grid icon */}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <rect x="1" y="1" width="6" height="6" rx="1" />
          <rect x="9" y="1" width="6" height="6" rx="1" />
          <rect x="1" y="9" width="6" height="6" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
        緊湊
      </button>
      <button
        type="button"
        className={btn(mode === 'detailed')}
        onClick={() => onChange('detailed')}
        title="詳細檢視"
        aria-pressed={mode === 'detailed'}
      >
        {/* large-card icon */}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <rect x="1" y="1" width="14" height="6" rx="1" />
          <rect x="1" y="9" width="14" height="6" rx="1" />
        </svg>
        詳細
      </button>
    </div>
  )
}
