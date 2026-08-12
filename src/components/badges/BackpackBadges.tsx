import { Fragment, useState } from 'react'
import { assetUrl } from '../../utils/assets'

export const BACKPACK_TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  Heal:            { label: '修理',    className: 'text-accent-green bg-accent-green/10 border-accent-green/30' },
  Ammo:            { label: '彈藥',    className: 'text-accent-orange bg-accent-orange/10 border-accent-orange/30' },
  Interference:    { label: '誘導',    className: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30' },
  Invisible:       { label: '隱形',    className: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30' },
  BackupEquipment: { label: '武器擴充', className: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30' },
  MovePointAdd:    { label: '移動',    className: 'text-accent-blue bg-accent-blue/10 border-accent-blue/30' },
  Flow:            { label: '飛行',    className: 'text-accent-pink bg-accent-pink/10 border-accent-pink/30' },
  Radar:           { label: '雷達',    className: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30' },
  EMP:             { label: '干擾',    className: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30' },
  Enhance:         { label: '強化',    className: 'text-accent-orange bg-accent-orange/10 border-accent-orange/30' },
  PowerAdd:        { label: '出力',    className: 'text-accent-red bg-accent-red/10 border-accent-red/30' },
}

export const ASSEMBLABLE_ARMOR_CONFIG: Record<string, { label: string; className: string }> = {
  Light:  { label: '輕甲', className: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/40' },
  Medium: { label: '中甲', className: 'text-accent-green bg-accent-green/10 border-accent-green/40' },
  Heavy:  { label: '重甲', className: 'text-accent-red bg-accent-red/10 border-accent-red/40' },
}

export function BackpackTypeBadge({ type, className = '' }: { type: string; className?: string }) {
  const config = BACKPACK_TYPE_CONFIG[type]
  const cls = config?.className ?? 'text-text-secondary bg-bg-card border-border'
  return (
    <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold border ${cls} ${className}`}>
      {config?.label ?? type}
    </span>
  )
}

export function AssemblableArmorTypeBadge({ armorType, className = '' }: { armorType: string[]; className?: string }) {
  if (!armorType || armorType.length === 0) return null
  return (
    <>
      {armorType.map((type, i) => {
        const config = ASSEMBLABLE_ARMOR_CONFIG[type]
        if (!config) return null
        return (
          <Fragment key={type}>
            {i > 0 && <span className="text-border/60 select-none text-[11px]">|</span>}
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold border ${config.className} ${className}`}>
              {config.label}
            </span>
          </Fragment>
        )
      })}
    </>
  )
}

type RarityIconStyle = { background: string; boxShadow: string; placeholder: string }
const RARITY_ICON_STYLE: Record<string, RarityIconStyle> = {
  SS: {
    background: 'linear-gradient(135deg, #2e1065 0%, #1c1a2e 50%, #451a03 100%)',
    boxShadow: '0 0 0 1.5px #d97706cc, 0 0 8px 1px #d9770638',
    placeholder: 'text-amber-200/60',
  },
  'S+': {
    background: '#0f172a',
    boxShadow: '0 0 0 1.5px #eab308cc, 0 0 6px 1px #eab30838',
    placeholder: 'text-yellow-300/60',
  },
  S: {
    background: '#0f172a',
    boxShadow: '0 0 0 1px #b45309aa',
    placeholder: 'text-amber-600/60',
  },
  A: {
    background: '#0f172a',
    boxShadow: '0 0 0 1px #7c3aedaa',
    placeholder: 'text-purple-400/60',
  },
  B: {
    background: '#0f172a',
    boxShadow: '0 0 0 1px #0891b2aa',
    placeholder: 'text-cyan-400/60',
  },
}

function resolveBackpackIcon(icon: string): { local: string; remote: string } {
  const filename = icon.split('/').pop() ?? ''
  return {
    local: assetUrl(`/images/backpacks/${filename}`),
    remote: icon,
  }
}

export function BackpackIcon({ icon, name, rarity, size = 'md' }: { icon?: string; name: string; rarity?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [fallback, setFallback] = useState<'local' | 'remote' | 'failed'>('local')
  const dim = size === 'lg' ? 'w-16 h-16' : size === 'md' ? 'w-10 h-10' : 'w-8 h-8'
  const rs = rarity ? (RARITY_ICON_STYLE[rarity] ?? null) : null

  const containerStyle = rs
    ? { background: rs.background, boxShadow: rs.boxShadow }
    : undefined

  if (!icon || fallback === 'failed') {
    return (
      <div
        className={`${dim} rounded-lg flex items-center justify-center flex-shrink-0 ${!rs ? 'bg-bg-dark border border-border' : ''}`}
        style={containerStyle}
      >
        <span className={`text-[13px] ${rs?.placeholder ?? 'text-text-dim'}`}>背</span>
      </div>
    )
  }

  const { local, remote } = resolveBackpackIcon(icon)
  const src = fallback === 'local' ? local : remote

  return (
    <div
      className={`${dim} rounded-lg overflow-hidden flex-shrink-0 ${!rs ? 'bg-bg-dark border border-border' : ''}`}
      style={containerStyle}
    >
      <img
        src={src}
        alt={name}
        className="w-full h-full object-contain"
        onError={() => setFallback((prev) => (prev === 'local' ? 'remote' : 'failed'))}
      />
    </div>
  )
}
