// ─── BOSS / 關卡（PLAN-019 Layer 3）──────────────────────────────────────────

import type { DescriptionRefs } from './common'
import type { SkillEffect } from './buff'

/** BOSS 技能（複用 SkillEffect 與引用層） */
export interface BossSkill {
  name: string
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  effects?: SkillEffect[]
  icon?: string
}

/** bosses Collection 文件 */
export interface Boss {
  id: string
  name: string
  icon?: string
  portrait?: string
  /** 複用 ArmorType enum 值（輕型 / 中甲 / 重型） */
  armorType?: string
  /** 各部件耐久 / 裝甲（複用 MechPart 概念，僅取數值面） */
  parts?: Partial<Record<'torso' | 'leftArm' | 'rightArm' | 'legs', { durable: number; armor: number }>>
  skills: BossSkill[]
  description?: string
  descriptionRefs?: DescriptionRefs
  /** 弱點標籤 */
  weakness?: string[]
  /** 後台資料維護標記（複用 Module.managedBy 慣例） */
  managedBy?: string
  updatedBy?: string
  updatedAt?: string
}

/** 關卡掉落條目（取代 src/data/bossDrops.ts 的靜態索引） */
export interface StageDropEntry {
  /** → components Collection 的元件 ID */
  componentId?: string
  /** 掉落該物的 BOSS 在 bossIds 中的索引（對應遊戲關卡第幾個 BOSS） */
  bossIndex?: number
  note?: string
}

/** stages Collection 文件（高難度關卡） */
export interface Stage {
  id: string
  name: string
  /** StageCategory enum：危境 / 深淵 / 活動… */
  category: string
  recommendedPower?: number
  /** → bosses Collection */
  bossIds: string[]
  /** 關卡機制文字 */
  mechanics?: string
  /** 機制文字內的 [xxx] 引用側錄（PLAN-019 Layer 1） */
  mechanicsRefs?: DescriptionRefs
  /** 掉落表（取代 bossDrops.ts） */
  drops?: StageDropEntry[]
  /** → guides Collection（PLAN-010 攻略） */
  guideIds?: string[]
  managedBy?: string
  updatedBy?: string
  updatedAt?: string
}
