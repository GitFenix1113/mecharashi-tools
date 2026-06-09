// ─── 機師個別科研（v1.1 新增）────────────────────────────────────────────────

export interface ResearchTraitOption {
  name: string
  description: string
  dmg: number
  crit: number
  critDmg: number
  acc: number
}

export interface ResearchTraitSlot {
  slot: number
  options: ResearchTraitOption[]
}

export interface ExclusionRule {
  slotA: number
  optionA: string
  slotB: number
  optionB: string
}

export interface PilotResearch {
  pilotId: string
  /** 機師特質 (I/II/III 欄位各有多個選項，選其一安裝) */
  pilotTraits: ResearchTraitSlot[]
  /** 機甲特質 (I/II/III) */
  mechTraits: ResearchTraitSlot[]
  /** 武裝特質 (I/II/III) */
  weaponTraits: ResearchTraitSlot[]
  exclusionRules: ExclusionRule[]
}

// ─── 全域科研（v1.1 新增）────────────────────────────────────────────────────

export interface ClassResearchBonus {
  flatBonus: Record<string, number>
  percentBonus: Record<string, number>
}

export interface MechTypeResearchBonus {
  flatBonus: Record<string, number>
  percentBonus: Record<string, number>
}

export interface WeaponTypeResearchBonus {
  bonus: Record<string, number>
}

export interface GlobalResearch {
  /** 機師科研：依職業分類 */
  pilotResearchByClass: Record<string, ClassResearchBonus>
  /** 機甲科研：依裝甲類型分類 */
  mechResearchByType: Record<string, MechTypeResearchBonus>
  /** 武器科研：依武器種類分類 */
  weaponResearchByType: Record<string, WeaponTypeResearchBonus>
}

// ─── 用戶科研完成度（Phase 5；UserProfile.researchLevels 用） ───────────────────

export interface UserResearchLevels {
  /** 機師科研完成度：{ 職業名: 0-100 (%) } */
  pilotByClass: Record<string, number>
  /** 機甲科研完成度：{ 裝甲類型: 0-100 (%) } */
  mechByType: Record<string, number>
  /** 武器科研完成度：{ 武器種類: 0-100 (%) } */
  weaponByType: Record<string, number>
}
