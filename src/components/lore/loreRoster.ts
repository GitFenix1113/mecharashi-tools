// PLAN-042-D A-2：故事館的「名冊順序」——館首頁的牆、詳情頁的切換列與機師名冊共用同一套排序與分組，
// 所以「‹ ›／← → 的下一位」永遠就是使用者剛剛在牆上看到的下一位。
//
// 本檔**只放純函式**（不 import React、不碰 DOM、不讀 import.meta.env），理由同 loreText.ts：
// `node --test` 直接載入本檔跑 loreRoster.test.ts。

import { PILOT_CLASS_NAMES, pilotClassMeta } from '../../data/pilotClasses.ts'
import { MECH_WEIGHT_CLASSES, mechWeightClassOf } from '../../data/mechWeightClasses.ts'
import type { LoreDoc, Pilot } from '../../types'

/**
 * 分組維度。`faction` 刻意不列入選項：89 人散在 30 個值、18 個只有 1 人，
 * 還含未正規化的重複與複合值，分出來會是一堆單人區塊。`class` 是均勻的 7 類。
 *
 * `weight`＝輕／中／重：機師看駕照（license）、機甲看裝甲類型（armorType）——兩者是同一個概念
 * （data/mechWeightClasses.ts：輕型駕照只能開輕型機甲）。兩館共用同一個偏好值，所以兩館都要認得它。
 */
export type LoreSort = 'class' | 'debut' | 'weight'

/** 分組按鈕的順序（館首頁與名冊共用） */
export const LORE_SORTS: readonly LoreSort[] = ['class', 'debut', 'weight']

/** 名冊與分組只需要這幾個欄位（測試不必湊整個 Pilot）。英文名來自 pilotLore，見 `withLoreNames` */
export type RosterPilot = Pick<Pilot, 'id' | 'name' | 'class' | 'debutVersion' | 'fullName' | 'faction'> & { nameEn?: string; license?: string }

/**
 * 故事館視角的機師：pilots 文件＋pilotLore 的英文名。
 *
 * PLAN-042-E 起英文名住 pilotLore（與數值、機制無關），但名冊搜尋與頭像 title 都要用它——
 * 頁面在這裡依 id 併一次再往下傳，元件不必各自去查 pilotLore。
 * pilotLore 讀不到時英文名就是空的（搜尋比不到英文名而已，不影響換人）。
 */
export type LorePilot = Pilot & { nameEn?: string }

export function withLoreNames(pilots: readonly Pilot[], lore: readonly Pick<LoreDoc, 'id' | 'nameEn'>[]): LorePilot[] {
  const names = new Map(lore.map((d) => [d.id, d.nameEn?.trim()]))
  return pilots.map((p) => {
    const nameEn = names.get(p.id)
    return nameEn ? { ...p, nameEn } : p
  })
}

export interface LoreGroup<T> {
  /** 職業名或版本字串（含兩個收容組） */
  key: string
  /** 顯示用標題：職業名／`v3.4`／「未標註版本」 */
  label: string
  items: T[]
}

export const UNCLASSIFIED = '其他'
export const UNVERSIONED = '未標註版本'
/** 駕照／裝甲類型未填或認不得（資料實測值域乾淨，這組照理不會出現；出現了也不留白） */
export const WEIGHT_UNKNOWN = '類型未載'

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
 * 依輕／中／重分組（兩館共用）：輕→中→重、認不得的殿後，組內 `byDebutDesc`。
 * key 與標題都是畫面短名「輕型／中型／重型」（決策十）——機甲的「中甲」也併成「中型」，
 * 頁面拿 key 丟給 `MechTypeIcon`／`mechWeightClassOf` 都認得。
 * @param rawOf 這位的駕照或裝甲類型（資料裡 5 種寫法都吃，見 mechWeightClassOf）
 */
export function buildWeightGroups<T extends { id: string; debutVersion?: string }>(
  items: readonly T[],
  rawOf: (x: T) => string | null | undefined,
): LoreGroup<T>[] {
  const buckets = new Map<string, T[]>()
  for (const x of items) {
    const key = mechWeightClassOf(rawOf(x))?.short ?? WEIGHT_UNKNOWN
    const bucket = buckets.get(key)
    if (bucket) bucket.push(x)
    else buckets.set(key, [x])
  }
  return [...MECH_WEIGHT_CLASSES.map((m) => m.short), WEIGHT_UNKNOWN]
    .filter((k) => buckets.has(k))
    .map((key) => ({ key, label: key, items: [...buckets.get(key)!].sort(byDebutDesc) }))
}

/**
 * 分組。職業依遊戲內篩選的順序（data/pilotClasses.ts，全站共用）、未知職業殿後；
 * 版本依數值遞減、未標註版本殿後；駕照見 `buildWeightGroups`。組內一律 `byDebutDesc`。
 */
export function buildLoreGroups<T extends RosterPilot>(pilots: readonly T[], sort: LoreSort): LoreGroup<T>[] {
  if (sort === 'weight') return buildWeightGroups(pilots, (p) => p.license)
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

// ── 排序偏好：館首頁的「依職業／依登場版本／依駕照」與名冊的分組是同一個選擇 ──────────────

const SORT_KEY = 'mecharashi_lore_sort'

/** 讀取這個分頁上次的排序；沒有、讀不到（無痕、被擋）、認不得的值一律 'class'。 */
export function readLoreSort(): LoreSort {
  try {
    const v = sessionStorage.getItem(SORT_KEY)
    return LORE_SORTS.find((s) => s === v) ?? 'class'
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
