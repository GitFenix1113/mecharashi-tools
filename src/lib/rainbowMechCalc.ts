import type {
  SlotInventory,
  SuperFactoryResources,
  SlotApproach,
  PlannerResult,
  SlotPlan,
  Gold1Node,
  Gold3Node,
  FertPair,
  BuyList,
} from '../types/mechUpgrade'
import type { MechPartPosition } from '../types/enums'

// ─── 規則摘要 ─────────────────────────────────────────────────────────────────
//
// 每部位需 2 個金三才能彩甲。一個金三可由以下方式取得：
//   · 自有金三
//   · 超級工廠 S++（萬能金三，免費但有限）
//   · 自有金二 → 金三（+2 肥料）
//   · 自有金一「錨點」+ 搭配（自有金一 / S零件 / 通用改進）→ 金二 → 金三（+2 肥料）
//   · 核心金三：核心改進原始(金1) + 通用改進 → 核心金二 → +2 肥料 → 核心金三（每部位上限 1）
//
// 關鍵限制：
//   1. 一次金二合成的兩個金一中至少一個是「真實零件」(自有 或 核心原始)；
//      替代品(S零件 / 通用)不能彼此或自我配對 → 每個合成金三都要消耗 1 個自有金一當錨點。
//   2. 核心金三每部位最多 1 個，且至少要有 1 個金三來自該部位自有材料，
//      因此「完全沒有任何零件」的部位無法升級。

interface Pool {
  sfS:     number
  sfSp:    number
  crossG2: number
  sUsed:   number
  spUsed:  number
  sppUsed: number
}

/** 一個部位扣除 S++ 後的生產分解 */
interface Breakdown {
  ownG3:     number   // 自有金三（直接算入）
  spp:       number   // 用 S++ 生產
  g2targets: number   // 自有金二當目標
  anchored:  number   // 自有金一錨定合成
  gaps:      number   // 無錨點 → 核心 / 缺料
  extraG1:   number   // 錨定後剩餘自有金一（可當搭配）
}

function breakdown(inv: SlotInventory, spp: number): Breakdown {
  const ownG3 = Math.min(inv.gold3, 2)
  const need = Math.max(0, 2 - ownG3)
  const usedSpp = Math.min(spp, need)
  const remaining = need - usedSpp
  const g2targets = Math.min(remaining, inv.gold2)
  const anchored = Math.min(remaining - g2targets, inv.gold1)
  const gaps = remaining - g2targets - anchored
  return { ownG3, spp: usedSpp, g2targets, anchored, gaps, extraG1: inv.gold1 - anchored }
}

// ─── 階段一：全域分配 S++ ──────────────────────────────────────────────────────
//
// 成本權重：1 通用 = 1；1 缺料(需核心) = 3（核心原始 + 通用 + 肥料，較貴）。

const CORE_WEIGHT = 3

function buyCost(inv: SlotInventory, spp: number): number {
  const b = breakdown(inv, spp)
  const wildcardPartners = Math.max(0, b.anchored - b.extraG1)  // 搭配無法以剩餘自有金一補的數量
  return wildcardPartners + b.gaps * CORE_WEIGHT
}

/** 該部位最多能有意義地使用幾個 S++（需保留至少 1 個自有金三來源） */
function maxSpp(inv: SlotInventory): number {
  const ownG3 = Math.min(inv.gold3, 2)
  const need = Math.max(0, 2 - ownG3)
  if (need === 0) return 0
  const ownBasedSources = inv.gold1 + inv.gold2
  const requiredOwnBased = ownG3 > 0 ? 0 : 1
  if (ownBasedSources < requiredOwnBased) return 0   // 完全無自有 → 不可行，不浪費 S++
  return Math.max(0, need - requiredOwnBased)
}

function allocateSpp(parts: SlotInventory[], sppTotal: number): Record<MechPartPosition, number> {
  const alloc: Record<string, number> = {}
  for (const p of parts) alloc[p.slot] = 0
  if (sppTotal <= 0) return alloc as Record<MechPartPosition, number>

  const entries: { slot: MechPartPosition; benefit: number }[] = []
  for (const inv of parts) {
    const cap = maxSpp(inv)
    for (let s = 0; s < cap; s++) {
      entries.push({ slot: inv.slot, benefit: buyCost(inv, s) - buyCost(inv, s + 1) })
    }
  }
  entries.sort((a, b) => b.benefit - a.benefit)
  for (let i = 0; i < entries.length && i < sppTotal; i++) alloc[entries[i].slot]++
  return alloc as Record<MechPartPosition, number>
}

// ─── 階段二：逐部位建構合成樹 ─────────────────────────────────────────────────

function planFerts(state: { g2: number }, pool: Pool, buy: BuyList): FertPair {
  if (pool.sfSp > 0) {
    pool.sfSp--; pool.spUsed++
    return { usedSp: true, fert1: 'owned', fert2: 'owned' }
  }
  const getFert = (): 'owned' | 'buy' => {
    if (state.g2 > 0)     { state.g2--;     return 'owned' }
    if (pool.crossG2 > 0) { pool.crossG2--; return 'owned' }
    buy.fertBuy++
    return 'buy'
  }
  return { usedSp: false, fert1: getFert(), fert2: getFert() }
}

function processSlot(
  inv:        SlotInventory,
  approach:   SlotApproach,
  sppForSlot: number,
  pool:       Pool,
): SlotPlan {
  const state = { g2: inv.gold2 }
  const buy: BuyList = { universal: 0, fertBuy: 0, coreRaw: 0 }
  const before = { s: pool.sUsed, sp: pool.spUsed, spp: pool.sppUsed }

  const b = breakdown(inv, sppForSlot)
  const feasible = b.ownG3 > 0 || inv.gold1 + inv.gold2 > 0
  let partnerOwn = b.extraG1   // 剩餘自有金一可當搭配
  let shortage = 0

  const nodes: Gold3Node[] = []

  // 自有金三
  for (let i = 0; i < b.ownG3; i++) nodes.push({ source: 'owned' })

  // 自有金二當目標
  for (let i = 0; i < b.g2targets; i++) {
    state.g2--
    nodes.push({ source: 'synth', targetGold2: { source: 'owned' }, ferts: planFerts(state, pool, buy) })
  }

  // 自有金一錨定合成（錨點必為自有；搭配 = 剩餘自有 → S零件 → 通用）
  for (let i = 0; i < b.anchored; i++) {
    let partner: Gold1Node
    if (partnerOwn > 0)    { partnerOwn--;  partner = { source: 'owned' } }
    else if (pool.sfS > 0) { pool.sfS--; pool.sUsed++; partner = { source: 'sf_s' } }
    else                   { buy.universal++; partner = { source: 'universal' } }
    nodes.push({
      source: 'synth',
      targetGold2: { source: 'synth', gold1a: { source: 'owned' }, gold1b: partner },
      ferts: planFerts(state, pool, buy),
    })
  }

  // S++（萬能金三）
  for (let i = 0; i < b.spp; i++) { pool.sppUsed++; nodes.push({ source: 'sf_spp' }) }

  // 缺口：核心金三（上限 1）或缺料
  for (let i = 0; i < b.gaps; i++) {
    if (approach === 'core') {
      buy.coreRaw++; buy.universal++
      nodes.push({
        source: 'core',
        targetGold2: { source: 'synth', gold1a: { source: 'core_raw' }, gold1b: { source: 'universal' } },
        ferts: planFerts(state, pool, buy),
      })
    } else {
      shortage++
      nodes.push({ source: 'shortage' })
    }
  }

  pool.crossG2 += state.g2   // 剩餘自有金二供跨部位作肥料

  return {
    slot: inv.slot, approach,
    gold3a: nodes[0] ?? { source: 'shortage' },
    gold3b: nodes[1] ?? { source: 'shortage' },
    buy,
    sfUsed: { s: pool.sUsed - before.s, sp: pool.spUsed - before.sp, spp: pool.sppUsed - before.spp },
    feasible, shortage,
  }
}

// ─── 主計算函式 ───────────────────────────────────────────────────────────────

/** 已彩甲部位：視為兩個金三皆自有，不消耗任何資源、不需準備材料 */
function donePlan(slot: MechPartPosition): SlotPlan {
  return {
    slot, approach: 'universal',
    gold3a: { source: 'owned' }, gold3b: { source: 'owned' },
    buy: { universal: 0, fertBuy: 0, coreRaw: 0 },
    sfUsed: { s: 0, sp: 0, spp: 0 },
    feasible: true, shortage: 0,
  }
}

export function calculateRainbowPlan(
  parts:      SlotInventory[],
  sf:         SuperFactoryResources,
  approaches: Record<MechPartPosition, SlotApproach>,
): PlannerResult {
  const pool: Pool = {
    sfS:     sf.enabled ? sf.sCount  : 0,
    sfSp:    sf.enabled ? sf.spCount : 0,
    crossG2: 0,
    sUsed: 0, spUsed: 0, sppUsed: 0,
  }

  // 已彩甲部位不參與 S++ 分配與合成排程
  const activeParts = parts.filter(p => !p.done)
  const sppAlloc = allocateSpp(activeParts, sf.enabled ? sf.sppCount : 0)

  // 先處理會釋出剩餘金二的部位，讓跨部位肥料池盡早可用
  const order = [...activeParts].sort((a, b) => {
    const surplus = (p: SlotInventory) => p.gold2 - 2 * Math.max(0, 2 - Math.min(p.gold3, 2))
    return surplus(b) - surplus(a)
  })

  const slotMap = new Map<MechPartPosition, SlotPlan>()
  for (const inv of order) {
    const approach = approaches[inv.slot] ?? 'universal'
    slotMap.set(inv.slot, processSlot(inv, approach, sppAlloc[inv.slot] ?? 0, pool))
  }

  const slots = parts.map(p => (p.done ? donePlan(p.slot) : slotMap.get(p.slot)!)).filter(Boolean)

  const totalBuy: BuyList = {
    universal: slots.reduce((s, p) => s + p.buy.universal, 0),
    fertBuy:   slots.reduce((s, p) => s + p.buy.fertBuy, 0),
    coreRaw:   slots.reduce((s, p) => s + p.buy.coreRaw, 0),
  }

  return {
    slots,
    totalBuy,
    sfUsed: { s: pool.sUsed, sp: pool.spUsed, spp: pool.sppUsed },
  }
}
