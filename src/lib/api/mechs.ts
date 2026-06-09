// ── 機甲 mechs ────────────────────────────────────────────────────────────────

import { doc, setDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { Mech } from '../../types'
import { fetchCollection, fetchDocument, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getMechs = () =>
  fetchCollection<Mech>('mechs')

export const getMech = (id: string) =>
  fetchDocument<Mech>('mechs', id)

/** 依裝甲類型（輕型 / 中甲 / 重型）只讀取該類機甲，降低 Firestore 讀取量 */
export const getMechsByArmorType = (armorType: string) =>
  fetchCollection<Mech>('mechs', [where('armorType', '==', armorType)])

export const updateMech = async (mech: Mech): Promise<string> => {
  const { id, ...data } = mech
  await setDoc(doc(db, 'mechs', id), stripUndefined(data))
  return bumpDataVersion('mechs').catch(() => '')
}
