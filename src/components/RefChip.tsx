import { createContext, useContext } from 'react'
import type { EntityRef, RefType } from '../types'
import { useReference } from '../contexts/ReferenceContext'

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
  const color = REF_COLOR[entity.refType] ?? 'text-accent-purple'
  const label = entity.label ?? inner

  return (
    <button
      type="button"
      className={`inline ${color} font-semibold underline decoration-dotted underline-offset-2 hover:brightness-125 transition-colors cursor-pointer`}
      title={`查看「${label}」`}
      onMouseEnter={inPopover ? undefined : (e) => hoverRef(entity, e.currentTarget)}
      onMouseLeave={inPopover ? undefined : leaveRef}
      onClick={(e) => {
        e.stopPropagation()
        if (inPopover) drillRef(entity)
        else pinRef(entity, e.currentTarget)
      }}
    >
      [{label}]
    </button>
  )
}
