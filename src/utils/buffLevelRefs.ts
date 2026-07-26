// 階梯 buff 的「單一等級」反查（PLAN-034 Phase E-2）
//
// findReferences 回答的是「誰引用了這個 **buff**」，粒度到文件為止。
// 但階梯 buff 的引用其實是指向**某一級**的：
//   · descriptionRefs 的 EntityRef.level
//   · buffIds / buffUpgrades 的 `id@N`
//   · 正文內嵌的 <id.lvN.attr> 數值 token
//
// 缺了 level 粒度反查，後台刪掉或重排 levels[] 時這些引用會**靜默指空**——
// 而 PLAN-034 的覆寫層把後果從「一筆引用壞掉」放大成「整族在該機師頁全部不生效」
// （建表閘門②查無該級 → 整族退場 → 使用者點算力毫無反應）。
//
// 純函式、可單測（npm test）。

import { findReferences, type RefHit, type RefScanData } from './entityRefs.ts'

/**
 * 找出所有指向 `buffId` **第 level 級**的引用。
 *
 * 三類站點的取級方式不同，逐類判定：
 *   · buffIds / buffUpgrades → RefHit.level（來自 parseBuffRef 的 @N）
 *   · descriptionRefs        → RefHit.level（來自 EntityRef.level）
 *   · numTokenText           → RefHit.level 不填，改比對 tokens 內的 `.lvN.` 段
 *
 * 沒指定級的引用（裸 id、無 level 的 EntityRef、無 lv 段的 token）**不算命中**：
 * 它們指的是家族本身，刪掉某一級不會讓它們指空。
 */
export function findBuffLevelRefs(buffId: string, level: number, data: RefScanData): RefHit[] {
  const { hits } = findReferences('buff', buffId, data)
  const lvSeg = `.lv${level}.`
  return hits.filter((h) => {
    if (h.kind === 'numTokenText') return (h.tokens ?? []).some((t) => t.includes(lvSeg))
    return h.level === level
  })
}

/** 一筆阻擋訊息所需的最小資訊 */
export interface BuffLevelBlocker {
  level: number
  hits: RefHit[]
}

/**
 * 存檔前檢查：哪些**即將被移除**的等級仍被引用。
 *
 * @param before 編輯前的 levels（DB 現值）
 * @param after  即將寫入的 levels
 */
export function findRemovedLevelsInUse(
  buffId: string,
  before: { level: number }[] | undefined,
  after: { level: number }[] | undefined,
  data: RefScanData,
): BuffLevelBlocker[] {
  const kept = new Set((after ?? []).map((l) => l.level))
  const removed = (before ?? []).map((l) => l.level).filter((n) => !kept.has(n))
  const out: BuffLevelBlocker[] = []
  for (const level of removed) {
    const hits = findBuffLevelRefs(buffId, level, data)
    if (hits.length) out.push({ level, hits })
  }
  return out
}

/** 依 level 昇冪正規化。實測 buff_迴避率降低 的 levels 順序是 [2,3,5,4]，亂序會讓人誤讀。 */
export function sortLevelsAscending<T extends { level: number }>(levels: T[] | undefined): T[] | undefined {
  if (!levels?.length) return levels
  return [...levels].sort((a, b) => a.level - b.level)
}
