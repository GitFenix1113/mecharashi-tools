import type { GlossaryTerm } from '../../types'
import { BUFF_TONE_BG, BUFF_TONE_LABEL } from '../../utils/buffGlyph'
import { StatusGlyph, type StatusGlyphSize } from './StatusGlyph'

/** 詞條可覆寫為 BUFF 色系；舊資料未設底色時維持粉紫，不隨機制分類變色。 */
export function TermGlyph({
  term, size = 'md', className = '',
}: {
  term: Pick<GlossaryTerm, 'icon' | 'iconTone' | 'name'>
  size?: StatusGlyphSize
  className?: string
}) {
  return (
    <StatusGlyph
      icon={term.icon}
      name={term.name}
      backgroundClass={term.iconTone ? BUFF_TONE_BG[term.iconTone] : 'bg-term-glyph'}
      title={`${term.name}・${term.iconTone ? BUFF_TONE_LABEL[term.iconTone] : '預設（粉紫）'}`}
      size={size}
      className={className}
    />
  )
}
