import { ModuleSlot, ModuleRarity } from '../types/enums'
import { SLOT_LABELS } from '../utils/moduleSlots'

const SLOT_CONFIG: Record<string, string> = {
  [ModuleSlot.SLOT_4]:    'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  [ModuleSlot.SLOT_8]:    'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
  [ModuleSlot.UNIVERSAL]: 'text-accent-green bg-accent-green/10 border-accent-green/30',
}

const RARITY_CONFIG: Record<string, string> = {
  [ModuleRarity.S]: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/40',
  [ModuleRarity.A]: 'text-accent-purple bg-accent-purple/10 border-accent-purple/40',
}

export function ModuleSlotBadge({ slot, className = '' }: { slot: string; className?: string }) {
  const label = SLOT_LABELS[slot] ?? slot
  const cls = SLOT_CONFIG[slot] ?? 'text-text-secondary bg-bg-card border-border'
  return (
    <span className={`text-[13px] px-1.5 py-0.5 rounded border ${cls} ${className}`}>
      {label}
    </span>
  )
}

export function ModuleRarityBadge({ rarity, className = '' }: { rarity: string; className?: string }) {
  const cls = RARITY_CONFIG[rarity] ?? ''
  return (
    <span className={`text-[13px] px-1.5 py-0.5 rounded border ${cls} ${className}`}>
      {rarity}
    </span>
  )
}
