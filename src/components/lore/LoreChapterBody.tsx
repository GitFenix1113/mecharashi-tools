import type { LoreChapter } from '../../types'
import { LoreRichText } from './LoreRichText'
import LoreSourceLine from './LoreSourceLine'
import LoreCommentaryRow from './LoreCommentaryRow'
import { splitParagraphs, isQuoteStyle } from './loreText'

export interface LoreChapterBodyProps {
  /** 整個章節物件。⚠ **呼叫端禁止 JSX spread**（見下方元件註解） */
  chapter: LoreChapter
  /** 0-based 陣列索引，只用來產生 eyebrow 的 `PART ${index + 1}` fallback */
  index: number
  className?: string
}

/**
 * 章節正文（PLAN-042-A C-3）。
 *
 * **呼叫端唯一合法寫法**：
 * ```tsx
 * <LoreChapterBody chapter={chapters[activeIndex]} index={activeIndex} />
 * ```
 *
 * ⚠ **不可寫成 `{...chapters[activeIndex]}`**，兩個原因都不會編譯失敗：
 *  1. `LoreChapter.key` 是必填欄位，React 19 會把 spread 進 JSX 的 `key` 摘走當元素 key
 *     （只在 console 留一行警告）⇒ 元件內部永遠拿不到 `chapter.key`。
 *  2. 展開的物件裡沒有 `index` ⇒ eyebrow 做不出 `PART ${i + 1}` fallback ⇒
 *     章節軸顯示「PART 2」而正文 eyebrow 空白。
 *
 * eyebrow 的 fallback 字串 `PART ${index + 1}` 與 LoreChapterPager 的章節軸、
 * entityRefs.ts 的 origin 字串共三處必須一致（契約 §2.8）。
 */
export default function LoreChapterBody({ chapter, index, className }: LoreChapterBodyProps) {
  const paragraphs = splitParagraphs(chapter.body)

  return (
    <article className={className}>
      <p className="text-xs font-semibold tracking-widest text-text-secondary">
        {chapter.label ?? `PART ${index + 1}`}
      </p>
      <h2 className="mt-1 text-xl font-bold text-text-primary sm:text-2xl">{chapter.title}</h2>

      {/*
        逐段 <p> 自備換行，**不依賴 whitespace-pre-line**（引文段要換成 blockquote，
        整包 pre-line 會讓兩種排版無法混用）。
        字級一律用 rem 類別（text-base / text-lg）而非 text-[Npx]——館內 header 保留了
        字級三顆按鈕，正文必須跟著使用者的設定縮放。
      */}
      <div className="mt-6 space-y-4 text-base leading-loose text-text-primary sm:text-lg">
        {paragraphs.map((p, i) =>
          isQuoteStyle(p) ? (
            // 引文體不做 drop cap：以「開頭，首字放大只會放大到引號本身。
            <blockquote key={i} className="border-l-2 border-border-accent pl-4 tracking-wide text-text-secondary">
              <LoreRichText text={p} refs={chapter.bodyRefs} />
            </blockquote>
          ) : (
            <p key={i}>
              <LoreRichText text={p} refs={chapter.bodyRefs} />
            </p>
          ),
        )}
      </div>

      <LoreSourceLine source={chapter.source} />
      <LoreCommentaryRow items={chapter.commentary} />
    </article>
  )
}
