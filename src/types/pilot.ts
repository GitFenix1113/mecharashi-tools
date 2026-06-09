// ─── 機師 ──────────────────────────────────────────────────────────────────

import type { DescriptionRefs } from './common'
import type { WeaponRequirement, SkillEffect } from './buff'

export interface PilotStats {
  melee: number
  assault: number
  shooting: number
  tactics: number
  defense: number
  engineering: number
}

export interface PilotSkill {
  name: string
  /** SkillType enum：被動技能 / 主動技能 / 指令技能 / 必殺技能 / 武器技能 */
  type: string
  /** biometicComputer 單元類型："0"=核心單元 "6"=職業單元 */
  unitType?: string
  ap?: string
  /** 冷卻回合數；指令技能（type=指令技能）才有 */
  cd?: string
  /** 限定武器需求；武器技能（type=武器技能）才有 */
  weapon?: WeaponRequirement | string
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  icon: string
  iconLocal: string
  effects:  SkillEffect[]
  buffIds:  string[]
  /**
   * 管理者手動新增的技能（PLAN：機師天生自帶、官網查無的技能）。
   * true = 後台手動建立，name/description 等欄位可在後台編輯；爬蟲補丁模式不會覆寫或刪除。
   * 未設定 / false = 由爬蟲腳本管理，後台僅能編輯 effects / buffIds。
   */
  manual?: boolean
}

/** 條件變體子技能（萬序擬合等：依形態/武器決定發動哪個）；PLAN-019 模擬層預留，暫不填 */
export interface SkillVariant {
  /** 觸發條件描述（如 "先鋒形態"）；未來可結構化 */
  condition: string
  /** 此變體引用的技能 refId（skill_xxx） */
  skillRefIds?: string[]
  description?: string
  effects?: SkillEffect[]
}

/** 技能作用範圍/形狀（龍雷拳：面前 3×4 格）；PLAN-019 模擬層預留，暫不填 */
export interface SkillArea {
  /** 形狀描述，如 "面前3×4格" */
  shape?: string
  rows?: number
  cols?: number
}

/**
 * pilotSkills 集合的技能文件（PLAN-004 技能庫抽離）。
 * 欄位與嵌入用 PilotSkill 相同，另有頂層 id；可被描述中的 [xxx] 引用（refType:'skill'）。
 * id 格式：skill_<技能名>，同名不同效時加 _<pilotId> 後綴。
 */
export interface PilotSkillDoc {
  id: string
  name: string
  /** SkillType enum：被動技能 / 主動技能 / 指令技能 / 必殺技能 / 武器技能 */
  type: string
  /** biometicComputer 單元類型："0"=核心單元 "6"=職業單元 */
  unitType?: string
  ap?: string
  /** 冷卻回合數；指令技能才有 */
  cd?: string
  /** 限定武器需求；武器技能才有 */
  weapon?: WeaponRequirement | string
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  icon: string
  iconLocal: string
  effects: SkillEffect[]
  buffIds: string[]
  /** 管理者手動新增的技能；爬蟲補丁模式不會覆寫或刪除。詳見 PilotSkill.manual */
  manual?: boolean
  /** 模擬層預留：條件變體（萬序擬合）；暫不填 */
  variants?: SkillVariant[]
  /** 模擬層預留：作用範圍（龍雷拳）；暫不填 */
  area?: SkillArea
}

export interface PilotTalent {
  name: string
  type: string
  description: string
  descriptionMax: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1）；適用 description 與 descriptionMax */
  descriptionRefs?: DescriptionRefs
  icon: string
  iconLocal: string
  effects:          SkillEffect[]
  enhancedEffects?: SkillEffect[]
  buffIds:          string[]
}

export interface NeuralDriveLevel {
  level: number
  minSum: number
  effect: string
  skillName: string
  skillIcon: string
  iconLocal: string
  effects: SkillEffect[]
  buffIds: string[]
}

export interface NeuralDrive {
  name: string
  icon: string
  slots: string[]
  levels: NeuralDriveLevel[]
}

export interface Pilot {
  id: string
  name: string
  fullName: string
  rarity: string
  class: string
  faction: string
  license: string
  masterLevel: string
  profile: {
    gender: string
    bloodType: string
    height: string
    additionalInfo: Record<string, string>
  }
  stats: PilotStats
  statsBase: Record<string, number>
  ap: { init: number; max: number; recovery: number }
  apBase: { init: number; max: number; recovery: number }
  talents: PilotTalent[]
  /**
   * PLAN-004 過渡型別：技能可能是嵌入物件（舊格式）或 pilotSkills 集合的 ID 字串（新格式／單一資料源）。
   * 以 resolvePilotSkills() 解析；遷移與爬蟲改寫完成後可收斂為 string[]。
   */
  skills: (string | PilotSkill)[]
  neuralDrive: NeuralDrive[]
  portrait: string
  portraitUrl?: string
  lore?: string
  attack?: number
  defense?: number
}
