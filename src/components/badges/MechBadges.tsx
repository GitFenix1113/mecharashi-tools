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

/**
 * 機甲品質（Mech.quality）配色。**刻意與機師品質（PilotBadges 的 S/A/B）用同一組顏色** ——
 * 機甲品質階序本來就是沿用機師的，同一個字母在站上兩處長得不一樣會讓人以為是不同的東西。
 *
 * 為什麼是抄一份而不是 import 機師那份：兩者是各自領域的顯示決策，日後機甲若出現機師沒有的
 * 品質值（或反之），共用一份 config 會逼其中一邊將就另一邊。這裡的重複是刻意的。
 * EX 目前無機甲使用，先列著讓值域完整。
 *
 * 不 export：目前只有下方的 badge 用得到它，而多一個非元件的 export 就多一條
 * react-refresh/only-export-components 的 lint 錯（ARMOR_CONFIG 已經有一條了）。
 */
const MECH_QUALITY_CONFIG: Record<string, string> = {
  EX: 'text-accent-orange bg-accent-orange/10 border-accent-orange/50',
  S:  'text-accent-yellow bg-bg-dark border-accent-yellow/50',
  A:  'text-accent-purple bg-accent-purple/10 border-accent-purple/40',
  B:  'text-accent-blue bg-accent-blue/10 border-accent-blue/40',
}

export function MechQualityBadge({ quality, className = '' }: { quality: string; className?: string }) {
  const cls = MECH_QUALITY_CONFIG[quality] ?? 'text-text-dim bg-bg-dark border-border'
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold border ${cls} ${className}`}>
      {quality}
    </span>
  )
}
