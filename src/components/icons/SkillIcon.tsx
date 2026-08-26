import { useState } from 'react'
import { assetUrl } from '../../utils/assets'

// ─── 技能／能力圖示（自 PilotDetailPage 上移，PLAN-052-I F 追加）────────────
//
// 天賦、技能、神經驅動能力共用的一顆方形圖示。**圖片型**而不是 SVG，
// 所以住在 `icons/` 但與 `LoadoutIcon` / `NavIcon` 那類描邊圖示不同源
// （`ComponentIcon` 是同一類，也在這個資料夾）。
//
// ⚠ 載不出來時渲染一顆 `?` 佔位方塊，**不是 `null`**：這些圖示排在名稱左邊，
//   少一顆會讓整排文字左右參差。與立繪相反 —— 那裡是整張不畫（`PilotIdentityCard`），
//   因為立繪的破圖框比沒有圖更糟，而這裡的方塊本來就只有 28–40px。

const SIZE = { sm: 'w-7 h-7', md: 'w-10 h-10' } as const

export function SkillIcon({
  iconLocal, name, size = 'md', className = '',
}: {
  iconLocal: string | undefined
  name: string
  size?: keyof typeof SIZE
  className?: string
}) {
  const [err, setErr] = useState(false)
  const cls = `${SIZE[size]} ${className}`

  if (err || !iconLocal) {
    return (
      <div className={`${cls} rounded-lg bg-bg-dark border border-border flex items-center justify-center text-text-dim text-xs flex-shrink-0`}>
        ?
      </div>
    )
  }
  return (
    <img
      src={assetUrl(iconLocal)}
      alt={name}
      className={`${cls} rounded-lg object-cover flex-shrink-0`}
      onError={() => setErr(true)}
    />
  )
}
