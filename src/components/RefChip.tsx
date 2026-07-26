import { createContext, useContext } from 'react'
import type { EntityRef, RefType } from '../types'
import { useReference } from '../contexts/ReferenceContext'
import { useNdOverrides } from '../contexts/NdOverrideContext'
import { effectiveLevel } from '../utils/ndOverrides'

/**
 * PLAN-019 Layer 1 — 引用 token（可 hover 預覽、click 釘選）。
 * RefText 與 DiffHighlight 共用此元件，確保互動一致。
 *
 * RefScopeContext.inPopover：true 代表此 chip 位於彈出視窗內部，
 * 點擊行為改為 drill（在視窗內向下鑽，保留返回歷史），且不觸發 hover 預覽。
 */
export const RefScopeContext = createContext<{ inPopover: boolean }>({ inPopover: false })

const REF_COLOR: Record<RefType, string> = {
  buff:      'text-accent-purple',
  skill:     'text-accent-cyan',
  pilot:     'text-accent-orange',
  mech:      'text-accent-blue',
  weapon:    'text-accent-yellow',
  module:    'text-accent-green',
  backpack:  'text-accent-green',
  component: 'text-accent-cyan',
  stat:      'text-accent-red',
  term:      'text-accent-purple',
  neuralDrive: 'text-accent-purple',
}

export function RefChip({ inner, entity }: { inner: string; entity: EntityRef }) {
  const { hoverRef, leaveRef, pinRef, drillRef } = useReference()
  const { inPopover } = useContext(RefScopeContext)
  const nd = useNdOverrides()
  const color = REF_COLOR[entity.refType] ?? 'text-accent-purple'

  // PLAN-034：神經驅動算力可把 buff 引用「抬升」到更高階。只有**確實抬升**才換字，
  // 未抬升時下面整段與今日 byte-identical（見 effectiveLevel 的註解）。
  const eff = effectiveLevel(entity, nd)
  const label = eff.lifted && eff.name ? eff.name : (entity.label ?? inner)
  // 送進浮窗的 ref 必須把抬升後的階**烘進去**：EntityRefView 掛在 App.tsx 的 ReferenceProvider
  // 底下、是 <Routes> 的兄弟，機師頁內部包的 provider 永遠不可能成為它的祖先（地雷一）。
  const outRef = eff.lifted ? { ...entity, level: eff.level } : entity
  // 覆寫快照隨 ref 一起送進 ReferenceContext，供浮窗 body 內層的 RefText 沿用同一張表。
  const snapshot = eff.lifted ? nd : undefined

  const liftedTitle = eff.lifted
    ? `已由 ${nd.entryOf(entity.refId)?.zone ?? ''} 算力自 Lv${entity.level ?? 1} 提升至 Lv${eff.level}`
    : ''

  return (
    <button
      type="button"
      className={`inline ${color} font-semibold underline underline-offset-2 hover:brightness-125 transition-colors cursor-pointer ${
        // 抬升是**必做**的視覺標記，不是選配：技能區是使用者對照官方 wiki 最頻繁的地方，
        // 字面被改掉卻沒有任何跡象，等同於默默給了與遊戲不符的資訊。
        eff.lifted ? 'decoration-double decoration-accent-pink' : 'decoration-dotted'
      }`}
      title={eff.lifted ? `查看「${label}」\n${liftedTitle}` : `查看「${label}」`}
      onMouseEnter={inPopover ? undefined : (e) => hoverRef(outRef, e.currentTarget, snapshot)}
      onMouseLeave={inPopover ? undefined : leaveRef}
      onClick={(e) => {
        e.stopPropagation()
        if (inPopover) drillRef(outRef)
        else pinRef(outRef, e.currentTarget, snapshot)
      }}
    >
      [{label}]
    </button>
  )
}
