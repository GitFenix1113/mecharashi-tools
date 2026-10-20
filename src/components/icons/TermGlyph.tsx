import type { GlossaryTerm } from '../../types'
import { StatusGlyph, type StatusGlyphSize } from './StatusGlyph'

/** 詞條固定使用粉紫底，不隨機制分類變色，也不需在 Firestore 儲存底色。 */
export function TermGlyph({
  term, size = 'md', className = '',
}: {
  term: Pick<GlossaryTerm, 'icon' | 'name'>
  size?: StatusGlyphSize
  className?: string
}) {
  return <StatusGlyph icon={term.icon} name={term.name} backgroundClass="bg-term-glyph" size={size} className={className} />
}
