// ─── 元件（v1.3 更新）────────────────────────────────────────────────────────

import type { DescriptionRefs } from './common'

/**
 * 元件的 BOSS 掉落關卡（PLAN-025：由靜態 bossDrops.ts 移入 Firestore 各元件文件，後台可編輯）
 * 圖片路徑規則：/images/components/Stage{stage}_Boss/character_{stage}_{bossNum}.png
 */
export interface StageDrop {
  /** 關卡編號 */
  stage: number
  /** 該關可掉落此元件的 BOSS 編號（1 起算） */
  bosses: number[]
}

export interface ComponentBase {
  id: string
  name: string
  moduleSubtype: number        // 1–11，對應 ModuleSubtype enum
  probabilityLevel: number     // 對應 WIKI ProbabilityLevel
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  allowedWeaponTypes: string[] // WeaponType[]，預設全給
  rarity: string               // ItemRarity
  icon?: string                // 技能圖示 key（如 "Icon_skill_passive_5223"）
  iconLocal?: string           // 技能圖示本機路徑（"/images/components/..."）
  outerFrameLocal?: string     // 外框圖本機路徑（"/images/components/OuterFrame/..."）
  componentsWType: 'W' | 'Normal'
  /** BOSS 掉落來源關卡（可空；PLAN-025 移入 Firestore，後台可編輯） */
  dropStages?: StageDrop[]
}

export interface ConditionComponent extends ComponentBase {
  componentType: 'Condition'
  conditionType: 'dualWield' | 'singleWield' | 'firstAttack' | 'apCost' | 'targetTorso' | 'always'
  condition: string            // 觸發條件描述文字
}

export interface FunctionComponent extends ComponentBase {
  componentType: 'Function'
  effectType: 'dmgBoost' | 'bulletAdd' | 'multiplierBoost' | 'armorBreak' | 'apDmgBoost' | 'torsoDmgBoost'
}

export type Component = ConditionComponent | FunctionComponent

/** @deprecated 舊命名，保留型別別名避免一次性重構負擔 */
export type TriggerComponent = ConditionComponent
/** @deprecated 舊命名，保留型別別名避免一次性重構負擔 */
export type EffectComponent = FunctionComponent
