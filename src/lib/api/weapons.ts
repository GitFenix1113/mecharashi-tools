// ── 武器 weapons ──────────────────────────────────────────────────────────────

import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { Weapon } from '../../types'
import { fetchCollection, fetchDocument, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getWeapons = () =>
  fetchCollection<Weapon>('weapons')

export const getWeapon = (id: string) =>
  fetchDocument<Weapon>('weapons', id)

export const updateWeapon = async (weapon: Weapon): Promise<string> => {
  const { id, ...data } = weapon
  await setDoc(doc(db, 'weapons', id), stripUndefined(data))
  return bumpDataVersion('weapons').catch(() => '')
}
