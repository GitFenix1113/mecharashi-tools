import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useWeapon, useWeapons, usePilotBriefMap, useBackpackNameMap, useWeaponSkillMap } from '../../hooks/useFirestore'
import { WeaponRarityBadge } from '../../components/badges/WeaponRarityBadge'
import { WeaponIcon } from '../../components/icons/WeaponIcon'
import { ExclusivePilotLink } from '../../components/icons/PilotIcon'
import {
  WeaponTypeBadge,
  WeaponEquipSlotBadge,
  WeaponMechRestrictionBadge,
  FixedArmamentBadge,
} from '../../components/badges/WeaponBadges'
import { WeaponSkillCard } from '../../components/cards/WeaponSkillCard'
import { buildUpgradeIndex, deriveFusedSkillNames, isCompositeWeapon } from '../../utils/weaponUpgrade'
import { resolveWeaponSkills } from '../../utils/weaponSkills'
import { naOr, isNaStat, isVariableStat, variableStatNote } from '../../utils/weaponStats'
import type { Weapon } from '../../types'

// ── Labels & formatters ───────────────────────────────────────────────────────

const MOD_STAT_LABELS: Record<string, string> = {
  attack:    '攻擊力',
  crit:      '暴擊',
  accuracy:  '命中',
  firepower: '火力',
  weight:    '重量',
}

const RANGE_TYPE_LABELS: Record<string, string> = {
  manhattan:  '菱形',
  orthogonal: '十字直線',
  ring:       '環形',
}

function formatRange(weapon: Weapon): string {
  return weapon.rangeType === 'ring'
    ? `${weapon.maxRange}+`
    : `${weapon.minRange}-${weapon.maxRange}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="text-xs text-text-dim tracking-[3px] uppercase font-[Orbitron,sans-serif] mb-3">
      {children}
    </h2>
  )
}

function StatCell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-bg-dark rounded-lg p-3 text-center">
      <div className="text-xs text-text-dim mb-1">{label}</div>
      <div className="text-base font-bold text-accent-red font-[JetBrains_Mono,monospace] leading-tight">
        {value}
      </div>
      {sub && <div className="text-[11px] text-text-dim mt-0.5">{sub}</div>}
    </div>
  )
}

function SlotBoxes({ count, colorClass }: { count: number; colorClass: string }) {
  if (count === 0) return <span className="text-text-dim text-sm font-[JetBrains_Mono,monospace]">0</span>
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`w-5 h-5 rounded border-2 ${colorClass}`} />
      ))}
      <span className={`text-sm font-bold font-[JetBrains_Mono,monospace] ${colorClass.split(' ')[0]}`}>
        ×{count}
      </span>
    </div>
  )
}

// ── B-1 進階鏈（PLAN-031）────────────────────────────────────────────────────

/** 「特種背包製作」badge：複合武器（upgrade.station === 'specialBackpack'）專用。 */
function CompositeBadge() {
  return (
    <span className="px-2 py-0.5 rounded text-[13px] border text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30">
      特種背包製作
    </span>
  )
}

/** 進階鏈上可點擊的武器 chip（連向該武器詳情頁）。 */
function WeaponChainLink({ weapon }: { weapon: Weapon }) {
  return (
    <Link
      to={`/weapons/${weapon.id}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-dark border border-border hover:border-accent-cyan transition-colors"
    >
      <WeaponIcon icon={weapon.icon} name={weapon.name} size="sm" isExclusive={weapon.isExclusive} />
      <span className="text-sm text-text-secondary">{weapon.name}</span>
      <WeaponRarityBadge rarity={weapon.rarity} />
    </Link>
  )
}

/**
 * 「融合自 ○○背包」純文字說明（複合武器專用）。
 * ⚠ 此元件內部才呼叫 useBackpackNameMap（觸發 backpacks 載入）——
 *   只有複合武器頁會掛載它，一般武器頁完全不付背包讀取量。
 */
function FusedBackpackNote({ backpackId }: { backpackId: string }) {
  const { data: nameMap } = useBackpackNameMap()
  const name = nameMap[backpackId]
  return (
    <div className="mt-3 text-[13px] text-text-dim">
      融合自 <span className="text-text-secondary">{name ?? backpackId}</span>
      <span className="ml-1">（特種背包製作產物）</span>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl space-y-5">
      <div className="h-4 w-28 bg-bg-card rounded animate-pulse" />
      <div className="h-36 bg-bg-card rounded-xl animate-pulse" />
      <div className="h-28 bg-bg-card rounded-xl animate-pulse" />
      <div className="h-40 bg-bg-card rounded-xl animate-pulse" />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WeaponDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: weapon, loading, error } = useWeapon(id)
  const { data: weapons } = useWeapons()
  const { data: pilotMap } = usePilotBriefMap()

  // ── B-1 進階鏈：母武器（前置）＋子武器（可進階為）＋融合/進階技能差集 ──────────
  const byId = useMemo(() => new Map(weapons.map((w) => [w.id, w])), [weapons])
  const index = useMemo(() => buildUpgradeIndex(weapons), [weapons])
  const parent = weapon?.upgrade?.fromWeaponId ? byId.get(weapon.upgrade.fromWeaponId) ?? null : null
  const children = useMemo(
    () => (weapon ? (index.childrenOf.get(weapon.id) ?? []).map((cid) => byId.get(cid)).filter(Boolean) as Weapon[] : []),
    [weapon, index, byId],
  )
  // PLAN-032：技能雙格式，一律先解析再用。技能庫載入中時 map 為空，引用格式會解析成 0 筆——
  // 故下方技能區的顯示 gate 接在 skills（解析後）而非 weapon.skills 上。
  // loading 一定要接進頁面 gate：只解構 data 的話，技能庫還沒到（或抓取失敗）時
  // 整頁照常渲染、但「武器技能」區塊整塊不存在，使用者看不出那是載入中還是真的沒技能。
  const { data: skillMap, loading: skillsLoading } = useWeaponSkillMap()
  const skills = useMemo(() => resolveWeaponSkills(weapon?.skills, skillMap), [weapon, skillMap])

  /** 相對於母武器新增的技能名（融合或進階帶來的），供技能列表標示。 */
  const fusedSkillNames = useMemo(() => {
    if (!weapon || !parent) return new Set<string>()
    return new Set(
      deriveFusedSkillNames(
        skills.map((s) => s.name),
        // 母武器也要解析——它可能與子武器不同格式（flip 是逐把武器進行的）。
        // 比對用的是技能「名稱」，故兩邊解析後才具可比性。
        resolveWeaponSkills(parent.skills, skillMap).map((s) => s.name),
      ),
    )
  }, [weapon, parent, skills, skillMap])

  if (loading || skillsLoading) return <LoadingSkeleton />

  if (error || !weapon) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
        <Link to="/weapons" className="text-accent-cyan hover:underline text-sm">← 返回武器圖鑑</Link>
        <div className="mt-8 bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          {error ? `載入失敗：${error.message}` : '找不到此武器'}
        </div>
      </div>
    )
  }

  const pilot       = weapon.exclusiveFor ? pilotMap[weapon.exclusiveFor] : undefined
  const hasFixedMod = !!(weapon.fixedMod?.planName)
  const hasFloatMod = !!(weapon.floatingMod?.planName)
  const hasSlots    = weapon.triggerSlots > 0 || weapon.effectSlots > 0 || weapon.componentLimit > 0

  /**
   * B-2 基礎屬性：先列成資料再過濾，不寫成八個 JSX 條件式——
   * 收掉的欄位還要拿來組說明句（variableStatNote），兩邊必須來自同一份清單才不會說謊。
   * keys 對齊 Weapon 的欄位名；射程是 minRange + maxRange 合成的單一格，故整組判斷。
   */
  const statCells: { keys: string[]; label: string; value: React.ReactNode; sub?: string }[] = [
    { keys: ['attack'],    label: '攻擊力', value: naOr(weapon, 'attack', weapon.attack) },
    { keys: ['accuracy'],  label: '命中',   value: naOr(weapon, 'accuracy', weapon.accuracy.toLocaleString()) },
    { keys: ['critValue'], label: '暴擊',   value: naOr(weapon, 'critValue', weapon.critValue.toLocaleString()) },
    { keys: ['weight'],    label: '重量',   value: naOr(weapon, 'weight', weapon.weight) },
    {
      keys: ['minRange', 'maxRange'],
      label: '射程',
      value: naOr(weapon, ['minRange', 'maxRange'], formatRange(weapon)),
      /* 射程不適用時連射程型態一起收掉——否則會出現「射程 — / 菱形」這種半真半假的組合 */
      sub: isNaStat(weapon, ['minRange', 'maxRange']) ? undefined : RANGE_TYPE_LABELS[weapon.rangeType],
    },
    { keys: ['ammoCount'],       label: '彈藥量',   value: naOr(weapon, 'ammoCount', weapon.ammoCount === 0 ? '∞' : weapon.ammoCount) },
    { keys: ['hitCount'],        label: '連擊數',   value: naOr(weapon, 'hitCount', weapon.hitCount) },
    { keys: ['kindCoefficient'], label: '種類係數', value: naOr(weapon, 'kindCoefficient', weapon.kindCoefficient.toFixed(2)) },
  ]
  const visibleStats    = statCells.filter((c) => !isVariableStat(weapon, c.keys))
  const variableStatMsg = variableStatNote(statCells.filter((c) => isVariableStat(weapon, c.keys)).map((c) => c.label))

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl space-y-6">

      {/* Breadcrumb */}
      <div>
        <Link to="/weapons" className="text-accent-cyan hover:underline text-sm">
          ← 返回武器圖鑑
        </Link>
      </div>

      {/* ── B-1 Hero + B-5 Component Slots ──────────────────────────────────── */}
      <div className={hasSlots ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : ''}>

        <div className="bg-bg-card border border-border rounded-xl p-6">
          <div className="flex items-start gap-4">
            <WeaponIcon icon={weapon.icon} name={weapon.name} size="lg" isExclusive={weapon.isExclusive} />
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-3 flex-wrap mb-3">
                <h1 className="text-2xl font-bold text-text-primary leading-tight">{weapon.name}</h1>
                <WeaponRarityBadge rarity={weapon.rarity} />
              </div>

              <div className="flex flex-wrap gap-2">
                <WeaponTypeBadge type={weapon.type} />
                <span className="px-2 py-0.5 rounded text-[13px] border text-text-secondary bg-bg-dark border-border">
                  {weapon.kind}
                </span>
                <WeaponEquipSlotBadge slot={weapon.equipSlot} />
                <WeaponMechRestrictionBadge restriction={weapon.mechRestriction} />
                {isCompositeWeapon(weapon) && <CompositeBadge />}
                {weapon.isFixedArmament && <FixedArmamentBadge />}
              </div>

              {weapon.isExclusive && pilot && weapon.exclusiveFor && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[13px] text-accent-yellow font-bold">⭐ 專屬武器</span>
                  <ExclusivePilotLink
                    pilotId={weapon.exclusiveFor}
                    pilot={pilot}
                    size="md"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {hasSlots && (
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <SectionHeading>元件插槽</SectionHeading>
            <div className="flex flex-wrap gap-8">

              <div>
                <div className="text-[13px] text-text-dim mb-2">觸發元件</div>
                <SlotBoxes
                  count={weapon.triggerSlots}
                  colorClass="border-accent-orange text-accent-orange"
                />
              </div>

              <div>
                <div className="text-[13px] text-text-dim mb-2">應用元件</div>
                <SlotBoxes
                  count={weapon.effectSlots}
                  colorClass="border-accent-cyan text-accent-cyan"
                />
              </div>

              {weapon.componentLimit > 0 && (
                <div className="border-l border-border pl-8">
                  <div className="text-[13px] text-text-dim mb-2">元件上限</div>
                  <div className="text-2xl font-bold text-accent-red font-[JetBrains_Mono,monospace]">
                    {weapon.componentLimit}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ── B-1 進階鏈（PLAN-031）：前置 ← 本武器 → 可進階為 ──────────────────── */}
      {(parent || children.length > 0) && (
        <div className="bg-bg-card border border-border rounded-xl p-5">
          <SectionHeading>製作 · 進階關係</SectionHeading>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {parent && (
              <>
                <span className="text-xs text-text-dim">前置</span>
                <WeaponChainLink weapon={parent} />
                <span className="text-text-dim">→</span>
              </>
            )}
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-dark border border-accent-cyan/50">
              <WeaponIcon icon={weapon.icon} name={weapon.name} size="sm" isExclusive={weapon.isExclusive} />
              <span className="text-sm font-bold text-text-primary">{weapon.name}</span>
            </span>
            {children.length > 0 && (
              <>
                <span className="text-text-dim">→</span>
                <span className="text-xs text-text-dim">可進階為</span>
                {children.map((c) => (
                  <WeaponChainLink key={c.id} weapon={c} />
                ))}
              </>
            )}
          </div>
          {isCompositeWeapon(weapon) && weapon.upgrade?.fusedBackpackId && (
            <FusedBackpackNote backpackId={weapon.upgrade.fusedBackpackId} />
          )}
        </div>
      )}

      {/* ── B-2 Stats ────────────────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <SectionHeading>基礎屬性</SectionHeading>
        {visibleStats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {visibleStats.map((c) => (
              <StatCell key={c.label} label={c.label} value={c.value} sub={c.sub} />
            ))}
          </div>
        )}
        {/* 收掉的格子必須有交代，否則看起來像資料沒建完 */}
        {variableStatMsg && (
          <p className={`text-[13px] text-text-dim leading-relaxed ${visibleStats.length ? 'mt-3' : ''}`}>
            {variableStatMsg}
          </p>
        )}
      </div>

      {/* ── B-3 Skills ───────────────────────────────────────────────────────── */}
      {skills.length > 0 && (
        <div>
          <SectionHeading>武器技能</SectionHeading>
          <div className="space-y-3">
            {skills.map((skill, i) => (
              <WeaponSkillCard
                key={i}
                skill={skill}
                fusedLabel={
                  fusedSkillNames.has(skill.name)
                    ? isCompositeWeapon(weapon) ? '融合技能' : '進階新增'
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* ── B-4 Mods ─────────────────────────────────────────────────────────── */}
      {(hasFixedMod || hasFloatMod) && (
        <div>
          <SectionHeading>改裝資訊</SectionHeading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {hasFixedMod && (
              <div className="bg-bg-card border border-border rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-[11px] text-accent-orange font-bold tracking-widest uppercase font-[Orbitron,sans-serif]">
                    固定改裝
                  </span>
                  <span className="text-sm font-bold text-text-primary">{weapon.fixedMod.planName}</span>
                </div>
                <div className="text-[13px] text-text-dim mb-3">
                  可改等級上限{' '}
                  <span className="text-accent-red font-bold font-[JetBrains_Mono,monospace]">
                    {weapon.fixedMod.maxLevel}
                  </span>
                </div>
                {weapon.fixedMod.effects.length > 0 && (
                  <div className="space-y-2">
                    {weapon.fixedMod.effects.map((e, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-text-secondary">{MOD_STAT_LABELS[e.stat] ?? e.stat}</span>
                        <span className="text-accent-red font-bold font-[JetBrains_Mono,monospace]">
                          +{e.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {hasFloatMod && (
              <div className="bg-bg-card border border-border rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-[11px] text-accent-cyan font-bold tracking-widest uppercase font-[Orbitron,sans-serif]">
                    浮動改裝
                  </span>
                  <span className="text-sm font-bold text-text-primary">{weapon.floatingMod.planName}</span>
                </div>
                <div className="text-[13px] text-text-dim mb-3">
                  可填{' '}
                  <span className="text-accent-red font-bold font-[JetBrains_Mono,monospace]">
                    {weapon.floatingMod.slots}
                  </span>{' '}
                  個效果
                </div>
                {weapon.floatingMod.possibleEffects.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-text-dim border-b border-border">
                          <th className="text-left pb-2 font-medium">效果</th>
                          <th className="text-left pb-2 font-medium">條件</th>
                          <th className="text-right pb-2 font-medium">數值範圍</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {weapon.floatingMod.possibleEffects.map((e, i) => (
                          <tr key={i} className="hover:bg-bg-dark/50 transition-colors">
                            <td className="py-1.5 text-text-secondary">
                              {MOD_STAT_LABELS[e.stat] ?? e.stat}
                            </td>
                            <td className="py-1.5 text-text-dim">
                              {e.condition ?? '無條件'}
                            </td>
                            <td className="py-1.5 text-right font-bold text-accent-red font-[JetBrains_Mono,monospace]">
                              {e.min} ~ {e.max}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}


    </div>
  )
}
