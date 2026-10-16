import { Link } from 'react-router-dom'
import type { LoreChapter } from '../../types'
import LoreProse from './LoreProse'
import LoreCommentaryRow from './LoreCommentaryRow'
import { normalizeLoreSource, readableParagraphs } from './loreText'

export interface LoreChapterBodyProps {
  /** 整個章節物件。⚠ **呼叫端禁止 JSX spread**（見下方元件註解） */
  chapter: LoreChapter
  /** 0-based 陣列索引，只用來產生 `PART ${index + 1}` fallback 與描邊大章號 */
  index: number
  /** 上一章／下一章（沒有就 undefined）。點了交給 onSelect（章節之間用 replace） */
  prev?: LoreChapter
  next?: LoreChapter
  onSelect: (key: string, index: number) => void
  /** 讀完最後一章時「返回檔案」的網址 */
  backHref: string
  pilotName: string
  /** 換章方向（1＝往後、-1＝往前、0＝從檔案進來）：決定稿紙從哪邊滑進來 */
  dir?: number
}

/**
 * 章節稿紙（PLAN-042-A C-3；PLAN-042-D D-1／D-3 改版）。
 *
 * **呼叫端唯一合法寫法**：`<LoreChapterBody key={chapter.key} chapter={chapters[i]} index={i} … />`
 *
 * ⚠ **不可寫成 `{...chapters[activeIndex]}`**：`LoreChapter.key` 是必填欄位，React 19 會把 spread 進 JSX 的
 *   `key` 摘走當元素 key，元件內部永遠拿不到；展開的物件也沒有 index，`PART N` fallback 做不出來。
 * 以章節 key 重掛本元件，稿紙進場動畫才會重播。
 *
 * `PART ${index + 1}` 的 fallback 與 LoreChapterPager、entityRefs.ts 的 origin 字串共三處必須一致（契約 §2.8）。
 */
export default function LoreChapterBody({ chapter, index, prev, next, onSelect, backHref, pilotName, dir = 0 }: LoreChapterBodyProps) {
  const paragraphs = readableParagraphs(chapter.body)
  const source = normalizeLoreSource(chapter.source)
  const label = (c: LoreChapter, i: number) => c.label ?? `PART ${i + 1}`

  return (
    <article className="lore-sheet">
      <div className={`lore-sheet-body${dir > 0 ? ' from-r' : dir < 0 ? ' from-l' : ''}`}>
        <span className="lore-sheet__num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <p className="lore-sheet__part">{label(chapter, index)}</p>
        <h2 className="lore-sheet__title">{chapter.title}</h2>
        <div className="lore-sheet__rule" aria-hidden="true" />
        <LoreProse paragraphs={paragraphs} refs={chapter.bodyRefs} />
        {source && <p className="lore-source">{source}</p>}
        <LoreCommentaryRow items={chapter.commentary} />
        <nav className="lore-chnav" aria-label="上一章／下一章">
          {prev && (
            <a href="#" className="is-prev" onClick={(e) => { e.preventDefault(); onSelect(prev.key, index - 1) }}>
              <small>‹ 上一章</small><span>{label(prev, index - 1)}・{prev.title}</span>
            </a>
          )}
          {next ? (
            <a href="#" className="is-next" onClick={(e) => { e.preventDefault(); onSelect(next.key, index + 1) }}>
              <small>下一章 ›</small><span>{label(next, index + 1)}・{next.title}</span>
            </a>
          ) : (
            <Link to={backHref} className="is-next">
              <small>讀完了</small><span>返回 {pilotName} 的檔案</span>
            </Link>
          )}
        </nav>
      </div>
    </article>
  )
}
