import type { CSSProperties } from 'react'
import { pilotClassBadgeClass } from '../../data/pilotClasses'
import { mechWeightClassOf, mechWeightShort } from '../../data/mechWeightClasses'
import { ClassIcon } from '../icons/ClassIcon'
import { MechTypeIcon } from '../icons/MechTypeIcon'

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

// 職業的色與順序住在 src/data/pilotClasses.ts（PLAN-059 B-1，原本這裡的 CLASS_CONFIG 已併入）

export function ClassBadge({ pilotClass, className = '' }: { pilotClass: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[13px] font-bold border ${pilotClassBadgeClass(pilotClass)} ${className}`}>
      <ClassIcon pilotClass={pilotClass} decorative />
      {pilotClass}
    </span>
  )
}

/**
 * 駕照（＝機師開得動的機甲類型）。圖示＋短名；滑鼠提示用遊戲內全名「重型機甲」（決策十）。
 * ⚠ 刻意中性色：駕照的類型色（青綠紅）會和職業色撞（守護者綠＝中型綠…），機師處只用形狀分辨。
 */
export function LicenseBadge({ license, className = '' }: { license: string; className?: string }) {
  return (
    <span
      title={mechWeightClassOf(license)?.full}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[13px] font-bold bg-black/50 text-text-secondary border border-border ${className}`}
    >
      <MechTypeIcon type={license} decorative />
      {mechWeightShort(license)}
    </span>
  )
}
