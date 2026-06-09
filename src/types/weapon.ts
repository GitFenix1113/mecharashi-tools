// ─── 武器 ──────────────────────────────────────────────────────────────────

import type { DescriptionRefs } from './common'
import type { SkillEffect } from './buff'

export interface WeaponSkill {
  name: string
  /** 技能圖示遠端 URL（API 原始路徑） */
  icon?: string
  /** 技能圖示本地路徑（如 /images/weapons/skills/Icon_skill_xxxxx.png）；前端縮圖顯示用 */
  iconLocal?: string
  type: string
  /** 生效方式："carry" 攜帶即生效 / "equip" 裝備中生效 / "use" 僅使用時生效 */
  activation: 'carry' | 'equip' | 'use'
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?:            DescriptionRefs
  effects:                     SkillEffect[]
  buffIds:                     string[]
  enhancesTalentName?:         string
  /** 天賦被此專武強化後的完整描述文字（遊戲原文）；用於與天賦原文做 DiffHighlight 差異對比 */
  enhancedTalentDescription?:  string
}

export interface WeaponFixedModEffect {
  stat: 'attack' | 'crit' | 'accuracy' | string
  value: number
}

export interface WeaponFloatingModEffect {
  stat: 'attack' | 'crit' | 'accuracy' | 'firepower' | string
  condition: string | null
  min: number
  max: number
}

export interface Weapon {
  id: string
  name: string
  /** 武器背景故事文字（API: describe） */
  description?: string
  /** 武器圖示本地路徑，如 /images/weapons/Icon_weapon_10001.png */
  icon?: string
  type:            string  // WeaponType：射擊 / 格鬥 / 突擊 / 戰術
  kind:            string  // 武器種類：機槍 / 狙擊步槍 / 刀劍…
  kindCoefficient: number
  attack: number           // API: WeaponBasicAttackingPower
  accuracy: number         // API: WeaponHitPoint（命中）
  critValue: number        // API: WeaponUnderstanding（暴擊值）
  rangeType:  string  // RangeType：'manhattan' | 'orthogonal' | 'ring'
  minRange:   number
  maxRange:   number
  weight: number      // API: WeaponWeight（重量）
  ammoCount: number
  hitCount: number
  rarity: string  // WeaponRarity：'SS' | 'S+' | 'S' | 'A' | 'B'
  mechRestriction: string  // MechRestriction：'none' | 'light' | 'medium' | 'heavy' · API: LimitedModelOfWeapon
  equipSlot: string        // WeaponEquipSlot：singleHand / dualHand / shoulder / back · API: RestrictionsPositionOfWeapon
  isExclusive: boolean
  exclusiveFor?: string
  triggerSlots: number
  effectSlots: number
  /** 元件上限：觸元件＋應元件總數不可超過此值（SS/S+=4, S=3, 其他=0） */
  componentLimit: number
  fixedMod: {
    planName: string
    maxLevel: number
    effects: WeaponFixedModEffect[]
  }
  floatingMod: {
    planName: string
    slots: number
    possibleEffects: WeaponFloatingModEffect[]
  }
  skills: WeaponSkill[]    // API: PassiveSkill[]
}
