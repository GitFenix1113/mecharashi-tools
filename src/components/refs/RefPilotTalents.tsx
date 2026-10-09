import type { PilotTalent } from '../../types'
import { gameIconCandidates } from '../../utils/gameIcons'
import { RefBriefSection, RefBriefRow } from './RefBriefList'

/**
 * 機師引用浮窗的天賦摘要（2026-10-09 起取代原本的機師故事）。
 *
 * 一律顯示**最大強化**（`descriptionMax`），沒有強化版的天賦退回初始正文 ——
 * 與配裝模擬器「天賦預設顯示強化過的版本」同一個口徑（使用者要求 2026-08-30）。
 * 初始／強化的對照留給機師詳情頁的天賦卡。
 *
 * 天賦就存在 pilot 文件裡，浮窗本來就載了 pilots，不多讀任何集合。
 */
export function RefPilotTalents({ talents, clamp }: {
  talents: PilotTalent[]
  /** hover 預覽：描述截三行 */
  clamp: boolean
}) {
  // 今天每位機師都只有一個天賦（89／89，最長 178 字）——整張卡就這一段，截掉就沒東西可看了，
  // 高度也撐不爆浮窗。截斷只留給「真的出現多個天賦」的那天。
  const clampRows = clamp && talents.length > 1
  return (
    <RefBriefSection title="天賦（最大強化）" empty={talents.length === 0} emptyText="天賦未建檔">
      {talents.map((t, i) => (
        <RefBriefRow
          key={`${t.name}:${i}`}
          icons={gameIconCandidates(t.icon, t.iconLocal)}
          name={t.name}
          text={t.descriptionMax || t.description}
          // descriptionRefs 同時涵蓋 description 與 descriptionMax（見 PilotTalent 型別註解）
          refs={t.descriptionRefs}
          clamp={clampRows}
        />
      ))}
    </RefBriefSection>
  )
}
