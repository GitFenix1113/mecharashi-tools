import { useState, useMemo } from 'react'
import { VersionFilter } from '../../components/common/VersionFilter'
import { matchesVersionFilter } from '../../utils/versionFilter'
import { Link } from 'react-router-dom'
import { assetUrl, pilotPortraitPath } from '../../utils/assets'
import { usePilots, useWeapons } from '../../hooks/useFirestore'
import { useViewMode } from '../../hooks/useViewMode'
import { WeaponIcon } from '../../components/icons/WeaponIcon'
import { PilotRarityBadge } from '../../components/badges/PilotBadges'
import { ViewModeToggle } from '../../components/common/ViewModeToggle'
import { PILOT_CLASS_NAMES, pilotClassMeta } from '../../data/pilotClasses'
import { mechWeightClassOf } from '../../data/mechWeightClasses'
import { MechLicense } from '../../types/enums'
import { ClassIcon } from '../../components/icons/ClassIcon'
import { MechTypeIcon } from '../../components/icons/MechTypeIcon'

/** 駕照篩選：遊戲內順序 輕→中→重（PLAN-059） */
const LICENSES = Object.values(MechLicense)
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
  const [versionFilter, setVersionFilter] = useState('')
  const [sortMode, setSortMode] = useState<'versionDesc' | 'versionAsc'>('versionDesc')
  const [viewMode, setViewMode] = useViewMode('pilots')

  // 登場版本篩選（兩層：大版本 → 小版本，見 components/common/VersionFilter）。
  // 只傳原始清單，去重、分組、排序由元件做；全空時元件自己隱藏
  const debutVersions = useMemo(() => pilots.map((p) => p.debutVersion ?? ''), [pilots])

  const exclusiveWeaponMap = useMemo(() => {
    const map: Record<string, { name: string; gameId?: string; icon?: string }> = {}
    for (const w of weapons) {
      if (w.isExclusive && w.exclusiveFor) map[w.exclusiveFor] = { name: w.name, gameId: w.gameId, icon: w.icon }
    }
    return map
  }, [weapons])

  const idNum = (id: string) => parseInt(id.match(/pilot_(\d+)/)?.[1] ?? '0', 10)

  const filtered = pilots
    .filter((p) => {
      if (classFilter && p.class !== classFilter) return false
      if (licenseFilter && p.license !== licenseFilter) return false
      if (rarityFilter && p.rarity !== rarityFilter) return false
      if (!matchesVersionFilter(p.debutVersion, versionFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.faction.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      // 主排序：登場版本（新→舊 或 舊→新）；無版本者永遠排最後
      const va = a.debutVersion ? parseFloat(a.debutVersion) : null
      const vb = b.debutVersion ? parseFloat(b.debutVersion) : null
      if (va === null && vb !== null) return 1
      if (vb === null && va !== null) return -1
      if (va !== null && vb !== null && va !== vb) {
        return sortMode === 'versionAsc' ? va - vb : vb - va
      }
      // 次要排序：品質 S→A→B（同版本、或皆無版本時皆套用）
      const rd = (RARITY_ORDER[a.rarity] ?? 99) - (RARITY_ORDER[b.rarity] ?? 99)
      if (rd !== 0) return rd
      // 第三序：編號遞減
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
          {PILOT_CLASS_NAMES.map((c) => {
            const s = pilotClassMeta(c)
            const active = classFilter === c
            return (
              <button
                key={c}
                onClick={() => setClassFilter(active ? '' : c)}
                // 這一列同時是全站「圖示 ↔ 職業」的圖例（PLAN-059 C-1）：未選取時圖示跟著字灰、選取時上職業色
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  active && s
                    ? `${s.bg} ${s.text} ${s.border}`
                    : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
                }`}
              >
                <ClassIcon pilotClass={c} size={15} decorative />
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
              title={mechWeightClassOf(l)?.full}
              className={`inline-flex items-center gap-1.5 ${filterBtn(licenseFilter === l)}`}
            >
              {/* 駕照在機師處用中性色（類型色會和職業色撞，PLAN-059 決策十） */}
              <MechTypeIcon type={l} size={14} decorative />
              {l}
            </button>
          ))}
        </div>

        {/* 登場版本：兩層篩選（全部／v3.x／v2.x／v1.x → 展開小版本）。全空時元件自己隱藏 */}
        <VersionFilter versions={debutVersions} value={versionFilter} onChange={setVersionFilter} />
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
        <div className="flex items-center gap-2">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as 'versionDesc' | 'versionAsc')}
            aria-label="排序方式"
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary cursor-pointer outline-none focus:border-border-accent"
          >
            <option value="versionDesc">登場版本 新→舊</option>
            <option value="versionAsc">登場版本 舊→新</option>
          </select>
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        </div>
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
            const s = pilotClassMeta(pilot.class)
            return (
              <Link
                key={pilot.id}
                to={`/pilots/${pilot.id}`}
                className="group block bg-bg-card border border-border rounded-lg overflow-hidden no-underline transition-all hover:bg-bg-card-hover hover:border-border-accent hover:-translate-y-0.5"
              >
                <div className="relative aspect-square bg-bg-dark overflow-hidden">
                  <img
                    src={assetUrl(pilotPortraitPath(pilot) ?? '')}
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
                  {s && (
                    <span className={`absolute bottom-1 right-1 w-6 h-6 rounded-full grid place-items-center bg-black/65 border ${s.borderStrong} ${s.text}`}>
                      <ClassIcon pilotClass={pilot.class} size={14} />
                    </span>
                  )}
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
            const s = pilotClassMeta(pilot.class)
            return (
              <Link
                key={pilot.id}
                to={`/pilots/${pilot.id}`}
                className="group block bg-bg-card border border-border rounded-xl overflow-hidden no-underline transition-all hover:bg-bg-card-hover hover:border-border-accent hover:-translate-y-0.5"
              >
                {/* Portrait */}
                <div className={`relative ${PORTRAIT_ASPECT} bg-bg-dark overflow-hidden`}>
                  <img
                    src={assetUrl(pilotPortraitPath(pilot) ?? '')}
                    alt={pilot.name}
                    className="w-full h-full object-cover object-top transition-transform group-hover:scale-105"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  {/* 駕照（中性色：類型色會和職業色撞，PLAN-059 決策十） */}
                  <span
                    title={mechWeightClassOf(pilot.license)?.full}
                    className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[13px] font-bold bg-black/50 text-text-secondary border border-border"
                  >
                    <MechTypeIcon type={pilot.license} decorative />
                    {pilot.license}
                  </span>
                  {/* Rarity badge */}
                  <span className="absolute bottom-2 left-2">
                    <PilotRarityBadge rarity={pilot.rarity} />
                  </span>
                  {/* 職業圓章：右下角，與遊戲內機師卡同一個位置（PLAN-059 C-2）。原本左上的職業字牌會蓋到臉，
                      職業名改印在下方資訊列。半透明黑底＋職業色外圈，淺色立繪背景上也看得清楚 */}
                  {s && (
                    <span className={`absolute bottom-2 right-2 w-9 h-9 rounded-full grid place-items-center bg-black/60 backdrop-blur-[2px] border-[1.5px] ${s.borderStrong} ${s.text}`}>
                      <ClassIcon pilotClass={pilot.class} size={20} />
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-3 flex gap-2">
                  {/* Left: pilot info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-text-primary truncate">{pilot.name}</p>
                    <p className="text-[12px] text-text-dim truncate mt-0.5">{pilot.faction}</p>
                    <p className="text-[11px] text-text-dim mt-1 truncate">
                      {s && <span className={`${s.text} font-semibold`}>{pilot.class}</span>}
                      {s && pilot.masterLevel && ' · '}
                      {pilot.masterLevel}
                    </p>
                  </div>
                  {/* Right: exclusive weapon */}
                  {exclusiveWeaponMap[pilot.id] && (
                    <div className="flex-shrink-0 flex flex-col items-center gap-1 w-14">
                      <WeaponIcon
                        gameId={exclusiveWeaponMap[pilot.id].gameId}
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
