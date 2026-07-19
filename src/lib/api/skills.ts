// ── 技能庫 pilotSkills（PLAN-004 技能庫抽離）────────────────────────────────────
// 可共用、可被引用的技能定義庫（單一資料源；編輯共用技能會影響所有持有它的機師）。

import type { PilotSkillDoc } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'

/** pilotSkills Collection（PLAN-004 技能庫抽離）：可共用、可被引用的技能定義庫 */
export const getPilotSkills = () =>
  fetchCollection<PilotSkillDoc>('pilotSkills')

/**
 * PLAN-004：寫入/更新單一技能文件（單一資料源；編輯共用技能會影響所有持有它的機師）
 * PLAN-030：改走 saveWithHistory，記錄變更歷史。簽章與回傳值維持不變。
 */
export const updatePilotSkill = (skill: PilotSkillDoc): Promise<string> =>
  saveWithHistory('pilotSkill', skill)
