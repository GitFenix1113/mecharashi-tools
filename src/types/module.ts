// ─── 模組（v1.9 更新：欄位重命名 + 新增防禦/機體屬性欄位）─────────────────────

import type { DescriptionRefs } from './common'

export interface ConditionalEffect {
  /** ConditionalTrigger enum value */
  trigger: string
  /** 觸發門檻值（apSkill 時為最低 AP 數） */
  minCount?: number
  /** 受影響的屬性欄位名稱，對應 Module 頂層欄位 */
  stats: string[]
  base?: number
  scale?: number
  max?: number
  maxStacks?: number
  /** null / 未設定 = 永久 */
  duration?: number
  resetOn?: 'attack' | 'turn' | null
}

export interface ModuleLevel {
  level: number
  description: string
  /** 該等級描述內 [xxx] 引用側錄（PLAN-019 Layer 1）；未設定時前台回退用父模組 Module.descriptionRefs */
  descriptionRefs?: DescriptionRefs
  dmg: number
  crit_rate: number
  critDmg: number
  acc_rate: number
  firepower_rate: number
  armor_rate: number
  crit_resist_rate: number
  output_bonus: number
  dodge_rate: number
  durable_rate: number
  dmg_resist_rate: number
  // 武器類別增傷
  dmg_assault?: number
  dmg_melee?: number
  dmg_shooting?: number
  dmg_tactical?: number
  // 武器種類增傷
  dmg_blade?: number
  dmg_polearm?: number
  dmg_missile?: number
  dmg_rocket?: number
  dmg_shotgun?: number
  dmg_machinegun?: number
  dmg_heavy_machinegun?: number
  dmg_railgun?: number
  dmg_funnel?: number
  dmg_sniper_light?: number
  dmg_sniper?: number
  dmg_fist?: number
  dmg_pile?: number
  dmg_chainsaw?: number
  dmg_flamethrower?: number
  // 特殊情境增傷
  dmg_counter?: number
  dmg_enemy_phase?: number
}

export interface Module {
  id: string
  name: string
  /** 模組槽位：使用 ModuleSlot enum 值（'機甲特性模組'/'機甲8級模組'/'通用模組'/'機甲副模組'/'機甲專屬模組'） */
  slot: string
  /** 綁定機甲 ID；null = 通用模組（可自由裝配） */
  boundMechId: string | null
  /** 綁定部位（陣列，v2.2 改為複數）；MechPartPosition enum 值組成的陣列；null 或 [] = 不限部位 */
  boundPart: string[] | null
  /** 可獨立取得：特性/8級/通用 = true；副模組 = false */
  available?: boolean
  dmg: number
  crit_rate: number
  critDmg: number
  acc_rate: number
  firepower_rate: number
  armor_rate: number
  crit_resist_rate: number
  output_bonus: number
  dodge_rate: number
  durable_rate: number
  dmg_resist_rate: number
  // 武器類別增傷
  dmg_assault?: number
  dmg_melee?: number
  dmg_shooting?: number
  dmg_tactical?: number
  // 武器種類增傷
  dmg_blade?: number
  dmg_polearm?: number
  dmg_missile?: number
  dmg_rocket?: number
  dmg_shotgun?: number
  dmg_machinegun?: number
  dmg_heavy_machinegun?: number
  dmg_railgun?: number
  dmg_funnel?: number
  dmg_sniper_light?: number
  dmg_sniper?: number
  dmg_fist?: number
  dmg_pile?: number
  dmg_chainsaw?: number
  dmg_flamethrower?: number
  // 特殊情境增傷
  dmg_counter?: number
  dmg_enemy_phase?: number
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  /**
   * 此模組可賦予的 buff ID 列表（PLAN-019 Layer 2）。
   * 模擬器以此建立反向索引：可用 buff = 當前配裝所有實體 buffIds[] 的聯集。
   */
  buffIds?: string[]
  /** ModuleRarity enum：'S' / 'A' */
  rarity: string
  /** 本地圖示路徑 /images/modules/{iconKey}.png */
  icon?: string
  /** 遊戲取得途徑（可複數）：ModuleSource enum 陣列（'商店'/'拆機甲'/'未知'） */
  source?: string[]
  /** 拆解可得此模組的機甲 ID 列表（對應 mechs collection）；僅 source 含 '拆機甲' 時有意義 */
  dismantleMechIds?: string[]
  /** 後台資料維護標記：ModuleDataSource enum（'auto'='腳本自動擷取' / 'manual'='管理者手動新增'） */
  managedBy?: string
  /** 各等級資料（特性/8級/通用模組有；副模組為空陣列） */
  levels?: ModuleLevel[]
  /** 條件效果（傷害模擬器用；無條件效果或副模組為空陣列） */
  conditionalEffects?: ConditionalEffect[]
  /** 模組增加等級（配裝時在插槽中增加的模組等級，預設 1；配裝模擬器累加所有嵌入模組的此值） */
  moduleAddLevel?: number
}
