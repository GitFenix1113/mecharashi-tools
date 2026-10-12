import { ALL_MECH_TYPES, mechWeightClassOf, mechWeightIconKey } from '../../data/mechWeightClasses'
import { MaskIcon } from './MaskIcon'

/**
 * 機甲類型＝駕照圖示（PLAN-059）：輕 L／中 M／重 H。吃資料裡 5 種寫法的任何一種
 * （mechs.armorType、pilots.license、背包 Light/Medium/Heavy、武器 light/medium/heavy）。
 * 顏色吃 currentColor：機甲與裝備處套 `mechWeightClassOf(x).text`，機師處維持中性色（決策十）。
 *
 * 尺寸自動選圖：≥32px 用 _l（340²，帶外框），其餘用 _s（只有字形）。認不得的值什麼都不畫。
 * 讀屏與滑鼠提示用遊戲內全名（「輕型機甲」）。
 */
export function MechTypeIcon({
  type, size = '1em', decorative = false, className = '',
}: {
  type: string | null | undefined
  size?: number | string
  decorative?: boolean
  className?: string
}) {
  const variant = typeof size === 'number' && size >= 32 ? 'l' : 's'
  const meta = mechWeightClassOf(type)
  return (
    <MaskIcon
      iconKey={mechWeightIconKey(type, variant)}
      size={size}
      label={decorative ? undefined : meta?.full}
      className={className}
    />
  )
}

/** 「全機型」：官方的三者合一圖示 004（只有 _l）。只用在裝備詳情頁的「可裝備」（決策十） */
export function AllMechTypesIcon({ size = '1em', decorative = false, className = '' }: { size?: number | string; decorative?: boolean; className?: string }) {
  return (
    <MaskIcon
      iconKey={`Icon_wanzertype_${ALL_MECH_TYPES.icon}_l`}
      size={size}
      label={decorative ? undefined : ALL_MECH_TYPES.full}
      className={className}
    />
  )
}
