import { Fragment, memo, useMemo, useState } from 'react'
import type { StoryLine, StoryShot } from './storyTypes'
import { parseStoryText } from './storyText'
import { FACE_SIZE, facePath, scenePath } from './storyScenes'
import { StorySceneShot } from './StorySceneShot'
import { assetUrl } from '../../../utils/assets'

/**
 * 一段對白。說話者空字串＝旁白（不顯示名字、改用淡墨色）；null＝戰中兩個觸發之間的分隔線。
 *
 * 同一人連續發言時不再重複名字（劇本慣例，PLAN-042-I C-2）：桌機留著空的名字欄、手機整列收掉，
 * 手機上能省下大量垂直空間。遇到分隔線重新計算——那是另一個觸發，該再報一次名字。
 * 名字欄保留文字給螢幕閱讀器（.lore-story-line.is-cont 只在視覺上藏起來），聽的人仍知道是誰在說。
 *
 * 場景條（PLAN-042-J）：shots 指定的那一行前插一張對白背景（StorySceneShot）。換了場景就重新報名字。
 * 規則（同一張不重插、黑幕沿用、戰鬥中回到戰場…）都在匯入腳本收斂好了，這裡照表插、不再判斷。
 *
 * 說話者頭像（PLAN-042-J 第二段）：face[i] 是 faces 的編號（0＝沒有），只畫在列名的那一行——
 * 連續發言的後續行名字都藏了，頭像也跟著不畫。開著頭像時名字欄加寬（.has-faces）。
 *
 * memo：換關時整份重掛，同一關內重畫（例如進度寫入）不必重算每一行。
 * 樣式在 index.css 的 .lore-story-line／.lore-story-shot（館內 token、手機改上下排）。
 */
export const StoryLines = memo(function StoryLines({ lines, shots, showShots = true, face, faces, showFaces = true }: {
  lines: (StoryLine | null)[]
  shots?: StoryShot[]
  /** 「場景圖」開關（StoryBookPage 的偏好） */
  showShots?: boolean
  /** 與 lines 等長的頭像編號（StoryPart.face） */
  face?: number[]
  /** 這本書的頭像表（StoryBook.faces） */
  faces?: string[]
  /** 「頭像」開關 */
  showFaces?: boolean
}) {
  const shotAt = useMemo(() => new Map(showShots ? shots ?? [] : []), [shots, showShots])
  const withFaces = showFaces && !!face && !!faces
  return (
    <ol className={withFaces ? 'lore-story-lines has-faces' : 'lore-story-lines'}>
      {lines.map((line, i) => {
        const shot = shotAt.get(i)
        // key 綁圖：換關時同一位置換了另一張，要重新走載入／失敗狀態，不能沿用上一張的
        const shotItem = shot && <StorySceneShot key={shot} as="li" path={scenePath(shot)} />
        if (!line) return <Fragment key={i}>{shotItem}<li className="lore-story-sep" aria-hidden="true" /></Fragment>
        const [who, text, choices] = line
        const prev = lines[i - 1]
        const cont = !!who && !!prev && prev[0] === who && !shot
        const faceKey = withFaces && who && !cont ? faces[(face[i] ?? 0) - 1] : undefined
        return (
          <Fragment key={i}>
            {shotItem}
            <li className={who ? (cont ? 'lore-story-line is-cont' : 'lore-story-line') : 'lore-story-line is-narr'}>
              {who && (
                <span className="lore-story-line__who">
                  {faceKey && <FaceImg key={faceKey} path={facePath(faceKey)} />}
                  <span className="lore-story-line__name">{who}</span>
                </span>
              )}
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
          </Fragment>
        )
      })}
    </ol>
  )
})

/** 說話者頭像：裝飾性（名字就在旁邊）、lazy、寬高先佔位；載入失敗就只剩名字 */
function FaceImg({ path }: { path: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="lore-story-line__face" src={assetUrl(path)} alt="" aria-hidden="true"
      width={FACE_SIZE} height={FACE_SIZE} loading="lazy" decoding="async" onError={() => setFailed(true)}
    />
  )
}

function RichText({ raw }: { raw: string }) {
  return (
    <>
      {parseStoryText(raw).map((seg, i) =>
        seg.em ? <em key={i} className="lore-story-em">{seg.text}</em> : <span key={i}>{seg.text}</span>,
      )}
    </>
  )
}
