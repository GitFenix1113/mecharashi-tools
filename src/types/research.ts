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
  /** 職業名（PilotClass 值域）。⚠ 實測只有 6 個職業，**沒有調構師** —— 海莉絲查不到加成 */
  className: string
  flatBonus: Record<string, number>
  percentBonus: Record<string, number>
}

export interface MechTypeResearchBonus {
  /**
   * ⚠ 這裡的值域是 **`'輕型' | '中型' | '重型'`**（官方科研頁的用詞，與 `MechLicense` 同），
   *   而 `Mech.armorType` 是 **`'輕型' | '中甲' | '重型'`**（`ArmorType`）。中階不同名。
   *   直接 `find(x => x.armorType === mech.armorType)` 會讓 36/90 台中甲**靜默拿 0**。
   *   一律走 `findMechResearch()`（src/utils/normalizeArmorType.ts），不要自己比對。
   */
  armorType: string
  flatBonus: Record<string, number>
  percentBonus: Record<string, number>
}

export interface WeaponTypeResearchBonus {
  /** 武器種類（WeaponKind 值域）。實測 5 種：狙擊步槍／機槍／重機槍／刀劍／拳套 */
  weaponType: string
  bonus: Record<string, number>
}

/**
 * 全域科研加成表（`globalResearch/global` 單一文件）。
 *
 * ⚠ 三個欄位都是 **`Array`，不是 `Record`**（PLAN-052-A D-2 修正）。
 *   型別原本宣告成 `Record<string, …>`，於是 `gr.pilotResearchByClass['格鬥家']`
 *   **恆為 undefined**，而 tsc 完全不會抱怨——索引一個 Record 本來就允許查無。
 *   線上資料從第一天就是 Array（元素帶 className / armorType / weaponType 判別欄位）。
 *
 * ⚠ **這個集合不可刪。** 兩份盤點曾誤判它為「零消費端可移除」——它是全庫唯一填滿的
 *   公式數值表（六職業／三裝甲／五武器種類全有值），對照全庫 `SkillEffect` 是
 *   0/225 buffs、0/841 skills。今天沒有消費端只代表傷害模擬還沒做。
 */
export interface GlobalResearch {
  /** 機師科研：依職業分類 */
  pilotResearchByClass: ClassResearchBonus[]
  /** 機甲科研：依裝甲類型分類 */
  mechResearchByType: MechTypeResearchBonus[]
  /** 武器科研：依武器種類分類 */
  weaponResearchByType: WeaponTypeResearchBonus[]
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
