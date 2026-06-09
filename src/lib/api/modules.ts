// ── 模組 modules ──────────────────────────────────────────────────────────────

import { doc, setDoc, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import type { Module } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getModules = () =>
  fetchCollection<Module>('modules')

export const getAvailableModules = () =>
  fetchCollection<Module>('modules', [where('available', '==', true), orderBy('slot')])

export const getModulesByMech = (mechId: string) =>
  fetchCollection<Module>('modules', [where('boundMechId', '==', mechId)])

export const updateModule = async (module: Module): Promise<string> => {
  const { id, ...data } = module
  await setDoc(doc(db, 'modules', id), stripUndefined(data))
  return bumpDataVersion('modules').catch(() => '')
}
