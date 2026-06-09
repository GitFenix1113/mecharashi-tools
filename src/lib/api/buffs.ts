// ── BUFF buffs（PLAN-019 Layer 2）：BUFF / 狀態 / 形態定義庫 ─────────────────────

import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { GameBuff } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

/** buffs Collection（PLAN-019 Layer 2）：BUFF / 狀態 / 形態定義庫 */
export const getBuffs = () =>
  fetchCollection<GameBuff>('buffs')

/** PLAN-019-F：BUFF 後台寫入（buffs 安全規則已具備 admin write）。 */
export const updateBuff = async (buff: GameBuff): Promise<string> => {
  const { id, ...data } = buff
  await setDoc(doc(db, 'buffs', id), stripUndefined(data))
  return bumpDataVersion('buffs').catch(() => '')
}
