import type { MechPartPosition } from './enums'

export type PartLevel = 'none' | 'gold1' | 'gold2' | 'gold3' | 'rainbow'

/** 單部位升彩甲的路線：通用模組合成 / 改用核心金三 */
export type SlotApproach = 'universal' | 'core'

// ─── 輸入型別 ─────────────────────────────────────────────────────────────────

export interface SlotInventory {
  slot:  MechPartPosition
  gold1: number
  gold2: number
  gold3: number
  done?: boolean   // 已彩甲：此部位已完成，計算時直接略過、不需任何材料
}

export interface ModuleInventory {
  universal:  number  // 通用改進模組（須對應機甲 ArmorType 重量）
  coreRaw:    number  // 核心改進模組（原始）
  coreGold2:  number  // 核心改進（金二）
  coreGold3:  number  // 核心改進（金三）= 萬能金三，須對應機甲重量
}

export interface SuperFactoryResources {
  enabled:  boolean
  sCount:   number   // S 零件  = 萬能金一（無重量限制）
  spCount:  number   // S+ 零件 = 替代兩個金二肥料（無重量限制）
  sppCount: number   // S++ 零件 = 萬能金三（無重量限制）
}

// ─── 計算結果型別 ─────────────────────────────────────────────────────────────
//
// 規劃器不再有「缺料」狀態：任何金一缺口一律以通用改進模組補足，任何肥料缺口一律
// 列為「需準備的金二零件」。結果即是一張「要準備什麼材料」的清單。

export interface Gold1Node {
  /**
   * owned=自有金一（可作錨點）；sf_s=超級工廠 S；universal=需備通用改進模組；
   * core_raw=核心改進原始（本身即一個金一錨點）。
   * 規則：一次金二合成的兩個金一中，至少一個必須是「真實零件」（owned 或 core_raw）；
   * 替代品（sf_s / universal）不能彼此或自我配對。
   */
  source: 'owned' | 'sf_s' | 'universal' | 'core_raw'
}

export interface Gold2Node {
  source: 'owned' | 'synth'
  gold1a?: Gold1Node   // defined when source === 'synth'（錨點）
  gold1b?: Gold1Node   // defined when source === 'synth'（搭配）
}

/** 一次金二→金三合成所需的兩個肥料 */
export interface FertPair {
  usedSp: boolean          // true 時 S+ 涵蓋兩個肥料，fert1/fert2 不適用
  fert1:  'owned' | 'buy'  // owned=自有/跨部位金二；buy=需準備金二零件
  fert2:  'owned' | 'buy'
}

export interface Gold3Node {
  /**
   * owned=自有金三；sf_spp=超級工廠 S++；core=核心金三（每部位上限 1）；
   * synth=以自有金一/金二合成；shortage=缺真實零件（無法以通用路線完成）。
   */
  source:       'owned' | 'sf_spp' | 'core' | 'synth' | 'shortage'
  targetGold2?: Gold2Node  // source === 'synth' / 'core' 時存在
  ferts?:       FertPair    // source === 'synth' / 'core' 時存在
}

/** 需要額外準備的材料數量 */
export interface BuyList {
  universal: number   // 通用改進模組
  fertBuy:   number   // 金二零件（肥料）
  coreRaw:   number   // 核心改進模組（原始）
}

export interface SlotPlan {
  slot:        MechPartPosition
  approach:    SlotApproach
  gold3a:      Gold3Node   // 彩甲所需第一個金三
  gold3b:      Gold3Node   // 彩甲所需第二個金三
  buy:         BuyList     // 此部位需準備的材料
  sfUsed:      { s: number; sp: number; spp: number }
  feasible:    boolean     // false=完全沒有零件，無法升級
  shortage:    number      // 通用路線下缺多少真實零件（可改用核心補）
}

export interface PlannerResult {
  slots:    SlotPlan[]
  totalBuy: BuyList
  sfUsed:   { s: number; sp: number; spp: number }
}
