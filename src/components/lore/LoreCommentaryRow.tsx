import { usePilotBriefMap } from '../../hooks/useFirestore'
import type { PilotBrief } from '../../hooks/useFirestore'
import { FallbackImage } from '../common/FallbackImage'
import { imageCandidates, pilotPortraitCandidates } from '../../utils/assets'
import { npcGameArt } from '../../utils/gameArt'
import type { LoreCommentary } from '../../types'

export interface LoreCommentaryRowProps {
  items?: LoreCommentary[]
}

/** 便條上要顯示的說話者；兩樣都可能沒有（說話者未指定、機師被刪、自訂說話者只填了其中一樣） */
interface NoteSpeaker {
  name?: string
  avatar: string[]
}

/**
 * 自訂說話者優先（有 `speaker` 物件就不讀 speakerId，見 types/lore.ts）。
 * 頭像一律用 half（340²）：機師那邊也是 half，`head` 是另一種構圖，混用的話便條上的臉大小會不一致。
 */
function noteSpeaker(c: LoreCommentary, briefs: Record<string, PilotBrief>): NoteSpeaker {
  if (c.speaker) {
    return { name: c.speaker.name.trim() || undefined, avatar: imageCandidates(npcGameArt(c.speaker.art, 'half')) }
  }
  // briefs 是 Record<string, PilotBrief>（不是 Map），查無 → undefined。
  const s = briefs[c.speakerId]
  return s ? { name: s.name, avatar: pilotPortraitCandidates(s) } : { avatar: [] }
}

/**
 * NPC 旁白（PLAN-042-A C-3；PLAN-042-D D-4 改成貼在稿紙上的便條）：某幾位機師對這一章的評註。
 * 2026-10-14 起說話者也可以是自訂的非機師（匿名使用者、劇情 NPC），頭像取自 NPC 圖庫。
 *
 * ⚠ 說話者查不到時**只少頭像與名字，整張便條不可消失**（types/lore.ts 明文要求，地雷 M-14）。
 *   旁白的文字本身有價值；寫成 `{s && <aside/>}` 會讓資料明明在 Firestore 裡、畫面上卻靜默少一張。
 * ⚠ 旁白 `text` **不經** LoreRichText：`LoreCommentary` 刻意沒有 refs 欄位（0/5 定律）。
 */
export default function LoreCommentaryRow({ items }: LoreCommentaryRowProps) {
  const { data: briefs } = usePilotBriefMap()
  if (!items || items.length === 0) return null

  return (
    <>
      {items.map((c, i) => {
        const { name, avatar } = noteSpeaker(c, briefs)
        return (
          <aside key={i} className={`lore-note${avatar.length ? '' : ' is-solo'}`}>
            {avatar.length > 0 && (
              <span className="lore-note__avatar">
                <FallbackImage candidates={avatar} alt="" fallback={null} />
              </span>
            )}
            <div>
              {name && <div className="lore-note__who">{name}</div>}
              <p className="lore-note__text">{c.text}</p>
            </div>
          </aside>
        )
      })}
    </>
  )
}
