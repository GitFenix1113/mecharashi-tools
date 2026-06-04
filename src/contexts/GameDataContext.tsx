import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import type { Pilot, Mech, Module, Weapon, Backpack, Component, GlobalResearch, GrayOpsRoster, GameBuff, PilotSkillDoc } from '../types'
import {
  getPilots, getMechs, getModules, getWeapons, getBackpacks, getComponents, getBuffs, getPilotSkills,
  getGlobalResearch, getGrayOpsRoster, getDataVersion,
} from '../lib/firestoreApi'

export const EMPTY_GLOBAL_RESEARCH: GlobalResearch = {
  pilotResearchByClass: {},
  mechResearchByType:   {},
  weaponResearchByType: {},
}

export type CollectionKey =
  | 'pilots' | 'mechs' | 'modules' | 'weapons'
  | 'backpacks' | 'components' | 'buffs' | 'pilotSkills' | 'globalResearch' | 'grayOpsRoster'

export const ALL_COLLECTION_KEYS: CollectionKey[] = [
  'pilots', 'mechs', 'modules', 'weapons',
  'backpacks', 'components', 'buffs', 'pilotSkills', 'globalResearch', 'grayOpsRoster',
]

// ── PLAN-017：版本 gate 的 per-collection localStorage 快取 ─────────────────────
// 任何 CollectionKey（含未來新集合）自動納入，無需維護清單。
// 由 meta/gameData 的 version gate；版本不符或無 meta 文件時退化為直接讀取。

const CACHE_PREFIX = 'mecharashi_gd_'

function readCache<T>(key: string, version: string): T | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { v: string; d: T }
    if (parsed.v !== version) { localStorage.removeItem(CACHE_PREFIX + key); return undefined }
    return parsed.d
  } catch {
    try { localStorage.removeItem(CACHE_PREFIX + key) } catch { /* ignore */ }
    return undefined
  }
}

function writeCache(key: string, version: string, data: unknown): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ v: version, d: data }))
  } catch { /* 配額超限等 → 略過快取，不影響功能 */ }
}

function clearCache(): void {
  if (typeof localStorage === 'undefined') return
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
}

export interface GameDataState {
  pilots:         Pilot[]
  mechs:          Mech[]
  weapons:        Weapon[]
  backpacks:      Backpack[]
  modules:        Module[]
  components:     Component[]
  buffs:          GameBuff[]
  pilotSkills:    PilotSkillDoc[]
  globalResearch: GlobalResearch
  grayOpsRoster:  GrayOpsRoster | null
  loadedKeys:     ReadonlySet<CollectionKey>
  errorMap:       Readonly<Partial<Record<CollectionKey, Error>>>
  reloadTick:     number
  ensureLoaded:   (keys: CollectionKey[]) => void
  reload:         () => void
}

const GameDataContext = createContext<GameDataState | null>(null)

export function GameDataProvider({ children }: { children: ReactNode }) {
  const [pilots,         setPilots]         = useState<Pilot[]>([])
  const [mechs,          setMechs]          = useState<Mech[]>([])
  const [weapons,        setWeapons]        = useState<Weapon[]>([])
  const [backpacks,      setBackpacks]      = useState<Backpack[]>([])
  const [modules,        setModules]        = useState<Module[]>([])
  const [components,     setComponents]     = useState<Component[]>([])
  const [buffs,          setBuffs]          = useState<GameBuff[]>([])
  const [pilotSkills,    setPilotSkills]    = useState<PilotSkillDoc[]>([])
  const [globalResearch, setGlobalResearch] = useState<GlobalResearch>(EMPTY_GLOBAL_RESEARCH)
  const [grayOpsRoster,  setGrayOpsRoster]  = useState<GrayOpsRoster | null>(null)
  const [loadedKeys,     setLoadedKeys]     = useState<Set<CollectionKey>>(new Set())
  const [errorMap,       setErrorMap]       = useState<Partial<Record<CollectionKey, Error>>>({})
  const [reloadTick,     setReloadTick]     = useState(0)

  // Tracks keys that are already in-flight or done (synchronous check, prevents double-fetch)
  const fetchedRef = useRef<Set<CollectionKey>>(new Set())
  // 版本：undefined=尚未讀取；null=無 meta 文件（退化）；string=遠端版本
  const versionRef = useRef<string | null | undefined>(undefined)
  const versionPromiseRef = useRef<Promise<void> | null>(null)

  const applyData = useCallback((key: CollectionKey, data: unknown) => {
    switch (key) {
      case 'pilots':         setPilots(data as Pilot[]); break
      case 'mechs':          setMechs(data as Mech[]); break
      case 'modules':        setModules(data as Module[]); break
      case 'weapons':        setWeapons(data as Weapon[]); break
      case 'backpacks':      setBackpacks(data as Backpack[]); break
      case 'components':     setComponents(data as Component[]); break
      case 'buffs':          setBuffs(data as GameBuff[]); break
      case 'pilotSkills':    setPilotSkills(data as PilotSkillDoc[]); break
      case 'globalResearch': setGlobalResearch(data as GlobalResearch); break
      case 'grayOpsRoster':  setGrayOpsRoster(data as GrayOpsRoster | null); break
    }
  }, [])

  const fetchFromFirestore = useCallback(async (key: CollectionKey): Promise<unknown> => {
    switch (key) {
      case 'pilots':         return getPilots()
      case 'mechs':          return getMechs()
      case 'modules':        return getModules()
      case 'weapons':        return getWeapons()
      case 'backpacks':      return getBackpacks()
      case 'components':     return getComponents()
      case 'buffs':          return getBuffs()
      case 'pilotSkills':    return getPilotSkills()
      case 'globalResearch': return (await getGlobalResearch()) ?? EMPTY_GLOBAL_RESEARCH
      case 'grayOpsRoster':  return getGrayOpsRoster()
    }
  }, [])

  const ensureLoaded = useCallback(async (keys: CollectionKey[]) => {
    const toFetch = keys.filter(k => !fetchedRef.current.has(k))
    if (toFetch.length === 0) return
    toFetch.forEach(k => fetchedRef.current.add(k))

    // 讀版本一次/ session（1 次 Firestore read；失敗 → null 退化）
    if (versionRef.current === undefined) {
      if (!versionPromiseRef.current) {
        versionPromiseRef.current = getDataVersion()
          .then(v => { versionRef.current = v })
          .catch(() => { versionRef.current = null })
      }
      await versionPromiseRef.current
    }
    const version = versionRef.current

    await Promise.all(toFetch.map(async (key) => {
      try {
        // 命中版本相符的 localStorage → 0 Firestore reads
        const cached = version ? readCache(key, version) : undefined
        if (cached !== undefined) {
          applyData(key, cached)
        } else {
          const data = await fetchFromFirestore(key)
          applyData(key, data)
          if (version) writeCache(key, version, data)
        }
        setLoadedKeys(prev => new Set([...prev, key]))
      } catch (e) {
        fetchedRef.current.delete(key)
        const err = e instanceof Error ? e : new Error(String(e))
        setErrorMap(prev => ({ ...prev, [key]: err }))
      }
    }))
  }, [applyData, fetchFromFirestore])

  const reload = useCallback(() => {
    fetchedRef.current.clear()
    versionRef.current = undefined
    versionPromiseRef.current = null
    clearCache()
    setLoadedKeys(new Set())
    setErrorMap({})
    setReloadTick(t => t + 1)
  }, [])

  return (
    <GameDataContext.Provider value={{
      pilots, mechs, weapons, backpacks, modules, components, buffs, pilotSkills,
      globalResearch, grayOpsRoster,
      loadedKeys, errorMap, reloadTick,
      ensureLoaded, reload,
    }}>
      {children}
    </GameDataContext.Provider>
  )
}

export function useGameData(): GameDataState {
  const ctx = useContext(GameDataContext)
  if (!ctx) throw new Error('useGameData must be used within GameDataProvider')
  return ctx
}
