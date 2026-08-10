// ── Weapon Type ──────────────────────────────────────────────────────────────

const WEAPON_TYPE_CONFIG: Record<string, string> = {
  射擊: 'text-accent-blue   bg-accent-blue/10   border-accent-blue/30',
  格鬥: 'text-accent-red    bg-accent-red/10    border-accent-red/30',
  突擊: 'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  戰術: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
  // 固定武裝專用（PLAN-040）。刻意明列而非吃下方 fallback：
  // fallback 是給「未知／壞資料」的樣式，讓已知的「特殊」與未知同色，
  // 等於把一個正常值渲染成看起來像壞掉的值。
  特殊: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30',
}

export function WeaponTypeBadge({ type, className = '' }: { type: string; className?: string }) {
  const cls = WEAPON_TYPE_CONFIG[type] ?? 'text-text-secondary bg-bg-card border-border'
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold border ${cls} ${className}`}>
      {type}
    </span>
  )
}

// ── Fixed Armament（PLAN-040）─────────────────────────────────────────────────

/**
 * [固定武裝] 標記：無法更換的武器。
 *
 * ⚠ 必須與專武（isExclusive）的金框 + ⭐ **視覺可辨**——兩者語意相反：
 *   專武是「可選裝的獎勵」，固定武裝是「鎖死的限制」。看起來一樣會讓使用者
 *   把限制誤讀成獎勵，所以這裡用鎖頭而非星星、橘色而非金色。
 */
export function FixedArmamentBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-[13px] font-bold border text-accent-orange bg-accent-orange/10 border-accent-orange/30 ${className}`}
      title="固定武裝：無法更換、不可裝元件"
    >
      🔒 固定武裝
    </span>
  )
}

// ── Equip Slot ────────────────────────────────────────────────────────────────

const EQUIP_SLOT_CONFIG: Record<string, { label: string; className: string }> = {
  singleHand: { label: '單手', className: 'text-text-secondary bg-bg-dark border-border' },
  dualHand:   { label: '雙手', className: 'text-text-secondary bg-bg-dark border-border' },
  shoulder:   { label: '肩膀', className: 'text-accent-cyan  bg-accent-cyan/10  border-accent-cyan/30' },
  back:       { label: '背後', className: 'text-accent-green bg-accent-green/10 border-accent-green/30' },
}

export const EQUIP_SLOT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(EQUIP_SLOT_CONFIG).map(([k, v]) => [k, v.label])
)

export function WeaponEquipSlotBadge({ slot, className = '' }: { slot: string; className?: string }) {
  const config = EQUIP_SLOT_CONFIG[slot]
  if (!config) return null
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold border ${config.className} ${className}`}>
      {config.label}
    </span>
  )
}

// ── Mech Restriction ──────────────────────────────────────────────────────────

const MECH_RESTRICTION_CONFIG: Record<string, { label: string; className: string }> = {
  light:  { label: '輕型限定', className: 'text-accent-cyan  bg-accent-cyan/10  border-accent-cyan/30' },
  medium: { label: '中型限定', className: 'text-accent-green bg-accent-green/10 border-accent-green/30' },
  heavy:  { label: '重型限定', className: 'text-accent-red   bg-accent-red/10   border-accent-red/30' },
}

export const MECH_RESTRICTION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(MECH_RESTRICTION_CONFIG).map(([k, v]) => [k, v.label])
)

export function WeaponMechRestrictionBadge({ restriction, className = '' }: { restriction: string; className?: string }) {
  const config = MECH_RESTRICTION_CONFIG[restriction]
  if (!config) return null
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold border ${config.className} ${className}`}>
      {config.label}
    </span>
  )
}

// ── Skill Activation ──────────────────────────────────────────────────────────
// carry=紫 / equip=青 / use=橘（依 PLAN-006 決策四）

export const ACTIVATION_CONFIG: Record<string, { label: string; className: string }> = {
  carry: { label: '攜帶生效',   className: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30' },
  equip: { label: '裝備中生效', className: 'text-accent-cyan   bg-accent-cyan/10   border-accent-cyan/30' },
  use:   { label: '使用時生效', className: 'text-accent-orange bg-accent-orange/10 border-accent-orange/30' },
}

export const ACTIVATION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ACTIVATION_CONFIG).map(([k, v]) => [k, v.label])
)

export function WeaponActivationBadge({ activation, className = '' }: { activation: string; className?: string }) {
  const config = ACTIVATION_CONFIG[activation] ?? { label: activation, className: 'text-text-dim bg-bg-dark border-border' }
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold border ${config.className} ${className}`}>
      {config.label}
    </span>
  )
}
