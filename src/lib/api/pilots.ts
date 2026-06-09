// ── 機師 pilots ────────────────────────────────────────────────────────────────

import { doc, setDoc, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import type { Pilot } from '../../types'
import { fetchCollection, fetchDocument, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getPilots = () =>
  fetchCollection<Pilot>('pilots', [orderBy('rarity', 'desc')])

export const getPilot = (id: string) =>
  fetchDocument<Pilot>('pilots', id)

export const getPilotsByClass = (pilotClass: string) =>
  fetchCollection<Pilot>('pilots', [where('class', '==', pilotClass), orderBy('rarity', 'desc')])

export const updatePilot = async (pilot: Pilot): Promise<string> => {
  const { id, ...data } = pilot
  await setDoc(doc(db, 'pilots', id), stripUndefined(data))
  return bumpDataVersion('pilots').catch(() => '')
}
