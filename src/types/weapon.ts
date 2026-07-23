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

/**
 * 武器製作／進階關係（PLAN-031）。有值 = 此武器由 fromWeaponId 製作而來。
 * 只存「事實」，不存 UI 顯示決策，也不存任何可推導值。
 *
 * ⚠ upgrade 不改變本武器的儲存集合、doc id 或 refType —— 複合武器（裁決者等）
 *   在官方介面歸類為「特種背包製作」，但資料形狀是武器，故仍存於 weapons、refType 仍為 'weapon'，
 *   官方介面歸類改由本欄位 station 這類正交欄位表達（跨界實體判準）。
 *
 * 刻意不加的可推導值：
 *   - upgradeTo（反向索引由 buildUpgradeIndex 前端 derive；雙向欄位失同步無機制可察）
 *   - fusedSkillName（＝子武器 skills − 母武器 skills 差集，前端 derive）
 *   - fusedBackpackType（由 fusedBackpackId 查 backpacks 取得）
 *   - isComposite（＝ station === 'specialBackpack'）
 *
 * 材料擴充點（現在不建欄位，0/5 定律）：未來的
 *   materials?: { itemId: string; qty: number }[] 屬於本型別（邊的屬性，非武器的屬性）。
 *   前置條件：items 集合與武裝討伐掉落資料，兩者皆尚未存在。
 */
export interface WeaponUpgrade {
  /** 母武器 doc id（必填 —— 實測 42 條邊皆有母武器） */
  fromWeaponId: string
  /** 官方製作工作台。未填 = 一般武裝生產；'specialBackpack' = 特種背包製作（複合武器） */
  station?: 'specialBackpack'
  /**
   * 融合進來的背包 doc id（複合武器專用），如 '60102405'。
   * ⚠ 此為實機確認的事實值，不可由武器 buffId 推定 ——
   *   實測融合技能 buffId 600433 由多個背包共用，且確認正解 60102405 反而不含該 buffId。
   */
  fusedBackpackId?: string
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
  /** 製作／進階關係（PLAN-031）。有值 = 由 upgrade.fromWeaponId 製作而來；不影響本武器的儲存集合／refType。 */
  upgrade?: WeaponUpgrade
}
