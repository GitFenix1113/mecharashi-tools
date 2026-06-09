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
}
