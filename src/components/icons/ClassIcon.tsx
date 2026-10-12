import { pilotClassIconKey } from '../../data/pilotClasses'
import { MaskIcon } from './MaskIcon'

/**
 * 機師職業圖示（PLAN-059）。顏色吃 currentColor——要職業色就在外層套 `pilotClassMeta(x).text`。
 *
 * 尺寸自動選圖：≥32px 用 _l（340²，有刮痕質感），其餘用 _s（72×80，線條乾淨；_l 縮小後刮痕會糊成雜點）。
 * size 給字串（預設 1em）時一律當小圖。認不得的職業什麼都不畫。
 */
export function ClassIcon({
  pilotClass, size = '1em', decorative = false, className = '',
}: {
  pilotClass: string | null | undefined
  size?: number | string
  /** 旁邊已經寫了職業名時設 true（讀屏不重複念） */
  decorative?: boolean
  className?: string
}) {
  const variant = typeof size === 'number' && size >= 32 ? 'l' : 's'
  return (
    <MaskIcon
      iconKey={pilotClassIconKey(pilotClass, variant)}
      size={size}
      label={decorative ? undefined : (pilotClass ?? undefined)}
      className={className}
    />
  )
}
