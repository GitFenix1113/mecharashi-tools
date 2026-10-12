import { assetUrl } from '../../utils/assets'
import { gameIconPath } from '../../utils/gameIcons'
import { isMonoLogo } from '../../utils/factionLogos'
import { MaskIcon } from './MaskIcon'

/**
 * 陣營徽章（PLAN-059 D）。
 *   `_00` 白色單色 → CSS mask 吃 currentColor：紙色扉頁上給墨色就像蓋上去的印章，暗底縮圖上給白色
 *   `_01` 彩色     → 原樣的 <img>
 * 圖在 public/images/game/icons/camp/；不是陣營徽章檔名就什麼都不畫。
 */
export function FactionLogo({
  logoKey, size = 32, label, className = '',
}: {
  logoKey: string
  size?: number | string
  /** 有給＝獨立的圖（讀屏與滑鼠提示）；沒給＝裝飾 */
  label?: string
  className?: string
}) {
  if (isMonoLogo(logoKey)) return <MaskIcon iconKey={logoKey} size={size} label={label} className={className} />
  const path = gameIconPath(logoKey)
  if (!path) return null
  return (
    <img
      src={assetUrl(path)}
      alt={label ?? ''}
      title={label}
      aria-hidden={label ? undefined : true}
      loading="lazy"
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  )
}
