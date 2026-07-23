import { useEffect, useMemo } from 'react'
import type {
  Pilot, Mech, Module, Weapon, Backpack, Component,
  GlobalResearch, GameBuff, PilotSkillDoc,
} from '../types'
import { ModuleSlot } from '../types/enums'
import { useGameData, EMPTY_GLOBAL_RESEARCH, type CollectionKey } from '../contexts/GameDataContext'

// ── 通用型別 ──────────────────────────────────────────────────────────────────

export interface HookResult<T> {
  data: T
  loading: boolean
  error: Error | null
}

// ── 內部輔助 ──────────────────────────────────────────────────────────────────

function useCollections(keys: CollectionKey[]) {
  const { loadedKeys, errorMap, ensureLoaded, reloadTick } = useGameData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void ensureLoaded(keys) }, [ensureLoaded, reloadTick])
  const loading = !keys.every(k => loadedKeys.has(k))
  const error   = keys.map(k => errorMap[k]).find(Boolean) ?? null
  return { loading, error: error ?? null }
}

// ── 機師 ──────────────────────────────────────────────────────────────────────

export function usePilots(): HookResult<Pilot[]> {
  const { pilots } = useGameData()
  const { loading, error } = useCollections(['pilots'])
  return { data: pilots, loading, error }
}

export function usePilotNameMap(): HookResult<Record<string, string>> {
  const { pilots } = useGameData()
  const { loading, error } = useCollections(['pilots'])
  const data = useMemo(
    () => Object.fromEntries(pilots.map((p) => [p.id, p.name])),
    [pilots],
  )
  return { data, loading, error }
}

export function usePilot(id: string | undefined): HookResult<Pilot | null> {
  const { pilots } = useGameData()
  const { loading, error } = useCollections(['pilots'])
  const data = useMemo(
    () => (id ? (pilots.find((p) => p.id === id) ?? null) : null),
    [id, pilots],
  )
  return { data, loading, error }
}

// ── 機甲 ──────────────────────────────────────────────────────────────────────

export function useMechs(): HookResult<Mech[]> {
  const { mechs } = useGameData()
  const { loading, error } = useCollections(['mechs'])
  return { data: mechs, loading, error }
}

export function useMech(id: string | undefined): HookResult<Mech | null> {
  const { mechs } = useGameData()
  const { loading, error } = useCollections(['mechs'])
  const data = useMemo(
    () => (id ? (mechs.find((m) => m.id === id) ?? null) : null),
    [id, mechs],
  )
  return { data, loading, error }
}

export function useMechNameMap(): HookResult<Record<string, string>> {
  const { mechs } = useGameData()
  const { loading, error } = useCollections(['mechs'])
  const data = useMemo(
    () => Object.fromEntries(mechs.map((m) => [m.id, m.name])),
    [mechs],
  )
  return { data, loading, error }
}

export interface MechWithModules {
  mech: Mech
  mod4: Module | null
  mod8: Module | null
  fixedMods: Module[]
  exclusiveMods: Module[]
}

export function useMechWithModules(id: string | undefined): HookResult<MechWithModules | null> {
  const { mechs, modules } = useGameData()
  const { loading, error } = useCollections(['mechs', 'modules'])

  const data = useMemo<MechWithModules | null>(() => {
    if (!id) return null
    const mech = mechs.find((m) => m.id === id) ?? null
    if (!mech) return null
    const find = (mid: string) => modules.find((m) => m.id === mid) ?? null
    const exclusiveMods = modules.filter(
      (m) => m.boundMechId === mech.id && m.slot === ModuleSlot.EXCLUSIVE,
    )
    const exclusiveIds = new Set(exclusiveMods.map((m) => m.id))
    const mod4Candidate = mech.module4Id ? find(mech.module4Id) : null
    const mod8Candidate = mech.module8Id ? find(mech.module8Id) : null
    return {
      mech,
      mod4: mod4Candidate?.slot === ModuleSlot.SLOT_4 ? mod4Candidate : null,
      mod8: mod8Candidate?.slot === ModuleSlot.SLOT_8 ? mod8Candidate : null,
      fixedMods: (mech.moduleFixedIds ?? [])
        .map(find)
        .filter((m): m is Module => m !== null && m.slot === ModuleSlot.BUILT_IN && !exclusiveIds.has(m.id)),
      exclusiveMods,
    }
  }, [id, mechs, modules])

  return { data, loading, error }
}

// ── 模組 ──────────────────────────────────────────────────────────────────────

export function useModules(): HookResult<Module[]> {
  const { modules } = useGameData()
  const { loading, error } = useCollections(['modules'])
  return { data: modules, loading, error }
}

// ── 武器 ──────────────────────────────────────────────────────────────────────

export function useWeapons(): HookResult<Weapon[]> {
  const { weapons } = useGameData()
  const { loading, error } = useCollections(['weapons'])
  return { data: weapons, loading, error }
}

export function useWeapon(id: string | undefined): HookResult<Weapon | null> {
  const { weapons } = useGameData()
  const { loading, error } = useCollections(['weapons'])
  const data = useMemo(
    () => (id ? (weapons.find((w) => w.id === id) ?? null) : null),
    [id, weapons],
  )
  return { data, loading, error }
}

export function usePilotExclusiveWeapon(pilotId: string | undefined): HookResult<Weapon | null> {
  const { weapons } = useGameData()
  const { loading, error } = useCollections(['weapons'])
  const data = useMemo(
    () => (pilotId ? (weapons.find((w) => w.isExclusive && w.exclusiveFor === pilotId) ?? null) : null),
    [pilotId, weapons],
  )
  return { data, loading, error }
}

export function usePilotExclusiveWeapons(pilotId: string | undefined): HookResult<Weapon[]> {
  const { weapons } = useGameData()
  const { loading, error } = useCollections(['weapons'])
  const data = useMemo(
    () => (pilotId ? weapons.filter((w) => w.isExclusive && w.exclusiveFor === pilotId) : []),
    [pilotId, weapons],
  )
  return { data, loading, error }
}

// ── 背包 ──────────────────────────────────────────────────────────────────────

export function useBackpacks(): HookResult<Backpack[]> {
  const { backpacks } = useGameData()
  const { loading, error } = useCollections(['backpacks'])
  return { data: backpacks, loading, error }
}

/**
 * 背包 id→name 對照（PLAN-031 複合武器「融合自 ○○背包」顯示用）。
 * ⚠ 會觸發 backpacks 集合載入（冷快取 ~180 read）——呼叫端請在「確定是複合武器」
 *   的元件邊界內才掛載此 hook，避免一般武器頁多付讀取量。
 */
export function useBackpackNameMap(): HookResult<Record<string, string>> {
  const { backpacks } = useGameData()
  const { loading, error } = useCollections(['backpacks'])
  const data = useMemo(
    () => Object.fromEntries(backpacks.map((b) => [b.id, b.name])),
    [backpacks],
  )
  return { data, loading, error }
}

// ── 元件 ──────────────────────────────────────────────────────────────────────

export function useComponents(): HookResult<Component[]> {
  const { components } = useGameData()
  const { loading, error } = useCollections(['components'])
  return { data: components, loading, error }
}

// ── 全域科研 ──────────────────────────────────────────────────────────────────

export function useGlobalResearch(): HookResult<GlobalResearch> {
  const { globalResearch } = useGameData()
  const { loading, error } = useCollections(['globalResearch'])
  return { data: globalResearch, loading, error }
}

// ── SimulatorPage 全量資料 ────────────────────────────────────────────────────

export interface AllGameData {
  pilots: Pilot[]
  mechs: Mech[]
  weapons: Weapon[]
  backpacks: Backpack[]
  modules: Module[]
  components: Component[]
  globalResearch: GlobalResearch
  /** PLAN-019-B：可達 buff 收斂用（buffs 集合 + 解析字串 ID 技能的 pilotSkills） */
  buffs: GameBuff[]
  pilotSkills: PilotSkillDoc[]
}

const SIMULATOR_KEYS: CollectionKey[] = ['pilots', 'mechs', 'modules', 'weapons', 'backpacks', 'components', 'globalResearch', 'buffs', 'pilotSkills']

export function useAllGameData(): HookResult<AllGameData | null> {
  const { pilots, mechs, weapons, backpacks, modules, components, globalResearch, buffs, pilotSkills } = useGameData()
  const { loading, error } = useCollections(SIMULATOR_KEYS)

  const data = useMemo<AllGameData | null>(() => {
    if (loading) return null
    return { pilots, mechs, weapons, backpacks, modules, components, globalResearch, buffs, pilotSkills }
  }, [loading, pilots, mechs, weapons, backpacks, modules, components, globalResearch, buffs, pilotSkills])

  return { data, loading, error }
}

// ── 便利重新整理 ─────────────────────────────────────────────────────────────

export { EMPTY_GLOBAL_RESEARCH }
