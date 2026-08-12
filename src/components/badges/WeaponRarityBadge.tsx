import type { CSSProperties } from 'react'

type RarityConfig = { className: string; style?: CSSProperties }

const RARITY_CONFIG: Record<string, RarityConfig> = {
  SS: {
    className: 'text-amber-300',
    style: {
      background: 'linear-gradient(135deg, #2e1065 0%, #1c1a2e 50%, #451a03 100%)',
      boxShadow: '0 0 0 1.5px #d97706cc, 0 0 8px 1px #d9770638',
    },
  },
  'S+': {
    className: 'text-accent-yellow bg-bg-dark',
    style: {
      boxShadow: '0 0 0 1.5px #eab308cc, 0 0 6px 1px #eab30838',
    },
  },
  S: {
    className: 'text-amber-600 bg-bg-dark border border-amber-700/50',
  },
  A: {
    className: 'text-accent-purple bg-accent-purple/10 border border-accent-purple/40',
  },
  B: {
    className: 'text-accent-cyan bg-accent-cyan/10 border border-accent-cyan/40',
  },
}

const FALLBACK: RarityConfig = { className: 'text-text-dim bg-bg-dark border border-border' }

export function WeaponRarityBadge({ rarity, className = '' }: { rarity: string; className?: string }) {
  const config = RARITY_CONFIG[rarity] ?? FALLBACK
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[13px] font-bold flex-shrink-0 ${config.className} ${className}`}
      style={config.style}
    >
      {rarity}
    </span>
  )
}
