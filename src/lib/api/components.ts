// ── 元件 components ────────────────────────────────────────────────────────────

import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { Component } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getComponents = () =>
  fetchCollection<Component>('components')

export const updateComponent = async (component: Component): Promise<string> => {
  const { id, ...data } = component
  await setDoc(doc(db, 'components', id), stripUndefined(data))
  return bumpDataVersion('components').catch(() => '')
}
