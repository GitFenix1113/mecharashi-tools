import { ItemRarity, ConditionType, EffectType } from '../../types/enums'

const BADGE_BASE = 'text-[13px] px-1.5 py-0.5 rounded border font-medium'

const RARITY_STYLES: Record<string, string> = {
  [ItemRarity.EX]: 'text-accent-orange bg-accent-orange/10 border-accent-orange/40',
  [ItemRarity.S]:  'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/40',
  [ItemRarity.A]:  'text-accent-purple bg-accent-purple/10 border-accent-purple/40',
  [ItemRarity.B]:  'text-accent-blue   bg-accent-blue/10   border-accent-blue/30',
}

const CONDITION_TYPE_STYLES: Record<string, string> = {
  [ConditionType.DUAL_WIELD]:   'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  [ConditionType.SINGLE_WIELD]: 'text-accent-blue   bg-accent-blue/10   border-accent-blue/30',
  [ConditionType.FIRST_ATTACK]: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30',
  [ConditionType.AP_COST]:      'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
  [ConditionType.TARGET_TORSO]: 'text-accent-red    bg-accent-red/10    border-accent-red/30',
  [ConditionType.ALWAYS]:       'text-accent-cyan   bg-accent-cyan/10   border-accent-cyan/30',
}

export const CONDITION_TYPE_LABELS: Record<string, string> = {
  [ConditionType.DUAL_WIELD]:   '雙持攻擊',
  [ConditionType.SINGLE_WIELD]: '單持攻擊',
  [ConditionType.FIRST_ATTACK]: '首次攻擊',
  [ConditionType.AP_COST]:      'AP消耗',
  [ConditionType.TARGET_TORSO]: '攻擊軀幹',
  [ConditionType.ALWAYS]:       '每次攻擊',
}

const EFFECT_TYPE_STYLES: Record<string, string> = {
  [EffectType.DMG_BOOST]:    'text-accent-red    bg-accent-red/10    border-accent-red/30',
  [EffectType.BULLET_ADD]:   'text-accent-blue   bg-accent-blue/10   border-accent-blue/30',
  [EffectType.MULTIPLIER]:   'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  [EffectType.ARMOR_BREAK]:  'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
  [EffectType.AP_DMG_BOOST]: 'text-accent-cyan   bg-accent-cyan/10   border-accent-cyan/30',
  [EffectType.TORSO_DMG]:    'text-accent-green  bg-accent-green/10  border-accent-green/30',
}

export const EFFECT_TYPE_LABELS: Record<string, string> = {
  [EffectType.DMG_BOOST]:    '增傷',
  [EffectType.BULLET_ADD]:   '增加子彈',
  [EffectType.MULTIPLIER]:   '增加倍率',
  [EffectType.ARMOR_BREAK]:  '破甲',
  [EffectType.AP_DMG_BOOST]: 'AP增傷',
  [EffectType.TORSO_DMG]:    '軀幹增傷',
}

export function RarityBadge({ rarity }: { rarity: string }) {
  return (
    <span className={`${BADGE_BASE} ${RARITY_STYLES[rarity] ?? 'text-text-secondary border-border'}`}>
      {rarity}
    </span>
  )
}

export function ComponentTypeBadge({ type }: { type: 'Condition' | 'Function' }) {
  return (
    <span
      className={`${BADGE_BASE} ${
        type === 'Condition'
          ? 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30'
          : 'text-accent-orange bg-accent-orange/10 border-accent-orange/30'
      }`}
    >
      {type === 'Condition' ? '觸元件' : '應元件'}
    </span>
  )
}

export function WTypeBadge() {
  return (
    <span className={`${BADGE_BASE} text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30`}>
      W型
    </span>
  )
}

export function ConditionTypeBadge({ conditionType }: { conditionType: string }) {
  return (
    <span
      className={`${BADGE_BASE} ${CONDITION_TYPE_STYLES[conditionType] ?? 'text-text-secondary border-border'}`}
    >
      {CONDITION_TYPE_LABELS[conditionType] ?? conditionType}
    </span>
  )
}

export function EffectTypeBadge({ effectType }: { effectType: string }) {
  return (
    <span
      className={`${BADGE_BASE} ${EFFECT_TYPE_STYLES[effectType] ?? 'text-text-secondary border-border'}`}
    >
      {EFFECT_TYPE_LABELS[effectType] ?? effectType}
    </span>
  )
}
