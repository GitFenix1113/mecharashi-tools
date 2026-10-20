import { FallbackImage } from '../common/FallbackImage'
import { gameIconCandidates } from '../../utils/gameIcons'

const SIZE = {
  xs: { box: 'w-4 h-4', frame: 'border', dot: 'w-1.5 h-1.5' },
  sm: { box: 'w-5 h-5', frame: 'border', dot: 'w-2 h-2' },
  md: { box: 'w-7 h-7', frame: 'border-2', dot: 'w-2.5 h-2.5' },
  lg: { box: 'w-10 h-10', frame: 'border-2', dot: 'w-3 h-3' },
  xl: { box: 'w-14 h-14', frame: 'border-2', dot: 'w-3.5 h-3.5' },
} as const

export type StatusGlyphSize = keyof typeof SIZE

/** BUFF 與詞條共用的遊戲圖示：色塊底＋米白框＋透明底白色字形；未設圖時顯示中性小點。 */
export function StatusGlyph({
  icon, name, backgroundClass, title = name, size = 'md', className = '',
}: {
  icon?: string
  name: string
  backgroundClass: string
  title?: string
  size?: StatusGlyphSize
  className?: string
}) {
  const s = SIZE[size]
  const key = icon?.trim()
  if (!key) {
    return (
      <span className={`inline-flex items-center justify-center flex-shrink-0 ${s.box} ${className}`} aria-hidden="true">
        <span className={`${s.dot} rounded-full bg-text-dim/50`} />
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 rounded-[3px] border-buff-frame ${s.box} ${s.frame} ${backgroundClass} ${className}`}
      title={title}
    >
      <FallbackImage candidates={gameIconCandidates(key)} alt={name} className="w-[72%] h-[72%] object-contain" />
    </span>
  )
}
