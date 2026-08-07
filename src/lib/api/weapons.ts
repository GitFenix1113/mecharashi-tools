// ── 武器 weapons ──────────────────────────────────────────────────────────────

import type { Weapon } from '../../types'
import { fetchCollection, fetchDocument, writeDoc } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getWeapons = () =>
  fetchCollection<Weapon>('weapons')

export const getWeapon = (id: string) =>
  fetchDocument<Weapon>('weapons', id)

export const updateWeapon = async (weapon: Weapon): Promise<string> => {
  const { id, ...data } = weapon
  await writeDoc('weapons', id, data)
  return bumpDataVersion('weapons').catch(() => '')
}
