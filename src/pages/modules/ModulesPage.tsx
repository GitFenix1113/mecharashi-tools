import { useState } from 'react'
import { useModules } from '../../hooks/useFirestore'
import { useModuleAdopters } from '../../hooks/useModuleAdopters'
import { ModuleSlot, ModuleRarity } from '../../types/enums'
import { SLOT_LABELS, CATALOG_SLOTS, compareModuleBySlot } from '../../utils/moduleSlots'
import { ModuleCard } from '../../components/module/ModuleCard'
import { ModuleAdopters } from '../../components/module/ModuleAdopters'

export default function ModulesPage() {
  const { data: modules, loading, error: modulesError } = useModules()
  const adoptersOf = useModuleAdopters()

  const [searchText, setSearchText] = useState('')
  const [searchByName, setSearchByName] = useState(true)
  const [searchByDesc, setSearchByDesc] = useState(true)
  const [slotFilters, setSlotFilters] = useState<Set<string>>(new Set())
  // 預設只看 S：A 級模組多為過渡期裝備，玩家查圖鑑時絕大多數在找 S。仍可按「全部」放開。
  const [rarityFilter, setRarityFilter] = useState<string | null>(ModuleRarity.S)
  const [showBuiltIn, setShowBuiltIn] = useState(false)

  // Catalog-eligible count (slot exclusion only, ignoring user filters)
  const catalogCount = modules.filter(
    (m) => m.slot !== ModuleSlot.BUILT_IN && m.slot !== ModuleSlot.EXCLUSIVE
  ).length

  // 排序：特性 → 8級 → 通用（順序由 CATALOG_SLOTS 定義，與篩選按鈕同一份）。
  // sort 是穩定排序，同槽位內維持 Firestore 原始順序。
  const filtered = modules
    .filter((m) => {
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
    .sort((a, b) => compareModuleBySlot(a.slot, b.slot))

  const toggleSlot = (slot: string) => {
    setSlotFilters((prev) => {
      const next = new Set(prev)
      if (next.has(slot)) next.delete(slot)
      else next.add(slot)
      return next
    })
  }

  const filterBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
        : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      <div className="mb-8">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Database
        </span>
        <h1 className="text-3xl font-bold mt-2">模組圖鑑</h1>
        <p className="text-text-secondary mt-2">
          特性模組、8級模組、通用模組完整列表，含採用機甲與技能效果。
        </p>
      </div>

      {/* Filters */}
      <div className="bg-bg-card border border-border rounded-xl p-4 mb-6 flex flex-col gap-3">
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
          {filtered.map((mod) => (
            <ModuleCard
              key={mod.id}
              mod={mod}
              variant="catalog"
              meta={
                <ModuleAdopters
                  adopters={adoptersOf(mod)}
                  boundPart={mod.boundPart}
                  className="mb-1"
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
