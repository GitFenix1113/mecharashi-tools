// 劇情書頁的「關卡導覽」純函式（PLAN-042-I A-2）：關卡列結構、目前在哪一關、上一關／下一關。
//
// ⚠ 本檔刻意不 import storyData.ts：那邊用 import.meta.glob 載書，node --test 跑不動。
//   跨書的鄰居（上一本／下一本）由呼叫端用 storyNeighbors() 算好傳進來。

import type { StoryCatalogEntry, StoryStage } from './storyTypes'

/** 關卡列的一列：一個正關，底下掛著它後面那幾場沒有編號的遭遇戰／突襲戰 */
export interface OutlineEntry {
  /** 在 book.stages 裡的位置 */
  index: number
  /** 掛在這一關底下的小關（遭遇戰、突襲戰）的位置 */
  minors: number[]
}

/** 關卡列的一段：活動的一幕、主線的「支線」、長串切開的一截，或沒有標題的本體 */
export interface OutlineSection {
  /** React key，也用來判斷「目前那一段」 */
  key: string
  /** 段標題（幕名、「支線」、「1～10」）；本體沒有標題 */
  label: string | null
  /** 可以收合：桌機關卡列只展開目前所在的那一段（活動分幕、長串切開的每一截） */
  foldable: boolean
  entries: OutlineEntry[]
}

/** 沒有編號、也不是支線的關＝遭遇戰之類的小關，要掛在前一個正關底下 */
const isMinor = (s: StoryStage) => !s.code && !s.branch

/**
 * 一段超過這麼多列就切成一截一截（每截 CHUNK 列、可收合）。
 * 量法：1366×768 的館內 scrollport 高 722px，關卡列一列約 25px、列頭列尾約 140px——
 * 全部攤開的話約 22 列就超出（event-8 逆止之疑：22 個正關、沒有分幕，實測 808px）。
 * 關卡列黏著又不能自己捲（地雷 M-08），超出的部分就永遠看不到，所以長串一定要收。
 */
export const OUTLINE_MAX_ENTRIES = 14
const CHUNK = 10

/**
 * 把一本書的關卡整理成關卡列。規則（計畫書決策三）：
 *   · 活動分幕（stage.group）一幕一段（可收合）
 *   · 主線支線另起一段「支線」
 *   · 沒有編號的小關掛在同一段裡前一個正關底下；段首就是小關時（沒有可掛的）自成一列
 *   · 不可收合的段超過 OUTLINE_MAX_ENTRIES 列時，切成每截 10 列、可收合的幾截（標題「1～10」）
 * 每一關恰好出現一次，順序與 book.stages 相同。
 */
export function stageOutline(stages: readonly StoryStage[]): OutlineSection[] {
  const sections: OutlineSection[] = []
  let cur: OutlineSection | null = null
  stages.forEach((s, i) => {
    const sectionKey = s.branch ? 'branch' : s.group ? `g:${s.group}` : 'main'
    if (!cur || cur.key !== sectionKey) {
      cur = { key: sectionKey, label: s.branch ? '支線' : s.group ?? null, foldable: !!s.group && !s.branch, entries: [] }
      sections.push(cur)
    }
    const last = cur.entries.at(-1)
    if (isMinor(s) && last) last.minors.push(i)
    else cur.entries.push({ index: i, minors: [] })
  })
  return sections.flatMap((sec) => {
    if (sec.foldable || sec.entries.length <= OUTLINE_MAX_ENTRIES) return [sec]
    const chunks: OutlineSection[] = []
    for (let at = 0; at < sec.entries.length; at += CHUNK) {
      const entries = sec.entries.slice(at, at + CHUNK)
      const name = (e: OutlineEntry) => stages[e.index].code || stages[e.index].name
      const range = `${name(entries[0])}～${name(entries.at(-1)!)}`
      chunks.push({ key: `${sec.key}:${at}`, label: sec.label ? `${sec.label} ${range}` : range, foldable: true, entries })
    }
    return chunks
  })
}

/**
 * 桌機關卡列在「目前在第 index 關」時實際顯示幾列（列頭列尾不算）：
 * 收合的段一列、展開的段＝段標題＋每個正關一列＋目前那一組的小關。給測試量最壞情況用。
 */
export function visibleRowCount(outline: readonly OutlineSection[], index: number): number {
  const here = locateStage(outline, index)
  return outline.reduce((n, sec) => {
    if (sec.foldable && here?.section !== sec) return n + 1
    const minors = here && here.section === sec ? here.entry.minors.length : 0
    return n + (sec.label ? 1 : 0) + sec.entries.length + minors
  }, 0)
}

/** 某一關落在關卡列的哪一段、哪一列（找不到回 null） */
export function locateStage(outline: readonly OutlineSection[], index: number): { section: OutlineSection; entry: OutlineEntry } | null {
  for (const section of outline) {
    for (const entry of section.entries) {
      if (entry.index === index || entry.minors.includes(index)) return { section, entry }
    }
  }
  return null
}

/** 網址上的關卡 key → 位置。沒給 key＝書根＝第一關；給了卻找不到回 -1（呼叫端 replace 回書根） */
export function resolveStageIndex(stages: readonly StoryStage[], key: string | undefined): number {
  if (!key) return stages.length ? 0 : -1
  return stages.findIndex((s) => s.key === key)
}

/**
 * 舊版書頁的頁內錨點（`/lore/story/main-2#w108`）→ 關卡 key。
 * 改版前分享出去的連結都長這樣；認得就導到新網址，不認得回 null。
 */
export function legacyHashStage(stages: readonly StoryStage[], hash: string): string | null {
  const key = decodeURIComponent(hash.replace(/^#/, ''))
  return key && stages.some((s) => s.key === key) ? key : null
}

/** 一關的網址。第一關就是書根（不重複出兩個網址指同一頁） */
export function stagePath(bookId: string, stages: readonly StoryStage[], index: number): string {
  const base = `/lore/story/${bookId}`
  return index <= 0 ? base : `${base}/${encodeURIComponent(stages[index].key)}`
}

/** 關卡列與分頁標題上的名字：「1-3 全頻道阻塞」；沒有編號的小關只有名字 */
export const stageLabel = (s: Pick<StoryStage, 'code' | 'name'>): string => (s.code ? `${s.code} ${s.name}` : s.name)

/** 上一關／下一關可能是同一本的另一關，也可能是隔壁那一本 */
export type StageTarget =
  | { kind: 'stage'; index: number }
  | { kind: 'book'; entry: StoryCatalogEntry }

/**
 * 關末導覽的兩個方向。本書首關的上一個是上一本、末關的下一個是下一本（同種類、目錄順序）；
 * 再往外就沒有了。
 */
export function stageNeighbors(
  stages: readonly StoryStage[],
  index: number,
  books: { prev?: StoryCatalogEntry; next?: StoryCatalogEntry },
): { prev?: StageTarget; next?: StageTarget } {
  const prev: StageTarget | undefined = index > 0 ? { kind: 'stage', index: index - 1 } : books.prev && { kind: 'book', entry: books.prev }
  const next: StageTarget | undefined =
    index < stages.length - 1 ? { kind: 'stage', index: index + 1 } : books.next && { kind: 'book', entry: books.next }
  return { prev, next }
}
