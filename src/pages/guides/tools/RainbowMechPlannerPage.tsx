import { useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { toPng } from 'html-to-image'
import type { Mech } from '../../../types'
import type { MechPartPosition } from '../../../types/enums'
import type { SlotInventory, SuperFactoryResources, SlotApproach } from '../../../types/mechUpgrade'
import { calculateRainbowPlan } from '../../../lib/rainbowMechCalc'
import { getMechsByArmorType } from '../../../lib/firestoreApi'
import { MechSelector }      from '../../../components/planner/MechSelector'
import { PartSlotCard }      from '../../../components/planner/PartSlotCard'
import { SuperFactoryPanel } from '../../../components/planner/SuperFactoryPanel'
import { PlanResult, type Weight } from '../../../components/planner/PlanResult'

const ALL_SLOTS: MechPartPosition[] = ['torso', 'leftArm', 'rightArm', 'legs']

const ARMOR_WEIGHT: Record<string, Weight> = { '輕型': 'light', '中甲': 'medium', '重型': 'heavy' }

const ARMOR_TYPES: { value: string; label: string; color: string }[] = [
  { value: '輕型', label: '輕型', color: 'text-accent-cyan  border-accent-cyan/50  bg-accent-cyan/10'  },
  { value: '中甲', label: '中型', color: 'text-accent-green border-accent-green/50 bg-accent-green/10' },
  { value: '重型', label: '重型', color: 'text-accent-red   border-accent-red/50   bg-accent-red/10'   },
]

// 各裝甲類型機甲的 session 快取：同一裝甲類型只讀取一次（避免來回切換重複計費）
const mechCache = new Map<string, Mech[]>()

const defaultParts = (): SlotInventory[] =>
  ALL_SLOTS.map(slot => ({ slot, gold1: 0, gold2: 0, gold3: 0 }))

const defaultApproaches = (): Record<MechPartPosition, SlotApproach> => ({
  torso: 'universal', leftArm: 'universal', rightArm: 'universal', legs: 'universal',
})

const defaultSF = (): SuperFactoryResources => ({
  enabled: false, sCount: 0, spCount: 0, sppCount: 0,
})

export default function RainbowMechPlannerPage() {
  const [armorType, setArmorType]       = useState<string | null>(null)
  const [mechs, setMechs]               = useState<Mech[]>([])
  const [mechsLoading, setMechsLoading] = useState(false)
  const [selectedMech, setSelectedMech] = useState<Mech | null>(null)
  const [parts, setParts]               = useState<SlotInventory[]>(defaultParts)
  const [approaches, setApproaches]     = useState<Record<MechPartPosition, SlotApproach>>(defaultApproaches)
  const [superFactory, setSuperFactory] = useState<SuperFactoryResources>(defaultSF)
  const [exporting, setExporting]       = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // 選定裝甲類型後，只讀取該類機甲；同類型已讀過則用快取，不再計費
  useEffect(() => {
    if (!armorType) { setMechs([]); return }

    const cached = mechCache.get(armorType)
    if (cached) { setMechs(cached); setMechsLoading(false); return }

    let cancelled = false
    setMechsLoading(true)
    getMechsByArmorType(armorType)
      .then(list => {
        const sorted = list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
        mechCache.set(armorType, sorted)
        if (!cancelled) setMechs(sorted)
      })
      .catch(err => { console.error('[RainbowPlanner] load mechs error:', err); if (!cancelled) setMechs([]) })
      .finally(() => { if (!cancelled) setMechsLoading(false) })
    return () => { cancelled = true }
  }, [armorType])

  const updatePart = (idx: number, v: SlotInventory) =>
    setParts(prev => prev.map((p, i) => (i === idx ? v : p)))

  async function handleExport() {
    const el = exportRef.current
    if (!el) return
    setExporting(true)

    // 匯出時：① 把各部位合成樹的水平捲動區展開避免裁切；② 整體與卡片縮成內容寬度，減少空白
    const scrolls = Array.from(el.querySelectorAll<HTMLElement>('[data-tree-scroll]'))
    const saved = scrolls.map(s => ({ s, overflow: s.style.overflow, width: s.style.width }))
    const grid = el.querySelector<HTMLElement>('[data-slots-grid]')
    const savedEl   = el.style.cssText
    const savedGrid = grid?.style.cssText ?? ''

    const restore = () => {
      saved.forEach(({ s, overflow, width }) => { s.style.overflow = overflow; s.style.width = width })
      el.style.cssText = savedEl
      if (grid) grid.style.cssText = savedGrid
    }

    try {
      scrolls.forEach(s => { s.style.overflow = 'visible'; s.style.width = `${s.scrollWidth}px` })
      // 收緊版面：整體與部位卡都縮到內容寬度，部位卡改為自動寬度的雙欄
      el.style.width = 'max-content'
      el.style.maxWidth = 'none'
      if (grid) {
        grid.style.display = 'inline-grid'
        grid.style.gridTemplateColumns = 'repeat(2, max-content)'
        grid.style.width = 'max-content'
      }
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

      const dataUrl = await toPng(el, { backgroundColor: '#0a0c10', pixelRatio: 2, skipFonts: false })
      restore()

      const a = document.createElement('a')
      a.download = `彩甲規劃_${selectedMech?.name ?? 'mech'}.png`
      a.href = dataUrl
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      console.error('[RainbowPlanner] export error:', err)
      restore()
    } finally {
      setExporting(false)
    }
  }

  const updateApproach = (slot: MechPartPosition, a: SlotApproach) =>
    setApproaches(prev => ({ ...prev, [slot]: a }))

  const resetInputs = () => {
    setParts(defaultParts())
    setApproaches(defaultApproaches())
  }

  const handleArmorType = (t: string) => {
    if (t === armorType) return
    setArmorType(t)
    setSelectedMech(null)   // 換裝甲類型 → 清空選擇、收起設定
    resetInputs()
  }

  const handleSelectMech = (mech: Mech) => {
    if (selectedMech?.id !== mech.id) resetInputs()
    setSelectedMech(mech)
  }

  const result = useMemo(() => {
    if (!selectedMech) return null
    return calculateRainbowPlan(parts, superFactory, approaches)
  }, [selectedMech, parts, superFactory, approaches])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">

      {/* 麵包屑 */}
      <div className="flex items-center gap-1.5 text-[12px] text-text-dim">
        <Link to="/tools" className="hover:text-text-secondary transition-colors">工具</Link>
        <span>›</span>
        <span className="text-text-secondary">彩甲升級規劃器</span>
      </div>

      {/* 頁頭 */}
      <div>
        <span className="text-[10px] font-bold tracking-[3px] text-accent-purple uppercase font-[Orbitron,sans-serif]">
          Tool
        </span>
        <h1 className="text-2xl font-bold mt-1"
          style={{ background: 'linear-gradient(135deg,#ef4444,#eab308,#22c55e,#06b6d4,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          彩甲升級規劃器
        </h1>
        <p className="text-[13px] text-text-dim mt-1">
          輸入目前持有的零件，自動計算升彩甲所需材料
        </p>
      </div>

      {/* 裝甲類型 + 機甲選擇 */}
      <div className="bg-bg-card border border-border rounded-xl p-4 flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-bold tracking-[3px] text-accent-orange uppercase font-[Orbitron,sans-serif] flex-shrink-0">
          Target
        </span>

        {/* 先選裝甲類型，再依類型載入機甲（降低讀取量） */}
        <div className="flex items-center gap-1.5">
          {ARMOR_TYPES.map(({ value, label, color }) => (
            <button
              key={value}
              onClick={() => handleArmorType(value)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-bold border transition-colors cursor-pointer ${
                armorType === value ? color : 'text-text-dim border-border hover:border-border-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <MechSelector
          mechs={mechs}
          loading={mechsLoading}
          selected={selectedMech}
          onSelect={handleSelectMech}
          disabled={!armorType}
        />
        {selectedMech && (
          <span className="text-[12px] text-text-dim">切換裝甲 / 機甲將重置所有輸入</span>
        )}
      </div>

      {/* 選擇機甲前，下方設定收起、不可編輯 */}
      {!selectedMech || !result ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-text-dim text-[13px]">
          請先於上方選擇目標機甲，即可開始輸入零件、超級工廠資源並計算所需材料
        </div>
      ) : (
        <>
          {/* 部位零件輸入 */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-[3px] text-accent-yellow uppercase font-[Orbitron,sans-serif]">
                Parts Inventory
              </span>
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-text-dim">目前持有各等級零件數量</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {parts.map((part, idx) => (
                <PartSlotCard
                  key={part.slot}
                  slot={part.slot}
                  partIcon={selectedMech.parts[part.slot]?.icon}
                  value={part}
                  onChange={(v) => updatePart(idx, v)}
                />
              ))}
            </div>
          </div>

          {/* 超級工廠（可選） */}
          <SuperFactoryPanel value={superFactory} onChange={setSuperFactory} />

          {/* 匯出按鈕 */}
          <div className="flex justify-end">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 rounded-lg border border-accent-purple/50 bg-accent-purple/10 px-4 py-2 text-[13px] font-bold text-accent-purple transition-colors hover:bg-accent-purple/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {exporting ? '匯出中…' : '⬇ 匯出材料清單圖片'}
            </button>
          </div>

          {/* 結果（自動計算，含通用/核心切換）— 匯出範圍 */}
          <div ref={exportRef} className="flex flex-col gap-3 rounded-xl">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-[3px] text-accent-purple uppercase font-[Orbitron,sans-serif]">
                Materials Needed
              </span>
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-text-dim">{selectedMech.name} · 各部位可切換通用 / 核心</span>
            </div>
            <PlanResult
              result={result}
              slotApproach={approaches}
              onApproachChange={updateApproach}
              partIcons={{
                torso:    selectedMech.parts.torso?.icon,
                leftArm:  selectedMech.parts.leftArm?.icon,
                rightArm: selectedMech.parts.rightArm?.icon,
                legs:     selectedMech.parts.legs?.icon,
              }}
              weight={ARMOR_WEIGHT[selectedMech.armorType] ?? 'medium'}
            />
          </div>
        </>
      )}
    </div>
  )
}
