export interface LoreSourceLineProps {
  /** 已含 —— 記號本身（例：'——《週刊米赫瑪·文娛版》'）。空／空白 → return null */
  source?: string
  className?: string
}

/** 署名的預設排版：上方細線分隔、右對齊小字。扉頁與章節共用同一份。 */
const DEFAULT_CLASS = 'mt-6 pt-3 border-t border-border/60 text-right text-xs text-text-secondary'

/**
 * 出處署名列（PLAN-042-A C-3）。
 *
 * 扉頁的 `LoreDoc.frontSource` 與章節的 `LoreChapter.source` 共用本元件——
 * 兩者的排版必須一致，分成兩份寫法會在同一頁上並排時看得出來。
 */
export default function LoreSourceLine({ source, className }: LoreSourceLineProps) {
  if (!source?.trim()) return null
  return <p className={className ?? DEFAULT_CLASS}>{source}</p>
}
