import { FallbackImage } from '../common/FallbackImage'
import { gameIconCandidates } from '../../utils/gameIcons'

// ─── 技能／能力圖示（自 PilotDetailPage 上移，PLAN-052-I F 追加）────────────
//
// 天賦、技能、神經驅動能力、武器技能、背包技能共用的一顆方形圖示。**圖片型**而不是 SVG，
// 所以住在 `icons/` 但與 `LoadoutIcon` / `NavIcon` 那類描邊圖示不同源
// （`ComponentIcon` 是同一類，也在這個資料夾）。
//
// PLAN-055：圖片一律從扁平圖庫 `game/icons/` 取（`gameIconCandidates`：檔名即 key）。
// `icon`（官方檔名 key）與 `iconLocal`（舊路徑）都給——任一個能解析就有圖，舊資料不必先改。
//
// ⚠ 載不出來時渲染一顆 `?` 佔位方塊，**不是 `null`**：這些圖示排在名稱左邊，
//   少一顆會讓整排文字左右參差。與立繪相反 —— 那裡是整張不畫（`PilotIdentityCard`），
//   因為立繪的破圖框比沒有圖更糟，而這裡的方塊本來就只有 28–40px。

const SIZE = { sm: 'w-7 h-7', compact: 'w-9 h-9', md: 'w-10 h-10' } as const

export function SkillIcon({
  icon, iconLocal, name, size = 'md', className = '', placeholder = '?',
}: {
  /** 官方檔名 key（如 Icon_skill_passive_5227）；舊資料可能是路徑或遠端 URL，一樣能解析 */
  icon?: string | null
  /** 舊路徑欄位（PLAN-055 C 之後退場） */
  iconLocal?: string | null
  name: string
  size?: keyof typeof SIZE
  className?: string
  /** 沒有圖時方塊裡的字（武器／背包頁沿用「技」） */
  placeholder?: string
}) {
  const cls = `${SIZE[size]} ${className}`
  const box = (
    <div className={`${cls} rounded-lg bg-bg-dark border border-border flex items-center justify-center text-text-dim text-xs flex-shrink-0`}>
      {placeholder}
    </div>
  )
  const candidates = gameIconCandidates(icon, iconLocal)
  if (!candidates.length) return box
  return (
    <FallbackImage
      candidates={candidates}
      alt={name}
      className={`${cls} rounded-lg object-cover flex-shrink-0`}
      fallback={box}
    />
  )
}
