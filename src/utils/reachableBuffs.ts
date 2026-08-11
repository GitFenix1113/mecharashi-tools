// 可用 buff 池 → 可達 buff 集：收斂（PLAN-019-B Layer 2）
//
// buildBuffPool 給出的是「來源在配裝中」的原始聯集，可能含重複。本層做一種收斂：
//   同 buffId 多 level（階梯取最高）：同一個 buff 出現 @2 / @3 → 取 level 最大者。
//
// ⚠ **形態互斥（mutexGroup / FormGroup）已於 PLAN-041 移除。** 那套引擎是 PLAN-019-B 為
//   「虛粒子 ⟷ 實粒子」預留的，但實測全庫 **0 筆 buff 曾經填過 mutexGroup**——它從上線到
//   刪除為止算出來的永遠是 0 組、UI 從未渲染過一次。形態現在是 forms 集合的獨立實體
//   （機師詳情頁的形態分頁），不再由 buff 互斥模擬。模擬器的形態 gate 明文不在 PLAN-041 範圍內，
//   日後真要做時應以 forms 為準，**不要**把 mutexGroup 找回來。
//
// 純函式、無副作用，可單測（npm test）。

import type { GameBuff } from '../types'
import type { BuffSource } from './buffPool'

/** 收斂後的單一 buff 條目（已合併同 id、取最高級，帶所有來源） */
export interface ResolvedBuff {
  buff: GameBuff
  /** 取最高後的等級；undefined = 該 buff 無階梯 / 未指定級 */
  level?: number
  /** 所有貢獻此 buff 的來源（去重） */
  origins: string[]
}

export interface ResolvedBuffs {
  /** 已定案的 buff（已做 level 取最高） */
  fixed: ResolvedBuff[]
  /** pool 中查無對應 GameBuff 文件的孤兒（優雅降級：面板可略過或灰顯） */
  unresolved: BuffSource[]
}

/** level 比較用：未指定級視為 0（base），方便和指定級取最大 */
function levelRank(level: number | undefined): number {
  return level ?? 0
}

/**
 * 收斂可用 buff 池為可達集。
 * @param pool    buildBuffPool 的輸出
 * @param buffMap buffs 集合 id→GameBuff 查表
 */
export function resolveReachable(
  pool: BuffSource[],
  buffMap: Map<string, GameBuff>,
): ResolvedBuffs {
  const unresolved: BuffSource[] = []

  // ── 同 buffId 收斂：取最高級、合併來源 ──
  // key = buffId；value = 目前最高級的條目 + 累積來源
  const collapsed = new Map<string, { level?: number; origins: string[] }>()
  for (const src of pool) {
    if (!buffMap.has(src.buffId)) {
      unresolved.push(src)
      continue
    }
    const cur = collapsed.get(src.buffId)
    if (!cur) {
      collapsed.set(src.buffId, { level: src.level, origins: [src.origin] })
    } else {
      if (!cur.origins.includes(src.origin)) cur.origins.push(src.origin)
      if (levelRank(src.level) > levelRank(cur.level)) cur.level = src.level
    }
  }

  const fixed: ResolvedBuff[] = [...collapsed].map(([buffId, { level, origins }]) => ({
    buff: buffMap.get(buffId)!,
    level,
    origins,
  }))

  return { fixed, unresolved }
}
