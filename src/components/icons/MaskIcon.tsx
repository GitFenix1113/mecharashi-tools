import type { CSSProperties } from 'react'
import { assetUrl } from '../../utils/assets'
import { gameIconPath } from '../../utils/gameIcons'

// ─── 白色字形 → CSS mask 上色（PLAN-059）──────────────────────────────────────
//
// 官方的職業、駕照圖示（以及陣營徽章的 _00 單色版）是白色透明底。當成遮罩用、底色吃 currentColor，
// 顏色就跟著父層文字色走：站上的職業色、故事館紙色主題的墨色，都不必另存一份上色的圖。
//
// ⚠ html2canvas（配裝匯出圖卡）不支援 CSS mask——那裡要改用 <img> 直接畫白色原圖。
// ⚠ 預設尺寸 1em：跟著旁邊文字的字級走（站上有字級切換）；圓章這類固定版面再給 px。

export function MaskIcon({
  iconKey, size = '1em', label, className = '',
}: {
  /** 圖庫裡的官方檔名；不是圖庫 key（或 undefined）就什麼都不畫 */
  iconKey: string | undefined
  size?: number | string
  /** 有給＝獨立的圖（role="img"＋aria-label＋滑鼠提示）；沒給＝裝飾，旁邊已經有文字 */
  label?: string
  className?: string
}) {
  const path = gameIconPath(iconKey)
  if (!path) return null
  const url = `url("${assetUrl(path)}")`
  const style: CSSProperties = {
    width: size, height: size,
    WebkitMaskImage: url, maskImage: url,
    WebkitMaskSize: 'contain', maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center', maskPosition: 'center',
  }
  return label
    ? <span role="img" aria-label={label} title={label} className={`inline-block shrink-0 bg-current ${className}`} style={style} />
    : <span aria-hidden="true" className={`inline-block shrink-0 bg-current ${className}`} style={style} />
}
