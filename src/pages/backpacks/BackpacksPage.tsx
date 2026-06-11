import { useState, useLayoutEffect, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useBackpacks } from '../../hooks/useFirestore'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/useIsMobile'
import {
  BACKPACK_TYPE_CONFIG,
  ASSEMBLABLE_ARMOR_CONFIG,
  BackpackTypeBadge,
  AssemblableArmorTypeBadge,
  BackpackIcon,
} from '../../components/BackpackBadges'
import { WeaponRarityBadge } from '../../components/WeaponRarityBadge'
import { EQUIP_SLOT_LABELS } from '../../components/WeaponBadges'
import { assetUrl } from '../../utils/assets'
import type { Backpack } from '../../types'

const PAGE_SIZE = 36

const ALL_RARITIES = ['SS', 'S+', 'S', 'A', 'B']
const ALL_BACKPACK_TYPES = [
  'Heal', 'Ammo', 'Interference', 'Invisible', 'BackupEquipment',
  'MovePointAdd', 'Flow', 'Radar', 'EMP', 'Enhance', 'PowerAdd',
]
const RARITY_ORDER: Record<string, number> = { SS: 0, 'S+': 1, S: 2, A: 3, B: 4 }

function Num({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-accent-red font-bold font-[JetBrains_Mono,monospace] ${className}`}>
      {children}
    </span>
  )
}

function SkillIcon({ icon, name }: { icon?: string; name: string }) {
  const [err, setErr] = useState(false)
  if (err || !icon) {
    return (
      <div className="w-9 h-9 rounded-lg bg-bg-dark border border-border flex items-center justify-center text-text-dim text-xs flex-shrink-0">
        技
      </div>
    )
  }
  const filename = icon.split('/').pop() ?? ''
  const src = assetUrl(`/images/skills/${filename}`)
  return (
    <img
      src={src}
      alt={name}
      className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
      onError={() => setErr(true)}
    />
  )
}

function HighlightedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/([\+\-]?\d+(?:\.\d+)?%?)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^[\+\-]?\d+(?:\.\d+)?%?$/.test(part) && /\d/.test(part)
          ? <Num key={i} className={className}>{part}</Num>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

function BackpackTooltipContent({ bp }: { bp: Backpack }) {
  const armorLabel =
    bp.assemblableArmorType.length === 0
      ? '無限制'
      : bp.assemblableArmorType
          .map((t) => ASSEMBLABLE_ARMOR_CONFIG[t]?.label ?? t)
          .join('、')

  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3 flex-shrink-0">
        <BackpackIcon icon={bp.icon} name={bp.name} rarity={bp.rarity} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <div className="font-bold text-sm text-text-primary leading-tight">{bp.name}</div>
            <WeaponRarityBadge rarity={bp.rarity} className="px-2" />
          </div>
          <div className="mt-1">
            <BackpackTypeBadge type={bp.type} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {/* Stats */}
        <div className="bg-bg-dark rounded-lg p-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-text-dim">重量</span>
            <Num className="text-[14px]">{bp.weight}</Num>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-text-dim">部位</span>
            <span className="text-[14px] text-text-secondary">{EQUIP_SLOT_LABELS[bp.slot] ?? bp.slot}</span>
          </div>
          {bp.repairAmount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-text-dim">修理量</span>
              <Num className="text-[14px]">{bp.repairAmount}</Num>
            </div>
          )}
          <div className="flex items-center gap-1.5 col-span-2">
            <span className="text-[13px] text-text-dim">裝備限制</span>
            <span className="text-[14px] text-text-secondary">{armorLabel}</span>
          </div>
        </div>

        {/* Main Skill */}
        {bp.mainSkill && (
          <div className="bg-bg-dark rounded-lg overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border flex items-center gap-2">
              <SkillIcon icon={bp.mainSkill.icon} name={bp.mainSkill.name} />
              <span className="text-[13px] font-bold text-text-primary">{bp.mainSkill.name}</span>
            </div>
            <div className="p-2.5 space-y-2">
              <p className="text-[13px] text-text-secondary leading-relaxed">
                <HighlightedText text={bp.mainSkill.description} className="text-[13px]" />
              </p>
              {(bp.mainSkill.dmg || bp.mainSkill.crit || bp.mainSkill.critDmg || bp.mainSkill.acc) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {bp.mainSkill.dmg != null && (
                    <span className="text-[14px] text-text-dim">
                      增傷 <Num className="text-[14px]">+{bp.mainSkill.dmg}%</Num>
                    </span>
                  )}
                  {bp.mainSkill.crit != null && (
                    <span className="text-[14px] text-text-dim">
                      爆率 <Num className="text-[14px]">+{bp.mainSkill.crit}</Num>
                    </span>
                  )}
                  {bp.mainSkill.critDmg != null && (
                    <span className="text-[14px] text-text-dim">
                      爆傷 <Num className="text-[14px]">+{bp.mainSkill.critDmg}%</Num>
                    </span>
                  )}
                  {bp.mainSkill.acc != null && (
                    <span className="text-[14px] text-text-dim">
                      命中 <Num className="text-[14px]">+{bp.mainSkill.acc}</Num>
                    </span>
                  )}
                </div>
              )}
              {bp.mainSkill.specialEffects && bp.mainSkill.specialEffects.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {bp.mainSkill.specialEffects.map((ef, i) => (
                    <span
                      key={i}
                      className="text-[11px] text-accent-cyan bg-accent-cyan/5 border border-accent-cyan/20 rounded px-1.5 py-0.5"
                    >
                      {ef}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function BackpackTooltip({ bp }: { bp: Backpack }) {
  return (
    <div className="w-80 max-h-[min(90vh,_600px)] flex flex-col bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl">
      <div className="flex-1 min-h-0 overflow-y-auto p-1">
        <BackpackTooltipContent bp={bp} />
      </div>
    </div>
  )
}

interface TooltipState {
  bpId: string
  x: number
  anchorTop: number
}

function TooltipPortal({ bp, x, anchorTop }: { bp: Backpack; x: number; anchorTop: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, bp.id])

  return createPortal(
    <div ref={ref} className="fixed z-50 pointer-events-none" style={{ left: x, top }}>
      <BackpackTooltip bp={bp} />
    </div>,
    document.body,
  )
}

export default function BackpacksPage() {
  const { data: backpacks, loading } = useBackpacks()

  const [search, setSearch]               = useState('')
  const [rarityFilters, setRarityFilters] = useState<Set<string>>(new Set())
  const [typeFilters, setTypeFilters]     = useState<Set<string>>(new Set())
  const [armorFilter, setArmorFilter]     = useState<string | null>(null)
  const [displayCount, setDisplayCount]   = useState(PAGE_SIZE)

  useEffect(() => { setDisplayCount(PAGE_SIZE) }, [search, rarityFilters, typeFilters, armorFilter])

  const isMobile = useIsMobile()
  const [hoverTooltip, setHoverTooltip] = useState<TooltipState | null>(null)
  const [sheetBp, setSheetBp] = useState<Backpack | null>(null)

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) { next.delete(value) } else { next.add(value) }
      return next
    })
  }

  const filtered = backpacks
    .filter((bp) => {
      if (rarityFilters.size > 0 && !rarityFilters.has(bp.rarity)) return false
      if (typeFilters.size > 0   && !typeFilters.has(bp.type))     return false
      if (armorFilter === 'none' && bp.assemblableArmorType.length > 0) return false
      if (armorFilter && armorFilter !== 'none' && !bp.assemblableArmorType.includes(armorFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          bp.name.toLowerCase().includes(q) ||
          (bp.mainSkill?.description.toLowerCase().includes(q) ?? false)
        )
      }
      return true
    })
    .sort((a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9))

  const paginated = filtered.slice(0, displayCount)

  const computePos = (el: HTMLDivElement): { x: number; anchorTop: number } => {
    const rect = el.getBoundingClientRect()
    const tooltipW = 320
    const margin = 8
    const rightX = rect.right + margin
    const leftX = rect.left - tooltipW - margin
    const x = rightX + tooltipW > window.innerWidth - margin
      ? Math.max(margin, leftX)
      : rightX
    return { x: Math.max(margin, Math.min(x, window.innerWidth - tooltipW - margin)), anchorTop: rect.top }
  }

  const activeTooltip = hoverTooltip
  const activeBp = activeTooltip
    ? backpacks.find((b) => b.id === activeTooltip.bpId) ?? null
    : null

  const filterBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-pink/15 text-accent-pink border-accent-pink/40'
        : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  const typeFilterBtn = (type: string) => {
    const active = typeFilters.has(type)
    const config = BACKPACK_TYPE_CONFIG[type]
    if (active && config) return `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${config.className}`
    return filterBtn(false)
  }

  const armorFilterBtn = (key: string) => {
    const active = armorFilter === key
    const config = ASSEMBLABLE_ARMOR_CONFIG[key]
    if (active && config) return `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${config.className}`
    return filterBtn(active)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      {activeBp && activeTooltip && !isMobile && (
        <TooltipPortal
          key={activeTooltip.bpId}
          bp={activeBp}
          x={activeTooltip.x}
          anchorTop={activeTooltip.anchorTop}
        />
      )}

      <BottomSheet open={!!sheetBp} onClose={() => setSheetBp(null)}>
        {sheetBp && <BackpackTooltipContent bp={sheetBp} />}
      </BottomSheet>

      {/* Header */}
      <div className="mb-8">
        <span className="text-xs text-accent-pink tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Database
        </span>
        <h1 className="text-3xl font-bold mt-2">背包圖鑑</h1>
        <p className="text-text-secondary mt-2">
          所有背包裝備的技能效果、重量與裝配限制。共 {backpacks.length} 件背包。
        </p>
      </div>

      {/* Filters */}
      <div
        className="bg-bg-card border border-border rounded-xl p-4 mb-6 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          placeholder="搜尋背包名稱或效果描述..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-bg-dark border border-border rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-border-accent"
        />

        {/* Rarity – multi-select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">稀有度</span>
          <button className={filterBtn(rarityFilters.size === 0)} onClick={() => setRarityFilters(new Set())}>全部</button>
          {ALL_RARITIES.map((r) => (
            <button key={r} className={filterBtn(rarityFilters.has(r))} onClick={() => toggleSet(setRarityFilters, r)}>
              {r}
            </button>
          ))}
        </div>

        {/* Type – multi-select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">類型</span>
          <button className={filterBtn(typeFilters.size === 0)} onClick={() => setTypeFilters(new Set())}>全部</button>
          {ALL_BACKPACK_TYPES.map((t) => (
            <button key={t} className={typeFilterBtn(t)} onClick={() => toggleSet(setTypeFilters, t)}>
              {BACKPACK_TYPE_CONFIG[t]?.label ?? t}
            </button>
          ))}
        </div>

        {/* Armor – single-select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">裝備</span>
          <button className={filterBtn(!armorFilter)} onClick={() => setArmorFilter(null)}>全部</button>
          <button className={filterBtn(armorFilter === 'none')} onClick={() => setArmorFilter(armorFilter === 'none' ? null : 'none')}>
            無限制
          </button>
          {Object.entries(ASSEMBLABLE_ARMOR_CONFIG).map(([key]) => (
            <button key={key} className={armorFilterBtn(key)} onClick={() => setArmorFilter(armorFilter === key ? null : key)}>
              {ASSEMBLABLE_ARMOR_CONFIG[key].label}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      {!loading && (
        <p className="text-xs text-text-dim mb-4">
          顯示 <Num className="text-xs">{Math.min(displayCount, filtered.length)}</Num> / {filtered.length} 件背包
          {filtered.length !== backpacks.length && <span className="ml-1">（全 {backpacks.length} 件）</span>}
        </p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          沒有符合條件的背包
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {paginated.map((bp) => (
            <div
              key={bp.id}
              className="bg-bg-card border border-border rounded-xl p-3 cursor-default transition-all select-none hover:border-border-accent hover:bg-bg-card-hover"
              onMouseEnter={(e) => { if (!isMobile) setHoverTooltip({ bpId: bp.id, ...computePos(e.currentTarget) }) }}
              onMouseLeave={() => { if (!isMobile) setHoverTooltip(null) }}
              onClick={() => { if (isMobile) setSheetBp(bp) }}
            >
              {/* Top row */}
              <div className="flex items-start gap-2 mb-2">
                <BackpackIcon icon={bp.icon} name={bp.name} rarity={bp.rarity} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1 mb-0.5">
                    <span className="font-bold text-sm text-text-primary leading-tight line-clamp-2">
                      {bp.name}
                    </span>
                    <WeaponRarityBadge rarity={bp.rarity} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    <BackpackTypeBadge type={bp.type} />
                    {bp.assemblableArmorType.length > 0 && (
                      <>
                        <span className="text-[11px] text-text-dim self-center leading-none select-none">|</span>
                        <AssemblableArmorTypeBadge armorType={bp.assemblableArmorType} />
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[14px]">
                <div>
                  <span className="text-text-dim">重 </span>
                  <Num>{bp.weight}</Num>
                </div>
                {bp.repairAmount > 0 && (
                  <div>
                    <span className="text-text-dim">修理 </span>
                    <Num>{bp.repairAmount}</Num>
                  </div>
                )}
                {bp.mainSkill && (
                  <div className="col-span-2 mt-0.5">
                    <span className="text-[11px] text-accent-pink bg-accent-pink/8 border border-accent-pink/20 rounded px-1.5 py-0.5">
                      ✦ {bp.mainSkill.name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && displayCount < filtered.length && (
        <div className="mt-6 text-center">
          <button
            className="px-6 py-2.5 rounded-xl border border-border bg-bg-card text-text-secondary text-sm hover:border-border-accent hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => setDisplayCount((n) => n + PAGE_SIZE)}
          >
            載入更多（{filtered.length - displayCount} 件）
          </button>
        </div>
      )}
    </div>
  )
}
