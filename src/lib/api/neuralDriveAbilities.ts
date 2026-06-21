// ── 神經驅動能力庫 neuralDriveAbilities（PLAN-023 N1）──────────────────────────
// 從各機師 Pilot.neuralDrive[].levels[] 抽出去重的共用／專屬能力（能力名為鍵）。
// 比照 pilotSkills：可共用、可被引用的能力定義庫，編輯共用能力影響所有持有它的機師。

import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { NeuralDriveAbility } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

/** neuralDriveAbilities Collection（PLAN-023）：神經驅動能力定義庫 */
export const getNeuralDriveAbilities = () =>
  fetchCollection<NeuralDriveAbility>('neuralDriveAbilities')

/** PLAN-023：寫入/更新單一能力文件（單一資料源；編輯共用能力影響所有引用它的機師） */
export const updateNeuralDriveAbility = async (ability: NeuralDriveAbility): Promise<string> => {
  const { id, ...data } = ability
  await setDoc(doc(db, 'neuralDriveAbilities', id), stripUndefined(data))
  return bumpDataVersion('neuralDriveAbilities').catch(() => '')
}
