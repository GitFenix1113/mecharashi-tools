// ── 背包 backpacks ────────────────────────────────────────────────────────────

import {
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  type QueryConstraint,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Backpack } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getBackpacks = () =>
  fetchCollection<Backpack>('backpacks')

export const updateBackpack = async (backpack: Backpack): Promise<string> => {
  const { id, ...data } = backpack
  await setDoc(doc(db, 'backpacks', id), stripUndefined(data))
  return bumpDataVersion('backpacks').catch(() => '')
}

export const getBackpacksPage = async (opts: {
  nameSearch?: string
  lastItemName?: string
  pageSize?: number
}): Promise<{ items: Backpack[]; hasMore: boolean; lastItemName: string | null }> => {
  const { nameSearch = '', lastItemName, pageSize = 20 } = opts
  const constraints: QueryConstraint[] = [orderBy('name')]
  if (nameSearch) {
    constraints.push(where('name', '>=', nameSearch))
    constraints.push(where('name', '<=', nameSearch + ''))
  }
  if (lastItemName) constraints.push(startAfter(lastItemName))
  constraints.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, 'backpacks'), ...constraints))
  const items = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Backpack)
  return { items, hasMore: items.length === pageSize, lastItemName: items[items.length - 1]?.name ?? null }
}
