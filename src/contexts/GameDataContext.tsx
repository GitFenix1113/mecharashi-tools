import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import type { Pilot, Mech, Module, Weapon, Backpack, BackpackSkillDoc, Component, GlobalResearch, GrayOpsRoster, GameBuff, PilotSkillDoc, GlossaryTerm, NeuralDriveAbility } from '../types'
import {
  getPilots, getMechs, getModules, getWeapons, getBackpacks, getBackpackSkills, getComponents, getBuffs, getPilotSkills, getGlossaryTerms,
  getNeuralDriveAbilities, getGlobalResearch, getGrayOpsRoster, getDataVersions, type DataVersions,
} from '../lib/firestoreApi'
// PLAN-029 Phase 2-3：flag 開時，公開資料與版本改走 Cloudflare Worker 代理（可灰度／回退）
import { WORKER_ENABLED, getWorkerDataVersions, fetchWorkerCollection } from '../lib/api/workerData'

export const EMPTY_GLOBAL_RESEARCH: GlobalResearch = {
  pilotResearchByClass: {},
  mechResearchByType:   {},
  weaponResearchByType: {},
}

export type CollectionKey =
  | 'pilots' | 'mechs' | 'modules' | 'weapons'
  | 'backpacks' | 'backpackSkills' | 'components' | 'buffs' | 'pilotSkills' | 'neuralDriveAbilities' | 'glossaryTerms' | 'globalResearch' | 'grayOpsRoster'

export const ALL_COLLECTION_KEYS: CollectionKey[] = [
  'pilots', 'mechs', 'modules', 'weapons',
  'backpacks', 'backpackSkills', 'components', 'buffs', 'pilotSkills', 'neuralDriveAbilities', 'glossaryTerms', 'globalResearch', 'grayOpsRoster',
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

function removeCache(key: string): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(CACHE_PREFIX + key) } catch { /* ignore */ }
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
  backpackSkills: BackpackSkillDoc[]
  modules:        Module[]
  components:     Component[]
  buffs:          GameBuff[]
  pilotSkills:    PilotSkillDoc[]
  neuralDriveAbilities: NeuralDriveAbility[]
  glossaryTerms:  GlossaryTerm[]
  globalResearch: GlobalResearch
  grayOpsRoster:  GrayOpsRoster | null
  loadedKeys:     ReadonlySet<CollectionKey>
  errorMap:       Readonly<Partial<Record<CollectionKey, Error>>>
  reloadTick:     number
  ensureLoaded:   (keys: CollectionKey[]) => void
  reload:         () => void
  /**
   * PLAN-017 Part 1：後台儲存陣列集合單筆後，就地同步編輯者自己的快取（免重讀）。
   * 該集合本 session 已載入 → upsert 進記憶體 + 以新版本號改寫 localStorage；
   * 未載入 → 僅清掉該集合 localStorage，下次自然抓最新。version 為 bumpDataVersion 回傳值。
   */
  patchCollectionItem: (key: CollectionKey, item: { id: string }, version: string) => void
  /**
   * PLAN-030：與 patchCollectionItem 對稱的移除路徑（後台刪除單筆後同步自己的快取）。
   * 記憶體 state 與 localStorage 兩層都會移除；未載入該集合時僅清 localStorage。
   */
  removeCollectionItem: (key: CollectionKey, id: string, version: string) => void
  /** 同上，但用於 singleton 集合（如 grayOpsRoster）：以整個物件替換。 */
  patchSingleton: (key: CollectionKey, value: unknown, version: string) => void
}

const GameDataContext = createContext<GameDataState | null>(null)

export function GameDataProvider({ children }: { children: ReactNode }) {
  const [pilots,         setPilots]         = useState<Pilot[]>([])
  const [mechs,          setMechs]          = useState<Mech[]>([])
  const [weapons,        setWeapons]        = useState<Weapon[]>([])
  const [backpacks,      setBackpacks]      = useState<Backpack[]>([])
  const [backpackSkills, setBackpackSkills] = useState<BackpackSkillDoc[]>([])
  const [modules,        setModules]        = useState<Module[]>([])
  const [components,     setComponents]     = useState<Component[]>([])
  const [buffs,          setBuffs]          = useState<GameBuff[]>([])
  const [pilotSkills,    setPilotSkills]    = useState<PilotSkillDoc[]>([])
  const [neuralDriveAbilities, setNeuralDriveAbilities] = useState<NeuralDriveAbility[]>([])
  const [glossaryTerms,  setGlossaryTerms]  = useState<GlossaryTerm[]>([])
  const [globalResearch, setGlobalResearch] = useState<GlobalResearch>(EMPTY_GLOBAL_RESEARCH)
  const [grayOpsRoster,  setGrayOpsRoster]  = useState<GrayOpsRoster | null>(null)
  const [loadedKeys,     setLoadedKeys]     = useState<Set<CollectionKey>>(new Set())
  const [errorMap,       setErrorMap]       = useState<Partial<Record<CollectionKey, Error>>>({})
  const [reloadTick,     setReloadTick]     = useState(0)

  // Tracks keys that are already in-flight or done (synchronous check, prevents double-fetch)
  const fetchedRef = useRef<Set<CollectionKey>>(new Set())
  // 版本：undefined=尚未讀取；DataVersions=已讀（global + 每集合 byKey）
  const versionsRef = useRef<DataVersions | undefined>(undefined)
  const versionsPromiseRef = useRef<Promise<void> | null>(null)

  // 某集合的有效版本 = byKey[key] ?? global；皆無 → null（該集合退化為直接讀取、不快取）
  const effectiveVersion = useCallback((key: CollectionKey): string | null => {
    const v = versionsRef.current
    if (!v) return null
    return v.byKey[key] ?? v.global
  }, [])

  const applyData = useCallback((key: CollectionKey, data: unknown) => {
    switch (key) {
      case 'pilots':         setPilots(data as Pilot[]); break
      case 'mechs':          setMechs(data as Mech[]); break
      case 'modules':        setModules(data as Module[]); break
      case 'weapons':        setWeapons(data as Weapon[]); break
      case 'backpacks':      setBackpacks(data as Backpack[]); break
      case 'backpackSkills': setBackpackSkills(data as BackpackSkillDoc[]); break
      case 'components':     setComponents(data as Component[]); break
      case 'buffs':          setBuffs(data as GameBuff[]); break
      case 'pilotSkills':    setPilotSkills(data as PilotSkillDoc[]); break
      case 'neuralDriveAbilities': setNeuralDriveAbilities(data as NeuralDriveAbility[]); break
      case 'glossaryTerms':  setGlossaryTerms(data as GlossaryTerm[]); break
      case 'globalResearch': setGlobalResearch(data as GlobalResearch); break
      case 'grayOpsRoster':  setGrayOpsRoster(data as GrayOpsRoster | null); break
    }
  }, [])

  // 抓單一集合的原始資料。WORKER_ENABLED 時走 Worker 代理，否則 Firestore 直連。
  // 兩條路徑回傳形狀一致（Worker 回應刻意對齊 getter），故上游套快取邏輯無須分岔。
  const fetchCollectionData = useCallback(async (key: CollectionKey): Promise<unknown> => {
    if (WORKER_ENABLED) {
      const data = await fetchWorkerCollection(key)
      // globalResearch 缺文件時對齊直連路徑的 EMPTY fallback（避免 null 汙染下游）
      return key === 'globalResearch' ? (data ?? EMPTY_GLOBAL_RESEARCH) : data
    }
    switch (key) {
      case 'pilots':         return getPilots()
      case 'mechs':          return getMechs()
      case 'modules':        return getModules()
      case 'weapons':        return getWeapons()
      case 'backpacks':      return getBackpacks()
      case 'backpackSkills': return getBackpackSkills()
      case 'components':     return getComponents()
      case 'buffs':          return getBuffs()
      case 'pilotSkills':    return getPilotSkills()
      case 'neuralDriveAbilities': return getNeuralDriveAbilities()
      case 'glossaryTerms':  return getGlossaryTerms()
      case 'globalResearch': return (await getGlobalResearch()) ?? EMPTY_GLOBAL_RESEARCH
      case 'grayOpsRoster':  return getGrayOpsRoster()
    }
  }, [])

  const ensureLoaded = useCallback(async (keys: CollectionKey[]) => {
    const toFetch = keys.filter(k => !fetchedRef.current.has(k))
    if (toFetch.length === 0) return
    toFetch.forEach(k => fetchedRef.current.add(k))

    // 讀版本一次/ session（1 次讀取；失敗 → 空版本退化）。
    // WORKER_ENABLED 時走 Worker /api/versions（Phase 3 收緊 meta 後仍讀得到）。
    if (versionsRef.current === undefined) {
      if (!versionsPromiseRef.current) {
        const loadVersions = WORKER_ENABLED ? getWorkerDataVersions : getDataVersions
        versionsPromiseRef.current = loadVersions()
          .then(v => { versionsRef.current = v })
          .catch(() => { versionsRef.current = { global: null, byKey: {} } })
      }
      await versionsPromiseRef.current
    }

    await Promise.all(toFetch.map(async (key) => {
      try {
        const version = effectiveVersion(key)
        // 命中版本相符的 localStorage → 0 Firestore reads
        const cached = version ? readCache(key, version) : undefined
        if (cached !== undefined) {
          applyData(key, cached)
        } else {
          const data = await fetchCollectionData(key)
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
  }, [applyData, fetchCollectionData, effectiveVersion])

  const reload = useCallback(() => {
    fetchedRef.current.clear()
    versionsRef.current = undefined
    versionsPromiseRef.current = null
    clearCache()
    setLoadedKeys(new Set())
    setErrorMap({})
    setReloadTick(t => t + 1)
  }, [])

  // ── PLAN-017 Part 1：儲存後就地同步編輯者自己的快取 ──────────────────────────
  // 只在「版本已讀且該集合本 session 已載入」時就地 patch；否則僅清掉該集合
  // localStorage（下次 ensureLoaded 會讀到伺服器最新版本並重抓），確保不會殘留舊資料。
  const patchCollectionItem = useCallback((key: CollectionKey, item: { id: string }, version: string) => {
    if (!version || versionsRef.current === undefined || !fetchedRef.current.has(key)) {
      removeCache(key)
      return
    }
    versionsRef.current.byKey[key] = version
    const upsert = <T extends { id: string }>(prev: T[]): T[] => {
      const next = prev.some(i => i.id === item.id)
        ? prev.map(i => (i.id === item.id ? (item as T) : i))
        : [item as T, ...prev]
      writeCache(key, version, next)
      return next
    }
    switch (key) {
      case 'pilots':        setPilots(upsert);        break
      case 'mechs':         setMechs(upsert);         break
      case 'modules':       setModules(upsert);       break
      case 'weapons':       setWeapons(upsert);       break
      case 'backpacks':     setBackpacks(upsert);     break
      case 'backpackSkills': setBackpackSkills(upsert); break
      case 'components':    setComponents(upsert);    break
      case 'buffs':         setBuffs(upsert);         break
      case 'pilotSkills':   setPilotSkills(upsert);   break
      case 'neuralDriveAbilities': setNeuralDriveAbilities(upsert); break
      case 'glossaryTerms': setGlossaryTerms(upsert); break
      default: break // singleton / 無 id 集合不走此路徑
    }
  }, [])

  // ── PLAN-030：刪除後就地同步（與 patchCollectionItem 對稱）─────────────────
  // patchCollectionItem 是 upsert-only，沒有移除路徑。缺這支的症狀是
  // 「刪掉的項目仍留在列表上，直到手動 reload」——記憶體 state 與 localStorage
  // 兩層都會殘留，所以兩層都要移除。
  const removeCollectionItem = useCallback((key: CollectionKey, id: string, version: string) => {
    if (!version || versionsRef.current === undefined || !fetchedRef.current.has(key)) {
      removeCache(key)
      return
    }
    versionsRef.current.byKey[key] = version
    const drop = <T extends { id: string }>(prev: T[]): T[] => {
      const next = prev.filter(i => i.id !== id)
      writeCache(key, version, next)
      return next
    }
    switch (key) {
      case 'pilots':        setPilots(drop);        break
      case 'mechs':         setMechs(drop);         break
      case 'modules':       setModules(drop);       break
      case 'weapons':       setWeapons(drop);       break
      case 'backpacks':     setBackpacks(drop);     break
      case 'backpackSkills': setBackpackSkills(drop); break
      case 'components':    setComponents(drop);    break
      case 'buffs':         setBuffs(drop);         break
      case 'pilotSkills':   setPilotSkills(drop);   break
      case 'neuralDriveAbilities': setNeuralDriveAbilities(drop); break
      case 'glossaryTerms': setGlossaryTerms(drop); break
      default: break // singleton / 無 id 集合不走此路徑
    }
  }, [])

  const patchSingleton = useCallback((key: CollectionKey, value: unknown, version: string) => {
    if (!version || versionsRef.current === undefined || !fetchedRef.current.has(key)) {
      removeCache(key)
      return
    }
    versionsRef.current.byKey[key] = version
    applyData(key, value)
    writeCache(key, version, value)
  }, [applyData])

  return (
    <GameDataContext.Provider value={{
      pilots, mechs, weapons, backpacks, backpackSkills, modules, components, buffs, pilotSkills, neuralDriveAbilities, glossaryTerms,
      globalResearch, grayOpsRoster,
      loadedKeys, errorMap, reloadTick,
      ensureLoaded, reload, patchCollectionItem, removeCollectionItem, patchSingleton,
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
