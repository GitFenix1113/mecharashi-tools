import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useComponents } from '../../hooks/useFirestore'
import { ComponentType, ComponentsWType, ItemRarity, COMPONENT_WEAPON_TYPES } from '../../types/enums'
import type { Component, ConditionComponent, FunctionComponent } from '../../types'
import { highlightNumbers } from '../../utils/moduleStats'
import { RefText } from '../../components/RefText'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ComponentIcon } from '../../components/ComponentIcon'
import { BossDropTooltip, BossDropSection } from '../../components/BossDropTooltip'
import { getAllStages, componentDropsFromStage } from '../../data/bossDrops'
import {
  RarityBadge,
  ComponentTypeBadge,
  WTypeBadge,
  ConditionTypeBadge,
  EffectTypeBadge,
  EFFECT_TYPE_LABELS,
} from '../../components/ComponentBadges'

const PAGE_SIZE = 24

type TypeFilter = 'all' | 'Condition' | 'Function'
type WFilter = 'all' | 'W' | 'Normal'

const MODULE_SUBTYPE_LABELS: Record<number, string> = {
  1: '命中相關', 2: '攻擊方式', 3: '受擊相關', 4: '耐久相關',
  5: 'AP相關',  6: '戰中效果', 7: '戰後效果', 8: '攻擊結果',
  9: '距離相關', 10: '特殊效果', 11: '移動相關',
}

const RARITIES = [ItemRarity.EX, ItemRarity.S, ItemRarity.A, ItemRarity.B] as const

const RARITY_ORDER: Record<string, number> = {
  [ItemRarity.EX]: 0,
  [ItemRarity.S]:  1,
  [ItemRarity.A]:  2,
  [ItemRarity.B]:  3,
}

function isCondition(c: Component): c is ConditionComponent {
  return c.componentType === ComponentType.CONDITION
}

function isFunction(c: Component): c is FunctionComponent {
  return c.componentType === ComponentType.FUNCTION
}

function ComponentDetail({ comp }: { comp: Component }) {
  const restrictedWeapons =
    comp.allowedWeaponTypes.length > 0 && comp.allowedWeaponTypes.length < COMPONENT_WEAPON_TYPES.length
      ? comp.allowedWeaponTypes
      : null

  return (
    <div className="space-y-4 pb-2">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ComponentIcon comp={comp} size={64} />
        <div>
          <h3 className="font-bold text-base leading-tight">{comp.name}</h3>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <RarityBadge rarity={comp.rarity} />
            <ComponentTypeBadge type={comp.componentType} />
            {comp.componentsWType === ComponentsWType.W && <WTypeBadge />}
          </div>
        </div>
      </div>

      {/* Tags row */}
      <div className="flex flex-wrap gap-1.5">
        {isCondition(comp) && <ConditionTypeBadge conditionType={comp.conditionType} />}
        {isFunction(comp) && <EffectTypeBadge effectType={comp.effectType} />}
        {comp.moduleSubtype > 0 && (
          <span className="text-[13px] px-1.5 py-0.5 rounded border text-text-dim bg-bg-dark border-border">
            {MODULE_SUBTYPE_LABELS[comp.moduleSubtype] ?? `子類型 ${comp.moduleSubtype}`}
          </span>
        )}
        {comp.probabilityLevel > 0 && (
          <span className="text-[13px] px-1.5 py-0.5 rounded border text-text-dim bg-bg-dark border-border">
            等級 {comp.probabilityLevel}
          </span>
        )}
      </div>

      {/* Condition text (觸元件 trigger condition) */}
      {isCondition(comp) && comp.condition && (
        <div>
          <p className="text-xs text-text-dim mb-1">觸發條件</p>
          <p className="text-sm text-text-secondary leading-relaxed">
            {highlightNumbers(comp.condition)}
          </p>
        </div>
      )}

      {/* Effect description */}
      {comp.description && (
        <div>
          <p className="text-xs text-text-dim mb-1">效果描述</p>
          <p className="text-sm text-text-secondary leading-relaxed">
            <RefText text={comp.description} refs={comp.descriptionRefs} />
          </p>
        </div>
      )}

      {/* Weapon restrictions */}
      {restrictedWeapons && (
        <div>
          <p className="text-xs text-text-dim mb-1">限定武器類型</p>
          <div className="flex flex-wrap gap-1.5">
            {restrictedWeapons.map((wt) => (
              <span
                key={wt}
                className="text-[13px] px-1.5 py-0.5 rounded border text-accent-orange bg-accent-orange/10 border-accent-orange/30"
              >
                {wt}
              </span>
            ))}
          </div>
        </div>
      )}

      {comp.componentsWType === ComponentsWType.W && (
        <p className="text-xs text-accent-yellow">⚠ 僅限雙手 / 背後武器可裝備</p>
      )}

      {/* Boss drop sources */}
      <BossDropSection comp={comp} />
    </div>
  )
}

export default function ComponentsPage() {
  const { data: components, loading, error } = useComponents()
  const isMobile = useIsMobile()

  const [typeFilter, setTypeFilter]               = useState<TypeFilter>('all')
  const [rarityFilter, setRarityFilter]           = useState<string | null>(null)
  const [subtypeFilter, setSubtypeFilter]         = useState<number | null>(null)
  const [effectTypeFilter, setEffectTypeFilter]   = useState<string | null>(null)
  const [wTypeFilter, setWTypeFilter]             = useState<WFilter>('all')
  const [stageFilter, setStageFilter]             = useState<number | null>(null)
  const [searchText, setSearchText]               = useState('')
  const [sheetComp, setSheetComp]                 = useState<Component | null>(null)
  const [displayCount, setDisplayCount]           = useState(PAGE_SIZE)

  const STAGES = useMemo(() => getAllStages(components), [components])

  useEffect(() => { setDisplayCount(PAGE_SIZE) }, [typeFilter, rarityFilter, subtypeFilter, effectTypeFilter, wTypeFilter, stageFilter, searchText])

  const showEffectFilter = typeFilter === 'all' || typeFilter === 'Function'

  const filtered = components.filter((c) => {
    if (typeFilter !== 'all' && c.componentType !== typeFilter) return false
    if (rarityFilter && c.rarity !== rarityFilter) return false
    if (subtypeFilter !== null && c.moduleSubtype !== subtypeFilter) return false
    if (wTypeFilter !== 'all' && c.componentsWType !== wTypeFilter) return false
    if (stageFilter !== null && !componentDropsFromStage(c, stageFilter)) return false
    // effectType filter applies only to Function components
    if (effectTypeFilter && isFunction(c) && c.effectType !== effectTypeFilter) return false
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      const inName      = c.name.toLowerCase().includes(q)
      const inDesc      = c.description.toLowerCase().includes(q)
      const inCondition = isCondition(c) && c.condition.toLowerCase().includes(q)
      if (!inName && !inDesc && !inCondition) return false
    }
    return true
  }).sort((a, b) => (RARITY_ORDER[a.rarity] ?? 99) - (RARITY_ORDER[b.rarity] ?? 99))

  const paginated = filtered.slice(0, displayCount)

  const filterBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/40'
        : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  const handleTypeChange = (t: TypeFilter) => {
    setTypeFilter(t)
    if (t === 'Condition') setEffectTypeFilter(null)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      <BottomSheet open={!!sheetComp} onClose={() => setSheetComp(null)}>
        {sheetComp && <ComponentDetail comp={sheetComp} />}
      </BottomSheet>

      {/* Page header */}
      <div className="mb-8">
        <span className="text-xs text-accent-yellow tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Database
        </span>
        <h1 className="text-3xl font-bold mt-2">元件圖鑑</h1>
        <p className="text-text-secondary mt-2">
          觸元件（Condition）與應元件（Function）完整圖鑑，含觸發條件與效果類型篩選<strong className="text-red-500">（篩選條件有BUG，還在修）</strong>。
        </p>
        <Link
          to="/guides/component-drops"
          className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-[13px] font-bold border border-accent-orange/50 bg-accent-orange/10 text-accent-orange transition-colors hover:bg-accent-orange/20 no-underline"
        >
          📋 元件掉落總表 · 看各關 BOSS 掉落 →
        </Link>
      </div>

      {/* Filter panel */}
      <div className="bg-bg-card border border-border rounded-xl p-4 mb-6 flex flex-col gap-3">
        {/* Search */}
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="搜尋元件名稱或描述..."
          className="w-full bg-bg-dark border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-border-accent"
        />

        {/* Type filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">元件類型</span>
          {(['all', 'Condition', 'Function'] as const).map((t) => (
            <button key={t} className={filterBtn(typeFilter === t)} onClick={() => handleTypeChange(t)}>
              {t === 'all' ? '全部' : t === 'Condition' ? '觸元件' : '應元件'}
            </button>
          ))}
        </div>

        {/* Rarity filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">稀有度</span>
          <button className={filterBtn(rarityFilter === null)} onClick={() => setRarityFilter(null)}>
            全部
          </button>
          {RARITIES.map((r) => (
            <button
              key={r}
              className={filterBtn(rarityFilter === r)}
              onClick={() => setRarityFilter((prev) => (prev === r ? null : r))}
            >
              {r}
            </button>
          ))}
        </div>

        {/* moduleSubtype filter (single-select) */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">子類型</span>
          <button className={filterBtn(subtypeFilter === null)} onClick={() => setSubtypeFilter(null)}>
            全部
          </button>
          {Object.entries(MODULE_SUBTYPE_LABELS).map(([key, label]) => {
            const value = Number(key)
            return (
              <button
                key={key}
                className={filterBtn(subtypeFilter === value)}
                onClick={() => setSubtypeFilter((prev) => (prev === value ? null : value))}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* effectType filter (Function / All mode) */}
        {showEffectFilter && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-text-dim mr-1">效果類型</span>
            <button
              className={filterBtn(effectTypeFilter === null)}
              onClick={() => setEffectTypeFilter(null)}
            >
              全部
            </button>
            {Object.entries(EFFECT_TYPE_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={filterBtn(effectTypeFilter === key)}
                onClick={() => setEffectTypeFilter((prev) => (prev === key ? null : key))}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* W-type filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">W型</span>
          {(['all', 'W', 'Normal'] as const).map((w) => (
            <button key={w} className={filterBtn(wTypeFilter === w)} onClick={() => setWTypeFilter(w)}>
              {w === 'all' ? '全部' : w === 'W' ? 'W型' : '一般'}
            </button>
          ))}
        </div>

        {/* Stage (Boss drop) filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">Boss 關卡</span>
          <button className={filterBtn(stageFilter === null)} onClick={() => setStageFilter(null)}>
            全部
          </button>
          {STAGES.map((s) => (
            <button
              key={s}
              className={filterBtn(stageFilter === s)}
              onClick={() => setStageFilter((prev) => (prev === s ? null : s))}
            >
              第 {s} 關
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 mb-4 text-sm text-accent-red">
          資料載入失敗：{error.message}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="text-center py-20 text-text-dim">載入中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-text-dim">
          {components.length === 0 ? '尚無元件資料' : '找不到符合條件的元件'}
        </div>
      ) : (
        <>
          <p className="text-xs text-text-dim mb-4">
            顯示 {Math.min(displayCount, filtered.length)} / {filtered.length} 筆{filtered.length !== components.length ? `（全 ${components.length} 筆）` : ''}{isMobile ? '，點擊卡片查看詳情' : ''}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginated.map((comp) => {
              const hasRestriction =
                comp.allowedWeaponTypes.length > 0 &&
                comp.allowedWeaponTypes.length < COMPONENT_WEAPON_TYPES.length

              return (
                <BossDropTooltip key={comp.id} comp={comp}>
                  <div
                    className={`bg-bg-card border border-border rounded-xl p-4 transition-colors hover:border-border-accent ${
                      isMobile ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => isMobile && setSheetComp(comp)}
                  >
                    <div className="flex items-start gap-3">
                      <ComponentIcon comp={comp} size={48} />
                      <div className="flex-1 min-w-0">
                        {/* Name + rarity + type badges */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                          <h3 className="font-bold text-sm">{comp.name}</h3>
                          <RarityBadge rarity={comp.rarity} />
                          <ComponentTypeBadge type={comp.componentType} />
                        </div>

                        {/* moduleSubtype + probabilityLevel */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {comp.moduleSubtype > 0 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded border text-text-dim bg-bg-dark border-border">
                              {MODULE_SUBTYPE_LABELS[comp.moduleSubtype] ?? `子類型 ${comp.moduleSubtype}`}
                            </span>
                          )}
                          {comp.probabilityLevel > 0 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded border text-text-dim bg-bg-dark border-border">
                              Lv. {comp.probabilityLevel}
                            </span>
                          )}
                        </div>

                        {/* Primary description */}
                        <p className="text-xs text-text-secondary leading-relaxed">
                          {isCondition(comp)
                            ? highlightNumbers(comp.condition)
                            : <RefText text={comp.description} refs={comp.descriptionRefs} />}
                        </p>

                        {/* Weapon restriction hint */}
                        {hasRestriction && (
                          <p className="text-[11px] text-text-dim mt-1.5">
                            限定：{comp.allowedWeaponTypes.join('・')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </BossDropTooltip>
              )
            })}
          </div>

          {displayCount < filtered.length && (
            <div className="mt-6 text-center">
              <button
                className="px-6 py-2.5 rounded-xl border border-border bg-bg-card text-text-secondary text-sm hover:border-border-accent hover:text-text-primary transition-colors cursor-pointer"
                onClick={() => setDisplayCount((n) => n + PAGE_SIZE)}
              >
                載入更多（{filtered.length - displayCount} 筆）
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
