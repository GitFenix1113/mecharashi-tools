import { usePilotBriefMap } from '../../hooks/useFirestore'
import { FallbackImage } from '../common/FallbackImage'
import { pilotPortraitCandidates } from '../../utils/assets'
import type { LoreCommentary } from '../../types'

export interface LoreCommentaryRowProps {
  items?: LoreCommentary[]
}

/**
 * NPC 旁白（PLAN-042-A C-3；PLAN-042-D D-4 改成貼在稿紙上的便條）：某幾位機師對這一章的評註。
 *
 * ⚠ `speakerId` 查不到時**只少頭像與名字，整張便條不可消失**（types/lore.ts 明文要求，地雷 M-14）。
 *   旁白的文字本身有價值；寫成 `{s && <aside/>}` 會讓資料明明在 Firestore 裡、畫面上卻靜默少一張。
 * ⚠ 旁白 `text` **不經** LoreRichText：`LoreCommentary` 刻意沒有 refs 欄位（0/5 定律）。
 */
export default function LoreCommentaryRow({ items }: LoreCommentaryRowProps) {
  const { data: briefs } = usePilotBriefMap()
  if (!items || items.length === 0) return null

  return (
    <>
      {items.map((c, i) => {
        // briefs 是 Record<string, PilotBrief>（不是 Map），查無 → undefined。
        const s = briefs[c.speakerId]
        return (
          <aside key={i} className={`lore-note${s ? '' : ' is-solo'}`}>
            {s && (
              <span className="lore-note__avatar">
                <FallbackImage candidates={pilotPortraitCandidates(s)} alt="" fallback={null} />
              </span>
            )}
            <div>
              {s && <div className="lore-note__who">{s.name}</div>}
              <p className="lore-note__text">{c.text}</p>
            </div>
          </aside>
        )
      })}
    </>
  )
}
