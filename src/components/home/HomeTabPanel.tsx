import { useState } from 'react'
import type { PatchVersion } from '../../data/patchVersions'
import VersionQuickTable from './VersionQuickTable'
import GrayOpsPanel from './GrayOpsPanel'
import VersionTimeline from '../timeline/VersionTimeline'

type TabId = 'quick' | 'grayops' | 'timeline'

const TABS: { id: TabId; label: string }[] = [
  { id: 'quick',    label: 'Quick Table' },
  { id: 'grayops',  label: 'Gray Ops' },
  { id: 'timeline', label: 'Timeline' },
]

interface Props {
  versions: PatchVersion[]
  loading: boolean
  error: Error | null
  expanded: boolean
  onToggleExpand: () => void
}

export default function HomeTabPanel({ versions, loading, error, expanded, onToggleExpand }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('quick')

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full">
      {/* Tab bar */}
      <div className="flex items-stretch border-b border-border shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-1.5 text-lg font-[Orbitron,sans-serif] tracking-wider transition-colors cursor-pointer border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-accent-orange text-text-primary'
                : 'border-transparent text-text-dim hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Expand / collapse toggle */}
        <button
          onClick={onToggleExpand}
          title={expanded ? '收縮版面' : '展開版面'}
          className="px-4 py-1.5 text-xs font-[Orbitron,sans-serif] tracking-widest text-text-dim hover:text-accent-orange transition-colors cursor-pointer border-b-2 border-transparent -mb-px select-none"
        >
          {expanded ? '◀◀' : '▶▶'}
        </button>
      </div>

      {/* Tab content — scrolls independently, does not trigger page snap */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'quick' && (
          <VersionQuickTable versions={versions} loading={loading} error={error} />
        )}
        {activeTab === 'grayops' && (
          <GrayOpsPanel />
        )}
        {activeTab === 'timeline' && (
          <VersionTimeline versions={versions} loading={loading} />
        )}
      </div>
    </div>
  )
}
