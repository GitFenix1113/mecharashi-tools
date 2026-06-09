// ── 技能庫 pilotSkills（PLAN-004 技能庫抽離）────────────────────────────────────
// 可共用、可被引用的技能定義庫（單一資料源；編輯共用技能會影響所有持有它的機師）。

import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { PilotSkillDoc } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

/** pilotSkills Collection（PLAN-004 技能庫抽離）：可共用、可被引用的技能定義庫 */
export const getPilotSkills = () =>
  fetchCollection<PilotSkillDoc>('pilotSkills')

/** PLAN-004：寫入/更新單一技能文件（單一資料源；編輯共用技能會影響所有持有它的機師） */
export const updatePilotSkill = async (skill: PilotSkillDoc): Promise<string> => {
  const { id, ...data } = skill
  await setDoc(doc(db, 'pilotSkills', id), stripUndefined(data))
  return bumpDataVersion('pilotSkills').catch(() => '')
}
