// PLAN-042-E A-3：人物檔案（LoreDoc.dossier）的純函式。
//
// 卷宗（LoreDossier）、編輯台（存檔前檢查）、搬遷腳本（B-2 的舊格式轉換）共用同一份規則，
// 所以「哪些列會出現、順序怎麼排、什麼算同名」只寫在這裡一次。
//
// 本檔**只放純函式**（不 import React、不讀 import.meta.env），理由同 loreText.ts：
// `node --test` 直接載入本檔跑 loreDossier.test.ts。

import type { LoreDoc, LoreDossierField, LoreDossierInfo } from '../types'

/** 卷宗個人資料卡的一列：[標籤, 內容] */
export type DossierRow = readonly [label: string, value: string]

const has = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/**
 * 卷宗要顯示的列：固定三欄（性別／身高／血型）→ 陣營 → 自訂欄位，**空值一律濾掉**。
 *
 * 陣營不住 pilotLore（站長 Q1：陣營日後會有機制作用，留在 pilots），由呼叫端從 pilots 帶進來。
 * 自訂欄位依陣列順序（＝編輯者排的順序）；標籤是空字串的列也濾掉——那種列在前台只會印出一個沒有標題的值。
 */
export function dossierRows(doc: Pick<LoreDoc, 'dossier'> | null | undefined, faction?: string): DossierRow[] {
  const d = doc?.dossier
  const rows: DossierRow[] = []
  const push = (label: string, value: unknown) => { if (has(value)) rows.push([label, value.trim()]) }
  push('性別', d?.gender)
  push('身高', d?.height)
  push('血型', d?.bloodType)
  push('陣營', faction)
  for (const f of d?.extra ?? []) {
    if (has(f?.label)) push(f.label.trim(), f.value)
  }
  return rows
}

/**
 * 重複的標籤（trim 後比對，大小寫視為不同）。編輯台存檔前用它擋下：同名兩列在前台會撞 React key，
 * 讀者也分不出哪一列才對。空標籤不算（那是「還沒填」，由 `normalizeDossier` 處理）。
 * 回傳每個重複的標籤一次，依第一次出現的順序。
 */
export function duplicateLabels(extra: readonly Pick<LoreDossierField, 'label'>[] | undefined): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const f of extra ?? []) {
    const k = f?.label?.trim()
    if (!k) continue
    if (seen.has(k)) dup.add(k)
    else seen.add(k)
  }
  return [...dup]
}

/**
 * 自訂欄位裡「有內容、卻沒有標籤」的列（1 起算的列號）。編輯台存檔前擋下：這種列 `dossierRows` 會濾掉，
 * 存進去等於內容消失，編輯者不會發現。
 */
export function unlabeledRows(extra: readonly LoreDossierField[] | undefined): number[] {
  const out: number[] = []
  ;(extra ?? []).forEach((f, i) => { if (!has(f?.label) && has(f?.value)) out.push(i + 1) })
  return out
}

/**
 * 存檔前的整理：固定欄位與自訂欄位都 trim，丟掉空的固定欄位與「標籤、內容都空」的列；
 * 整份都空 → `undefined`（文件上就不留 `dossier` 這個欄位）。
 *
 * 只整理空白，不改內容、不排序、不去重——同名要由編輯者自己決定留哪一列（`duplicateLabels`）。
 */
export function normalizeDossier(d: LoreDossierInfo | undefined): LoreDossierInfo | undefined {
  if (!d) return undefined
  const out: LoreDossierInfo = {}
  if (has(d.gender)) out.gender = d.gender.trim()
  if (has(d.height)) out.height = d.height.trim()
  if (has(d.bloodType)) out.bloodType = d.bloodType.trim()
  const extra = (d.extra ?? [])
    .map((f) => ({ label: (f?.label ?? '').trim(), value: (f?.value ?? '').trim() }))
    .filter((f) => f.label || f.value)
  if (extra.length) out.extra = extra
  return Object.keys(out).length ? out : undefined
}

/** 人物檔案「有內容的欄位數」（不含陣營）：後台進度總覽用。 */
export function dossierFieldCount(d: LoreDossierInfo | undefined): number {
  return dossierRows({ dossier: d }).length
}

/**
 * 舊格式轉換（給 B-2 搬遷腳本）：`pilots.profile.additionalInfo` 的 map → 有序陣列。
 *
 * **照讀到的鍵序轉換**——那就是前台到搬遷當天為止的顯示順序（Object.entries 的順序），
 * 不重新排序。標籤 trim；空標籤、非字串的值丟掉（B-3 對帳會把被丟掉的列報出來）。
 */
export function fromAdditionalInfo(map: Record<string, unknown> | null | undefined): LoreDossierField[] {
  if (!map || typeof map !== 'object') return []
  const out: LoreDossierField[] = []
  for (const [k, v] of Object.entries(map)) {
    const label = k.trim()
    if (!label || typeof v !== 'string') continue
    out.push({ label, value: v })
  }
  return out
}
