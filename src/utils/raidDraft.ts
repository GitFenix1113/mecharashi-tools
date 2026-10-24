// PLAN-064 D／H：武裝討伐草稿的純函式（後台審核頁用；node:test 可直接測）。
//
// 譯名校對怎麼生效（決策八）：
//   · 草稿裡的名稱是匯入當下套表的結果；terms 清單記著「每個簡中原文、當時用了什麼譯文、已校或待校」。
//   · 站長在後台改了某條譯名（寫進 raidTerms）之後，發布前用 applyTermOverrides 把草稿裡
//     「整個字串等於當時譯文」的值換成新譯名——名稱、整段長文都是整字串，換得到。
//   · 名詞改了，含這個名詞的長文跟著換（H-2）：只換「原文確實含這個名詞、譯文含舊譯名」的長文，
//     長文自己有對照表條目的不動（那是站長親手寫的版本）。不必再為了名詞重跑匯入。

import type { Boss, RaidDraft, RaidOverride, RaidSeason, RaidTermEntry, RaidTermUse, Stage } from '../types/boss'
import { applyFieldOverrides, type FieldOverrideResult } from './raidOverride.ts'

/** 會出現在長文裡的名詞種類——與 scripts/lib/raidI18n.mjs 的 NAME_KINDS 一致 */
export const NAME_KINDS = new Set(['season', 'faction', 'level', 'battle', 'unit', 'mech', 'weapon', 'backpack', 'skill', 'buff', 'terrain'])

/** termHash：與匯入端 scripts/lib/raidI18n.mjs 相同（sha1 hex 前 16 碼），對照表條目的鍵 */
export async function termHash(cn: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(cn))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

/** 對照表查詢鍵 */
export const termKey = (kind: string, cn: string) => `${kind}\u0000${cn}`

/** raidTerms 各分片 → kind+原文 的查詢表 */
export function indexTerms(docs: { kind: string; entries: Record<string, RaidTermEntry> }[]): Map<string, RaidTermEntry> {
  const out = new Map<string, RaidTermEntry>()
  for (const d of docs) for (const e of Object.values(d.entries || {})) if (e?.cn) out.set(termKey(d.kind, e.cn), e)
  return out
}

/** 草稿的譯名清單：新草稿存 terms（含已校），舊草稿只有 pending */
export function draftTerms(draft: Pick<RaidDraft, 'terms' | 'pending'>): RaidTermUse[] {
  if (draft.terms) return draft.terms
  return (draft.pending ?? []).map((p) => ({ ...p, status: 'pending' as const }))
}

/** 深層替換所有「整個字串等於 from」的值 */
function replaceDeep<T>(val: T, map: Map<string, string>): T {
  if (typeof val === 'string') return (map.get(val) ?? val) as T
  if (Array.isArray(val)) return val.map((v) => replaceDeep(v, map)) as T
  if (val && typeof val === 'object') {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, replaceDeep(v, map)])) as T
  }
  return val
}

/** 後台看到的一筆譯名（套上對照表與名詞連動之後） */
export interface RaidTermView {
  kind: string
  cn: string
  /** 草稿裡的譯文（匯入當下） */
  draftTw: string
  /** 現在的譯文 */
  tw: string
  status: 'verified' | 'pending'
  source: string
  count: number
  /** 對照表裡有這一條（站長校過，或來源匯入） */
  hasEntry: boolean
  /** 長文裡的名詞改過、跟著換了 */
  linked?: boolean
  /** 同一個草稿譯文對到兩種新譯文，沒有套用（要人工處理） */
  conflict?: boolean
}

export interface TermOverrideResult {
  season: RaidSeason
  stages: Stage[]
  bosses: Boss[]
  /** 已套用的已校譯名（草稿譯文 → 新譯名；不含名詞連動的長文） */
  applied: { kind: string; cn: string; from: string; to: string }[]
  /** 這一期的全部譯名（後台譯名頁） */
  entries: RaidTermView[]
  /** 仍待校（含衝突） */
  stillPending: RaidTermView[]
}

/**
 * 把後台校對過的譯名套進草稿（預覽與發布都走這裡）。只換「整個字串等於草稿當時譯文」的值。
 * 同一個草稿譯文對到兩種新譯文時（不同種類、原文不同但機轉相同）不換，列進 stillPending 讓人工處理。
 */
export function applyTermOverrides(draft: Pick<RaidDraft, 'season' | 'stages' | 'bosses' | 'terms' | 'pending'>, terms: Map<string, RaidTermEntry>): TermOverrideResult {
  const entries: RaidTermView[] = draftTerms(draft).map((p) => {
    const t = terms.get(termKey(p.kind, p.cn))
    return {
      kind: p.kind, cn: p.cn, draftTw: p.tw, tw: t ? t.tw : p.tw,
      status: t ? t.status : p.status, source: t?.source ?? p.source, count: p.count, hasEntry: !!t,
    }
  })

  // 名詞 → 長文連動（長的名詞先換，避免「科斯蒂」吃掉「科斯蒂利亞」）
  const changed = entries
    .filter((v) => NAME_KINDS.has(v.kind) && v.cn.length >= 2 && v.tw !== v.draftTw)
    .sort((a, b) => b.draftTw.length - a.draftTw.length)
  if (changed.length) {
    for (const v of entries) {
      if (NAME_KINDS.has(v.kind) || v.hasEntry) continue
      const slots: string[] = []
      let s = v.draftTw
      for (const n of changed) {
        if (!v.cn.includes(n.cn) || !s.includes(n.draftTw)) continue
        s = s.split(n.draftTw).join(`\u0001${slots.push(n.tw) - 1}\u0001`)
      }
      if (!slots.length) continue
      // 佔位是「\u0001序號\u0001」：切開後奇數段就是序號（換完的新譯名不會再被後面較短的名詞誤換）
      v.tw = s.split('\u0001').map((x, i) => (i % 2 ? slots[Number(x)] : x)).join('')
      v.linked = true
    }
  }

  // 草稿譯文 → 新譯文；同一個草稿譯文對到兩種新譯文＝衝突，整組不換
  const map = new Map<string, string>()
  const conflict = new Set<string>()
  for (const v of entries) {
    if (v.tw === v.draftTw) continue
    if (map.has(v.draftTw) && map.get(v.draftTw) !== v.tw) conflict.add(v.draftTw)
    else map.set(v.draftTw, v.tw)
  }
  for (const c of conflict) map.delete(c)
  for (const v of entries) {
    if (conflict.has(v.draftTw) && v.tw !== v.draftTw) {
      v.conflict = true
      v.tw = v.draftTw
    }
  }

  /** 已校條目的草稿譯文（含「照原樣確認」）：這些值的「待校」標記要拿掉 */
  const verifiedFrom = new Set(entries.filter((v) => v.status === 'verified' && !v.conflict).map((v) => v.draftTw))
  const { season, stages, bosses } = clearPending(draft, verifiedFrom)
  return {
    season: replaceDeep(season, map),
    stages: replaceDeep(stages, map),
    bosses: replaceDeep(bosses, map),
    applied: entries
      .filter((v) => v.status === 'verified' && !v.linked && v.tw !== v.draftTw)
      .map((v) => ({ kind: v.kind, cn: v.cn, from: v.draftTw, to: v.tw })),
    entries,
    stillPending: entries.filter((v) => v.status !== 'verified' || v.conflict),
  }
}

/** 已校的名稱拿掉「待校」標記：期名／勢力（i18nPending）、首領名（i18nPending）、單位字典（pending） */
function clearPending(draft: Pick<RaidDraft, 'season' | 'stages' | 'bosses'>, verified: Set<string>) {
  const dropFrom = (list: string[] | undefined, field: string, value: string | undefined) =>
    list && value && verified.has(value) ? list.filter((x) => x !== field) : list
  const tidy = <T extends { i18nPending?: string[] }>(doc: T, list: string[] | undefined): T => {
    const out = { ...doc, i18nPending: list }
    if (!list?.length) delete out.i18nPending
    return out
  }
  let sl = draft.season.i18nPending
  sl = dropFrom(sl, 'name', draft.season.name)
  sl = dropFrom(sl, 'faction', draft.season.faction?.name)
  const season = tidy(draft.season, sl)
  const bosses = draft.bosses.map((b) => tidy(b, dropFrom(b.i18nPending, 'name', b.name)))
  const stages = draft.stages.map((st) => {
    if (!st.raid) return st
    const unitDict = Object.fromEntries(Object.entries(st.raid.unitDict).map(([k, u]) => {
      if (!u.pending || !verified.has(u.name)) return [k, u]
      const rest = { ...u }
      delete rest.pending
      return [k, rest]
    }))
    return { ...st, raid: { ...st.raid, unitDict } }
  })
  return { season, stages, bosses }
}

// ── 草稿 vs 已發布 ─────────────────────────────────────────────────────────────

const IGNORED_KEYS = new Set(['updatedAt', 'updatedBy', 'published'])

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).filter(([k]) => !IGNORED_KEYS.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)))
    : x))
}

export interface DocDiff {
  id: string
  kind: 'season' | 'stage' | 'boss'
  status: 'new' | 'changed' | 'removed'
  /** 有變動的頂層欄位（stage 再細到 raid.variants.<難度>） */
  fields: string[]
}

function fieldDiff(a: Record<string, unknown>, b: Record<string, unknown>, prefix = ''): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !IGNORED_KEYS.has(k) && k !== 'id'))
  const out: string[] = []
  for (const k of keys) {
    if (stable(a[k]) === stable(b[k])) continue
    const av = a[k], bv = b[k]
    const nested = (prefix === '' && k === 'raid') || prefix === 'raid.' || (prefix === '' && k === 'variants')
    if (nested && av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av)) {
      out.push(...fieldDiff(av as Record<string, unknown>, bv as Record<string, unknown>, `${prefix}${k}.`))
    } else out.push(`${prefix}${k}`)
  }
  return out
}

/**
 * 這期草稿與已發布文件的差異（後台差異檢視用）。
 * published 傳入「目前前台的三個集合」，函式自己挑出屬於這一期的文件；被草稿拿掉的文件列 removed（發布時會刪）。
 */
export function diffDraft(
  draft: { season: RaidSeason; stages: Stage[]; bosses: Boss[] },
  published: { seasons: RaidSeason[]; stages: Stage[]; bosses: Boss[] },
): DocDiff[] {
  const sid = draft.season.id
  const out: DocDiff[] = []
  const cmp = (kind: DocDiff['kind'], doc: { id: string }, pub: { id: string } | undefined) => {
    if (!pub) out.push({ id: doc.id, kind, status: 'new', fields: [] })
    else {
      const fields = fieldDiff(doc as unknown as Record<string, unknown>, pub as unknown as Record<string, unknown>)
      if (fields.length) out.push({ id: doc.id, kind, status: 'changed', fields })
    }
  }
  cmp('season', draft.season, published.seasons.find((s) => s.id === sid))
  const pubStages = published.stages.filter((s) => s.raid?.seasonId === sid)
  const pubBosses = published.bosses.filter((b) => b.seasonId === sid)
  for (const s of draft.stages) cmp('stage', s, pubStages.find((x) => x.id === s.id))
  for (const b of draft.bosses) cmp('boss', b, pubBosses.find((x) => x.id === b.id))
  for (const s of pubStages) if (!draft.stages.some((x) => x.id === s.id)) out.push({ id: s.id, kind: 'stage', status: 'removed', fields: [] })
  for (const b of pubBosses) if (!draft.bosses.some((x) => x.id === b.id)) out.push({ id: b.id, kind: 'boss', status: 'removed', fields: [] })
  return out
}

// ── 發布用的完整文件：草稿 → 已校譯名 → 欄位覆寫（預覽與發布同一條路）────────────────

export interface RaidBuildResult extends TermOverrideResult {
  /** 套用了的欄位覆寫 */
  overrides: RaidOverride[]
  /** 暫停套用的欄位覆寫（草稿的值與建立時不同，等站長確認） */
  suspended: FieldOverrideResult['suspended']
}

export function buildRaidDocs(draft: Pick<RaidDraft, 'season' | 'stages' | 'bosses' | 'terms' | 'pending'>, terms: Map<string, RaidTermEntry>, overrides: RaidOverride[] = []): RaidBuildResult {
  const t = applyTermOverrides(draft, terms)
  const f = applyFieldOverrides(draft, t, overrides)
  return { ...t, season: f.season, stages: f.stages, bosses: f.bosses, overrides: f.active, suspended: f.suspended }
}
