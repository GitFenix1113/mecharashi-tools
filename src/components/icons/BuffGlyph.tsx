import { FallbackImage } from '../common/FallbackImage'
import type { BuffLevel, GameBuff } from '../../types'
import { BUFF_TONE_LABEL, buffGlyphKey, buffIconTone } from '../../utils/buffGlyph'
import { gameIconCandidates } from '../../utils/gameIcons'

// ─── BUFF 圖示（PLAN-055 D-1）────────────────────────────────────────────────
//
// 照遊戲的畫法：**色塊底＋細米白框＋白色字形**（藍增益／紅減益／紫特殊／綠治療，色值在 index.css 的 --color-buff-*）。
// 官方字形本來就是白色透明底，所以直接疊一張 <img>，不需要 CSS mask 上色。
// 底色規則與字形選擇在 utils/buffGlyph.ts（純函式，有測試）。
//
// ⚠ 沒有字形（BUFF 還沒對到圖）時畫一顆**中性小點**，不畫空色塊：空的藍／紅塊會被讀成「有一個沒圖的增益」，
//   而實際上只是我們還沒建檔。字形 key 有、但檔案載不到時才留下空色塊（不該發生，掃描器 (c) 會抓）。
// ⚠ 不畫層數與剩餘回合：那是戰鬥中的即時狀態，網站顯示的是 BUFF 定義。

const SIZE = {
  xs: { box: 'w-4 h-4', frame: 'border', dot: 'w-1.5 h-1.5' },
  sm: { box: 'w-5 h-5', frame: 'border', dot: 'w-2 h-2' },
  md: { box: 'w-7 h-7', frame: 'border-2', dot: 'w-2.5 h-2.5' },
  lg: { box: 'w-10 h-10', frame: 'border-2', dot: 'w-3 h-3' },
  /** 引用浮窗標題旁那一格（與其他實體的 56px 圖示對齊） */
  xl: { box: 'w-14 h-14', frame: 'border-2', dot: 'w-3.5 h-3.5' },
} as const

// Tailwind v4 要在原始碼裡看得到完整 class 名稱才會產生，所以用查表、不拼字串
const TONE_BG = { buff: 'bg-buff-up', debuff: 'bg-buff-down', special: 'bg-buff-special', heal: 'bg-buff-heal' } as const

export function BuffGlyph({
  buff, level, size = 'md', className = '',
}: {
  buff: Pick<GameBuff, 'icon' | 'iconTone' | 'buffType' | 'name'>
  /** 指定某一級時，該級有專屬圖示就用它 */
  level?: Pick<BuffLevel, 'icon'> | null
  size?: keyof typeof SIZE
  className?: string
}) {
  const s = SIZE[size]
  const key = buffGlyphKey(buff, level)
  if (!key) {
    return (
      <span className={`inline-flex items-center justify-center flex-shrink-0 ${s.box} ${className}`} aria-hidden="true">
        <span className={`${s.dot} rounded-full bg-text-dim/50`} />
      </span>
    )
  }
  const tone = buffIconTone(buff)
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 rounded-[3px] border-buff-frame ${s.box} ${s.frame} ${TONE_BG[tone]} ${className}`}
      title={`${buff.name}・${BUFF_TONE_LABEL[tone]}`}
    >
      <FallbackImage candidates={gameIconCandidates(key)} alt={buff.name} className="w-[72%] h-[72%] object-contain" />
    </span>
  )
}
