// 陣營徽章註記（factionEmblems）的純函式 —— PLAN-042-F
//
// 註記本身的意義（為什麼是「徽章的名字」而不是「陣營 → 徽章」字典）在 src/types/factionEmblem.ts。
// 選圖器與編輯台「陣營徽章」分頁共用；純函式、無 React／Firestore 依賴，可 node --test。

import type { FactionEmblem } from '../types/factionEmblem.ts'
import { groupLogoPairs, logoNumber, normalizeFactionLogos, type LogoPair, type LogoSuggestion } from './factionLogos.ts'

/** 選圖器／管理分頁的一張卡：圖庫的一組變體＋DB 註記（沒有＝未命名） */
export interface EmblemEntry extends LogoPair {
  emblem?: FactionEmblem
}

export function emblemsById(emblems: readonly FactionEmblem[]): Map<string, FactionEmblem> {
  return new Map(emblems.map((e) => [e.id, e]))
}

/**
 * 圖庫檔名＋DB 註記 → 卡片清單（編號遞增）。
 * 清單以**圖庫**為準：DB 有、圖庫沒有的編號直接忽略（圖被移走、或文件 ID 打錯）。
 */
export function emblemCatalog(keys: readonly string[], emblems: readonly FactionEmblem[]): EmblemEntry[] {
  const byId = emblemsById(emblems)
  return groupLogoPairs(keys).map((p) => ({ ...p, emblem: byId.get(p.num) }))
}

/** 徽章（任一變體的檔名）的名稱；沒有註記或沒填名稱 → undefined */
export function emblemName(logoKey: string, byId: ReadonlyMap<string, FactionEmblem>): string | undefined {
  const num = logoNumber(logoKey)
  return (num && byId.get(num)?.name?.trim()) || undefined
}

/**
 * 滑鼠提示用的完整稱呼：「中文・英文」，只有其中一個就用那一個；兩個都沒有 → undefined。
 * 只有英文的也顯示（有人填了英文、中文還在查，比什麼都不顯示好）。
 */
export function emblemTitle(logoKey: string, byId: ReadonlyMap<string, FactionEmblem>): string | undefined {
  const num = logoNumber(logoKey)
  const e = num ? byId.get(num) : undefined
  const parts = [e?.name?.trim(), e?.nameEn?.trim()].filter(Boolean)
  return parts.length ? parts.join('・') : undefined
}

export const isNamed = (entry: EmblemEntry): boolean => !!entry.emblem?.name?.trim()

/**
 * 搜尋：純數字比對編號（'25' 命中 0025，同改版前的行為）；
 * 其餘比對中英文名稱、圖上字樣、對應的陣營文字、備註（英文不分大小寫）。空字串＝全部。
 */
export function matchEmblem(entry: EmblemEntry, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  if (/^\d+$/.test(q)) return String(Number(entry.num)).includes(String(Number(q)))
  const needle = q.toLowerCase()
  const e = entry.emblem
  const hay = [e?.name, e?.nameEn, e?.inscription, e?.note, ...(e?.factions ?? []), entry.num]
  return hay.some((s) => !!s && s.toLowerCase().includes(needle))
}

/**
 * 這位機師的建議編號：
 *   ① 徽章的名稱、或「對應的陣營文字」與機師的 faction 完全相同（去頭尾空白）
 *   ② 同樣寫這個陣營文字的其他機師已經選了的（factionLogoSuggestions 的結果）
 * 只拿來排序，不會替任何人自動選。
 */
export function suggestedEmblemNums(
  faction: string | null | undefined,
  entries: readonly EmblemEntry[],
  suggestions: readonly LogoSuggestion[] = [],
): Set<string> {
  const out = new Set<string>()
  const target = faction?.trim()
  if (target) {
    for (const en of entries) {
      const e = en.emblem
      if (e?.name?.trim() === target || e?.factions?.some((f) => f.trim() === target)) out.add(en.num)
    }
  }
  for (const s of suggestions) for (const k of s.logos) { const n = logoNumber(k); if (n) out.add(n) }
  return out
}

/** 選圖器排序：建議 → 已命名 → 未命名；同一組依編號遞增 */
export function rankEmblems(entries: readonly EmblemEntry[], suggested: ReadonlySet<string> = new Set()): EmblemEntry[] {
  const tier = (en: EmblemEntry) => (suggested.has(en.num) ? 0 : isNamed(en) ? 1 : 2)
  return [...entries].sort((a, b) => tier(a) - tier(b) || a.num.localeCompare(b.num))
}

/** 使用中：編號 → 選了它的文件 ID（單色、彩色任一都算），供管理分頁顯示「N 位」 */
export function emblemUsage(loreDocs: readonly { id: string; factionLogos?: unknown }[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const d of loreDocs) {
    const nums = new Set(normalizeFactionLogos(d.factionLogos).map(logoNumber).filter((n): n is string => !!n))
    for (const n of nums) out.set(n, [...(out.get(n) ?? []), d.id])
  }
  return out
}

/**
 * 存檔前整理：字串 trim、空的拿掉；對應的陣營文字 trim、去空、去重（保留輸入順序）。
 * 全部清空就只剩 `{ id }`——writeDoc 是整份覆寫，欄位會真的從文件上消失。
 */
export function normalizeEmblem(e: FactionEmblem): FactionEmblem {
  const text = (s: string | undefined) => s?.trim() || undefined
  const factions = [...new Set((e.factions ?? []).map((f) => f.trim()).filter(Boolean))]
  return {
    id: e.id,
    ...(text(e.name) && { name: text(e.name) }),
    ...(text(e.nameEn) && { nameEn: text(e.nameEn) }),
    ...(text(e.inscription) && { inscription: text(e.inscription) }),
    ...(factions.length && { factions }),
    ...(text(e.note) && { note: text(e.note) }),
  }
}

/** 站上現有的陣營文字（「對應的陣營文字」輸入框的候選）：去頭尾空白、去重，人數多的在前、同數依字串 */
export function factionValues(pilots: readonly { faction?: string }[]): string[] {
  const count = new Map<string, number>()
  for (const p of pilots) {
    const f = p.faction?.trim()
    if (f) count.set(f, (count.get(f) ?? 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f)
}
