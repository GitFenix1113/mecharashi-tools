// ── 背包 backpacks ────────────────────────────────────────────────────────────

import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { Backpack } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'
import { cascadeDelete, type CascadeDeleteResult } from './cascadeDelete'

export const getBackpacks = () =>
  fetchCollection<Backpack>('backpacks')

export const updateBackpack = async (backpack: Backpack): Promise<string> => {
  const { id, ...data } = backpack
  await setDoc(doc(db, 'backpacks', id), stripUndefined(data))
  return bumpDataVersion('backpacks').catch(() => '')
}

/**
 * PLAN-043：刪除背包並級聯清除全站對它的引用。
 *
 * ⚠ 背包被兩處以**裸 id 硬引用**：`weapons.upgrade.fusedBackpackId`（PLAN-031 複合武器融合）
 * 與 `backpacks.craft.prereqBackpackId`（PLAN-036 前置主背包鏈）。這兩處在 entityRefs 中
 * 標記為 `hardRef`，命中時會**擋下刪除**（要求先手動斷鏈）而非自動清成 null——
 * 自動清除會無聲破壞那兩個計畫建立的關係鏈，且前台只會靜默降級成「前置主背包待確認」。
 *
 * 已不存在時回傳 `null`；被硬引用時拋 `CascadeBlockedError`（拋出時資料毫髮無傷）。
 */
export const deleteBackpack = (id: string): Promise<CascadeDeleteResult | null> =>
  cascadeDelete('backpack', id)
