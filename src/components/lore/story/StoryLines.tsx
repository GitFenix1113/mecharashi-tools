import { memo } from 'react'
import type { StoryLine } from './storyTypes'
import { parseStoryText } from './storyText'

/**
 * 一段對白。說話者空字串＝旁白（不顯示名字、改用淡墨色）；null＝戰中兩個觸發之間的分隔線。
 *
 * memo：一章最多近三千行，「全部展開／收合」時只有 <details> 重掛，行本身不必重算。
 * 樣式在 index.css 的 .lore-story-line（館內 token、手機改上下排）。
 */
export const StoryLines = memo(function StoryLines({ lines }: { lines: (StoryLine | null)[] }) {
  return (
    <ol className="lore-story-lines">
      {lines.map((line, i) => {
        if (!line) return <li key={i} className="lore-story-sep" aria-hidden="true" />
        const [who, text, choices] = line
        return (
          <li key={i} className={who ? 'lore-story-line' : 'lore-story-line is-narr'}>
            {who && <span className="lore-story-line__who">{who}</span>}
            <span className="lore-story-line__say">
              <RichText raw={text} />
              {choices && (
                <span className="lore-story-choices">
                  {choices.map((c) => (
                    <span key={c} className="lore-story-choice">
                      <RichText raw={c} />
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
})

function RichText({ raw }: { raw: string }) {
  return (
    <>
      {parseStoryText(raw).map((seg, i) =>
        seg.em ? <em key={i} className="lore-story-em">{seg.text}</em> : <span key={i}>{seg.text}</span>,
      )}
    </>
  )
}
