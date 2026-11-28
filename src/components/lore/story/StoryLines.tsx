import { memo } from 'react'
import type { StoryLine } from './storyTypes'
import { parseStoryText } from './storyText'

/**
 * 一段對白。說話者空字串＝旁白（不顯示名字、改用淡墨色）；null＝戰中兩個觸發之間的分隔線。
 *
 * 同一人連續發言時不再重複名字（劇本慣例，PLAN-042-I C-2）：桌機留著空的名字欄、手機整列收掉，
 * 手機上能省下大量垂直空間。遇到分隔線重新計算——那是另一個觸發，該再報一次名字。
 * 名字欄保留文字給螢幕閱讀器（.lore-story-line.is-cont 只在視覺上藏起來），聽的人仍知道是誰在說。
 *
 * memo：換關時整份重掛，同一關內重畫（例如進度寫入）不必重算每一行。
 * 樣式在 index.css 的 .lore-story-line（館內 token、手機改上下排）。
 */
export const StoryLines = memo(function StoryLines({ lines }: { lines: (StoryLine | null)[] }) {
  return (
    <ol className="lore-story-lines">
      {lines.map((line, i) => {
        if (!line) return <li key={i} className="lore-story-sep" aria-hidden="true" />
        const [who, text, choices] = line
        const prev = lines[i - 1]
        const cont = !!who && !!prev && prev[0] === who
        return (
          <li key={i} className={who ? (cont ? 'lore-story-line is-cont' : 'lore-story-line') : 'lore-story-line is-narr'}>
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
