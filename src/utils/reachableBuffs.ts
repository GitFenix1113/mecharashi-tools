// 可用 buff 池 → 可達 buff 集：收斂（PLAN-019-B Layer 2）
//
// buildBuffPool 給出的是「來源在配裝中」的原始聯集，可能含重複與互斥。本層做兩種【分立】收斂
// （PLAN-024 後語意，務必區分）：
//   ① mutexGroup（形態互斥）：同 GameBuff.mutexGroup 一次只能存在一個（虛粒子 ⟷ 實粒子）。
//      → 不自動決定，而是輸出「擇一選項組」交給 UI 讓玩家切。
//   ② 同 buffId 多 level（階梯取最高）：同一個 buff 出現 @2 / @3 → 取 level 最大者（天然互斥，
//      取代舊「階梯共用 mutexGroup」用法）。
// 兩者語意不同、互不衝突：先做 ②（同 id 收斂取最高），再做 ①（跨 id 依形態分組）。
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

/** 形態互斥組：同 mutexGroup 的多個 buff，需使用者擇一 active */
export interface FormGroup {
  mutexGroup: string
  options: ResolvedBuff[]
}

export interface ResolvedBuffs {
  /** 形態互斥組（mutexGroup 命中且同組 >0）；UI 渲染成擇一切換 */
  formGroups: FormGroup[]
  /** 非形態、已定案的 buff（已做 level 取最高） */
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

  // ── ② 同 buffId 收斂：取最高級、合併來源 ──
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

  // ── ① 跨 buffId 依 mutexGroup 分組 ──
  const fixed: ResolvedBuff[] = []
  const groupMap = new Map<string, ResolvedBuff[]>()
  for (const [buffId, { level, origins }] of collapsed) {
    const buff = buffMap.get(buffId)!
    const resolved: ResolvedBuff = { buff, level, origins }
    if (buff.mutexGroup) {
      const arr = groupMap.get(buff.mutexGroup)
      if (arr) arr.push(resolved)
      else groupMap.set(buff.mutexGroup, [resolved])
    } else {
      fixed.push(resolved)
    }
  }

  const formGroups: FormGroup[] = [...groupMap.entries()].map(
    ([mutexGroup, options]) => ({ mutexGroup, options }),
  )

  return { formGroups, fixed, unresolved }
}
