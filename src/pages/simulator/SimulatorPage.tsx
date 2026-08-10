import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import html2canvas from 'html2canvas'
import type {
  Pilot,
  Mech,
  Weapon,
  Backpack,
  BackpackSkillDoc,
  Module,
  Component,
  PilotResearch,
  TriggerComponent,
  EffectComponent,
  FloatingModSelection,
  Build,
  UserBuild,
  SkillEffect,
} from '../../types'
import { useAllGameData, type AllGameData } from '../../hooks/useFirestore'
import { getAllPilotResearch } from '../../lib/firestoreApi'
import { buildBuffPool } from '../../utils/buffPool'
import { resolveBackpackSkills, buildBackpackSkillMap } from '../../utils/backpackSkills'
import { resolveReachable, type ResolvedBuff } from '../../utils/reachableBuffs'
import { resolvePilotSkills, buildSkillMap } from '../../utils/pilotSkills'

type AllData = AllGameData
import { useAuth } from '../../contexts/AuthContext'
import { saveBuild } from '../../lib/userApi'

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'pilot' | 'mech' | 'weapon' | 'backpack' | 'research' | 'weaponMod' | 'components' | 'result'

const STEPS: { key: Step; label: string; icon: string }[] = [
  { key: 'pilot', label: '機師', icon: '👤' },
  { key: 'mech', label: '機甲', icon: '🤖' },
  { key: 'weapon', label: '武器', icon: '🔫' },
  { key: 'backpack', label: '背包', icon: '🎒' },
  { key: 'research', label: '科研', icon: '🔬' },
  { key: 'weaponMod', label: '改裝', icon: '🔧' },
  { key: 'components', label: '元件', icon: '⚙️' },
  { key: 'result', label: '結果', icon: '📊' },
]

// ─── Simulator State ─────────────────────────────────────────────────────────

interface SimState {
  pilotId: string | null
  mechId: string | null
  weaponId: string | null
  backpackId: string | null
  researchSelections: Record<string, string>
  weaponFloatingMods: FloatingModSelection[]
  triggerComponentIds: string[]
  effectComponentIds: string[]
  /** PLAN-019-B：形態互斥組的擇一選擇（mutexGroup → 選中的 buffId） */
  activeForms: Record<string, string>
}

const INITIAL_STATE: SimState = {
  pilotId: null,
  mechId: null,
  weaponId: null,
  backpackId: null,
  researchSelections: {},
  weaponFloatingMods: [],
  triggerComponentIds: [],
  effectComponentIds: [],
  activeForms: {},
}

// ─── Helper components ───────────────────────────────────────────────────────

function StepIndicator({ steps, current, onStep }: { steps: typeof STEPS; current: Step; onStep: (s: Step) => void }) {
  const currentIdx = steps.findIndex((s) => s.key === current)
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-6">
      {steps.map((step, i) => {
        const isActive = step.key === current
        const isPast = i < currentIdx
        return (
          <button
            key={step.key}
            onClick={() => onStep(step.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
              isActive
                ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
                : isPast
                  ? 'bg-accent-green/10 text-accent-green border-accent-green/30'
                  : 'bg-bg-card text-text-dim border-border hover:text-text-secondary'
            }`}
          >
            <span>{step.icon}</span>
            <span>{step.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function SelectionCard({
  selected,
  children,
  onClick,
}: {
  selected: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left w-full p-3 rounded-lg border transition-colors cursor-pointer ${
        selected
          ? 'bg-accent-orange/10 border-accent-orange/40 text-text-primary'
          : 'bg-bg-card border-border hover:border-border-accent text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

function buildToSimState(build: UserBuild): SimState {
  return {
    pilotId: build.pilotId || null,
    mechId: build.mechId || null,
    weaponId: build.weaponId || null,
    backpackId: build.backpackId || null,
    researchSelections: Object.fromEntries(
      Object.entries(build.pilotResearch ?? {}).map(([k, v]) => [k, String(v)])
    ),
    weaponFloatingMods: build.weaponFloatingMod ?? [],
    triggerComponentIds: build.triggerComponents ?? [],
    effectComponentIds: build.effectComponents ?? [],
    activeForms: {},
  }
}

export default function SimulatorPage() {
  const { data, loading } = useAllGameData()
  const { user } = useAuth()
  const location = useLocation()

  // PLAN-043：背包技能字典（Step 4 的選擇卡要用它反查說明文字）
  const backpackSkillMap = useMemo(() => buildBackpackSkillMap(data?.backpackSkills), [data?.backpackSkills])

  const [pilotResearchList, setPilotResearchList] = useState<PilotResearch[]>([])
  useEffect(() => {
    getAllPilotResearch().then(setPilotResearchList)
  }, [])

  const incomingBuild = (location.state as { build?: UserBuild } | null)?.build
  const [step, setStep] = useState<Step>(
    incomingBuild?.pilotId && incomingBuild?.mechId && incomingBuild?.weaponId ? 'result' : 'pilot'
  )
  const [state, setState] = useState<SimState>(
    incomingBuild ? buildToSimState(incomingBuild) : INITIAL_STATE
  )
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // ─── Derived data ────────────────────────────────────────────────────────

  const selectedPilot = data?.pilots.find((p) => p.id === state.pilotId) ?? null
  const selectedMech = data?.mechs.find((m) => m.id === state.mechId) ?? null
  const selectedWeapon = data?.weapons.find((w) => w.id === state.weaponId) ?? null
  const selectedBackpack = data?.backpacks.find((b) => b.id === state.backpackId) ?? null

  // Filtering logic
  const getFilteredMechs = useCallback(() => {
    if (!data || !selectedPilot) return data?.mechs ?? []
    const license = selectedPilot.license
    if (!license) return data.mechs
    return data.mechs.filter((m) => {
      if (license === '重型') return true
      if (license === '中甲') return m.armorType !== '重型'
      if (license === '輕型') return m.armorType === '輕型'
      return true
    })
  }, [data, selectedPilot])

  const getFilteredWeapons = useCallback(() => {
    if (!data || !selectedMech) return data?.weapons ?? []
    const remainingOutput = selectedMech.output - selectedMech.weight
    return data.weapons.filter((w) => {
      // 固定武裝無法更換，本來就不是玩家配裝的選項（PLAN-040 決策八）。
      // ⚠ 這一行不能省：純封鎖型的 weight 為 0，下面那條唯一的規則
      //    `w.weight <= remainingOutput` 對它**恆為真** →
      //    玩家能幫任何輕型機甲選「嵐質儲能艙」當主武器。
      //    真正的槽位 gate（mechRestriction、equipSlot 槽存在性、back 槽互斥）屬 PLAN-047。
      if (w.isFixedArmament) return false
      return w.weight <= remainingOutput
    })
  }, [data, selectedMech])

  const getFilteredBackpacks = useCallback(() => {
    if (!data || !selectedMech) return data?.backpacks ?? []
    const weaponWeight = selectedWeapon?.weight ?? 0
    const remainingOutput = selectedMech.output - selectedMech.weight - weaponWeight
    return data.backpacks.filter((b) => {
      if (b.weight > remainingOutput) return false
      if (b.assemblableArmorType.length > 0) {
        const armorMap: Record<string, string> = { Light: '輕型', Medium: '中甲', Heavy: '重型' }
        const allowed = b.assemblableArmorType.map(t => armorMap[t]).filter(Boolean)
        if (allowed.length > 0 && !allowed.includes(selectedMech.armorType)) {
          return false
        }
      }
      return true
    })
  }, [data, selectedMech, selectedWeapon])

  const getMechModules = useCallback(() => {
    if (!data || !selectedMech) return []
    return data.modules.filter(
      (m) => m.id === selectedMech.module4Id || m.id === selectedMech.module8Id || selectedMech.moduleFixedIds.includes(m.id)
    )
  }, [data, selectedMech])

  const getPilotResearch = useCallback(() => {
    if (!selectedPilot) return null
    return pilotResearchList.find((pr) => pr.pilotId === selectedPilot.id) ?? null
  }, [pilotResearchList, selectedPilot])

  // ─── Handlers ────────────────────────────────────────────────────────────

  const selectPilot = (id: string) => {
    setState((prev) => ({ ...prev, pilotId: id, mechId: null, weaponId: null, backpackId: null }))
  }

  const selectMech = (id: string) => {
    setState((prev) => ({ ...prev, mechId: id, weaponId: null, backpackId: null }))
  }

  const selectWeapon = (id: string) => {
    setState((prev) => ({ ...prev, weaponId: id, backpackId: null }))
  }

  const selectBackpack = (id: string) => {
    setState((prev) => ({ ...prev, backpackId: id }))
  }

  const setResearch = (key: string, value: string) => {
    setState((prev) => ({
      ...prev,
      researchSelections: { ...prev.researchSelections, [key]: value },
    }))
  }

  const setFloatingMod = (index: number, mod: FloatingModSelection) => {
    setState((prev) => {
      const mods = [...prev.weaponFloatingMods]
      mods[index] = mod
      return { ...prev, weaponFloatingMods: mods }
    })
  }

  const toggleTriggerComponent = (id: string) => {
    setState((prev) => {
      const maxSlots = selectedWeapon?.triggerSlots ?? 0
      const ids = prev.triggerComponentIds.includes(id)
        ? prev.triggerComponentIds.filter((x) => x !== id)
        : prev.triggerComponentIds.length < maxSlots
          ? [...prev.triggerComponentIds, id]
          : prev.triggerComponentIds
      return { ...prev, triggerComponentIds: ids }
    })
  }

  const toggleEffectComponent = (id: string) => {
    setState((prev) => {
      const maxSlots = selectedWeapon?.effectSlots ?? 0
      const ids = prev.effectComponentIds.includes(id)
        ? prev.effectComponentIds.filter((x) => x !== id)
        : prev.effectComponentIds.length < maxSlots
          ? [...prev.effectComponentIds, id]
          : prev.effectComponentIds
      return { ...prev, effectComponentIds: ids }
    })
  }

  const setActiveForm = (mutexGroup: string, buffId: string) => {
    setState((prev) => ({
      ...prev,
      activeForms: { ...prev.activeForms, [mutexGroup]: buffId },
    }))
  }

  // ─── Export ──────────────────────────────────────────────────────────────

  const handleExport = async () => {
    if (!exportRef.current) return
    setExporting(true)
    try {
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: '#0a0c10',
        scale: 2,
        useCORS: true,
      })
      const dataUrl = canvas.toDataURL('image/png')

      // Try native share on mobile
      if (navigator.share && navigator.canShare) {
        const blob = await (await fetch(dataUrl)).blob()
        const file = new File([blob], 'loadout.png', { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: '鋼嵐配裝分享' })
          return
        }
      }

      // Fallback: download
      const link = document.createElement('a')
      link.download = `loadout_${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } finally {
      setExporting(false)
    }
  }

  // ─── Save Build ──────────────────────────────────────────────────────────

  const handleSaveBuild = useCallback(async (buildName: string): Promise<void> => {
    if (!user || !state.pilotId || !state.mechId || !state.weaponId) return
    const mech = data?.mechs.find((m) => m.id === state.mechId)
    const build: Build = {
      buildName,
      pilotId: state.pilotId,
      mechId: state.mechId,
      weaponId: state.weaponId,
      backpackId: state.backpackId ?? '',
      modules: {
        slot4: mech?.module4Id ?? null,
        slot8: mech?.module8Id ?? null,
        fixed: mech?.moduleFixedIds ?? [],
      },
      weaponFixedMod: {},
      weaponFloatingMod: state.weaponFloatingMods,
      triggerComponents: state.triggerComponentIds,
      effectComponents: state.effectComponentIds,
      pilotResearch: Object.fromEntries(
        Object.entries(state.researchSelections).map(([k, v]) => [k, parseInt(v) || 0])
      ),
    }
    await saveBuild(user.uid, build)
  }, [user, state, data])

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
        <div className="text-center py-20 text-text-dim">載入資料中...</div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-6">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Core Tool
        </span>
        <h1 className="text-3xl font-bold mt-2">配裝模擬器</h1>
        <p className="text-text-secondary mt-2">
          選擇機師、機甲、武器、背包，配置科研與元件，匯出分享圖。
        </p>
      </div>

      <StepIndicator steps={STEPS} current={step} onStep={setStep} />

      {/* Step content */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        {step === 'pilot' && <PilotStep data={data} state={state} onSelect={selectPilot} onNext={() => setStep('mech')} />}
        {step === 'mech' && <MechStep mechs={getFilteredMechs()} state={state} onSelect={selectMech} onNext={() => setStep('weapon')} />}
        {step === 'weapon' && <WeaponStep weapons={getFilteredWeapons()} state={state} onSelect={selectWeapon} onNext={() => setStep('backpack')} />}
        {step === 'backpack' && <BackpackStep backpacks={getFilteredBackpacks()} skillMap={backpackSkillMap} state={state} onSelect={selectBackpack} onNext={() => setStep('research')} />}
        {step === 'research' && <ResearchStep pilotResearch={getPilotResearch()} state={state} onSelect={setResearch} onNext={() => setStep('weaponMod')} />}
        {step === 'weaponMod' && <WeaponModStep weapon={selectedWeapon} state={state} onSetMod={setFloatingMod} onNext={() => setStep('components')} />}
        {step === 'components' && (
          <ComponentsStep
            components={data.components}
            weapon={selectedWeapon}
            state={state}
            onToggleTrigger={toggleTriggerComponent}
            onToggleEffect={toggleEffectComponent}
            onNext={() => setStep('result')}
          />
        )}
        {step === 'result' && (
          <ResultStep
            data={data}
            state={state}
            pilot={selectedPilot}
            mech={selectedMech}
            weapon={selectedWeapon}
            backpack={selectedBackpack}
            modules={getMechModules()}
            exportRef={exportRef}
            exporting={exporting}
            onExport={handleExport}
            user={user}
            onSave={handleSaveBuild}
            onSetForm={setActiveForm}
          />
        )}
      </div>
    </div>
  )
}

// ─── Step Components ─────────────────────────────────────────────────────────

function PilotStep({ data, state, onSelect, onNext }: { data: AllData; state: SimState; onSelect: (id: string) => void; onNext: () => void }) {
  const [search, setSearch] = useState('')
  const filtered = data.pilots.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.class.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">Step 1 — 選擇機師</h2>
      <p className="text-sm text-text-dim mb-4">自動帶入六維、技能、天賦、神經驅動、駕駛等級</p>
      <input
        type="text"
        placeholder="搜尋機師名稱或職業..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-bg-dark border border-border rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-border-accent mb-4"
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 max-h-[400px] overflow-y-auto">
        {filtered.map((p) => (
          <SelectionCard key={p.id} selected={state.pilotId === p.id} onClick={() => onSelect(p.id)}>
            <div className="text-sm font-bold">{p.name}</div>
            <div className="text-[14px] text-text-dim">{p.class} · {p.license}</div>
          </SelectionCard>
        ))}
      </div>
      {state.pilotId && (
        <div className="mt-4 flex justify-end">
          <button onClick={onNext} className="px-4 py-2 bg-accent-orange text-white rounded-lg text-sm font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer">
            下一步 →
          </button>
        </div>
      )}
    </div>
  )
}

function MechStep({ mechs, state, onSelect, onNext }: { mechs: Mech[]; state: SimState; onSelect: (id: string) => void; onNext: () => void }) {
  const [search, setSearch] = useState('')
  const filtered = mechs.filter((m) => !search || m.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">Step 2 — 選擇機甲</h2>
      <p className="text-sm text-text-dim mb-4">根據駕駛許可自動篩選可駕駛機甲（共 {mechs.length} 架可選）</p>
      <input
        type="text"
        placeholder="搜尋機甲名稱..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-bg-dark border border-border rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-border-accent mb-4"
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[400px] overflow-y-auto">
        {filtered.map((m) => (
          <SelectionCard key={m.id} selected={state.mechId === m.id} onClick={() => onSelect(m.id)}>
            <div className="text-sm font-bold">{m.name}</div>
            <div className="text-[14px] text-text-dim">{m.armorType} · 出力{m.output}</div>
          </SelectionCard>
        ))}
      </div>
      {state.mechId && (
        <div className="mt-4 flex justify-end">
          <button onClick={onNext} className="px-4 py-2 bg-accent-orange text-white rounded-lg text-sm font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer">
            下一步 →
          </button>
        </div>
      )}
    </div>
  )
}

function WeaponStep({ weapons, state, onSelect, onNext }: { weapons: Weapon[]; state: SimState; onSelect: (id: string) => void; onNext: () => void }) {
  const [search, setSearch] = useState('')
  const filtered = weapons.filter((w) => !search || w.name.toLowerCase().includes(search.toLowerCase()) || w.type.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">Step 3 — 選擇武器</h2>
      <p className="text-sm text-text-dim mb-4">已根據機甲出力自動篩選（共 {weapons.length} 把可裝備）</p>
      <input
        type="text"
        placeholder="搜尋武器名稱或種類..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-bg-dark border border-border rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-border-accent mb-4"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
        {filtered.map((w) => (
          <SelectionCard key={w.id} selected={state.weaponId === w.id} onClick={() => onSelect(w.id)}>
            <div className="text-sm font-bold">{w.name}</div>
            <div className="text-[14px] text-text-dim">
              {w.kind}/{w.type} · 重量{w.weight} {w.isExclusive && <span className="text-accent-yellow">★專武</span>}
            </div>
          </SelectionCard>
        ))}
      </div>
      {state.weaponId && (
        <div className="mt-4 flex justify-end">
          <button onClick={onNext} className="px-4 py-2 bg-accent-orange text-white rounded-lg text-sm font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer">
            下一步 →
          </button>
        </div>
      )}
    </div>
  )
}

function BackpackStep({ backpacks, skillMap, state, onSelect, onNext }: {
  backpacks: Backpack[]
  /** PLAN-043：技能本體已抽離為集合，選擇卡的說明文字要反查 */
  skillMap: Map<string, BackpackSkillDoc>
  state: SimState
  onSelect: (id: string) => void
  onNext: () => void
}) {
  return (
    <div>
      <h2 className="text-lg font-bold mb-1">Step 4 — 選擇背包</h2>
      <p className="text-sm text-text-dim mb-4">已根據裝甲類型與剩餘出力自動篩選（共 {backpacks.length} 個可裝備）</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
        {backpacks.map((b) => (
          <SelectionCard key={b.id} selected={state.backpackId === b.id} onClick={() => onSelect(b.id)}>
            <div className="text-sm font-bold">{b.name}</div>
            <div className="text-[14px] text-text-dim">
              {b.type} · 重量{b.weight} {b.assemblableArmorType.length > 0 && <span className="text-accent-cyan">({b.assemblableArmorType.map(t => ({Light:'輕型',Medium:'中甲',Heavy:'重型'})[t]??t).join('/')}限定)</span>}
            </div>
            <div className="text-[14px] text-text-secondary mt-1">
              {resolveBackpackSkills(b, skillMap).map((sk) => sk.description).join('／')}
            </div>
          </SelectionCard>
        ))}
        {backpacks.length === 0 && (
          <div className="col-span-full text-center py-8 text-text-dim">無可裝備的背包（出力不足或裝甲類型不符）</div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={onNext} className="px-4 py-2 bg-accent-orange text-white rounded-lg text-sm font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer">
          {state.backpackId ? '下一步 →' : '跳過 →'}
        </button>
      </div>
    </div>
  )
}

function ResearchStep({
  pilotResearch,
  state,
  onSelect,
  onNext,
}: {
  pilotResearch: PilotResearch | null
  state: SimState
  onSelect: (key: string, value: string) => void
  onNext: () => void
}) {
  if (!pilotResearch) {
    return (
      <div>
        <h2 className="text-lg font-bold mb-1">Step 5 — 配置科研</h2>
        <p className="text-sm text-text-dim mb-4">此機師尚無科研資料</p>
        <div className="flex justify-end">
          <button onClick={onNext} className="px-4 py-2 bg-accent-orange text-white rounded-lg text-sm font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer">
            跳過 →
          </button>
        </div>
      </div>
    )
  }

  const categories = [
    { key: 'pilotTraits', label: '機師特質', traits: pilotResearch.pilotTraits },
    { key: 'mechTraits', label: '機甲特質', traits: pilotResearch.mechTraits },
    { key: 'weaponTraits', label: '武裝特質', traits: pilotResearch.weaponTraits },
  ]

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">Step 5 — 配置機師個別科研</h2>
      <p className="text-sm text-text-dim mb-4">各欄位選擇一個選項安裝</p>
      <div className="space-y-6">
        {categories.map((cat) => (
          <div key={cat.key}>
            <h3 className="text-sm font-bold text-accent-cyan mb-2">{cat.label}</h3>
            <div className="space-y-3">
              {cat.traits.map((trait) => {
                const selKey = `${cat.key}_${trait.slot}`
                return (
                  <div key={trait.slot}>
                    <div className="text-xs text-text-dim mb-1">欄位 {trait.slot}</div>
                    <div className="flex flex-wrap gap-2">
                      {trait.options.map((opt) => (
                        <button
                          key={opt.name}
                          onClick={() => onSelect(selKey, opt.name)}
                          className={`px-3 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                            state.researchSelections[selKey] === opt.name
                              ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
                              : 'bg-bg-dark text-text-secondary border-border hover:border-border-accent'
                          }`}
                        >
                          <div className="font-medium">{opt.name}</div>
                          <div className="text-[13px] text-text-dim">{opt.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={onNext} className="px-4 py-2 bg-accent-orange text-white rounded-lg text-sm font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer">
          下一步 →
        </button>
      </div>
    </div>
  )
}

function WeaponModStep({
  weapon,
  state,
  onSetMod,
  onNext,
}: {
  weapon: Weapon | null
  state: SimState
  onSetMod: (index: number, mod: FloatingModSelection) => void
  onNext: () => void
}) {
  if (!weapon) {
    return (
      <div>
        <h2 className="text-lg font-bold mb-1">Step 6 — 武器改裝</h2>
        <p className="text-sm text-text-dim mb-4">請先選擇武器</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">Step 6 — 武器改裝</h2>
      <p className="text-sm text-text-dim mb-4">固定改裝自動帶入，浮動改裝可選擇效果</p>

      {/* Fixed mod */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-accent-green mb-2">固定改裝 — {weapon.fixedMod.planName}</h3>
        <div className="bg-bg-dark rounded-lg p-3 border border-border">
          {weapon.fixedMod.effects.map((eff, i) => (
            <div key={i} className="text-xs text-text-secondary">
              {eff.stat}: +{eff.value}
            </div>
          ))}
          <div className="text-[13px] text-text-dim mt-1">最大等級 Lv.{weapon.fixedMod.maxLevel}</div>
        </div>
      </div>

      {/* Floating mod */}
      <div>
        <h3 className="text-sm font-bold text-accent-yellow mb-2">
          浮動改裝 — {weapon.floatingMod.planName}（{weapon.floatingMod.slots} 格）
        </h3>
        <div className="space-y-2">
          {Array.from({ length: weapon.floatingMod.slots }).map((_, i) => (
            <div key={i} className="bg-bg-dark rounded-lg p-3 border border-border">
              <div className="text-xs text-text-dim mb-2">改裝格 {i + 1}</div>
              <div className="flex flex-wrap gap-2">
                {weapon.floatingMod.possibleEffects.map((eff, j) => {
                  const selected = state.weaponFloatingMods[i]?.stat === eff.stat && state.weaponFloatingMods[i]?.condition === eff.condition
                  return (
                    <button
                      key={j}
                      onClick={() => onSetMod(i, { stat: eff.stat, condition: eff.condition, value: eff.max })}
                      className={`px-2 py-1 rounded text-[14px] border transition-colors cursor-pointer ${
                        selected
                          ? 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/40'
                          : 'bg-bg-card text-text-dim border-border hover:text-text-secondary'
                      }`}
                    >
                      {eff.stat} +{eff.min}~{eff.max}
                      {eff.condition && <span className="ml-1 text-[13px]">({eff.condition})</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onNext} className="px-4 py-2 bg-accent-orange text-white rounded-lg text-sm font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer">
          下一步 →
        </button>
      </div>
    </div>
  )
}

function ComponentsStep({
  components,
  weapon,
  state,
  onToggleTrigger,
  onToggleEffect,
  onNext,
}: {
  components: Component[]
  weapon: Weapon | null
  state: SimState
  onToggleTrigger: (id: string) => void
  onToggleEffect: (id: string) => void
  onNext: () => void
}) {
  const triggers = components.filter((c): c is TriggerComponent => c.componentType === 'Condition')
  const effects = components.filter((c): c is EffectComponent => c.componentType === 'Function')
  const triggerSlots = weapon?.triggerSlots ?? 0
  const effectSlots = weapon?.effectSlots ?? 0

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">Step 7 — 配置元件</h2>
      <p className="text-sm text-text-dim mb-4">
        觸元件 {state.triggerComponentIds.length}/{triggerSlots} 格 · 應元件 {state.effectComponentIds.length}/{effectSlots} 格
      </p>

      {/* Trigger components */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-accent-purple mb-2">觸元件（觸發條件）— {triggerSlots} 格</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[250px] overflow-y-auto">
          {triggers.map((t) => {
            const selected = state.triggerComponentIds.includes(t.id)
            return (
              <button
                key={t.id}
                onClick={() => onToggleTrigger(t.id)}
                className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                  selected
                    ? 'bg-accent-purple/10 border-accent-purple/40'
                    : 'bg-bg-dark border-border hover:border-border-accent'
                }`}
              >
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-[14px] text-text-dim">
                  Lv.{t.probabilityLevel} · {t.condition}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Effect components */}
      <div>
        <h3 className="text-sm font-bold text-accent-cyan mb-2">應元件（效果）— {effectSlots} 格</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[250px] overflow-y-auto">
          {effects.map((e) => {
            const selected = state.effectComponentIds.includes(e.id)
            return (
              <button
                key={e.id}
                onClick={() => onToggleEffect(e.id)}
                className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                  selected
                    ? 'bg-accent-cyan/10 border-accent-cyan/40'
                    : 'bg-bg-dark border-border hover:border-border-accent'
                }`}
              >
                <div className="text-sm font-medium">{e.name}</div>
                <div className="text-[14px] text-text-dim">
                  Lv.{e.probabilityLevel} · {e.description}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onNext} className="px-4 py-2 bg-accent-orange text-white rounded-lg text-sm font-medium hover:bg-accent-orange/80 transition-colors cursor-pointer">
          查看結果 →
        </button>
      </div>
    </div>
  )
}

// ── PLAN-019-B：buff 效果加總輔助 ───────────────────────────────────────────────

/** 取一個 ResolvedBuff 在指定 level 的 effects（階梯 buff 取該級；無階梯取頂層） */
function buffLevelEffects(rb: ResolvedBuff): SkillEffect[] {
  const { buff, level } = rb
  if (buff.levels && buff.levels.length > 0) {
    const lv = level != null ? buff.levels.find((l) => l.level === level) : undefined
    return (lv ?? buff.levels[buff.levels.length - 1]).effects ?? []
  }
  return buff.effects ?? []
}

/** 把多個 active buff 的 effects 依 stat 加總（v1 僅 add；override 留待 Phase 7 傷害公式處理） */
function aggregateEffects(buffs: ResolvedBuff[]): { stat: string; value: number }[] {
  const sum = new Map<string, number>()
  for (const rb of buffs) {
    for (const e of buffLevelEffects(rb)) {
      sum.set(e.stat, (sum.get(e.stat) ?? 0) + e.value)
    }
  }
  return [...sum.entries()].map(([stat, value]) => ({ stat, value }))
}

function ResultStep({
  data,
  state,
  pilot,
  mech,
  weapon,
  backpack,
  modules,
  exportRef,
  exporting,
  onExport,
  user,
  onSave,
  onSetForm,
}: {
  data: AllData
  state: SimState
  pilot: Pilot | null
  mech: Mech | null
  weapon: Weapon | null
  backpack: Backpack | null
  modules: Module[]
  exportRef: React.RefObject<HTMLDivElement | null>
  exporting: boolean
  onExport: () => void
  user: import('firebase/auth').User | null
  onSave: (buildName: string) => Promise<void>
  onSetForm: (mutexGroup: string, buffId: string) => void
}) {
  const [buildName, setBuildName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const handleSave = async () => {
    if (!buildName.trim()) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await onSave(buildName.trim())
      setSaveMsg('配裝已儲存！')
      setBuildName('')
    } catch {
      setSaveMsg('儲存失敗，請稍後再試')
    } finally {
      setSaving(false)
    }
  }
  // PLAN-043：背包技能字典（顯示層用；buff 池的等級解析在 buildBuffPool 內部做）
  const backpackSkillMap = useMemo(() => buildBackpackSkillMap(data.backpackSkills), [data.backpackSkills])

  const triggerComps = data.components.filter((c): c is TriggerComponent => state.triggerComponentIds.includes(c.id) && c.componentType === 'Condition')
  const effectComps = data.components.filter((c): c is EffectComponent => state.effectComponentIds.includes(c.id) && c.componentType === 'Function')

  // ── PLAN-019-B：可達 buff 收斂 ──────────────────────────────────────────────
  const reachable = useMemo(() => {
    const skillMap = buildSkillMap(data.pilotSkills)
    const skills = resolvePilotSkills(pilot?.skills, skillMap)
    // PLAN-032：weaponSkills 傳的是同一份技能庫（pilotSkills 集合＝全站技能字典，非只有機師的）。
    // 漏傳的症狀是「引用化的武器完全不賦予 buff」，不會報錯——見 BuffPoolInput.weaponSkills。
    const pool = buildBuffPool({
      pilot, skills, modules, weapon, backpack,
      backpackSkills: data.backpackSkills, weaponSkills: data.pilotSkills,
    })
    const buffMap = new Map(data.buffs.map((b) => [b.id, b]))
    return resolveReachable(pool, buffMap)
  }, [data.pilotSkills, data.buffs, data.backpackSkills, pilot, modules, weapon, backpack])

  // 形態互斥組：未選時預設取第一個 option；產出「目前 active 的形態 buff」清單
  const activeFormBuffs = reachable.formGroups.map((g) => {
    const chosenId = state.activeForms[g.mutexGroup] ?? g.options[0]?.buff.id
    return g.options.find((o) => o.buff.id === chosenId) ?? g.options[0]
  })
  // active buff 集 = 固定 buff + 各形態組擇一
  const activeBuffs: ResolvedBuff[] = [...reachable.fixed, ...activeFormBuffs.filter(Boolean)]
  const aggregatedEffects = aggregateEffects(activeBuffs)
  const hasReachable = reachable.formGroups.length > 0 || reachable.fixed.length > 0

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">配裝結果</h2>

      {/* 形態切換（PLAN-019-B：mutexGroup 擇一）*/}
      {reachable.formGroups.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-4 mb-6">
          <div className="text-sm font-bold text-accent-purple mb-3">形態切換</div>
          <div className="space-y-3">
            {reachable.formGroups.map((g) => {
              const chosenId = state.activeForms[g.mutexGroup] ?? g.options[0]?.buff.id
              return (
                <div key={g.mutexGroup}>
                  <div className="flex flex-wrap gap-2">
                    {g.options.map((o) => (
                      <button
                        key={o.buff.id}
                        onClick={() => onSetForm(g.mutexGroup, o.buff.id)}
                        title={o.origins.join('、')}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                          chosenId === o.buff.id
                            ? 'bg-accent-purple/15 text-accent-purple border-accent-purple/40'
                            : 'bg-bg-dark text-text-secondary border-border hover:border-border-accent'
                        }`}
                      >
                        {o.buff.name}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="text-[13px] text-text-dim mt-3">
            同一形態組一次只能存在一個（互斥）；切換會即時反映在下方「可達增益」。
          </div>
        </div>
      )}

      {/* Export card */}
      <div ref={exportRef} className="bg-bg-dark border border-border rounded-xl p-6 mb-6" style={{ minWidth: 600 }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
          <div className="text-lg font-bold text-accent-orange font-[Orbitron,sans-serif]">鋼嵐工具站</div>
          <div className="text-xs text-text-dim">配裝分享</div>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Pilot */}
          <div className="bg-bg-card rounded-lg p-3 border border-border">
            <div className="text-[13px] text-accent-orange uppercase tracking-wider mb-1">機師</div>
            <div className="text-sm font-bold">{pilot?.name ?? '未選擇'}</div>
            {pilot && <div className="text-[14px] text-text-dim">{pilot.class} · {pilot.license}</div>}
          </div>

          {/* Mech */}
          <div className="bg-bg-card rounded-lg p-3 border border-border">
            <div className="text-[13px] text-accent-blue uppercase tracking-wider mb-1">機甲</div>
            <div className="text-sm font-bold">{mech?.name ?? '未選擇'}</div>
            {mech && <div className="text-[14px] text-text-dim">{mech.armorType} · 火力{mech.firepower}</div>}
          </div>

          {/* Weapon */}
          <div className="bg-bg-card rounded-lg p-3 border border-border">
            <div className="text-[13px] text-accent-yellow uppercase tracking-wider mb-1">武器</div>
            <div className="text-sm font-bold">{weapon?.name ?? '未選擇'}</div>
            {weapon && <div className="text-[14px] text-text-dim">{weapon.type}/{weapon.kind} · 攻擊{weapon.attack}</div>}
          </div>

          {/* Backpack */}
          <div className="bg-bg-card rounded-lg p-3 border border-border">
            <div className="text-[13px] text-accent-green uppercase tracking-wider mb-1">背包</div>
            <div className="text-sm font-bold">{backpack?.name ?? '未裝備'}</div>
            {backpack && (
              <div className="text-[14px] text-text-dim">
                {resolveBackpackSkills(backpack, backpackSkillMap).map((sk) => sk.name).join('、')}
              </div>
            )}
          </div>
        </div>

        {/* Modules */}
        <div className="bg-bg-card rounded-lg p-3 border border-border mb-4">
          <div className="text-[13px] text-accent-purple uppercase tracking-wider mb-2">模組配置</div>
          <div className="grid grid-cols-3 gap-2">
            {modules.map((mod) => (
              <div key={mod.id} className="text-xs">
                <span className="text-text-dim">{mod.slot === '4mod' ? '四模' : mod.slot === '8mod' ? '八模' : '固定'}：</span>
                <span className="text-text-primary">{mod.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Components */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-bg-card rounded-lg p-3 border border-border">
            <div className="text-[13px] text-accent-purple uppercase tracking-wider mb-2">觸元件</div>
            {triggerComps.length > 0 ? (
              triggerComps.map((c) => (
                <div key={c.id} className="text-xs text-text-secondary">{c.name}</div>
              ))
            ) : (
              <div className="text-xs text-text-dim">未配置</div>
            )}
          </div>
          <div className="bg-bg-card rounded-lg p-3 border border-border">
            <div className="text-[13px] text-accent-cyan uppercase tracking-wider mb-2">應元件</div>
            {effectComps.length > 0 ? (
              effectComps.map((c) => (
                <div key={c.id} className="text-xs text-text-secondary">{c.name}</div>
              ))
            ) : (
              <div className="text-xs text-text-dim">未配置</div>
            )}
          </div>
        </div>

        {/* 可達增益（PLAN-019-B）：active buff + 效果加總 */}
        <div className="bg-bg-card rounded-lg p-3 border border-border mb-4">
          <div className="text-[13px] text-accent-orange uppercase tracking-wider mb-2">可達增益</div>
          {hasReachable ? (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {activeBuffs.map((rb) => (
                  <span
                    key={rb.buff.id}
                    className="text-[13px] px-2 py-0.5 rounded bg-accent-purple/10 text-accent-purple border border-accent-purple/30"
                  >
                    {rb.buff.name}
                    {rb.level != null && <span className="opacity-70"> Lv.{rb.level}</span>}
                  </span>
                ))}
              </div>
              {aggregatedEffects.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
                  {aggregatedEffects.map((e) => (
                    <div key={e.stat} className="text-[13px] text-text-secondary">
                      {e.stat}: <span className="text-accent-green">+{e.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-text-dim">此配裝的可達 buff 尚無結構化數值效果</div>
              )}
            </>
          ) : (
            <div className="text-sm text-text-dim text-center py-2">此配裝無可達增益</div>
          )}
        </div>

        {/* Damage placeholder */}
        <div className="bg-bg-card rounded-lg p-3 border border-border border-dashed">
          <div className="text-[13px] text-text-dim uppercase tracking-wider mb-1">傷害計算</div>
          <div className="text-sm text-text-dim text-center py-2">
            傷害計算系統開發中（Phase 7）
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-4">
        {/* Export */}
        <div className="flex justify-center">
          <button
            onClick={onExport}
            disabled={exporting}
            className="px-6 py-3 bg-accent-orange text-white rounded-xl text-sm font-bold hover:bg-accent-orange/80 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-2"
          >
            {exporting ? '匯出中...' : '📸 匯出分享圖'}
          </button>
        </div>

        {/* Save build */}
        <div className="border-t border-border pt-4">
          <div className="text-xs text-text-dim mb-3 text-center">☁️ 儲存配裝至雲端</div>
          {user ? (
            <div className="flex flex-col sm:flex-row gap-2 items-center justify-center">
              <input
                type="text"
                placeholder="輸入配裝名稱..."
                value={buildName}
                onChange={(e) => setBuildName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                maxLength={40}
                className="w-full sm:w-60 bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-border-accent"
              />
              <button
                onClick={handleSave}
                disabled={saving || !buildName.trim()}
                className="px-4 py-2 bg-accent-blue/10 text-accent-blue border border-accent-blue/30 rounded-lg text-sm font-medium hover:bg-accent-blue/20 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
              >
                {saving ? '儲存中...' : '儲存配裝'}
              </button>
            </div>
          ) : (
            <div className="text-center">
              <Link
                to="/profile"
                className="text-sm text-accent-orange no-underline hover:text-accent-orange/80 transition-colors"
              >
                請先登入以儲存配裝 →
              </Link>
            </div>
          )}
          {saveMsg && (
            <div
              className={`text-center text-sm mt-2 ${
                saveMsg.includes('失敗') ? 'text-accent-red' : 'text-accent-green'
              }`}
            >
              {saveMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
