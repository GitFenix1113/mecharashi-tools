import { usePilotBriefMap } from '../../hooks/useFirestore'
import { PilotIcon } from '../icons/PilotIcon'
import type { LoreCommentary } from '../../types'

export interface LoreCommentaryRowProps {
  items?: LoreCommentary[]
  className?: string
}

const DEFAULT_CLASS = 'mt-6 space-y-3 border-l-2 border-border-subtle pl-4'

/**
 * NPC 旁白列（PLAN-042-A C-3）：某幾位機師對這一章的評註。
 *
 * ⚠ `speakerId` 查不到時**只少頭像與名字，整列不可消失**（types/lore.ts:22-24 明文要求，
 *   地雷 M-14）。旁白的文字本身有價值；寫成 `{s && <li/>}` 會讓資料明明在 Firestore 裡、
 *   畫面上卻靜默少一列，沒有任何錯誤訊息。
 *
 * ⚠ 旁白 `text` **不經** <LoreRichText>：`LoreCommentary` 刻意沒有 refs 欄位
 *   （短句評註不需要 [xxx]，見 types/lore.ts 的「0/5 定律」註解）。
 */
export default function LoreCommentaryRow({ items, className }: LoreCommentaryRowProps) {
  const { data: briefs } = usePilotBriefMap()
  if (!items || items.length === 0) return null

  return (
    <ul className={className ?? DEFAULT_CLASS}>
      {items.map((c, i) => {
        // briefs 是 Record<string, PilotBrief>（不是 Map），查無 → undefined。
        const s = briefs[c.speakerId]
        return (
          <li key={i} className="flex items-start gap-2">
            {s && <PilotIcon pilot={s} size="xs" fallback={null} />}
            <div className="min-w-0">
              {s && <span className="text-xs font-semibold">{s.name}</span>}
              <p className="text-sm">{c.text}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
