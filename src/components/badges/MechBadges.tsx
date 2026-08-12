export const ARMOR_CONFIG: Record<string, string> = {
  輕型: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/40',
  中甲: 'text-accent-green bg-accent-green/10 border-accent-green/40',
  重型: 'text-accent-red bg-accent-red/10 border-accent-red/40',
}

export function ArmorTypeBadge({ armorType, className = '' }: { armorType: string; className?: string }) {
  const cls = ARMOR_CONFIG[armorType] ?? 'text-text-secondary bg-bg-card border-border'
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold border ${cls} ${className}`}>
      {armorType}
    </span>
  )
}
