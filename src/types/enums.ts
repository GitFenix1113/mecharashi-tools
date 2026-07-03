// ─── 機師 ────────────────────────────────────────────────────────────────────

export const PilotClass = {
  ASSAULT:   '突擊手',
  SNIPER:    '狙擊手',
  TACTICIAN: '戰術家',
  FIGHTER:   '格鬥家',
  GUARDIAN:  '守護者',
  ENGINEER:  '機械師',
  CONSTRUCTOR: '調構師',
} as const;
export type PilotClass = typeof PilotClass[keyof typeof PilotClass];

export const MechLicense = {
  LIGHT:  '輕型',
  MEDIUM: '中型',
  HEAVY:  '重型',
} as const;
export type MechLicense = typeof MechLicense[keyof typeof MechLicense];

// ─── 通用稀有度 ────────────────────────────────────────────────────────────────

export const ItemRarity = {
  EX: 'EX',
  S:  'S',
  A:  'A',
  B:  'B',
} as const;
export type ItemRarity = typeof ItemRarity[keyof typeof ItemRarity];

// ─── 機甲 ────────────────────────────────────────────────────────────────────

export const ArmorType = {
  LIGHT:  '輕型',
  MEDIUM: '中甲',
  HEAVY:  '重型',
} as const;
export type ArmorType = typeof ArmorType[keyof typeof ArmorType];

export const MechPartPosition = {
  TORSO:     'torso',
  LEFT_ARM:  'leftArm',
  RIGHT_ARM: 'rightArm',
  LEGS:      'legs',
} as const;
export type MechPartPosition = typeof MechPartPosition[keyof typeof MechPartPosition];

// ─── 模組 ────────────────────────────────────────────────────────────────────

export const ModuleRarity = {
  S: 'S',
  A: 'A',
} as const;
export type ModuleRarity = typeof ModuleRarity[keyof typeof ModuleRarity];

export const ModuleSlot = {
  SLOT_4:    '機甲特性模組',
  SLOT_8:    '機甲8級模組',
  UNIVERSAL: '通用模組',
  BUILT_IN:  '機甲副模組',
  EXCLUSIVE: '機甲專屬模組',
} as const;
export type ModuleSlot = typeof ModuleSlot[keyof typeof ModuleSlot];

export const ModuleSource = {
  SHOP:              '商店',
  DISMANTLE:         '拆機甲',
  MECH_NO_DISMANTLE: '機甲不可拆',
  UNKNOWN:           '未知',
} as const;
export type ModuleSource = typeof ModuleSource[keyof typeof ModuleSource];

// 後台資料維護標記（非遊戲取得途徑）
export const ModuleDataSource = {
  AUTO:   'auto',
  MANUAL: 'manual',
} as const;
export type ModuleDataSource = typeof ModuleDataSource[keyof typeof ModuleDataSource];

// 模組條件效果觸發類型（傷害模擬器用）
export const ConditionalTrigger = {
  PER_BUFF_HELD:     'perBuffHeld',     // 每持有N個增益效果
  PER_COMBO:         'perCombo',        // 每N連擊
  AP_SKILL:          'apSkill',         // 使用N AP以上技能
  PER_AMMO_CONSUMED: 'perAmmoConsumed', // 每消耗N枚彈藥
  TACTICAL_WEAPON:   'tacticalWeapon',  // 使用戰術武器時（基礎觸發）
} as const;
export type ConditionalTrigger = typeof ConditionalTrigger[keyof typeof ConditionalTrigger];

// ─── 武器 ────────────────────────────────────────────────────────────────────

// 類型
export const WeaponType = {
  Sniper: '射擊',
  Melee:    '格鬥',
  Assault:  '突擊',
  Heavy: '戰術',
} as const;
export type WeaponType = typeof WeaponType[keyof typeof WeaponType];

// 種類
export const WeaponKind = {
  // 格鬥類
  Shield:     '大盾',
  Buckler:      '手盾',
  Blade:            '刀劍',
  Knuckle:          '拳套',
  PileBunker:             '打樁機',
  Saw:         '電鋸',
  Rod:          '長柄',
  // 戰術類
  RailGun:          '電磁炮',
  Funnel:           '浮游炮',
  Missile:          '導彈',
  Rocket:           '火箭',
  // 突擊類
  ShotGun:          '霰彈槍',
  MachineGun:       '機槍',
  HeavyMachineGun: '重機槍',
  Flamethrower:     '噴火器',
  // 射擊類
  LightSniper:     '輕型狙擊步槍',
  HeavySniper:           '狙擊步槍',
} as const;
export type WeaponKind = typeof WeaponKind[keyof typeof WeaponKind];

export const WeaponEquipSlot = {
  SINGLE_HAND: 'singleHand', // 單手：左臂或右臂其中一個 · API RestrictionsPositionOfWeapon: "Hand"
  DUAL_HAND:   'dualHand',   // 雙手：同時佔據左右臂 · API RestrictionsPositionOfWeapon: "DualHand"
  SHOULDER:    'shoulder',   // 肩膀：左臂或右臂其中一個肩膀 · API RestrictionsPositionOfWeapon: "Shoulder"
  BACK:        'back',       // 背後 · API RestrictionsPositionOfWeapon: "Back"
} as const;
export type WeaponEquipSlot = typeof WeaponEquipSlot[keyof typeof WeaponEquipSlot];

export const RangeType = {
  MANHATTAN:  'manhattan',  // 菱形射程：Manhattan 距離，可打斜格。攻擊格：|dx|+|dy| ∈ [minRange, maxRange]
  ORTHOGONAL: 'orthogonal', // 十字直線：只能上下左右，不可打斜格（電磁炮）。攻擊格：(dx=0 XOR dy=0) AND |dx|+|dy| ∈ [minRange, maxRange]
  RING:       'ring',       // 環形 N 圈：Chebyshev 距離，方形覆蓋。攻擊格：max(|dx|,|dy|) ≤ maxRange，minRange 固定為 0
} as const;
export type RangeType = typeof RangeType[keyof typeof RangeType];

export const WeaponRarity = {
  SS:     'SS',
  S_PLUS: 'S+',
  S:      'S',
  A:      'A',
  B:      'B',
} as const;
export type WeaponRarity = typeof WeaponRarity[keyof typeof WeaponRarity];

export const SkillActivation = {
  CARRY: 'carry',
  EQUIP: 'equip',
  USE:   'use',
} as const;
export type SkillActivation = typeof SkillActivation[keyof typeof SkillActivation];

export const MechRestriction = {
  NONE:        'none',   // API LimitedModelOfWeapon: "Light/Medium/Heavy"（三種均含）
  LIGHT_ONLY:  'light',  // API LimitedModelOfWeapon: "Light"
  MEDIUM_ONLY: 'medium', // API LimitedModelOfWeapon: "Medium"
  HEAVY_ONLY:  'heavy',  // API LimitedModelOfWeapon: "Heavy"
} as const;
export type MechRestriction = typeof MechRestriction[keyof typeof MechRestriction];

// ─── 背包 ────────────────────────────────────────────────────────────────────

// 背包種類（API: BackpackMainType）
export const BackpackType = {
  HEAL:             'Heal',            // 修理
  AMMO:             'Ammo',            // 彈藥
  INTERFERENCE:     'Interference',    // 誘導
  INVISIBLE:        'Invisible',       // 隱形
  BACKUP_EQUIPMENT: 'BackupEquipment', // 武器擴充
  MOVE_POINT_ADD:   'MovePointAdd',    // 移動
  FLOW:             'Flow',            // 飛行
  RADAR:            'Radar',           // 雷達
  EMP:              'EMP',             // 干擾背包
  ENHANCE:          'Enhance',         // 強化背包
  POWERADD:         'PowerAdd',        // 出力背包
} as const;
export type BackpackType = typeof BackpackType[keyof typeof BackpackType];

// 背包可裝備機甲類型（正向邏輯：指定哪些機甲可裝備，與 MechRestriction 反向）
// API: AssemblableAirmenType - "Light" / "Medium" / "Heavy" / 空白或多值 → All
export const AssemblableArmorType = {
  LIGHT:  'Light',  // 僅限輕型機甲
  MEDIUM: 'Medium', // 僅限中型機甲
  HEAVY:  'Heavy',  // 僅限重型機甲
} as const;
export type AssemblableArmorType = typeof AssemblableArmorType[keyof typeof AssemblableArmorType];

// ─── 技能 / BUFF ──────────────────────────────────────────────────────────────

export const SkillType = {
  PASSIVE: '被動技能',
  ACTIVE:  '主動技能',
  COMMAND: '指令技能',  // Order — 有 CD，消耗 AP
  PP:      'PP技能',    // 消耗 PP（每次出擊有限 PP 上限），如「勇氣」
} as const;
export type SkillType = typeof SkillType[keyof typeof SkillType];

// 技能觸發條件類型（顯示標籤用，非計算觸發）
export const PilotSkillTrigger = {
  ALWAYS:          'always',
  ON_ATTACK:       'onAttack',
  ON_COUNTER:      'onCounter',
  ON_AP_SKILL:     'onApSkill',
  WEAPON_TYPE: 'weaponType',
  DUAL_WIELD:      'dualWield',
  HP_BELOW:        'hpBelow',
  FIRST_ATTACK:    'firstAttack',
  ENEMY_PHASE:     'enemyPhase',
  ALLY_HAS_BUFF:   'allyHasBuff',
} as const;
export type PilotSkillTrigger = typeof PilotSkillTrigger[keyof typeof PilotSkillTrigger];

// 技能效果受益對象（隊伍計算器用）
export const SkillScope = {
  SELF: 'self',
  ALLY: 'ally',
  TEAM: 'team',
} as const;
export type SkillScope = typeof SkillScope[keyof typeof SkillScope];

// Buff 類型
export const BuffType = {
  STAT_BOOST: 'statBoost',
  RESOURCE:   'resource',
  STATE:      'state',
  DEBUFF:     'debuff',
  CONTROL:    'control',
} as const;
export type BuffType = typeof BuffType[keyof typeof BuffType];

// ─── 關卡（PLAN-019 Layer 3）─────────────────────────────────────────────────

// 高難度關卡分類（用於 Stage.category）
export const StageCategory = {
  CRISIS: '危境',   // 危境重構
  ABYSS:  '深淵',   // 深淵 / 高難度挑戰
  EVENT:  '活動',   // 限時活動關卡
  RAID:   '討伐',   // 武裝討伐
  OTHER:  '其他',
} as const;
export type StageCategory = typeof StageCategory[keyof typeof StageCategory];

// ─── 元件 ────────────────────────────────────────────────────────────────────

// 對應 WIKI mQuery ModuleType
export const ComponentType = {
  CONDITION: 'Condition', // 觸元件
  FUNCTION:  'Function',  // 應元件
} as const;
export type ComponentType = typeof ComponentType[keyof typeof ComponentType];

// 對應 WIKI mQuery ModuleSubtype（數字 1–11）
export const ModuleSubtype = {
  HIT_RELATED:      1,  // 命中相關
  ATTACK_METHOD:    2,  // 攻擊方式
  HIT_RECEIVED:     3,  // 受擊相關
  DURABILITY:       4,  // 耐久相關
  AP_RELATED:       5,  // AP相關
  BATTLE_EFFECT:    6,  // 戰中效果
  POST_BATTLE:      7,  // 戰後效果
  ATTACK_RESULT:    8,  // 攻擊結果
  RANGE_RELATED:    9,  // 距離相關
  SPECIAL_EFFECT:   10, // 特殊效果
  MOVEMENT_RELATED: 11, // 移動相關
} as const;
export type ModuleSubtype = typeof ModuleSubtype[keyof typeof ModuleSubtype];

export const ConditionType = {
  DUAL_WIELD:   'dualWield',
  SINGLE_WIELD: 'singleWield',
  FIRST_ATTACK: 'firstAttack',
  AP_COST:      'apCost',
  TARGET_TORSO: 'targetTorso',
  ALWAYS:       'always',
} as const;
export type ConditionType = typeof ConditionType[keyof typeof ConditionType];

export const EffectType = {
  DMG_BOOST:    'dmgBoost',
  BULLET_ADD:   'bulletAdd',
  MULTIPLIER:   'multiplierBoost',
  ARMOR_BREAK:  'armorBreak',
  AP_DMG_BOOST: 'apDmgBoost',
  TORSO_DMG:    'torsoDmgBoost',
} as const;
export type EffectType = typeof EffectType[keyof typeof EffectType];

// W type：僅 WeaponEquipSlot 為 DUAL_HAND / BACK 的武器可裝備（傷害計算機用）
export const ComponentsWType = {
  W:      'W',
  NORMAL: 'Normal',
} as const;
export type ComponentsWType = typeof ComponentsWType[keyof typeof ComponentsWType];

// ─── 資料維護 / 用戶權限 ──────────────────────────────────────────────────────

export const DataManaged = {
  SCRIPT: 'SCRIPT',
  MANUAL: 'MANUAL',
} as const;
export type DataManaged = typeof DataManaged[keyof typeof DataManaged];

export const UserRole = {
  GUEST: 'GUEST',  // 訪客（未登入，不儲存於 Firestore）
  USER:  'USER',   // 一般註冊用戶
  ADMIN: 'ADMIN',  // 管理者（可寫遊戲資料）
  OWNER: 'OWNER',  // 網站擁有者（最高權限）
} as const;
export type UserRole = typeof UserRole[keyof typeof UserRole];

export const GameServer = {
  LEOPARD_LOGISTICS: '獵豹物流',
  ASHES_OF_FIRE:     '灰燼之子',
  DAWN_CENTURY:      '破曉世紀',
} as const;
export type GameServer = typeof GameServer[keyof typeof GameServer];

// ─── 科研分類常數（與 Firestore globalResearch 結構同步） ──────────────────────

/** 可於科研頁設定的機師職業列表 */
export const RESEARCH_PILOT_CLASSES = ['格鬥家', '突擊手', '狙擊手', '戰術家', '守護者', '機械師'] as const

/** 可於科研頁設定的機甲類型列表 */
export const RESEARCH_MECH_TYPES = ['輕型', '中型', '重型'] as const

/** 可於科研頁設定的武器種類列表 */
export const RESEARCH_WEAPON_TYPES = ['狙擊步槍', '機槍', '重機槍', '刀劍', '拳套'] as const
