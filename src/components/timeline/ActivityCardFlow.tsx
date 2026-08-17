// PLAN-048 Phase 1（任務 1-2）：活動卡片流 —— 依衍生狀態分組
import { useMemo, useState } from 'react'
import ActivityCard from './ActivityCard'
import { activityStatus } from './activityStatus'
import type { VisibleActivity } from '../../data/patchVersions/types'

export interface KeyedActivity {
  key: string
  act: VisibleActivity
  /**
   * 這筆是從上一個版本延續進來的，值為來源版本的顯示名（如 `v3.1`）。
   *
   * 戰令這類活動常常跨版：它標在開跑的那一版（當期主打，也是給玩家準備時間的
   * 預告），但下一版期間仍在進行中。不標出來源，讀者會以為它是本版新增的。
   */
  carriedFrom?: string
  /**
   * 這筆卡池是復刻（實體不在該半版本的新增名單裡）。
   * 顯示層推導、不進資料 —— 見 activityTypeRegistry.bannerIsRerun。
   */
  rerun?: boolean
  /**
   * 自選池的可選名單。優先取活動自己的 `selection`，
   * 沒有才 fallback 到該半期的 `pilotSelection` / `mechSelection`。
   */
  selection?: string[]
}

type Phase = 'ongoing' | 'upcoming' | 'ended'

const GROUP_META: Record<Phase, { icon: string; label: string; cls: string }> = {
  ongoing:  { icon: '●', label: '進行中',   cls: 'text-accent-cyan' },
  upcoming: { icon: '▶', label: '即將開始', cls: 'text-text-secondary' },
  ended:    { icon: '○', label: '已結束',   cls: 'text-text-dim' },
}

export default function ActivityCardFlow({
  items,
  selectedKey,
  onSelect,
  onHover,
  registerRef,
}: {
  items: KeyedActivity[]
  selectedKey: string | null
  onSelect: (key: string | null) => void
  onHover: (key: string | null) => void
  registerRef: (key: string, el: HTMLDivElement | null) => void
}) {
  const [showEndedOverride, setShowEndedOverride] = useState<boolean | null>(null)

  const groups = useMemo(() => {
    const g: Record<Phase, KeyedActivity[]> = { ongoing: [], upcoming: [], ended: [] }
    for (const it of items) g[activityStatus(it.act).phase].push(it)
    // 進行中：快結束的排前面；即將開始：最近的排前面；已結束：最近結束的排前面
    const startOf = (x: KeyedActivity) => activityStatus(x.act).start.getTime()
    const endOf = (x: KeyedActivity) => activityStatus(x.act).endExclusive.getTime()
    g.ongoing.sort((a, b) => endOf(a) - endOf(b))
    g.upcoming.sort((a, b) => startOf(a) - startOf(b))
    g.ended.sort((a, b) => endOf(b) - endOf(a))
    return g
  }, [items])

  if (items.length === 0) return null

  // 「已結束」預設收合是為了讓進行中的內容不被舊帳淹沒；但瀏覽歷史版本時
  // 所有活動本來就都結束了，再收合就等於整個內容層空白 —— 那正是本階段要解決的問題。
  // 所以只有在還有進行中／即將開始的項目時才預設收合。
  const hasLiveItems = groups.ongoing.length > 0 || groups.upcoming.length > 0
  const showEnded = showEndedOverride ?? !hasLiveItems

  const renderGroup = (phase: Phase, list: KeyedActivity[]) => {
    if (list.length === 0) return null
    const meta = GROUP_META[phase]
    const collapsed = phase === 'ended' && !showEnded

    return (
      <div key={phase}>
        <div className={`flex items-center gap-1.5 text-[11px] mt-2 mb-1.5 ${meta.cls}`}>
          <span>{meta.icon}</span>
          <span>{meta.label} ({list.length})</span>
          {phase === 'ended' && (
            <button
              type="button"
              onClick={() => setShowEndedOverride(!showEnded)}
              className="text-text-dim hover:text-text-secondary transition-colors"
            >
              {collapsed ? '▸ 展開' : '▾ 收合'}
            </button>
          )}
        </div>
        {!collapsed && (
          <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-2">
            {list.map(({ key, act, carriedFrom, rerun, selection }) => (
              <ActivityCard
                key={key}
                act={act}
                actKey={key}
                carriedFrom={carriedFrom}
                rerun={rerun}
                selection={selection}
                selected={selectedKey === key}
                onSelect={onSelect}
                onHover={onHover}
                registerRef={registerRef}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    // @container：卡片要單欄還雙欄取決於**卡片自己的寬度**，不是視窗寬度
    // ——首頁面板收合時只有 48vw，用視窗斷點會判斷錯。
    <div className="@container px-2 pb-2 pt-1 border-t border-dashed border-border/70">
      {renderGroup('ongoing', groups.ongoing)}
      {renderGroup('upcoming', groups.upcoming)}
      {renderGroup('ended', groups.ended)}
    </div>
  )
}
