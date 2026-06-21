// ─── 技能 / Buff 共用型別（PLAN-001）────────────────────────────────────────

import type { DescriptionRefs } from './common'

/**
 * 武器技能的武器需求。
 * logic='or'  → categories 中任一種武器即可觸發
 * logic='and' → 必須同時持有 categories 中所有武器（通常為雙持同種）
 * logic='dual'→ 雙持：leftHand / rightHand 各自指定武器種類（null = 任意）
 */
export interface WeaponRequirement {
  logic: 'or' | 'and' | 'dual'
  /** logic='or'/'and' 時：武器種類列表 */
  categories?: string[]
  /** logic='dual' 時：左手武器種類；null 表示任意 */
  leftHand?: string | null
  /** logic='dual' 時：右手武器種類；null 表示任意 */
  rightHand?: string | null
}

/** 將 WeaponRequirement 格式化為顯示用字串（向後相容 string 型別） */
export function formatWeaponReq(weapon: WeaponRequirement | string | undefined): string {
  if (!weapon) return ''
  if (typeof weapon === 'string') return weapon
  if (weapon.logic === 'dual') {
    const l = weapon.leftHand ?? '任意'
    const r = weapon.rightHand ?? '任意'
    return `雙持 左:${l} 右:${r}`
  }
  const sep = weapon.logic === 'and' ? ' + ' : ' / '
  return (weapon.categories ?? []).join(sep)
}

/** 觸發條件（顯示給玩家的說明標籤，計算器不自動判斷） */
export interface SkillCondition {
  trigger:      string
  weaponType?:  string
  weaponKind?:  string
  hpThreshold?: number
  minApCost?:   number
  targetClass?: string
  /** trigger='hasBuff' 時：需持有的 buff / 狀態名稱（如 '強化射擊'、'瞄準'） */
  hasBuff?:     string
}

/** 單一可計算效果條目 */
export interface SkillEffect {
  /** 影響屬性，與 Module 平坦欄位名稱對齊：
   *  'dmg' | 'crit' | 'critDmg' | 'acc'
   *  'dmg_assault' | 'dmg_melee' | 'dmg_shooting' | 'dmg_tactical'
   *  'dmg_blade' | 'dmg_machinegun' | ... (武器種類，同 Module)
   *  'range' | 'armor_rate' | 'firepower_rate' | ... (其他屬性) */
  stat:        string
  value:       number
  /** 數值計算方式：'add'（預設，加算）/ 'override'（覆蓋原始值，如係數 0.15→0.2） */
  valueType?:  'add' | 'override'
  scope:       string
  condition:   SkillCondition | null
}

/**
 * 階梯 buff 的單一等級能力（PLAN-024）。
 * 比照 ModuleLevel：結構型（凝勢）各級 maxStack/effects 不同 → 填滿；
 * 數值型（傷害提升）各級只差數值 → 多半只填 level + effects。
 * level 是「靜態強度階」（來源決定掛哪級），與執行期的 stack（疊加層數）為兩個維度。
 */
export interface BuffLevel {
  /** 等級序號 1,2,3…（對應原羅馬尾碼） */
  level:        number
  /** 該級描述（選填；可被滿星 / 算力變體引用） */
  description?: string
  descriptionRefs?: DescriptionRefs
  /** 結構型各級不同（凝勢 5/7/7）；數值型通常不填 */
  maxStack?:    number
  duration?:    number
  /** 數值型各級的數值（傷害提升 5%/10%…）；模擬加總 */
  effects?:     SkillEffect[]
  /** 該級專屬圖示（選填；不填沿用 buff.icon） */
  icon?:        string
}

/** buffs Collection 文件 */
export interface GameBuff {
  id:          string
  name:        string
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1）；buff 也可引用其他 buff */
  descriptionRefs?: DescriptionRefs
  icon?:       string
  buffType:    string
  maxStack?:   number
  duration?:   number
  /**
   * 互斥群組（PLAN-019 Layer 2）：同 group 的形態/狀態一次只能存在一個。
   * 例：虛粒子形態 ⟷ 實粒子形態，填同一個 group key（如 '<pilotId>_forms'）。
   */
  mutexGroup?: string
  effects:     SkillEffect[]
  /**
   * 階梯 buff 各等級能力（PLAN-024）。無 = 普通 buff，沿用上方頂層欄位、行為不變。
   * 有 levels：各級 maxStack/effects 由此提供；同 buff 不同 level 天然互斥（取最高），取代 mutexGroup。
   * 數值引用以 <id.lvN.attr> 指定級；buffIds 以 id@N 賦予指定級。
   */
  levels?:     BuffLevel[]
  /**
   * 掛載 glossaryTerm 文件 ID（PLAN-024）。填了則詳情卡改以該詞條的官方關鍵字說明為顯示來源，
   * 取代本 buff 的 description（單一真相源，避免未來技能庫重複貼同一段關鍵字說明）。
   * 目前無計算意義，純為顯示/技能資料庫鋪路。
   */
  termRef?:    string
}
