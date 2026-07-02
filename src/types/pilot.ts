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

/**
 * 神經驅動算力改寫變體（PLAN-021）。
 * 當神經驅動算力跨過 minSum 門檻，遊戲把天賦正文就地改寫（引用更高階 buff、層數/數值變動）。
 * 以 minSum 鬆耦合到 NeuralDriveLevel.minSum；本變體 descriptionRefs 與天賦 descriptionRefs 合併解析。
 * 多階互斥、計算器取最高（對應的 buff 共用 GameBuff.mutexGroup）。
 */
export interface TalentNdVariant {
  /** 算力門檻（對應 NeuralDriveLevel.minSum） */
  minSum: number
  /**
   * 門檻所屬的神經驅動分區名（對應 NeuralDrive.name，如 'γ2'）。
   * 同機師多區可能有相同 minSum（艾達 γ1/γ2 各有 10/13），缺 zone 會歧義。
   */
  zone?: string
  /** 顯示用標籤；省略時前端以 zone+minSum 生成「γ2 算力 ≥ N」 */
  label?: string
  /** 改寫後天賦正文（token 用該階 buff 名，如 [凝勢III]） */
  description: string
  /**
   * 滿星版改寫正文（= talent.descriptionMax 被此算力階改寫後的樣子，含滿星專屬子句）。
   * 省略時前台退回顯示 description 並提示待補。
   */
  descriptionMax?: string
  /** 此正文的 [xxx]→buff 對照；與天賦 descriptionRefs 合併後解析 */
  descriptionRefs?: DescriptionRefs
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
  /** 神經驅動算力改寫變體（PLAN-021）；建議依 minSum 升序排列 */
  ndVariants?:      TalentNdVariant[]
  /**
   * 手動修正過的天賦正文（PLAN-021）。官方 API 的天賦正文可能是「滿晶片狀態」文本
   * （艾達案例：7層/5AP/星爆 皆為 γ2≥16 才有的值），人工去污染後設 true，
   * 爬蟲補丁模式不再覆寫 description / descriptionMax。語意比照 PilotSkill.manual。
   */
  manual?:          boolean
}

/**
 * 神經驅動能力（PLAN-023）。從各機師 Pilot.neuralDrive[].levels[] 抽出去重的共用／專屬能力，
 * 以能力名為鍵（id: nd_<能力名 slug>）。分區 level 以 abilityId 引用本實體（單一資料源，
 * 共用能力改一次全機師生效）。zone / minSum / slots（門檻、所屬分區、插槽）仍留在
 * Pilot.neuralDrive，屬「機師如何取得此能力」的資訊，與能力本身解耦。
 * 結構比照 pilotSkills（PLAN-004）：collection + ID 引用 + resolve 雙格式。
 */
export interface NeuralDriveAbility {
  /** 文件 ID：nd_<能力名 slug> */
  id: string
  /** 能力名（= NeuralDriveLevel.skillName） */
  name: string
  /** 能力效果描述（= NeuralDriveLevel.effect） */
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1；本計畫 N2-1 接線 RefText） */
  descriptionRefs?: DescriptionRefs
  /** 圖示（= NeuralDriveLevel.skillIcon / iconLocal） */
  icon?: string
  iconLocal?: string
  /** 可計算效果（模擬器用；多數待後台 NeuralDriveAdmin 補填） */
  effects: SkillEffect[]
  /** 賦予的 buff（id 或 id@N，比照技能／天賦） */
  buffIds: string[]
}

export interface NeuralDriveLevel {
  level: number
  minSum: number
  /**
   * PLAN-023 雙格式過渡：填了則本級能力內容改由 neuralDriveAbilities 集合的此 ID 提供
   * （單一資料源），以 resolveNeuralDriveAbilities() 解析；未填＝沿用下方嵌入欄位（舊格式）。
   * 嵌入欄位待 resolve 層（N1-4）與 PilotDetail 改寫（N1-5）就緒後才轉選填，供 flip（N1-6）寫最小 level。
   */
  abilityId?: string
  effect: string
  skillName: string
  skillIcon: string
  iconLocal: string
  effects: SkillEffect[]
  buffIds: string[]
  /** 描述內 [xxx] 引用側錄（PLAN-023 N2-1）；flip 後由 resolve 從 NeuralDriveAbility 帶入。 */
  descriptionRefs?: DescriptionRefs
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
  /**
   * 管理者手動新增的機師（PLAN-025：官方資料更新前由後台自建）。
   * true = 後台手動建立，爬蟲補丁模式（scrape-pilots-v3.js）整筆跳過、不覆寫或刪除；
   * 純作後端防覆寫用途，前台不因此顯示任何標記。語意比照 PilotSkill.manual / PilotTalent.manual。
   */
  manual?: boolean
}
