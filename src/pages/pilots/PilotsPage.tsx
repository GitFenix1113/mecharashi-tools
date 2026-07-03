import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { assetUrl } from '../../utils/assets'
import { usePilots, useWeapons } from '../../hooks/useFirestore'
import { useViewMode } from '../../hooks/useViewMode'
import { WeaponIcon } from '../../components/WeaponIcon'
import { PilotRarityBadge } from '../../components/PilotBadges'
import { ViewModeToggle } from '../../components/ViewModeToggle'

const CLASS_STYLES: Record<string, { text: string; border: string; bg: string }> = {
  守護者: { text: 'text-accent-green', border: 'border-accent-green/40', bg: 'bg-accent-green/10' },
  突擊手: { text: 'text-accent-orange', border: 'border-accent-orange/40', bg: 'bg-accent-orange/10' },
  格鬥家: { text: 'text-accent-red', border: 'border-accent-red/40', bg: 'bg-accent-red/10' },
  狙擊手: { text: 'text-accent-blue', border: 'border-accent-blue/40', bg: 'bg-accent-blue/10' },
  戰術家: { text: 'text-accent-purple', border: 'border-accent-purple/40', bg: 'bg-accent-purple/10' },
  機械師: { text: 'text-accent-cyan', border: 'border-accent-cyan/40', bg: 'bg-accent-cyan/10' },
  調構師: { text: 'text-accent-yellow', border: 'border-accent-yellow/40', bg: 'bg-accent-yellow/10' },
}

const CLASSES = ['守護者', '突擊手', '格鬥家', '狙擊手', '戰術家', '機械師', '調構師']
const LICENSES = ['重型', '中型', '輕型']
const RARITIES = ['EX', 'S', 'A', 'B']
const RARITY_ORDER: Record<string, number> = { EX: 0, S: 1, A: 2, B: 3 }
const RARITY_FILTER_STYLES: Record<string, { text: string; border: string; bg: string }> = {
  EX: { text: 'text-accent-orange', border: 'border-accent-orange/40', bg: 'bg-accent-orange/10' },
  S:  { text: 'text-accent-yellow', border: 'border-accent-yellow/40', bg: 'bg-accent-yellow/10' },
  A:  { text: 'text-accent-purple', border: 'border-accent-purple/40', bg: 'bg-accent-purple/10' },
  B:  { text: 'text-accent-blue',   border: 'border-accent-blue/40',   bg: 'bg-accent-blue/10'   },
}

const PORTRAIT_ASPECT = 'aspect-[3/2.8]' // 調整此值來改變肖像高度（原始為 aspect-[3/4]）

export default function PilotsPage() {
  const { data: pilots, loading } = usePilots()
  const { data: weapons } = useWeapons()
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [licenseFilter, setLicenseFilter] = useState('')
  const [rarityFilter, setRarityFilter] = useState('')
  const [viewMode, setViewMode] = useViewMode('pilots')

  const exclusiveWeaponMap = useMemo(() => {
    const map: Record<string, { name: string; icon?: string }> = {}
    for (const w of weapons) {
      if (w.isExclusive && w.exclusiveFor) map[w.exclusiveFor] = { name: w.name, icon: w.icon }
    }
    return map
  }, [weapons])

  const idNum = (id: string) => parseInt(id.match(/pilot_(\d+)/)?.[1] ?? '0', 10)

  const filtered = pilots
    .filter((p) => {
      if (classFilter && p.class !== classFilter) return false
      if (licenseFilter && p.license !== licenseFilter) return false
      if (rarityFilter && p.rarity !== rarityFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.faction.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      const rd = (RARITY_ORDER[a.rarity] ?? 99) - (RARITY_ORDER[b.rarity] ?? 99)
      if (rd !== 0) return rd
      return idNum(b.id) - idNum(a.id)
    })

  const filterBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
        : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      {/* Header */}
      <div className="mb-8">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Database
        </span>
        <h1 className="text-3xl font-bold mt-2">機師圖鑑</h1>
        <p className="text-text-secondary mt-2">
          查看所有機師的六維屬性、技能、天賦與神經驅動。共 {pilots.length} 位機師。
        </p>
      </div>

      {/* Filters */}
      <div className="bg-bg-card border border-border rounded-xl p-4 mb-6 flex flex-col gap-3">
        {/* Search */}
        <input
          type="text"
          placeholder="搜尋機師名稱或勢力..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-bg-dark border border-border rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-border-accent"
        />

        {/* Class Filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">職業</span>
          <button className={filterBtn(!classFilter)} onClick={() => setClassFilter('')}>全部</button>
          {CLASSES.map((c) => {
            const s = CLASS_STYLES[c]
            const active = classFilter === c
            return (
              <button
                key={c}
                onClick={() => setClassFilter(active ? '' : c)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  active && s
                    ? `${s.bg} ${s.text} ${s.border}`
                    : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>

        {/* Rarity Filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">品質</span>
          <button className={filterBtn(!rarityFilter)} onClick={() => setRarityFilter('')}>全部</button>
          {RARITIES.map((r) => {
            const s = RARITY_FILTER_STYLES[r]
            const active = rarityFilter === r
            return (
              <button
                key={r}
                onClick={() => setRarityFilter(active ? '' : r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  active && s
                    ? `${s.bg} ${s.text} ${s.border}`
                    : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
                }`}
              >
                {r}
              </button>
            )
          })}
        </div>

        {/* License Filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">駕照</span>
          <button className={filterBtn(!licenseFilter)} onClick={() => setLicenseFilter('')}>全部</button>
          {LICENSES.map((l) => (
            <button
              key={l}
              onClick={() => setLicenseFilter(licenseFilter === l ? '' : l)}
              className={filterBtn(licenseFilter === l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Count + View toggle */}
      <div className="flex items-center justify-between gap-3 mb-4 min-h-[28px]">
        {!loading ? (
          <p className="text-xs text-text-dim">
            顯示 {filtered.length} / {pilots.length} 位機師
          </p>
        ) : (
          <span />
        )}
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl h-64 animate-pulse" />
          ))}
        </div>
      ) : viewMode === 'compact' ? (
        /* ── 緊湊檢視：頭像 + 名 ── */
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {filtered.map((pilot) => {
            const s = CLASS_STYLES[pilot.class]
            return (
              <Link
                key={pilot.id}
                to={`/pilots/${pilot.id}`}
                className="group block bg-bg-card border border-border rounded-lg overflow-hidden no-underline transition-all hover:bg-bg-card-hover hover:border-border-accent hover:-translate-y-0.5"
              >
                <div className="relative aspect-square bg-bg-dark overflow-hidden">
                  <img
                    src={assetUrl(pilot.portrait)}
                    alt={pilot.name}
                    loading="lazy"
                    className="w-full h-full object-cover object-top transition-transform group-hover:scale-105"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  <span className="absolute bottom-1 left-1 scale-90 origin-bottom-left">
                    <PilotRarityBadge rarity={pilot.rarity} />
                  </span>
                </div>
                <div className="px-1.5 py-1.5 text-center">
                  <p className="text-xs font-bold text-text-primary truncate">{pilot.name}</p>
                  {/* 職業 · 駕照（機甲類型） */}
                  <p className="text-[10px] mt-0.5 truncate">
                    <span className={s ? s.text : 'text-text-dim'}>{pilot.class}</span>
                    <span className="text-text-dim"> · {pilot.license}</span>
                  </p>
                  {/* 專武名稱（僅名稱） */}
                  {exclusiveWeaponMap[pilot.id] && (
                    <p className="text-[10px] text-accent-yellow truncate mt-0.5">
                      {exclusiveWeaponMap[pilot.id].name}
                    </p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((pilot) => {
            const s = CLASS_STYLES[pilot.class]
            return (
              <Link
                key={pilot.id}
                to={`/pilots/${pilot.id}`}
                className="group block bg-bg-card border border-border rounded-xl overflow-hidden no-underline transition-all hover:bg-bg-card-hover hover:border-border-accent hover:-translate-y-0.5"
              >
                {/* Portrait */}
                <div className={`relative ${PORTRAIT_ASPECT} bg-bg-dark overflow-hidden`}>
                  <img
                    src={assetUrl(pilot.portrait)}
                    alt={pilot.name}
                    className="w-full h-full object-cover object-top transition-transform group-hover:scale-105"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  {/* Class badge */}
                  {s && (
                    <span
                      className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[13px] font-bold border ${s.bg} ${s.text} ${s.border}`}
                    >
                      {pilot.class}
                    </span>
                  )}
                  {/* License badge */}
                  <span className="absolute top-2 right-2 px-2 py-0.5 rounded text-[13px] font-bold bg-black/50 text-text-secondary border border-border">
                    {pilot.license}
                  </span>
                  {/* Rarity badge */}
                  <span className="absolute bottom-2 left-2">
                    <PilotRarityBadge rarity={pilot.rarity} />
                  </span>
                </div>

                {/* Info */}
                <div className="p-3 flex gap-2">
                  {/* Left: pilot info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-text-primary truncate">{pilot.name}</p>
                    <p className="text-[12px] text-text-dim truncate mt-0.5">{pilot.faction}</p>
                    <p className="text-[11px] text-text-dim mt-1">{pilot.masterLevel}</p>
                  </div>
                  {/* Right: exclusive weapon */}
                  {exclusiveWeaponMap[pilot.id] && (
                    <div className="flex-shrink-0 flex flex-col items-center gap-1 w-14">
                      <WeaponIcon
                        icon={exclusiveWeaponMap[pilot.id].icon}
                        name={exclusiveWeaponMap[pilot.id].name}
                        size="sm"
                        isExclusive
                      />
                      <p className="hidden sm:block text-[10px] text-accent-yellow text-center leading-tight line-clamp-2">
                        {exclusiveWeaponMap[pilot.id].name}
                      </p>
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          沒有符合條件的機師
        </div>
      )}
    </div>
  )
}
