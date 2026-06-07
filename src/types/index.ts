// ─── 實體引用層（PLAN-019 Layer 1）──────────────────────────────────────────

/** 可被引用的實體類型。'stat' 指向屬性 key（如 'dmg'）；'term' 指向 glossaryTerms 詞條 */
export type RefType =
  | 'buff' | 'skill' | 'pilot' | 'mech' | 'weapon'
  | 'module' | 'backpack' | 'component' | 'stat' | 'term'

/**
 * 對另一個實體的型別化、可解析引用。
 * 用於 description 內 [xxx] 詞條，以及 BOSS 機制文字等跨實體連結。
 */
export interface EntityRef {
  refType: RefType
  /** 目標 ID：buffs/{id}、pilots/{id}、glossaryTerms/{id}，或 stat key 如 'dmg' */
  refId: string
  /** 顯示文字；預設取目標 name，可覆寫（原文用別名時） */
  label?: string
}

/**
 * description 內 [xxx] 標記 → 對應實體的側錄表。
 * key = 括號內文字（如 "虛粒子形態"）；顯示層據此把 [xxx] 渲染為可點擊引用。
 * 未命中的 [xxx] 原樣顯示，向後相容、優雅降級。
 */
export type DescriptionRefs = Record<string, EntityRef>

/**
 * 詞條庫文件（PLAN-019-C）。
 * 收「無專屬集合可放」的機制關鍵字（如 固定傷害 / 啟動 / 形態增益），
 * 作為 refType:'term' 引用的資料源。被任意 description 內的 [xxx] 引用。
 */
export interface GlossaryTerm {
  /** 文件 ID。格式 term_<名稱>（與 skill_/buff_ 一致） */
  id: string
  /** 詞條名稱（= [xxx] 內文字） */
  name: string
  /** 機制分類（傷害 / 狀態 / 資源 / 通用…）；自由字串 */
  category?: string
  /** 詞條解釋文字（可含 [xxx] 標記） */
  description: string
  /** 解釋內 [xxx] → 實體引用側錄（解釋本身也能再引用） */
  descriptionRefs?: DescriptionRefs
  /** 同義詞：別名 [xxx] 對應同一詞條 */
  aliases?: string[]
  /** 選填圖示（遠端 URL 或本地 /images/…） */
  icon?: string
}

// ─── 技能 / Buff 共用型別（PLAN-001）────────────────────────────────────────

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

// ─── 機師 ──────────────────────────────────────────────────────────────────

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

// ─── 模組（v1.9 更新：欄位重命名 + 新增防禦/機體屬性欄位）─────────────────────

export interface ConditionalEffect {
  /** ConditionalTrigger enum value */
  trigger: string
  /** 觸發門檻值（apSkill 時為最低 AP 數） */
  minCount?: number
  /** 受影響的屬性欄位名稱，對應 Module 頂層欄位 */
  stats: string[]
  base?: number
  scale?: number
  max?: number
  maxStacks?: number
  /** null / 未設定 = 永久 */
  duration?: number
  resetOn?: 'attack' | 'turn' | null
}

export interface ModuleLevel {
  level: number
  description: string
  dmg: number
  crit_rate: number
  critDmg: number
  acc_rate: number
  firepower_rate: number
  armor_rate: number
  crit_resist_rate: number
  output_bonus: number
  dodge_rate: number
  durable_rate: number
  dmg_resist_rate: number
  // 武器類別增傷
  dmg_assault?: number
  dmg_melee?: number
  dmg_shooting?: number
  dmg_tactical?: number
  // 武器種類增傷
  dmg_blade?: number
  dmg_polearm?: number
  dmg_missile?: number
  dmg_rocket?: number
  dmg_shotgun?: number
  dmg_machinegun?: number
  dmg_heavy_machinegun?: number
  dmg_railgun?: number
  dmg_funnel?: number
  dmg_sniper_light?: number
  dmg_sniper?: number
  dmg_fist?: number
  dmg_pile?: number
  dmg_chainsaw?: number
  dmg_flamethrower?: number
  // 特殊情境增傷
  dmg_counter?: number
  dmg_enemy_phase?: number
}

export interface Module {
  id: string
  name: string
  /** 模組槽位：使用 ModuleSlot enum 值（'機甲特性模組'/'機甲8級模組'/'通用模組'/'機甲副模組'/'機甲專屬模組'） */
  slot: string
  /** 綁定機甲 ID；null = 通用模組（可自由裝配） */
  boundMechId: string | null
  /** 綁定部位（陣列，v2.2 改為複數）；MechPartPosition enum 值組成的陣列；null 或 [] = 不限部位 */
  boundPart: string[] | null
  /** 可獨立取得：特性/8級/通用 = true；副模組 = false */
  available?: boolean
  dmg: number
  crit_rate: number
  critDmg: number
  acc_rate: number
  firepower_rate: number
  armor_rate: number
  crit_resist_rate: number
  output_bonus: number
  dodge_rate: number
  durable_rate: number
  dmg_resist_rate: number
  // 武器類別增傷
  dmg_assault?: number
  dmg_melee?: number
  dmg_shooting?: number
  dmg_tactical?: number
  // 武器種類增傷
  dmg_blade?: number
  dmg_polearm?: number
  dmg_missile?: number
  dmg_rocket?: number
  dmg_shotgun?: number
  dmg_machinegun?: number
  dmg_heavy_machinegun?: number
  dmg_railgun?: number
  dmg_funnel?: number
  dmg_sniper_light?: number
  dmg_sniper?: number
  dmg_fist?: number
  dmg_pile?: number
  dmg_chainsaw?: number
  dmg_flamethrower?: number
  // 特殊情境增傷
  dmg_counter?: number
  dmg_enemy_phase?: number
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  /**
   * 此模組可賦予的 buff ID 列表（PLAN-019 Layer 2）。
   * 模擬器以此建立反向索引：可用 buff = 當前配裝所有實體 buffIds[] 的聯集。
   */
  buffIds?: string[]
  /** ModuleRarity enum：'S' / 'A' */
  rarity: string
  /** 本地圖示路徑 /images/modules/{iconKey}.png */
  icon?: string
  /** 遊戲取得途徑（可複數）：ModuleSource enum 陣列（'商店'/'拆機甲'/'未知'） */
  source?: string[]
  /** 拆解可得此模組的機甲 ID 列表（對應 mechs collection）；僅 source 含 '拆機甲' 時有意義 */
  dismantleMechIds?: string[]
  /** 後台資料維護標記：ModuleDataSource enum（'auto'='腳本自動擷取' / 'manual'='管理者手動新增'） */
  managedBy?: string
  /** 各等級資料（特性/8級/通用模組有；副模組為空陣列） */
  levels?: ModuleLevel[]
  /** 條件效果（傷害模擬器用；無條件效果或副模組為空陣列） */
  conditionalEffects?: ConditionalEffect[]
  /** 模組增加等級（配裝時在插槽中增加的模組等級，預設 1；配裝模擬器累加所有嵌入模組的此值） */
  moduleAddLevel?: number
}

// ─── 機甲部件（v1.4 新增：獨立部件資料）──────────────────────────────────────

export interface MechPart {
  position: 'torso' | 'leftArm' | 'rightArm' | 'legs'
  durable: number
  armor: number
  firepower: number
  /** 命中（僅左右臂有） */
  hit?: number
  /** 閃避（僅腿部有） */
  dodge?: number
  /** 移動力（僅腿部有） */
  move?: number
  /** 抗暴（僅軀幹有） */
  antiRiot?: number
  /** 出力（僅軀幹有） */
  output?: number
  weight: number
  interface: string
  /** 部件圖示路徑 /images/mechs/{機甲名}/{position}.png */
  icon?: string
  /** 遊戲內部資產名（用於 CDN waparts/ 路徑） */
  mechaIcon?: string
}

// ─── 機甲（v1.4 更新：部件詳細資料 + 模組映射）──────────────────────────────

export interface Mech {
  id: string
  name: string
  armorType: string
  firepower: number
  armor: number
  evasion: number
  mobility: number
  weight: number
  output: number
  /** 各部件詳細資料 */
  parts: {
    torso: MechPart
    leftArm: MechPart
    rightArm: MechPart
    legs: MechPart
  }
  /** → modules.json 四格模組 ID；無特性模組的機甲可省略 */
  module4Id?: string
  /** → modules.json 八格模組 ID；無8級模組的機甲可省略 */
  module8Id?: string
  /** → modules.json 固定模組 ID 列表（多數機甲1個，特殊機甲可有多個） */
  moduleFixedIds: string[]
  /**
   * 肩膀武器欄位（有肩膀武器槽的機甲才有此欄位）
   * null = 空槽（可自由裝備肩膀武器）
   * string = 固定武器 ID（部件綁死，不可更換）
   */
  leftShoulderSlot?: string | null
  rightShoulderSlot?: string | null
  /**
   * 背後武器欄位（有背後武器槽的機甲才有此欄位）
   * null = 空槽，string = 固定武器 ID
   */
  backSlot?: string | null
  portrait?: string
  /** 立繪半身像路徑 */
  halfPortrait?: string
  quality?: string
  lore?: string
}

/** 舊版部件耐久（向後相容） */
export interface MechPartsLegacy {
  torso: number
  leftArm: number
  rightArm: number
  legs: number
}

// ─── 武器 ──────────────────────────────────────────────────────────────────

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

// ─── 背包 ──────────────────────────────────────────────────────────────────

export interface Backpack {
  id: string
  name: string
  /** 背包圖示 URL · https://media.zlongame.com/media/pictures/cn/community/img/gl/gameInfo/pack/Icon_backpack_{ID}.png */
  icon?: string
  type: string            // BackpackType：'Heal' | 'Ammo' | 'Interference' | 'Invisible' | 'BackupEquipment' | 'MovePointAdd' | 'Flow'
  rarity: string          // WeaponRarity（與武器共用）：'SS' | 'S+' | 'S' | 'A' | 'B' · API quality: SSSR→SS / UR→S+ / SSR→S / SR→A / R→B
  weight: number          // 重量（佔機甲出力）· API: weight
  slot: string                // WeaponEquipSlot：固定為 'back'（WeaponEquipSlot.BACK）；與武器共用 enum 供裝備計算器統一判斷部位
  assemblableArmorType: string[]  // AssemblableArmorType 陣列（正向邏輯）：[] = 無限制；['Light'] / ['Medium'] / ['Heavy'] / 複數 = 指定機甲類型 · API: AssemblableAirmenType
  repairAmount: number    // 修理量；非修理類背包填 0 · API: AmountOfRepair
  /** 背包附帶技能（API: WithPassiveSkills[0]）；僅 SS 稀有度（API quality: SSSR）有此欄位 */
  mainSkill?: {
    id: string            // API: WithPassiveSkills[0].ID
    name: string          // API: WithPassiveSkills[0].name
    icon?: string         // API: WithPassiveSkills[0].SkillIcon / .icon（鍵名格式）
    description: string   // API: WithPassiveSkills[0].SpecificEffects（清洗 rich text 標籤後）
    /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
    descriptionRefs?: DescriptionRefs
    buffIds: string[]     // API: WithPassiveSkills[0].BufCarried（'/' 分隔 → split）
    // 以下為管理員手動填入的結構化效果數值
    dmg?: number
    crit?: number
    critDmg?: number
    acc?: number
    specialEffects?: string[]
  }
}

// ─── 元件（v1.3 更新）────────────────────────────────────────────────────────

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

// ─── 用戶系統（Phase 5）────────────────────────────────────────────────────────

export interface UserResearchLevels {
  /** 機師科研完成度：{ 職業名: 0-100 (%) } */
  pilotByClass: Record<string, number>
  /** 機甲科研完成度：{ 裝甲類型: 0-100 (%) } */
  mechByType: Record<string, number>
  /** 武器科研完成度：{ 武器種類: 0-100 (%) } */
  weaponByType: Record<string, number>
}

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL?: string
  role: 'USER' | 'ADMIN' | 'OWNER'
  researchLevels: UserResearchLevels
  createdAt: string
  updatedAt: string
  // PLAN-011 個人檔案管理
  avatarType?: 'upload' | 'pilot' | 'google' | null
  avatarUrl?: string | null
  avatarPilotId?: string | null
  gameNickname?: string | null
  gameServer?: import('./enums').GameServer | null
  guild?: string | null
}

// ─── 配裝（Firestore userBuilds / 本地快取）───────────────────────────────────

export interface FloatingModSelection {
  stat: string
  condition: string | null
  value: number
}

export interface Build {
  buildName: string
  pilotId: string
  mechId: string
  weaponId: string
  backpackId: string
  modules: {
    slot4: string | null
    slot8: string | null
    fixed: string[]
  }
  weaponFixedMod: Record<string, number>
  weaponFloatingMod: FloatingModSelection[]
  triggerComponents: string[]
  effectComponents: string[]
  pilotResearch: Record<string, number>
  result?: Record<string, number>
  createdAt?: string | number
}

export interface UserBuild extends Build {
  id: string
  updatedAt: string
}

// ─── 灰燼行動名單 ──────────────────────────────────────────────────────────────

export interface GrayOpsMechEntry {
  name: string
  version?: string
}

export interface GrayOpsRoster {
  companies: Record<string, GrayOpsMechEntry[]>
}

// ─── BOSS / 關卡（PLAN-019 Layer 3）──────────────────────────────────────────

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
