import {
  ModuleSlot, MechPartPosition, ConditionalTrigger, WeaponType, WeaponKind,
  ComponentType, ConditionType, EffectType, ModuleSubtype, ComponentsWType,
} from '../../../types/enums'
import type { GrayOpsCompany } from '../../../data/patchVersions'

// ── 模組槽位 ──────────────────────────────────────────────────────────────────

export const SLOT_OPTIONS: { value: string; label: string }[] = [
  { value: ModuleSlot.SLOT_4,    label: `四級特性模組（${ModuleSlot.SLOT_4}）` },
  { value: ModuleSlot.SLOT_8,    label: `八級模組（${ModuleSlot.SLOT_8}）` },
  { value: ModuleSlot.UNIVERSAL, label: `通用模組（${ModuleSlot.UNIVERSAL}）` },
  { value: ModuleSlot.BUILT_IN,  label: `副模組・機甲內建（${ModuleSlot.BUILT_IN}）` },
  { value: ModuleSlot.EXCLUSIVE, label: `機甲專屬模組（傷害模擬只有此機甲可用）（${ModuleSlot.EXCLUSIVE}）` },
]

export const SLOT_LABEL: Record<string, string> = {
  [ModuleSlot.SLOT_4]:    '四模',
  [ModuleSlot.SLOT_8]:    '八模',
  [ModuleSlot.UNIVERSAL]: '通用',
  [ModuleSlot.BUILT_IN]:  '副模',
  [ModuleSlot.EXCLUSIVE]: '專屬',
}

export const PART_OPTIONS: { value: string; label: string }[] = [
  { value: MechPartPosition.TORSO,     label: `軀幹（${MechPartPosition.TORSO}）` },
  { value: MechPartPosition.LEFT_ARM,  label: `左臂（${MechPartPosition.LEFT_ARM}）` },
  { value: MechPartPosition.RIGHT_ARM, label: `右臂（${MechPartPosition.RIGHT_ARM}）` },
  { value: MechPartPosition.LEGS,      label: `腿部（${MechPartPosition.LEGS}）` },
]

// ── 條件觸發 ──────────────────────────────────────────────────────────────────

export const TRIGGER_LABEL: Record<string, string> = {
  [ConditionalTrigger.PER_BUFF_HELD]:     `每持有N個增益效果（${ConditionalTrigger.PER_BUFF_HELD}）`,
  [ConditionalTrigger.PER_COMBO]:         `每N連擊（${ConditionalTrigger.PER_COMBO}）`,
  [ConditionalTrigger.AP_SKILL]:          `AP技能・最低AP門檻（${ConditionalTrigger.AP_SKILL}）`,
  [ConditionalTrigger.PER_AMMO_CONSUMED]: `每消耗N枚彈藥（${ConditionalTrigger.PER_AMMO_CONSUMED}）`,
  [ConditionalTrigger.TACTICAL_WEAPON]:   `使用戰術武器時（${ConditionalTrigger.TACTICAL_WEAPON}）`,
}

export const TRIGGER_DISPLAY: Record<string, string> = {
  always:         '無條件（always）',
  onAttack:       '攻擊時（onAttack）',
  onCrit:         '造成暴擊後（onCrit）',
  onCounter:      '反擊時（onCounter）',
  onApSkill:      '使用 AP 技能（onApSkill）',
  weaponType:     '指定武器類型（weaponType）',
  dualWield:      '雙持武器（dualWield）',
  hpBelow:        'HP 低於門檻（hpBelow）',
  firstAttack:    '先手攻擊（firstAttack）',
  enemyPhase:     '敵方回合（enemyPhase）',
  allyHasBuff:    '隊友持有增益（allyHasBuff）',
  hasBuff:        '持有特定狀態（hasBuff）',
  notMoved:       '本回合未移動（notMoved）',
}

// ── 屬性選項 ──────────────────────────────────────────────────────────────────

export const STAT_OPTIONS: { key: string; label: string }[] = [
  { key: 'dmg',                  label: '增傷 dmg (%)' },
  { key: 'crit_rate',            label: '暴擊率 crit_rate' },
  { key: 'critDmg',              label: '暴擊傷害 critDmg (%)' },
  { key: 'acc_rate',             label: '命中率 acc_rate' },
  { key: 'firepower_rate',       label: '火力 firepower_rate (%)' },
  { key: 'armor_rate',           label: '護甲 armor_rate (%)' },
  { key: 'output_bonus',         label: '出力 output_bonus' },
  { key: 'crit_resist_rate',     label: '被暴擊降低 crit_resist_rate' },
  { key: 'dodge_rate',           label: '回避 dodge_rate (%)' },
  { key: 'durable_rate',         label: '耐久 durable_rate (%)' },
  { key: 'dmg_resist_rate',      label: '傷害降低 dmg_resist_rate (%)' },
  { key: 'dmg_assault',          label: '突擊武器增傷 dmg_assault (%)' },
  { key: 'dmg_melee',            label: '格鬥武器增傷 dmg_melee (%)' },
  { key: 'dmg_shooting',         label: '射擊武器增傷 dmg_shooting (%)' },
  { key: 'dmg_tactical',         label: '戰術武器增傷 dmg_tactical (%)' },
  { key: 'dmg_blade',            label: '刀劍增傷 dmg_blade (%)' },
  { key: 'dmg_polearm',          label: '長柄增傷 dmg_polearm (%)' },
  { key: 'dmg_missile',          label: '導彈增傷 dmg_missile (%)' },
  { key: 'dmg_rocket',           label: '火箭增傷 dmg_rocket (%)' },
  { key: 'dmg_shotgun',          label: '霰彈增傷 dmg_shotgun (%)' },
  { key: 'dmg_machinegun',       label: '機槍增傷 dmg_machinegun (%)' },
  { key: 'dmg_heavy_machinegun', label: '重機槍增傷 dmg_heavy_machinegun (%)' },
  { key: 'dmg_railgun',          label: '電磁炮增傷 dmg_railgun (%)' },
  { key: 'dmg_funnel',           label: '浮游炮增傷 dmg_funnel (%)' },
  { key: 'dmg_sniper_light',     label: '輕型狙擊步槍增傷 dmg_sniper_light (%)' },
  { key: 'dmg_sniper',           label: '狙擊步槍增傷 dmg_sniper (%)' },
  { key: 'dmg_fist',             label: '拳套增傷 dmg_fist (%)' },
  { key: 'dmg_pile',             label: '打樁機增傷 dmg_pile (%)' },
  { key: 'dmg_chainsaw',         label: '電鋸增傷 dmg_chainsaw (%)' },
  { key: 'dmg_flamethrower',     label: '噴火器增傷 dmg_flamethrower (%)' },
  { key: 'dmg_counter',          label: '反擊增傷 dmg_counter (%)' },
  { key: 'dmg_enemy_phase',      label: '敵方階段增傷 dmg_enemy_phase (%)' },
]

// ── 機師／武器稀有度色彩 ──────────────────────────────────────────────────────

export const PILOT_RARITY_CLASS: Record<string, string> = {
  EX: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
  S:  'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  A:  'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30',
  B:  'text-text-secondary bg-bg-card border-border',
}

export const WEAPON_RARITY_CLASS: Record<string, string> = {
  SS:   'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
  'S+': 'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  S:    'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30',
  A:    'text-text-secondary bg-bg-card border-border',
  B:    'text-text-dim bg-bg-dark border-border',
}

// ── 武器種類 ──────────────────────────────────────────────────────────────────

export const WEAPON_KIND_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  [WeaponType.Melee]: [
    { value: WeaponKind.Shield,         label: `大盾（${WeaponKind.Shield}）` },
    { value: WeaponKind.Buckler,        label: `手盾（${WeaponKind.Buckler}）` },
    { value: WeaponKind.Blade,          label: `刀劍（${WeaponKind.Blade}）` },
    { value: WeaponKind.Knuckle,        label: `拳套（${WeaponKind.Knuckle}）` },
    { value: WeaponKind.PileBunker,     label: `打樁機（${WeaponKind.PileBunker}）` },
    { value: WeaponKind.Saw,            label: `電鋸（${WeaponKind.Saw}）` },
    { value: WeaponKind.Rod,            label: `長柄（${WeaponKind.Rod}）` },
  ],
  [WeaponType.Heavy]: [
    { value: WeaponKind.RailGun,  label: `電磁炮（${WeaponKind.RailGun}）` },
    { value: WeaponKind.Funnel,   label: `浮游炮（${WeaponKind.Funnel}）` },
    { value: WeaponKind.Missile,  label: `導彈（${WeaponKind.Missile}）` },
    { value: WeaponKind.Rocket,   label: `火箭（${WeaponKind.Rocket}）` },
  ],
  [WeaponType.Assault]: [
    { value: WeaponKind.ShotGun,         label: `霰彈槍（${WeaponKind.ShotGun}）` },
    { value: WeaponKind.MachineGun,      label: `機槍（${WeaponKind.MachineGun}）` },
    { value: WeaponKind.HeavyMachineGun, label: `重機槍（${WeaponKind.HeavyMachineGun}）` },
    { value: WeaponKind.Flamethrower,    label: `噴火器（${WeaponKind.Flamethrower}）` },
  ],
  [WeaponType.Sniper]: [
    { value: WeaponKind.LightSniper, label: `輕型狙擊步槍（${WeaponKind.LightSniper}）` },
    { value: WeaponKind.HeavySniper, label: `狙擊步槍（${WeaponKind.HeavySniper}）` },
  ],
}

export const ALL_WEAPON_KINDS: { value: string; label: string }[] = [
  ...(WEAPON_KIND_BY_TYPE[WeaponType.Melee] ?? []),
  ...(WEAPON_KIND_BY_TYPE[WeaponType.Heavy] ?? []),
  ...(WEAPON_KIND_BY_TYPE[WeaponType.Assault] ?? []),
  ...(WEAPON_KIND_BY_TYPE[WeaponType.Sniper] ?? []),
]

// ── 元件常數 ──────────────────────────────────────────────────────────────────

export const COMPONENT_TYPE_LABEL: Record<string, string> = {
  [ComponentType.CONDITION]: '觸元件（Condition）',
  [ComponentType.FUNCTION]:  '應元件（Function）',
}

export const CONDITION_TYPE_LABEL: Record<string, string> = {
  [ConditionType.DUAL_WIELD]:   '同時使用兩把武器（dualWield）',
  [ConditionType.SINGLE_WIELD]: '使用單把武器（singleWield）',
  [ConditionType.FIRST_ATTACK]: '首次攻擊（firstAttack）',
  [ConditionType.AP_COST]:      '每消耗N點AP（apCost）',
  [ConditionType.TARGET_TORSO]: '攻擊軀幹（targetTorso）',
  [ConditionType.ALWAYS]:       '每次攻擊（always）',
}

export const EFFECT_TYPE_LABEL: Record<string, string> = {
  [EffectType.DMG_BOOST]:    '增傷 dmgBoost（傷害提升%）',
  [EffectType.BULLET_ADD]:   '增加子彈 bulletAdd',
  [EffectType.MULTIPLIER]:   '增加倍率 multiplierBoost',
  [EffectType.ARMOR_BREAK]:  '破甲 armorBreak',
  [EffectType.AP_DMG_BOOST]: '每消耗AP增傷 apDmgBoost',
  [EffectType.TORSO_DMG]:    '對軀幹增傷 torsoDmgBoost',
}

export const MODULE_SUBTYPE_LABEL: Record<number, string> = {
  [ModuleSubtype.HIT_RELATED]:      '命中相關',
  [ModuleSubtype.ATTACK_METHOD]:    '攻擊方式',
  [ModuleSubtype.HIT_RECEIVED]:     '受擊相關',
  [ModuleSubtype.DURABILITY]:       '耐久相關',
  [ModuleSubtype.AP_RELATED]:       'AP相關',
  [ModuleSubtype.BATTLE_EFFECT]:    '戰中效果',
  [ModuleSubtype.POST_BATTLE]:      '戰後效果',
  [ModuleSubtype.ATTACK_RESULT]:    '攻擊結果',
  [ModuleSubtype.RANGE_RELATED]:    '距離相關',
  [ModuleSubtype.SPECIAL_EFFECT]:   '特殊效果',
  [ModuleSubtype.MOVEMENT_RELATED]: '移動相關',
}

export const COMPONENT_RARITY_CLASS: Record<string, string> = {
  EX: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
  S:  'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  A:  'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30',
  B:  'text-text-secondary bg-bg-card border-border',
}

// ── 灰燼行動 ──────────────────────────────────────────────────────────────────

export const GRAY_OPS_COMPANIES: GrayOpsCompany[] = ['武裝工坊', '創新動力', 'GeekX', '火花塞']

export const GRAY_OPS_COMPANY_COLOR: Record<GrayOpsCompany, string> = {
  '武裝工坊': 'text-accent-orange',
  '創新動力': 'text-accent-blue',
  'GeekX':    'text-accent-cyan',
  '火花塞':   'text-accent-yellow',
}

// ── 武器種類中分類 ─────────────────────────────────────────────────────────────

export const COMPONENTS_W_TYPE_LABEL: Record<string, string> = {
  [ComponentsWType.NORMAL]: 'Normal — 一般元件',
  [ComponentsWType.W]:      'W — W型元件',
}
