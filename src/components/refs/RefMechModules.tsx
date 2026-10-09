import type { MechModuleSet } from '../../utils/mechModules'
import { gameIconCandidates } from '../../utils/gameIcons'
import { levelRefs } from '../module/moduleRefs'
import { RefBriefSection, RefBriefRow } from './RefBriefList'

/**
 * 機甲引用浮窗的模組摘要（2026-10-09 起取代原本的機體描述）。
 *
 * 一律顯示**滿級**：浮窗是「這台機甲帶了什麼」的速查，逐級切換留給詳情頁的 ModuleCard。
 */

// 標籤色與機甲詳情頁的 ModuleGroupLabel 同一組，兩處看起來是同一個分類
const GROUPS: { key: keyof MechModuleSet; label: string; cls: string }[] = [
  { key: 'mod4',          label: '特性',   cls: 'text-accent-orange border-accent-orange/40 bg-accent-orange/10' },
  { key: 'mod8',          label: '8級',    cls: 'text-accent-blue border-accent-blue/40 bg-accent-blue/10' },
  { key: 'fixedMods',     label: '副模組', cls: 'text-accent-green border-accent-green/40 bg-accent-green/10' },
  { key: 'exclusiveMods', label: '專屬',   cls: 'text-accent-cyan border-accent-cyan/40 bg-accent-cyan/10' },
]

export function RefMechModules({ set, loading, clamp }: {
  set: MechModuleSet
  /** modules 集合尚未載入（第一次 hover 機甲、本機也沒有快取時） */
  loading: boolean
  /** hover 預覽：描述截三行 */
  clamp: boolean
}) {
  const rows = GROUPS.flatMap(({ key, label, cls }) => {
    const v = set[key]
    const mods = Array.isArray(v) ? v : v ? [v] : []
    return mods.map((mod) => ({ mod, label, cls }))
  })

  return (
    <RefBriefSection
      title="機甲模組（滿級）"
      loading={loading}
      loadingText="模組載入中…"
      empty={rows.length === 0}
      emptyText="模組未建檔"
    >
      {rows.map(({ mod, label, cls }, i) => {
        const levels = mod.levels ?? []
        const top = levels[levels.length - 1]
        return (
          <RefBriefRow
            // moduleFixedIds 是人工維護的陣列，不保證不重複 —— key 帶上索引免得撞 key
            key={`${mod.id}:${i}`}
            icons={gameIconCandidates(mod.icon)}
            name={mod.name}
            badges={
              <>
                <span className={`text-[10px] leading-none px-1 py-0.5 rounded border ${cls}`}>{label}</span>
                {levels.length > 1 && (
                  <span className="text-[10px] leading-none font-[JetBrains_Mono,monospace] text-text-dim">
                    Lv.{levels.length}
                  </span>
                )}
              </>
            }
            text={top?.description ?? mod.description}
            // 與 ModuleCard 同一套回退：該級 refs 為空物件時也要退回模組頂層（見 levelRefs）
            refs={levelRefs(top) ?? mod.descriptionRefs}
            clamp={clamp}
          />
        )
      })}
    </RefBriefSection>
  )
}
