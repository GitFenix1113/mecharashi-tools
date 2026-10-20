import type { BuffLevel, GameBuff } from '../../types'
import { BUFF_TONE_BG, BUFF_TONE_LABEL, buffGlyphKey, buffIconTone } from '../../utils/buffGlyph'
import { StatusGlyph, type StatusGlyphSize } from './StatusGlyph'

// ─── BUFF 圖示（PLAN-055 D-1）────────────────────────────────────────────────
//
// 照遊戲的畫法：**色塊底＋細米白框＋白色字形**（藍增益／紅減益／紫特殊／綠治療，色值在 index.css 的 --color-buff-*）。
// 官方字形本來就是白色透明底，所以直接疊一張 <img>，不需要 CSS mask 上色。
// 底色規則與字形選擇在 utils/buffGlyph.ts（純函式，有測試）。
//
// ⚠ 沒有字形（BUFF 還沒對到圖）時畫一顆**中性小點**，不畫空色塊：空的藍／紅塊會被讀成「有一個沒圖的增益」，
//   而實際上只是我們還沒建檔。字形 key 有、但檔案載不到時才留下空色塊（不該發生，掃描器 (c) 會抓）。
// ⚠ 不畫層數與剩餘回合：那是戰鬥中的即時狀態，網站顯示的是 BUFF 定義。

export function BuffGlyph({
  buff, level, size = 'md', className = '',
}: {
  buff: Pick<GameBuff, 'icon' | 'iconTone' | 'buffType' | 'name'>
  /** 指定某一級時，該級有專屬圖示就用它 */
  level?: Pick<BuffLevel, 'icon'> | null
  size?: StatusGlyphSize
  className?: string
}) {
  const tone = buffIconTone(buff)
  return (
    <StatusGlyph
      icon={buffGlyphKey(buff, level)}
      name={buff.name}
      backgroundClass={BUFF_TONE_BG[tone]}
      title={`${buff.name}・${BUFF_TONE_LABEL[tone]}`}
      size={size}
      className={className}
    />
  )
}
