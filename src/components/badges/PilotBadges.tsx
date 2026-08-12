import type { CSSProperties } from 'react'

type RarityConfig = { className: string; style?: CSSProperties }

const PILOT_RARITY_CONFIG: Record<string, RarityConfig> = {
  EX: {
    className: 'text-accent-orange',
    style: {
      background: 'linear-gradient(135deg, #1c0f07 0%, #1c1a2e 50%, #431403 100%)',
      boxShadow: '0 0 0 1.5px #f97316cc, 0 0 8px 1px #f9731640',
    },
  },
  S: { className: 'text-accent-yellow bg-bg-dark border border-accent-yellow/50' },
  A: { className: 'text-accent-purple bg-accent-purple/10 border border-accent-purple/40' },
  B: { className: 'text-accent-blue bg-accent-blue/10 border border-accent-blue/40' },
}

const RARITY_FALLBACK: RarityConfig = { className: 'text-text-dim bg-bg-dark border border-border' }

export function PilotRarityBadge({ rarity, className = '' }: { rarity: string; className?: string }) {
  const config = PILOT_RARITY_CONFIG[rarity] ?? RARITY_FALLBACK
  return (
    <span
      className={`px-2 py-0.5 rounded text-[13px] font-bold ${config.className} ${className}`}
      style={config.style}
    >
      {rarity}
    </span>
  )
}

export const CLASS_CONFIG: Record<string, string> = {
  守護者: 'text-accent-green bg-accent-green/10 border-accent-green/40',
  突擊手: 'text-accent-orange bg-accent-orange/10 border-accent-orange/40',
  格鬥家: 'text-accent-red bg-accent-red/10 border-accent-red/40',
  狙擊手: 'text-accent-blue bg-accent-blue/10 border-accent-blue/40',
  戰術家: 'text-accent-purple bg-accent-purple/10 border-accent-purple/40',
  機械師: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/40',
  調構師: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/40',
}

export function ClassBadge({ pilotClass, className = '' }: { pilotClass: string; className?: string }) {
  const cls = CLASS_CONFIG[pilotClass] ?? 'text-text-secondary bg-bg-card border-border'
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold border ${cls} ${className}`}>
      {pilotClass}
    </span>
  )
}

export function LicenseBadge({ license, className = '' }: { license: string; className?: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold bg-black/50 text-text-secondary border border-border ${className}`}>
      {license}
    </span>
  )
}
