// PLAN-042-D A-2：故事館的「名冊順序」——館首頁的牆、詳情頁的切換列與機師名冊共用同一套排序與分組，
// 所以「‹ ›／← → 的下一位」永遠就是使用者剛剛在牆上看到的下一位。
//
// 本檔**只放純函式**（不 import React、不碰 DOM、不讀 import.meta.env），理由同 loreText.ts：
// `node --test` 直接載入本檔跑 loreRoster.test.ts。

import { PILOT_CLASS_NAMES, pilotClassMeta } from '../../data/pilotClasses.ts'
import type { Pilot } from '../../types'

/**
 * 分組維度。`faction` 刻意不列入選項：89 人散在 30 個值、18 個只有 1 人，
 * 還含未正規化的重複與複合值，分出來會是一堆單人區塊。`class` 是均勻的 7 類。
 */
export type LoreSort = 'class' | 'debut'

/** 名冊與分組只需要這幾個欄位（測試不必湊整個 Pilot） */
export type RosterPilot = Pick<Pilot, 'id' | 'name' | 'class' | 'debutVersion' | 'fullName' | 'nameEn' | 'faction'>

export interface LoreGroup<T> {
  /** 職業名或版本字串（含兩個收容組） */
  key: string
  /** 顯示用標題：職業名／`v3.4`／「未標註版本」 */
  label: string
  items: T[]
}

export const UNCLASSIFIED = '其他'
export const UNVERSIONED = '未標註版本'

/** `debutVersion` 轉可比較的數字；未填 → null（一律排最後，不當成 0）。 */
export function versionValue(v: string | undefined): number | null {
  if (!v) return null
  const n = parseFloat(v)
  return Number.isNaN(n) ? null : n
}

/** 同一組內的次序：新版本在前，未標註版本殿後，最後以 id 穩定收尾。 */
export function byDebutDesc(a: Pick<Pilot, 'id' | 'debutVersion'>, b: Pick<Pilot, 'id' | 'debutVersion'>): number {
  const va = versionValue(a.debutVersion)
  const vb = versionValue(b.debutVersion)
  if (va === null && vb === null) return a.id.localeCompare(b.id)
  if (va === null) return 1
  if (vb === null) return -1
  if (va !== vb) return vb - va
  return a.id.localeCompare(b.id)
}

/**
 * 分組。職業依遊戲內篩選的順序（data/pilotClasses.ts，全站共用）、未知職業殿後；
 * 版本依數值遞減、未標註版本殿後。組內一律 `byDebutDesc`。
 */
export function buildLoreGroups<T extends RosterPilot>(pilots: readonly T[], sort: LoreSort): LoreGroup<T>[] {
  const buckets = new Map<string, T[]>()
  for (const p of pilots) {
    const key = sort === 'class'
      ? (pilotClassMeta(p.class) ? p.class : UNCLASSIFIED)
      : (p.debutVersion || UNVERSIONED)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(p)
    else buckets.set(key, [p])
  }
  const keys = sort === 'class'
    ? [...PILOT_CLASS_NAMES, UNCLASSIFIED].filter((k) => buckets.has(k))
    : [...buckets.keys()].sort((a, b) => {
        if (a === UNVERSIONED) return 1
        if (b === UNVERSIONED) return -1
        return (versionValue(b) ?? 0) - (versionValue(a) ?? 0)
      })
  return keys.map((key) => ({
    key,
    label: sort === 'class' || key === UNVERSIONED ? key : `v${key}`,
    items: [...(buckets.get(key) ?? [])].sort(byDebutDesc),
  }))
}

/** 名冊順序攤平成一列：切換列、‹ ›、← → 都照這個走。 */
export function loreOrder<T extends RosterPilot>(pilots: readonly T[], sort: LoreSort): T[] {
  return buildLoreGroups(pilots, sort).flatMap((g) => g.items)
}

/**
 * 名冊搜尋：中文名、全名、**英文名**、陣營、職業、版本（`v3.4` 或 `3.4` 都可）。不分大小寫、子字串比對。
 * 空字串一律通過。
 */
export function matchesLoreQuery(p: RosterPilot, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [p.name, p.fullName, p.nameEn, p.faction, p.class, p.debutVersion, p.debutVersion && `v${p.debutVersion}`]
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q))
}

// ── 排序偏好：館首頁的「依職業／依登場版本」與名冊的分組是同一個選擇 ──────────────────

const SORT_KEY = 'mecharashi_lore_sort'

/** 讀取這個分頁上次的排序；沒有、讀不到（無痕、被擋）一律 'class'。 */
export function readLoreSort(): LoreSort {
  try {
    return sessionStorage.getItem(SORT_KEY) === 'debut' ? 'debut' : 'class'
  } catch {
    return 'class'
  }
}

export function writeLoreSort(sort: LoreSort): void {
  try {
    sessionStorage.setItem(SORT_KEY, sort)
  } catch {
    /* 記不住就算了，預設依職業 */
  }
}
