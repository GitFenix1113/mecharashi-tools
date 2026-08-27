import React from 'react'
import type { ModuleStatKey } from './moduleRules.ts'
import { WeaponType, WeaponKind } from '../types/enums'

/**
 * 數值欄位鍵。
 *
 * ⚠ 定義搬到 `moduleRules.ts`（PLAN-052-G B-1），本檔改為 re-export ——
 *   規則層要拿同一組鍵做 Σ 加總，兩邊各定義一份就會在官方新增欄位時靜默不同步，
 *   而下面 `STAT_META` 的窮盡檢查只守得住本檔那一份。
 *   舊寫法 `Exclude<keyof ModuleLevel, 'level' | 'description'>` 會把 descriptionRefs
 *   也算成數值鍵，判定改由 `NonNullable<T[K]> extends number` 負責，行為不變。
 */
export type StatKey = ModuleStatKey

export interface StatMeta {
  label: string
  color: string
  suffix: string
  /** 數值前綴，預設 '+'；減傷/抗暴這類「越高越好但寫成負號」的欄位填 '-' */
  prefix?: string
}

export interface StatLabel extends StatMeta {
  key: StatKey
}

/**
 * 屬性顯示表。鍵序即畫面順序：基礎屬性 → 武器類別增傷 → 武器種類增傷 → 情境增傷。
 *
 * 型別是 Record<StatKey, …> 而非陣列，為的是**編譯期窮盡檢查**：
 * ModuleLevel 日後新增數值欄位（新版本出現新武器種類）卻忘了補標籤時，
 * `npm run build` 會直接失敗並指名缺哪個 key，而不是靜默地在前台少顯示一項。
 * 先前正是因為少了這道保險，dmg_heavy_machinegun 等 7 個欄位從未在前台出現過。
 */
const STAT_META: Record<StatKey, StatMeta> = {
  // ── 基礎屬性 ──
  dmg:                  { label: '傷害',     color: 'text-accent-orange', suffix: '%' },
  crit_rate:            { label: '暴擊',     color: 'text-accent-yellow', suffix: '%' },
  critDmg:              { label: '爆傷',     color: 'text-accent-red',    suffix: '%' },
  acc_rate:             { label: '命中',     color: 'text-accent-blue',   suffix: '%' },
  firepower_rate:       { label: '火力',     color: 'text-accent-green',  suffix: '%' },
  armor_rate:           { label: '護甲',     color: 'text-accent-cyan',   suffix: '%' },
  output_bonus:         { label: '出力',     color: 'text-accent-purple', suffix: ''  },
  dodge_rate:           { label: '回避',     color: 'text-accent-blue',   suffix: '%' },
  durable_rate:         { label: '耐久',     color: 'text-accent-green',  suffix: '%' },
  dmg_resist_rate:      { label: '減傷',     color: 'text-accent-cyan',   suffix: '%', prefix: '-' },
  crit_resist_rate:     { label: '抗暴',     color: 'text-accent-yellow', suffix: '%', prefix: '-' },
  // ── 武器類別增傷（標籤直接引用 WeaponType，enum 改字這裡自動跟上）──
  dmg_assault:          { label: `${WeaponType.Assault}傷害`,        color: 'text-accent-orange', suffix: '%' },
  dmg_melee:            { label: `${WeaponType.Melee}傷害`,          color: 'text-accent-orange', suffix: '%' },
  dmg_shooting:         { label: `${WeaponType.Sniper}傷害`,         color: 'text-accent-orange', suffix: '%' },
  dmg_tactical:         { label: `${WeaponType.Heavy}傷害`,          color: 'text-accent-orange', suffix: '%' },
  // ── 武器種類增傷（同理引用 WeaponKind，與武器圖鑑用語保證一致）──
  dmg_blade:            { label: `${WeaponKind.Blade}傷害`,          color: 'text-accent-orange', suffix: '%' },
  dmg_polearm:          { label: `${WeaponKind.Rod}傷害`,            color: 'text-accent-orange', suffix: '%' },
  dmg_missile:          { label: `${WeaponKind.Missile}傷害`,        color: 'text-accent-orange', suffix: '%' },
  dmg_rocket:           { label: `${WeaponKind.Rocket}傷害`,         color: 'text-accent-orange', suffix: '%' },
  dmg_shotgun:          { label: `${WeaponKind.ShotGun}傷害`,        color: 'text-accent-orange', suffix: '%' },
  dmg_machinegun:       { label: `${WeaponKind.MachineGun}傷害`,     color: 'text-accent-orange', suffix: '%' },
  dmg_heavy_machinegun: { label: `${WeaponKind.HeavyMachineGun}傷害`,color: 'text-accent-orange', suffix: '%' },
  dmg_railgun:          { label: `${WeaponKind.RailGun}傷害`,        color: 'text-accent-orange', suffix: '%' },
  dmg_funnel:           { label: `${WeaponKind.Funnel}傷害`,         color: 'text-accent-orange', suffix: '%' },
  dmg_sniper_light:     { label: `${WeaponKind.LightSniper}傷害`,    color: 'text-accent-orange', suffix: '%' },
  dmg_sniper:           { label: `${WeaponKind.HeavySniper}傷害`,    color: 'text-accent-orange', suffix: '%' },
  dmg_fist:             { label: `${WeaponKind.Knuckle}傷害`,        color: 'text-accent-orange', suffix: '%' },
  dmg_pile:             { label: `${WeaponKind.PileBunker}傷害`,     color: 'text-accent-orange', suffix: '%' },
  dmg_chainsaw:         { label: `${WeaponKind.Saw}傷害`,            color: 'text-accent-orange', suffix: '%' },
  dmg_flamethrower:     { label: `${WeaponKind.Flamethrower}傷害`,   color: 'text-accent-orange', suffix: '%' },
  // ── 特殊情境增傷 ──
  dmg_counter:          { label: '反擊傷害', color: 'text-accent-red',    suffix: '%' },
  dmg_enemy_phase:      { label: '敵回傷害', color: 'text-accent-red',    suffix: '%' },
}

/** 供渲染用的陣列形式；順序由 STAT_META 的鍵序決定。 */
export const STAT_LABELS: StatLabel[] = (Object.keys(STAT_META) as StatKey[]).map((key) => ({
  key,
  ...STAT_META[key],
}))

export function highlightNumbers(text: string): React.ReactNode[] {
  return text.split(/(\d+(?:\.\d+)?%?|%)/).map((part, i) =>
    i % 2 === 1
      ? <span key={i} className="text-accent-red font-bold">{part}</span>
      : part
  )
}
