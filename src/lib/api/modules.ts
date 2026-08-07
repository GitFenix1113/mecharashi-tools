// ── 模組 modules ──────────────────────────────────────────────────────────────

import { where, orderBy } from 'firebase/firestore'
import type { Module } from '../../types'
import { fetchCollection, writeDoc } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getModules = () =>
  fetchCollection<Module>('modules')

export const getAvailableModules = () =>
  fetchCollection<Module>('modules', [where('available', '==', true), orderBy('slot')])

export const getModulesByMech = (mechId: string) =>
  fetchCollection<Module>('modules', [where('boundMechId', '==', mechId)])

export const updateModule = async (module: Module): Promise<string> => {
  const { id, ...data } = module
  await writeDoc('modules', id, data)
  return bumpDataVersion('modules').catch(() => '')
}
