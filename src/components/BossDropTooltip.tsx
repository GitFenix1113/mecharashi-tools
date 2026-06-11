import {
  useFloating,
  useHover,
  useInteractions,
  useDismiss,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
  safePolygon,
} from '@floating-ui/react'
import { useState } from 'react'
import { getBossImagePath, getComponentDrops, type StageDrop } from '../data/bossDrops'
import { useIsMobile } from '../hooks/useIsMobile'
import { assetUrl } from '../utils/assets'
import type { Component } from '../types'

// ─── Shared drop content (tooltip 與 BottomSheet 共用) ────────────────────────

function BossDropContent({ drops }: { drops: StageDrop[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-4">
      {drops.map(({ stage, bosses }) => (
        <div key={stage} className="flex flex-col gap-1.5">
          <span className="text-xs text-text-dim">第 {stage} 關</span>
          <div className="flex gap-3">
            {bosses.map((bossNum) => (
              <div key={bossNum} className="flex flex-col items-center gap-1">
                <span className="text-xs font-bold text-accent-yellow">#{bossNum}</span>
                <img
                  src={assetUrl(getBossImagePath(stage, bossNum))}
                  alt={`Stage ${stage} Boss ${bossNum}`}
                  className="w-14 h-14 rounded-lg object-cover object-top border border-border"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── 懸停 Tooltip（桌面版卡片用）─────────────────────────────────────────────

interface BossDropTooltipProps {
  comp: Component
  children: React.ReactNode
}

export function BossDropTooltip({ comp, children }: BossDropTooltipProps) {
  const [isOpen, setIsOpen] = useState(false)
  const isMobile = useIsMobile()
  const drops = getComponentDrops(comp.componentType, comp.componentsWType, comp.name)
  const hasDrops = drops.length > 0

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
    ],
  })

  const hover = useHover(context, {
    enabled: hasDrops && !isMobile,
    delay: { open: 200, close: 80 },
    handleClose: safePolygon(),
  })
  const dismiss = useDismiss(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss])

  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()}>
        {children}
      </div>

      {isOpen && hasDrops && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl"
          >
            <p className="text-xs text-text-dim mb-3 tracking-wide">掉落來源</p>
            <BossDropContent drops={drops} />
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

// ─── 內嵌掉落區塊（行動版 BottomSheet 用）────────────────────────────────────

export function BossDropSection({ comp }: { comp: Component }) {
  const drops = getComponentDrops(comp.componentType, comp.componentsWType, comp.name)
  if (drops.length === 0) return null

  return (
    <div>
      <p className="text-xs text-text-dim mb-2">掉落來源</p>
      <BossDropContent drops={drops} />
    </div>
  )
}
