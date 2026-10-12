import { ALL_MECH_TYPES, mechWeightBadgeClass, mechWeightClassOf, mechWeightShort, restrictedMechTypes } from '../../data/mechWeightClasses'
import { AllMechTypesIcon, MechTypeIcon } from '../icons/MechTypeIcon'

/** 機甲類型徽章：圖示＋短名「中型」，滑鼠提示用全名（PLAN-059 決策十；色與字住在 data/mechWeightClasses.ts） */
export function ArmorTypeBadge({ armorType, className = '' }: { armorType: string; className?: string }) {
  return (
    <span
      title={mechWeightClassOf(armorType)?.full}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[13px] font-bold border ${mechWeightBadgeClass(armorType)} ${className}`}
    >
      <MechTypeIcon type={armorType} decorative />
      {mechWeightShort(armorType)}
    </span>
  )
}

/**
 * 裝備的機甲類型限定（武器 mechRestriction、背包 assemblableArmorType 共用，PLAN-059 F-3）：圖示＋「中型限定」。
 * 不限制（none、空陣列、三種都列）預設什麼都不畫——清單裡只有限定的才掛徽章；
 * 詳情頁給 showAll，不限制時畫中性的「全機型」（官方三者合一圖示 004，決策十）。
 */
export function MechRestrictionBadge({ types, size = 'md', showAll = false, className = '' }: {
  /** 任何寫法：'medium'、'Medium'、['Light', 'Medium', 'Heavy']… */
  types: readonly (string | null | undefined)[]
  size?: 'sm' | 'md'
  showAll?: boolean
  className?: string
}) {
  const list = restrictedMechTypes(types)
  const box = size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-[13px]'
  if (!list.length) {
    if (!showAll) return null
    return (
      <span title={ALL_MECH_TYPES.full} className={`inline-flex items-center gap-1 rounded font-bold border text-text-secondary bg-bg-dark border-border ${box} ${className}`}>
        <AllMechTypesIcon size="1.2em" decorative />
        {ALL_MECH_TYPES.short}
      </span>
    )
  }
  return (
    <>
      {list.map((m) => (
        <span key={m.armorType} title={`${m.full}限定`} className={`inline-flex items-center gap-1 rounded font-bold border ${m.text} ${m.bg} ${m.border} ${box} ${className}`}>
          <MechTypeIcon type={m.armorType} decorative />
          {list.length === 1 ? `${m.short}限定` : m.short}
        </span>
      ))}
    </>
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
 * react-refresh/only-export-components 的 lint 錯。
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
