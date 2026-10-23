// PLAN-064 D：武裝討伐草稿的純函式（後台審核頁用；node:test 可直接測）。
//
// 譯名校對怎麼生效（決策八）：
//   · 草稿裡的名稱是匯入當下套表的結果；pending 清單記著「哪個簡中原文、當時用了什麼譯文」。
//   · 站長在後台改了某條譯名（寫進 raidTerms）之後，發布前用 applyTermOverrides 把草稿裡
//     「整個字串等於當時譯文」的值換成新譯名——名稱、整段長文都是整字串，換得到。
//   · 長文裡夾帶的名詞換不到（要重跑匯入，匯入端會先替換已校名詞再機轉），審核頁會提醒。

import type { Boss, RaidDraft, RaidPendingTerm, RaidSeason, RaidTermEntry, Stage } from '../types/boss'

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

/** 深層替換所有「整個字串等於 from」的值 */
function replaceDeep<T>(val: T, map: Map<string, string>): T {
  if (typeof val === 'string') return (map.get(val) ?? val) as T
  if (Array.isArray(val)) return val.map((v) => replaceDeep(v, map)) as T
  if (val && typeof val === 'object') {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, replaceDeep(v, map)])) as T
  }
  return val
}

export interface TermOverrideResult {
  season: RaidSeason
  stages: Stage[]
  bosses: Boss[]
  /** 已套用的對照（草稿譯文 → 新譯名） */
  applied: { kind: string; cn: string; from: string; to: string }[]
  /** 仍待校的條目（對照表沒有，或對照表也還是 pending） */
  stillPending: RaidPendingTerm[]
}

/**
 * 把後台校對過的譯名套進草稿（發布前呼叫）。只換「整個字串等於草稿當時譯文」的值。
 * 同一個草稿譯文對到兩種新譯名時（不同種類、原文不同但機轉相同）不換，列進 stillPending 讓人工處理。
 */
export function applyTermOverrides(draft: Pick<RaidDraft, 'season' | 'stages' | 'bosses' | 'pending'>, terms: Map<string, RaidTermEntry>): TermOverrideResult {
  const map = new Map<string, string>()
  const conflict = new Set<string>()
  const applied: TermOverrideResult['applied'] = []
  const stillPending: RaidPendingTerm[] = []
  for (const p of draft.pending || []) {
    const t = terms.get(termKey(p.kind, p.cn))
    if (!t || t.status !== 'verified') {
      stillPending.push(t ? { ...p, tw: t.tw } : p)
      if (t && t.tw !== p.tw) { // 來源匯入但未校：仍採用它的譯文（優先於機轉）
        if (map.has(p.tw) && map.get(p.tw) !== t.tw) conflict.add(p.tw)
        else map.set(p.tw, t.tw)
      }
      continue
    }
    if (t.tw === p.tw) continue
    if (map.has(p.tw) && map.get(p.tw) !== t.tw) conflict.add(p.tw)
    else {
      map.set(p.tw, t.tw)
      applied.push({ kind: p.kind, cn: p.cn, from: p.tw, to: t.tw })
    }
  }
  for (const c of conflict) {
    map.delete(c)
    for (const p of draft.pending) if (p.tw === c && !stillPending.includes(p)) stillPending.push(p)
  }
  return {
    season: replaceDeep(draft.season, map),
    stages: replaceDeep(draft.stages, map),
    bosses: replaceDeep(draft.bosses, map),
    applied: applied.filter((a) => !conflict.has(a.from)),
    stillPending,
  }
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
