import { useEffect } from 'react'
import { useGameData } from '../../contexts/GameDataContext'
import type { GrayOpsCompany } from '../../data/patchVersions'
import GrayOpsMechRow from './GrayOpsMechRow'

const COMPANIES: GrayOpsCompany[] = ['武裝工坊', '創新動力', 'GeekX', '火花塞']

const COMPANY_COLORS: Record<GrayOpsCompany, string> = {
  '武裝工坊': 'text-accent-orange border-accent-orange/30 bg-accent-orange/5',
  '創新動力': 'text-accent-blue border-accent-blue/30 bg-accent-blue/5',
  'GeekX':    'text-accent-cyan border-accent-cyan/30 bg-accent-cyan/5',
  '火花塞':   'text-accent-yellow border-accent-yellow/30 bg-accent-yellow/5',
}

export default function GrayOpsPanel() {
  const { grayOpsRoster, loadedKeys, ensureLoaded, reloadTick } = useGameData()
  useEffect(() => { void ensureLoaded(['grayOpsRoster']) }, [ensureLoaded, reloadTick])
  const loading = !loadedKeys.has('grayOpsRoster')

  return (
    <div className="bg-bg-dark/10 rounded-2xl p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold tracking-[3px] text-accent-orange uppercase font-[Orbitron,sans-serif]">
          灰燼行動未來機甲一覽
        </span>
        {loading && <span className="text-[9px] text-text-dim animate-pulse">同步中…</span>}
        <div className="h-px flex-1 bg-border" />
      </div>

      {!loading && !grayOpsRoster && (
        <p className="text-text-dim text-sm text-center py-6">尚無資料（請由管理後台填入）</p>
      )}

      {grayOpsRoster && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {COMPANIES.map(company => {
            const mechs = grayOpsRoster.companies[company] ?? []
            return (
              <div
                key={company}
                className={`rounded-xl border p-3 ${COMPANY_COLORS[company]}`}
              >
                <div className="text-[13px] font-bold tracking-wide mb-2 pb-1.5 border-b border-current/20">
                  {company}
                </div>
                <div className="flex flex-col gap-1">
                  {mechs.map((entry, i) => (
                    <GrayOpsMechRow key={i} entry={entry} />
                  ))}
                  {mechs.length === 0 && (
                    <span className="text-[12px] text-text-dim">（尚無資料）</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
