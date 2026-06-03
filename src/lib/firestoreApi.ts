import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  QueryConstraint,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Pilot, Mech, Module, Weapon, Backpack, Component, PilotResearch, GlobalResearch, GrayOpsRoster, GrayOpsMechEntry, GameBuff } from '../types'

// ── 通用輔助 ──────────────────────────────────────────────────────────────────

async function fetchCollection<T>(collectionName: string, constraints: QueryConstraint[] = []): Promise<T[]> {
  const ref = collection(db, collectionName)
  const q   = constraints.length > 0 ? query(ref, ...constraints) : query(ref)
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id }) as T)
}

async function fetchDocument<T>(collectionName: string, id: string): Promise<T | null> {
  const snap = await getDoc(doc(db, collectionName, id))
  return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null
}

// ── 遊戲資料 API ──────────────────────────────────────────────────────────────

export const getPilots = () =>
  fetchCollection<Pilot>('pilots', [orderBy('rarity', 'desc')])

export const getPilot = (id: string) =>
  fetchDocument<Pilot>('pilots', id)

export const getPilotsByClass = (pilotClass: string) =>
  fetchCollection<Pilot>('pilots', [where('class', '==', pilotClass), orderBy('rarity', 'desc')])

export const getMechs = () =>
  fetchCollection<Mech>('mechs')

export const getMech = (id: string) =>
  fetchDocument<Mech>('mechs', id)

/** 依裝甲類型（輕型 / 中甲 / 重型）只讀取該類機甲，降低 Firestore 讀取量 */
export const getMechsByArmorType = (armorType: string) =>
  fetchCollection<Mech>('mechs', [where('armorType', '==', armorType)])

export const getModules = () =>
  fetchCollection<Module>('modules')

export const getAvailableModules = () =>
  fetchCollection<Module>('modules', [where('available', '==', true), orderBy('slot')])

export const getModulesByMech = (mechId: string) =>
  fetchCollection<Module>('modules', [where('boundMechId', '==', mechId)])

export const getWeapons = () =>
  fetchCollection<Weapon>('weapons')

export const getWeapon = (id: string) =>
  fetchDocument<Weapon>('weapons', id)

export const getBackpacks = () =>
  fetchCollection<Backpack>('backpacks')

export const getComponents = () =>
  fetchCollection<Component>('components')

/** buffs Collection（PLAN-019 Layer 2）：BUFF / 狀態 / 形態定義庫 */
export const getBuffs = () =>
  fetchCollection<GameBuff>('buffs')

export const getPilotResearch = (pilotId: string) =>
  fetchCollection<PilotResearch>('pilotResearch', [where('pilotId', '==', pilotId)])

export const getAllPilotResearch = () =>
  fetchCollection<PilotResearch>('pilotResearch')

export const getGlobalResearch = async (): Promise<GlobalResearch | null> =>
  fetchDocument<GlobalResearch>('globalResearch', 'global')

// ── 遊戲資料版本（PLAN-017 跨 session localStorage 快取）───────────────────────

/**
 * 讀取 meta/gameData 的版本號（1 次 read）。
 * 文件不存在或讀取失敗 → 回傳 null（快取層退化為直接讀取，不影響功能）。
 */
export const getDataVersion = async (): Promise<string | null> => {
  try {
    const snap = await getDoc(doc(db, 'meta', 'gameData'))
    return snap.exists() ? ((snap.data().version as string) ?? null) : null
  } catch {
    return null
  }
}

/**
 * 更新 meta/gameData 版本號（時間戳），使所有 client 的 localStorage 快取失效。
 * 任何 game collection 寫入後呼叫；merge 寫入，文件不存在時自動建立。
 */
export const bumpDataVersion = async (): Promise<string> => {
  const version = new Date().toISOString()
  await setDoc(doc(db, 'meta', 'gameData'), { version, updatedAt: serverTimestamp() }, { merge: true })
  return version
}

// ── 管理後台寫入 ──────────────────────────────────────────────────────────────

function stripUndefined<T>(val: T): T {
  if (Array.isArray(val)) return val.map(stripUndefined) as unknown as T
  if (val !== null && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    ) as T
  }
  return val
}

export const updateModule = async (module: Module): Promise<void> => {
  const { id, ...data } = module
  await setDoc(doc(db, 'modules', id), stripUndefined(data))
  await bumpDataVersion().catch(() => {})
}

export const updateMech = async (mech: Mech): Promise<void> => {
  const { id, ...data } = mech
  await setDoc(doc(db, 'mechs', id), stripUndefined(data))
  await bumpDataVersion().catch(() => {})
}

export const updatePilot = async (pilot: Pilot): Promise<void> => {
  const { id, ...data } = pilot
  await setDoc(doc(db, 'pilots', id), stripUndefined(data))
  await bumpDataVersion().catch(() => {})
}

export const updateWeapon = async (weapon: Weapon): Promise<void> => {
  const { id, ...data } = weapon
  await setDoc(doc(db, 'weapons', id), stripUndefined(data))
  await bumpDataVersion().catch(() => {})
}

export const updateComponent = async (component: Component): Promise<void> => {
  const { id, ...data } = component
  await setDoc(doc(db, 'components', id), stripUndefined(data))
  await bumpDataVersion().catch(() => {})
}

export const updateBackpack = async (backpack: Backpack): Promise<void> => {
  const { id, ...data } = backpack
  await setDoc(doc(db, 'backpacks', id), stripUndefined(data))
  await bumpDataVersion().catch(() => {})
}

export const getBackpacksPage = async (opts: {
  nameSearch?: string
  lastItemName?: string
  pageSize?: number
}): Promise<{ items: Backpack[]; hasMore: boolean; lastItemName: string | null }> => {
  const { nameSearch = '', lastItemName, pageSize = 20 } = opts
  const constraints: QueryConstraint[] = [orderBy('name')]
  if (nameSearch) {
    constraints.push(where('name', '>=', nameSearch))
    constraints.push(where('name', '<=', nameSearch + ''))
  }
  if (lastItemName) constraints.push(startAfter(lastItemName))
  constraints.push(limit(pageSize))
  const snap = await getDocs(query(collection(db, 'backpacks'), ...constraints))
  const items = snap.docs.map(d => ({ ...d.data(), id: d.id }) as Backpack)
  return { items, hasMore: items.length === pageSize, lastItemName: items[items.length - 1]?.name ?? null }
}

// ── 灰燼行動名單（每家公司一份文件）──────────────────────────────────────────────

export const getGrayOpsRoster = async (): Promise<GrayOpsRoster | null> => {
  const snap = await getDocs(collection(db, 'grayOps'))
  if (snap.empty) return null
  const companies: Record<string, GrayOpsMechEntry[]> = {}
  for (const d of snap.docs) {
    if (d.id === 'roster') continue
    const data = d.data()
    if (Array.isArray(data.mechs)) companies[d.id] = data.mechs as GrayOpsMechEntry[]
  }
  if (Object.keys(companies).length === 0) {
    // 舊格式 fallback
    return fetchDocument<GrayOpsRoster>('grayOps', 'roster')
  }
  return { companies }
}

export const updateGrayOpsRoster = async (roster: GrayOpsRoster): Promise<void> => {
  await Promise.all(
    Object.entries(roster.companies).map(([company, mechs]) =>
      setDoc(doc(db, 'grayOps', company), {
        mechs: mechs.map((m) => (m.version ? m : { name: m.name })),
        updatedAt: serverTimestamp(),
      })
    )
  )
  await bumpDataVersion().catch(() => {})
}
