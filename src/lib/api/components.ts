// ── 元件 components ────────────────────────────────────────────────────────────

import type { Component } from '../../types'
import { fetchCollection, writeDoc } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getComponents = () =>
  fetchCollection<Component>('components')

export const updateComponent = async (component: Component): Promise<string> => {
  const { id, ...data } = component
  await writeDoc('components', id, data)
  return bumpDataVersion('components').catch(() => '')
}
