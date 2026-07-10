import { useState, useLayoutEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { assetUrl } from '../../utils/assets'
import { useModules, useMechNameMap, useMechs } from '../../hooks/useFirestore'
import { ModuleSlot, ModuleRarity, MechPartPosition } from '../../types/enums'
import type { Module, Mech } from '../../types'
import { STAT_LABELS } from '../../utils/moduleStats'
import { BottomSheet } from '../../components/BottomSheet'
import { RefText } from '../../components/RefText'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useDragOffset } from '../../hooks/useDragOffset'

const SLOT_LABELS: Record<string, string> = {
  [ModuleSlot.SLOT_4]:    '特性模組',
  [ModuleSlot.SLOT_8]:    '8級模組',
  [ModuleSlot.UNIVERSAL]: '通用模組',
}

const SLOT_STYLES: Record<string, string> = {
  [ModuleSlot.SLOT_4]:    'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
  [ModuleSlot.SLOT_8]:    'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
  [ModuleSlot.UNIVERSAL]: 'text-accent-green bg-accent-green/10 border-accent-green/30',
}

const PART_LABELS: Record<string, string> = {
  [MechPartPosition.TORSO]:     '軀幹',
  [MechPartPosition.LEFT_ARM]:  '左臂',
  [MechPartPosition.RIGHT_ARM]: '右臂',
  [MechPartPosition.LEGS]:      '腿部',
}

const RARITY_STYLES: Record<string, string> = {
  [ModuleRarity.S]: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/40',
  [ModuleRarity.A]: 'text-accent-purple bg-accent-purple/10 border-accent-purple/40',
}

const CATALOG_SLOTS = [ModuleSlot.SLOT_4, ModuleSlot.SLOT_8, ModuleSlot.UNIVERSAL] as const



function LevelTooltipRows({ mod }: { mod: Module }) {
  const levels = mod.levels ?? []
  const activeStats = STAT_LABELS.filter(({ key }) =>
    levels.some((lv) => ((lv[key] as number | undefined) ?? 0) > 0)
  )
  return (
    <>
      {levels.map((lv) => (
        <div key={lv.level} className="bg-bg-dark rounded-lg p-2.5">
          <div className="flex items-start gap-2">
            <span className="text-[13px] px-1.5 py-0.5 rounded border text-accent-orange bg-accent-orange/10 border-accent-orange/30 font-bold flex-shrink-0">
              Lv.{lv.level}
            </span>
            {lv.description && (
              <span className="text-[14px] text-text-secondary leading-tight"><RefText text={lv.description} refs={lv.descriptionRefs ?? mod.descriptionRefs} /></span>
            )}
          </div>
          {activeStats.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 pl-1">
              {activeStats.map(({ key, label, color, suffix, prefix }) => {
                const val = (lv[key] as number | undefined) ?? 0
                if (!val) return null
                return (
                  <span key={key} className={`text-[14px] ${color}`}>
                    {label}{prefix ?? '+'}{val}{suffix}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

function LevelTooltip({ mod, pinned, mobile = false }: { mod: Module; pinned: boolean; mobile?: boolean }) {
  if ((mod.levels?.length ?? 0) === 0) return null

  if (mobile) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-accent-orange">{mod.name}</span>
          <span className="text-[13px] text-text-dim">各等級效果</span>
        </div>
        <LevelTooltipRows mod={mod} />
      </div>
    )
  }

  return (
    <div className="w-72 max-h-[min(90vh,_600px)] flex flex-col bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl">
      <div
        data-drag-handle
        className={`flex items-center justify-between mb-3 flex-shrink-0 ${pinned ? 'cursor-move select-none' : ''}`}
        title={pinned ? '拖曳標題可移動視窗' : undefined}
      >
        <span className="text-xs font-bold text-accent-orange">{mod.name}</span>
        <span className="text-[13px] text-text-dim">各等級效果{pinned ? ' · 📌' : ''}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
        <LevelTooltipRows mod={mod} />
      </div>
      {!pinned && (
        <p className="text-[13px] text-text-dim mt-2 text-center flex-shrink-0">點擊模組固定此視窗</p>
      )}
    </div>
  )
}

interface TooltipState {
  modId: string
  x: number
  anchorTop: number
}

function TooltipPortal({ mod, pinned, x, anchorTop }: {
  mod: Module; pinned: boolean; x: number; anchorTop: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)
  const { offset, dragging, dragHandlers } = useDragOffset(pinned, mod.id)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, mod.id])

  return createPortal(
    <div
      ref={ref}
      className={`fixed z-50 ${pinned ? 'pointer-events-auto' : 'pointer-events-none'} ${dragging ? 'select-none' : ''}`}
      style={{ left: x + offset.dx, top: top + offset.dy, touchAction: pinned ? 'none' : undefined }}
      onClick={(e) => e.stopPropagation()}
      {...(pinned ? dragHandlers : {})}
    >
      <LevelTooltip mod={mod} pinned={pinned} />
    </div>,
    document.body
  )
}

export default function ModulesPage() {
  const { data: modules, loading, error: modulesError } = useModules()
  const { data: mechNameMap } = useMechNameMap()
  const { data: mechs } = useMechs()

  // 反查索引：模組 ID → 採用此模組的機甲清單。
  // 機甲透過 module4Id（特性）/ module8Id（8級）/ moduleFixedIds（固定）引用模組；
  // 同一個 8 級模組可被多台機甲共用，正向資料只存在 mechs 端，需反查才能得知。
  // mechs 集合已由 useMechNameMap 載入並快取，建索引為純記憶體運算，無額外 Firestore 讀取。
  const mechsByModuleId = useMemo(() => {
    const map = new Map<string, Mech[]>()
    const add = (modId: string | null | undefined, mech: Mech) => {
      if (!modId) return
      const arr = map.get(modId)
      if (arr) {
        if (!arr.some((m) => m.id === mech.id)) arr.push(mech)
      } else {
        map.set(modId, [mech])
      }
    }
    for (const mech of mechs) {
      add(mech.module4Id, mech)
      add(mech.module8Id, mech)
      for (const fid of mech.moduleFixedIds ?? []) add(fid, mech)
    }
    return map
  }, [mechs])

  const [searchText, setSearchText] = useState('')
  const [searchByName, setSearchByName] = useState(true)
  const [searchByDesc, setSearchByDesc] = useState(true)
  const [slotFilters, setSlotFilters] = useState<Set<string>>(new Set())
  const [rarityFilter, setRarityFilter] = useState<string | null>(null)
  const [showBuiltIn, setShowBuiltIn] = useState(false)

  const isMobile = useIsMobile()
  const [hoverTooltip, setHoverTooltip] = useState<TooltipState | null>(null)
  const [pinnedTooltip, setPinnedTooltip] = useState<TooltipState | null>(null)
  const [sheetMod, setSheetMod] = useState<Module | null>(null)

  // Catalog-eligible count (slot exclusion only, ignoring user filters)
  const catalogCount = modules.filter(
    (m) => m.slot !== ModuleSlot.BUILT_IN && m.slot !== ModuleSlot.EXCLUSIVE
  ).length

  const filtered = modules.filter((m) => {
    if (m.slot === ModuleSlot.EXCLUSIVE) return false
    if (m.slot === ModuleSlot.BUILT_IN && !showBuiltIn) return false
    if (slotFilters.size > 0 && !slotFilters.has(m.slot)) return false
    if (rarityFilter && m.rarity !== rarityFilter) return false
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      const matchName = searchByName && m.name.toLowerCase().includes(q)
      const matchDesc = searchByDesc && (m.description ?? '').toLowerCase().includes(q)
      if (!matchName && !matchDesc) return false
    }
    return true
  })

  const toggleSlot = (slot: string) => {
    setSlotFilters((prev) => {
      const next = new Set(prev)
      if (next.has(slot)) next.delete(slot)
      else next.add(slot)
      return next
    })
  }

  const computePos = (cardEl: HTMLDivElement): { x: number; anchorTop: number } => {
    const rect = cardEl.getBoundingClientRect()
    const tooltipW = 296
    const x = rect.right + 8 + tooltipW > window.innerWidth ? rect.left - tooltipW - 8 : rect.right + 8
    return { x, anchorTop: rect.top }
  }

  const handleMouseEnter = (modId: string, cardEl: HTMLDivElement) => {
    if (isMobile || pinnedTooltip) return
    const mod = modules.find((m) => m.id === modId)
    if (!mod?.levels?.length) return
    setHoverTooltip({ modId, ...computePos(cardEl) })
  }

  const handleMouseLeave = () => {
    if (isMobile) return
    if (!pinnedTooltip) setHoverTooltip(null)
  }

  const handleCardClick = (modId: string, cardEl: HTMLDivElement, e: React.MouseEvent) => {
    e.stopPropagation()
    const mod = modules.find((m) => m.id === modId)
    if (!mod?.levels?.length) {
      if (!isMobile) setPinnedTooltip(null)
      return
    }
    if (isMobile) {
      setSheetMod(mod)
      return
    }
    if (pinnedTooltip?.modId === modId) {
      setPinnedTooltip(null)
    } else {
      setPinnedTooltip({ modId, ...computePos(cardEl) })
      setHoverTooltip(null)
    }
  }

  const handleContainerClick = () => {
    setPinnedTooltip(null)
  }

  const activeTooltip = pinnedTooltip ?? hoverTooltip
  const activeModId = activeTooltip?.modId ?? null
  const activeMod = activeModId ? modules.find((m) => m.id === activeModId) : null

  const filterBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
        : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl" onClick={handleContainerClick}>

      {activeMod && activeTooltip && !isMobile && (
        <TooltipPortal
          key={activeTooltip.modId}
          mod={activeMod}
          pinned={!!pinnedTooltip}
          x={activeTooltip.x}
          anchorTop={activeTooltip.anchorTop}
        />
      )}

      <BottomSheet open={!!sheetMod} onClose={() => setSheetMod(null)}>
        {sheetMod && <LevelTooltip mod={sheetMod} pinned={false} mobile />}
      </BottomSheet>

      <div className="mb-8">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Database
        </span>
        <h1 className="text-3xl font-bold mt-2">模組圖鑑</h1>
        <p className="text-text-secondary mt-2">
          特性模組、8級模組、通用模組完整列表，含對應機甲與技能效果。
        </p>
      </div>

      {/* Filters */}
      <div className="bg-bg-card border border-border rounded-xl p-4 mb-6 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="搜尋模組..."
          className="w-full bg-bg-dark border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-border-accent"
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 items-center">
          {(['name', 'desc'] as const).map((scope) => {
            const checked = scope === 'name' ? searchByName : searchByDesc
            const setter = scope === 'name' ? setSearchByName : setSearchByDesc
            const label  = scope === 'name' ? '搜名稱' : '搜能力'
            return (
              <label key={scope} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setter(e.target.checked)}
                  className="accent-accent-orange w-3.5 h-3.5"
                />
                <span className="text-xs text-text-secondary">{label}</span>
              </label>
            )
          })}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBuiltIn}
              onChange={(e) => setShowBuiltIn(e.target.checked)}
              className="accent-accent-orange w-3.5 h-3.5"
            />
            <span className="text-xs text-text-secondary">顯示副模組</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">模組類型</span>
          <button className={filterBtn(slotFilters.size === 0)} onClick={() => setSlotFilters(new Set())}>全部</button>
          {CATALOG_SLOTS.map((slot) => (
            <button
              key={slot}
              className={filterBtn(slotFilters.has(slot))}
              onClick={() => toggleSlot(slot)}
            >
              {SLOT_LABELS[slot]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">稀有度</span>
          <button className={filterBtn(rarityFilter === null)} onClick={() => setRarityFilter(null)}>全部</button>
          {([ModuleRarity.S, ModuleRarity.A] as const).map((r) => (
            <button
              key={r}
              className={filterBtn(rarityFilter === r)}
              onClick={() => setRarityFilter(prev => prev === r ? null : r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {modulesError && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 mb-4 text-sm text-accent-red">
          資料載入失敗：{modulesError.message}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-text-dim">載入中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-text-dim">
          {catalogCount === 0
            ? modules.length === 0
              ? 'Firestore 尚無模組資料，請執行 scrape-modules.js 爬蟲後再遷移。'
              : '所有模組均為副模組（已排除），請執行 scrape-modules.js 更新特性/8級/通用模組。'
            : '找不到符合條件的模組'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((mod) => {
            const slotStyle = SLOT_STYLES[mod.slot] || SLOT_STYLES[ModuleSlot.UNIVERSAL]
            const rarityStyle = RARITY_STYLES[mod.rarity] || ''
            const hasLevels = (mod.levels?.length ?? 0) > 0
            const isPinned = pinnedTooltip?.modId === mod.id
            // 採用此模組的機甲名稱（反查索引優先；查無時退回模組自身 boundMechId）
            const usedByMechs = mechsByModuleId.get(mod.id) ?? []
            const adopterNames = (
              usedByMechs.length > 0
                ? usedByMechs.map((m) => m.name)
                : mod.boundMechId
                  ? [mechNameMap[mod.boundMechId] ?? mod.boundMechId]
                  : []
            ).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
            return (
              <div
                key={mod.id}
                className={`bg-bg-card border rounded-xl p-4 transition-colors ${
                  hasLevels ? 'cursor-pointer' : ''
                } ${isPinned ? 'border-accent-orange' : 'border-border hover:border-border-accent'}`}
                onMouseEnter={(e) => handleMouseEnter(mod.id, e.currentTarget)}
                onMouseLeave={handleMouseLeave}
                onClick={(e) => handleCardClick(mod.id, e.currentTarget, e)}
              >
                <div className="flex items-start gap-3">
                  {mod.icon && (
                    <img
                      src={assetUrl(mod.icon)}
                      alt={mod.name}
                      className="w-12 h-12 rounded-lg object-cover bg-bg-dark border border-border flex-shrink-0"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-bold text-sm">{mod.name}</h3>
                      <span className={`text-[13px] px-1.5 py-0.5 rounded border ${rarityStyle}`}>
                        {mod.rarity}
                      </span>
                      <span className={`text-[13px] px-1.5 py-0.5 rounded border ${slotStyle}`}>
                        {SLOT_LABELS[mod.slot] || mod.slot}
                      </span>
                      {hasLevels && (
                        <span className="text-[13px] text-text-dim ml-auto">
                          {isPinned ? '📌' : '◉ 等級效果'}
                        </span>
                      )}
                    </div>
                    {adopterNames.length > 0 && (
                      <div className="text-[14px] text-text-dim mb-1">
                        {adopterNames.length > 1 ? '採用機甲' : '對應機甲'}：
                        <span className="text-accent-cyan">{adopterNames.join('、')}</span>
                        {mod.boundPart && (Array.isArray(mod.boundPart) ? mod.boundPart.length > 0 : true) && (
                          <span className="ml-2 text-accent-purple">
                            ({(Array.isArray(mod.boundPart) ? mod.boundPart : [mod.boundPart as string])
                              .map((p) => PART_LABELS[p] ?? p)
                              .join('・')})
                          </span>
                        )}
                      </div>
                    )}
                    {(Array.isArray(mod.source) && mod.source.length > 0) && (
                      <div className="text-[14px] text-text-dim mb-1">
                        來源：<span className="text-text-secondary">{mod.source.join('、')}</span>
                      </div>
                    )}
                    <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">
                      <RefText text={mod.description} refs={mod.descriptionRefs} />
                    </p>
                    {(mod.dmg > 0 || (mod.crit_rate ?? 0) > 0 || mod.critDmg > 0 || (mod.acc_rate ?? 0) > 0 || (mod.firepower_rate ?? 0) > 0 || (mod.armor_rate ?? 0) > 0 || (mod.output_bonus ?? 0) > 0 || (mod.dodge_rate ?? 0) > 0 || (mod.durable_rate ?? 0) > 0 || (mod.dmg_resist_rate ?? 0) > 0 || (mod.crit_resist_rate ?? 0) > 0) && (
                      <div className="flex gap-3 mt-2 text-[14px] flex-wrap">
                        {mod.dmg > 0 && <span className="text-accent-orange">傷害+{mod.dmg}%</span>}
                        {(mod.crit_rate ?? 0) > 0 && <span className="text-accent-yellow">暴擊+{mod.crit_rate}%</span>}
                        {mod.critDmg > 0 && <span className="text-accent-red">爆傷+{mod.critDmg}%</span>}
                        {(mod.acc_rate ?? 0) > 0 && <span className="text-accent-blue">命中+{mod.acc_rate}%</span>}
                        {(mod.firepower_rate ?? 0) > 0 && <span className="text-accent-green">火力+{mod.firepower_rate}%</span>}
                        {(mod.armor_rate ?? 0) > 0 && <span className="text-accent-cyan">護甲+{mod.armor_rate}%</span>}
                        {(mod.output_bonus ?? 0) > 0 && <span className="text-accent-purple">出力+{mod.output_bonus}</span>}
                        {(mod.dodge_rate ?? 0) > 0 && <span className="text-accent-blue">回避+{mod.dodge_rate}%</span>}
                        {(mod.durable_rate ?? 0) > 0 && <span className="text-accent-green">耐久+{mod.durable_rate}%</span>}
                        {(mod.dmg_resist_rate ?? 0) > 0 && <span className="text-accent-cyan">減傷-{mod.dmg_resist_rate}%</span>}
                        {(mod.crit_resist_rate ?? 0) > 0 && <span className="text-accent-yellow">抗暴-{mod.crit_resist_rate}%</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
