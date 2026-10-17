// PLAN-042-B D-5：機甲廳的名冊分組（純函式，理由同 loreRoster.ts：要能 node --test）。
//
// 機師廳依「職業／登場版本／駕照」分組；機甲廳依「廠商／登場版本／類型」。兩館共用同一個 LoreSort 值：
// 'class' 在機甲廳就是廠商（切換列的按鈕文字由頁面換掉），'weight' 在機師廳是駕照、在機甲廳是 armorType，
// 使用者在兩館切的是同一個偏好。

import { buildWeightGroups, byDebutDesc, UNVERSIONED, versionValue, type LoreGroup, type LoreSort } from './loreRoster.ts'
import type { MechMaker } from '../../types'

/** 廠商未填或對不到 mechMakers 文件的那一組（決策 B-8：不留白） */
export const MAKER_UNKNOWN_GROUP = '廠商未載'

export interface MechRosterGroup<T> extends LoreGroup<T> {
  /** 依廠商分組時，這組的廠商（未載那組為 undefined）——頁面拿它畫組頭徽章 */
  maker?: MechMaker
}

/** 廠商的排序：`order` 小的在前，沒填的排在有值的後面，再依 id（決策 B-8：排序是站長在編輯台調的） */
export function byMakerOrder(a: Pick<MechMaker, 'id' | 'order'>, b: Pick<MechMaker, 'id' | 'order'>): number {
  const oa = a.order ?? Infinity, ob = b.order ?? Infinity
  if (oa !== ob) return oa - ob
  return a.id.localeCompare(b.id)
}

/**
 * 分組。組內一律 `byDebutDesc`（新版本在前）。
 * @param makerIdOf 這台的廠商 ID（mechLore.maker）；對不到 makers 裡任何一家就歸「廠商未載」
 */
export function buildMechGroups<T extends { id: string; debutVersion?: string; armorType?: string }>(
  mechs: readonly T[],
  sort: LoreSort,
  makerIdOf: (m: T) => string | undefined,
  makers: readonly MechMaker[],
): MechRosterGroup<T>[] {
  if (sort === 'weight') return buildWeightGroups(mechs, (m) => m.armorType)
  if (sort === 'debut') {
    const buckets = new Map<string, T[]>()
    for (const m of mechs) {
      const key = m.debutVersion || UNVERSIONED
      ;(buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m)
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if (a === UNVERSIONED) return 1
      if (b === UNVERSIONED) return -1
      return (versionValue(b) ?? 0) - (versionValue(a) ?? 0)
    })
    return keys.map((key) => ({ key, label: key === UNVERSIONED ? key : `v${key}`, items: [...buckets.get(key)!].sort(byDebutDesc) }))
  }

  const byId = new Map(makers.map((mk) => [mk.id, mk]))
  const buckets = new Map<string, T[]>()
  for (const m of mechs) {
    const id = makerIdOf(m)
    const key = id && byId.has(id) ? id : MAKER_UNKNOWN_GROUP
    ;(buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m)
  }
  const ordered = [...makers].sort(byMakerOrder).filter((mk) => buckets.has(mk.id))
  const groups: MechRosterGroup<T>[] = ordered.map((mk) => ({
    key: mk.id,
    label: mk.name?.trim() || mk.id,
    maker: mk,
    items: [...buckets.get(mk.id)!].sort(byDebutDesc),
  }))
  const unknown = buckets.get(MAKER_UNKNOWN_GROUP)
  if (unknown) groups.push({ key: MAKER_UNKNOWN_GROUP, label: MAKER_UNKNOWN_GROUP, items: [...unknown].sort(byDebutDesc) })
  return groups
}
