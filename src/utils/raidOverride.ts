// PLAN-064 H：武裝討伐的欄位覆寫（審核後發現的非文字錯誤，或只改一處的文字）。純函式，node:test 可直接測。
//
// 覆寫存在 raidOverrides/{期}（後台限定），發布時疊在「草稿＋已校譯名」上面；重跑匯入不會洗掉。
// 每筆記著建立當下草稿的原值（base）：之後草稿的值變了（資料包更新、解析修正），
// 那一筆就**暫停套用**、在後台標 ⚠，等站長確認新資料還要不要覆寫——舊的修改不會默默蓋在新資料上。
// 套用到的欄位寫進文件的 manualPaths，前台列成「人工修正」。

import type { Boss, RaidOverride, RaidSeason, Stage } from '../types/boss'
import type { RaidDifficulty } from '../types/enums'

export type RaidDocKind = RaidOverride['doc']

interface RaidDocs { season: RaidSeason; stages: Stage[]; bosses: Boss[] }

const isIndex = (s: string) => /^\d+$/.test(s)

/** 依點分隔路徑取值（陣列用索引） */
export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** 依路徑寫值，沿路複製（不改原物件）。中間節點不存在時回 null（不憑空長出結構） */
export function setAt<T>(obj: T, path: string, value: unknown): T | null {
  const segs = path.split('.')
  const walk = (node: unknown, i: number): unknown => {
    if (node == null || typeof node !== 'object') return null
    const seg = segs[i]
    const src = node as Record<string, unknown>
    if (i < segs.length - 1 && (src[seg] == null || typeof src[seg] !== 'object')) return null
    const next = i === segs.length - 1 ? value : walk(src[seg], i + 1)
    if (next === null && i < segs.length - 1) return null
    if (Array.isArray(node)) {
      if (!isIndex(seg) || Number(seg) >= node.length) return null
      const copy = [...node]
      copy[Number(seg)] = next
      return copy
    }
    return { ...src, [seg]: next }
  }
  return walk(obj, 0) as T | null
}

/** 結構相等（物件鍵順序不影響） */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, norm(x)]))
    }
    return v ?? null
  }
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/** 覆寫的識別字串（Firestore 鍵是它的 termHash） */
export const overrideId = (o: Pick<RaidOverride, 'doc' | 'docId' | 'path'>) => `${o.doc}:${o.docId}:${o.path}`

function findDoc(docs: RaidDocs, kind: RaidDocKind, id: string): unknown {
  if (kind === 'season') return docs.season.id === id ? docs.season : undefined
  return (kind === 'stage' ? docs.stages : docs.bosses).find((d) => d.id === id)
}

export interface FieldOverrideResult extends RaidDocs {
  /** 套用了的覆寫 */
  active: RaidOverride[]
  /** 暫停套用：草稿的值與建立時不同（current＝草稿現在的值；文件不見了是 undefined） */
  suspended: { o: RaidOverride; current: unknown }[]
}

/**
 * 把欄位覆寫疊上去。raw＝草稿原文（比對 base 用），docs＝已套譯名的文件（寫值用）。
 * 套用到的路徑寫進各文件的 manualPaths（前台「人工修正」）。
 */
export function applyFieldOverrides(raw: RaidDocs, docs: RaidDocs, overrides: RaidOverride[]): FieldOverrideResult {
  let season = docs.season
  const stages = [...docs.stages]
  const bosses = [...docs.bosses]
  const active: RaidOverride[] = []
  const suspended: FieldOverrideResult['suspended'] = []
  const manual = new Map<string, Set<string>>()

  for (const o of overrides) {
    const rawDoc = findDoc(raw, o.doc, o.docId)
    const current = rawDoc === undefined ? undefined : getAt(rawDoc, o.path)
    if (rawDoc === undefined || !sameValue(current, o.base)) {
      suspended.push({ o, current })
      continue
    }
    const list: { id: string }[] = o.doc === 'season' ? [season] : o.doc === 'stage' ? stages : bosses
    const idx = list.findIndex((d) => d.id === o.docId)
    const next = idx < 0 ? null : setAt(list[idx], o.path, o.value)
    if (!next) {
      suspended.push({ o, current })
      continue
    }
    if (o.doc === 'season') season = next as RaidSeason
    else list[idx] = next
    const k = `${o.doc}:${o.docId}`
    if (!manual.has(k)) manual.set(k, new Set())
    manual.get(k)!.add(o.path)
    active.push(o)
  }

  const mark = <T extends { id: string; manualPaths?: string[] }>(kind: RaidDocKind, d: T): T => {
    const paths = manual.get(`${kind}:${d.id}`)
    const out = { ...d }
    delete out.manualPaths
    return paths ? { ...out, manualPaths: [...paths].sort() } : out
  }
  return {
    season: mark('season', season),
    stages: stages.map((d) => mark('stage', d)),
    bosses: bosses.map((d) => mark('boss', d)),
    active,
    suspended,
  }
}

// ── 欄位名稱（後台欄位編輯器、前台「人工修正」共用）──────────────────────────────

export const FIELD_LABEL: Record<string, string> = {
  name: '名稱', desc: '說明', description: '說明', details: '詳情', text: '文字', note: '備註',
  turnLimit: '回合上限', winText: '勝利條件', loseText: '失敗條件', battleName: '戰場名',
  features: '關卡特性', terrain: '地形', difficultyText: '難度強化', anomalies: '異常註記', anomaly: '異常註記',
  units: '開場陣容', reinforcements: '增援', events: '回合事件', bounties: '懸賞', clue: '線索', clueGate: '線索門檻',
  show: '顯示門檻', unlock: '解鎖門檻', count: '數量', level: '等級', ally: '友軍',
  when: '時點', warn: '預警', also: '附帶條件', turns: '回合', timing: '時機', from: '起始回合',
  mech: '機體', weapons: '武器', attack: '攻擊', parts: '面板',
  torso: '軀幹', leftArm: '左臂', rightArm: '右臂', legs: '腿部', durable: '耐久', armor: '裝甲',
  hpTotal: '耐久合計', antiCrit: '抗暴', dodge: '閃避', pilotStats: '機師能力',
  melee: '格鬥', assault: '突擊', shooting: '射擊', tactics: '戰術', defense: '防禦', engineering: '工程',
  skills: '技能', ap: 'AP', notCounted: '未計入', quote: '台詞',
  subtitleEn: '英文副標', faction: '勢力', twVersion: '台版版本', twDate: '台版開放日', twStatus: '台版狀態', cnOpenDate: '陸版開放日',
  rules: '每週規則', weekBuffs: '支援協議', week: '週', effects: '效果', difficultyNames: '難度名',
  unitDict: '單位', refDict: '引用說明',
}

const DIFF_FALLBACK: Record<string, string> = { normal: '初試', hard: '磨鍊', hell: '死境', d4: '煉獄' }

/**
 * 路徑 → 人讀名稱：'raid.variants.hell.reinforcements.2.when.turns.0' → 「死境・增援 #3・時點・回合 #1」。
 * omitDifficulty：前台已經在該難度分頁裡，不必再寫難度名。
 */
export function fieldLabel(path: string, opts: { difficultyNames?: Partial<Record<RaidDifficulty, string>>; omitDifficulty?: boolean } = {}): string {
  const segs = path.split('.')
  const out: string[] = []
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s === 'raid') continue
    if (s === 'variants') {
      const d = segs[++i]
      if (!opts.omitDifficulty) out.push(opts.difficultyNames?.[d as RaidDifficulty] ?? DIFF_FALLBACK[d] ?? d)
      continue
    }
    if (isIndex(s)) {
      if (out.length) out[out.length - 1] += ` #${Number(s) + 1}`
      else out.push(`#${Number(s) + 1}`)
      continue
    }
    if (s === 'unitDict' || s === 'refDict') {
      out.push(`${FIELD_LABEL[s]}（${segs[++i]}）`)
      continue
    }
    out.push(FIELD_LABEL[s] ?? s)
  }
  return out.join('・')
}

/** 這條路徑屬於某個難度？（不在 variants 底下的欄位＝所有難度共用） */
export function pathDifficulty(path: string): RaidDifficulty | null {
  const segs = path.split('.')
  const i = segs.indexOf('variants')
  return i >= 0 ? (segs[i + 1] as RaidDifficulty) : null
}
