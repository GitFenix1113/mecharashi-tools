import { useEffect, useMemo } from 'react'
import type {
  Pilot, Mech, Module, Weapon, Backpack, BackpackSkillDoc, Component,
  GlobalResearch, GameBuff, PilotSkillDoc, MechForm, NeuralDriveAbility,
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

/** 顯示層用的機師輕量資料（名稱＋頭像來源），避免把整包 Pilot 拖進純顯示元件。 */
export interface PilotBrief {
  id: string
  name: string
  portrait: string
  portraitUrl?: string
}

export function usePilotBriefMap(): HookResult<Record<string, PilotBrief>> {
  const { pilots } = useGameData()
  const { loading, error } = useCollections(['pilots'])
  const data = useMemo(
    () => Object.fromEntries(
      pilots.map((p) => [p.id, { id: p.id, name: p.name, portrait: p.portrait, portraitUrl: p.portraitUrl }]),
    ),
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

/**
 * 技能庫 id→doc 對照（PLAN-032 武器技能引用化）。
 *
 * 集合物理名是 `pilotSkills`，但它的真實契約是**全站技能字典**（實測 84% 的
 * refType:'skill' 引用目標沒有任何機師持有）——武器技能就住在同一個集合裡，
 * 刻意不另開 weaponSkills 集合。詳見 PilotSkillDoc 註解與 PLAN-032 決策一。
 *
 * 搭配 resolveWeaponSkills(weapon.skills, map) 使用。**載入中時 map 是空的**，
 * 引用格式會解析成 0 筆——故顯示 gate 一律接在解析後的陣列上，不可用 weapon.skills.length。
 */
export function useWeaponSkillMap(): HookResult<Map<string, PilotSkillDoc>> {
  const { pilotSkills } = useGameData()
  const { loading, error } = useCollections(['pilotSkills'])
  const data = useMemo(() => new Map(pilotSkills.map((s) => [s.id, s])), [pilotSkills])
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

/** 背包技能庫（PLAN-043）。前台以 Backpack.skillIds[] 反查。 */
export function useBackpackSkills(): HookResult<BackpackSkillDoc[]> {
  const { backpackSkills } = useGameData()
  const { loading, error } = useCollections(['backpackSkills'])
  return { data: backpackSkills, loading, error }
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

// ── 機師形態（PLAN-041）───────────────────────────────────────────────────────

export function useForms(): HookResult<MechForm[]> {
  const { forms } = useGameData()
  const { loading, error } = useCollections(['forms'])
  return { data: forms, loading, error }
}

/**
 * 某機師的形態，已依 order 排序。
 *
 * ⚠ 渲染條件請一律用 `data.length > 0`，**禁止**用 `pilot.class === '調構師'`：
 *   官方職業 icon 跳過 007/008/009，且實測已有 2/82 反例（瑪汀妮 class=機械師卻掛
 *   格鬥家職業單元、唐小葵掛突擊手）——class 字串與職業機制早已對不上。
 *   用 class gate 的話，新調構師上線但 forms 未填時會渲染出空的「形態 (0)」分頁。
 *   （跟隨既有慣例：NdPowerBar 也是用 `(pilot.neuralDrive?.length ?? 0) > 0` gate。）
 */
export function useFormsByPilot(pilotId: string | undefined): HookResult<MechForm[]> {
  const { forms } = useGameData()
  const { loading, error } = useCollections(['forms'])
  const data = useMemo(
    () => (pilotId ? forms.filter((f) => f.pilotId === pilotId).sort((a, b) => a.order - b.order) : []),
    [pilotId, forms],
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

// ── 配裝模擬器：分階段載入（PLAN-052-B B-1）─────────────────────

/**
 * 配裝器的載入階段。首屏只要 pilots + forms（機師挑選器）——
 * 舊 SimulatorPage 一進頁就拉 11 個集合（含 208 筆元件、242 筆模組、buffs、技能庫），
 * 而玩家在選完機師之前一筆都用不到。
 *
 * ⚠ 階段只能**累加**，不可回退：讀過的集合已經在記憶體快取裡，
 *   「退回 pilot 階段」不會省任何 read，只會讓 UI 白閃一下。
 */
export type LoadoutStage = 'pilot' | 'mech' | 'equip'

/**
 * ⚠ `neuralDriveAbilities` 自 `mech` 階段起載入（PLAN-052-I D-1）：選完機師之後左欄就要畫
 *   算力面板的「目前生效能力」。它是小集合（能力庫），而少了它的症狀是**靜默的**——
 *   `resolveNeuralDriveLevel()` 會退回嵌入式舊欄位，已遷移的機師於是列出一排空白名稱。
 *   pilot 階段刻意不載：那時還沒有機師，一筆都用不到。
 *
 * ⚠ `components`（208 筆）自 `equip` 階段起載入（PLAN-052-D A-3）：規則層要驗證元件
 *   就得認得元件，而 `reconcile()` 每次動作都會跑。掛在 equip 而不是更早，是因為那時
 *   才有武器 —— 元件掛在武器上，沒有武器的階段一筆都用不到。
 *   ⚠ 少了它的症狀**不是報錯而是靜默跳過驗證**（見 `canEquipComponent` 的載入 gate），
 *   於是玩家會裝得上五顆元件；漏掉這一行不會有任何紅字。
 */
const LOADOUT_STAGE_KEYS: Record<LoadoutStage, CollectionKey[]> = {
  pilot: ['pilots', 'forms'],
  mech:  ['pilots', 'forms', 'mechs', 'neuralDriveAbilities'],
  equip: ['pilots', 'forms', 'mechs', 'weapons', 'backpacks', 'neuralDriveAbilities', 'components'],
}

export interface LoadoutGameData {
  pilots: Pilot[]
  forms: MechForm[]
  mechs: Mech[]
  weapons: Weapon[]
  backpacks: Backpack[]
  neuralDriveAbilities: NeuralDriveAbility[]
  components: Component[]
}

/**
 * 配裝器的資料。**不走 `useCollections()`** —— 那一支的 effect 依賴只有
 * `[ensureLoaded, reloadTick]`，keys 變了不會重跑（對固定清單的呼叫端是對的，
 * 對「階段會變」的本例則會靜默不載入第二階段）。
 */
export function useLoadoutGameData(stage: LoadoutStage): HookResult<LoadoutGameData> {
  const { pilots, forms, mechs, weapons, backpacks, neuralDriveAbilities, components, loadedKeys, errorMap, ensureLoaded, reloadTick } = useGameData()
  const keys = LOADOUT_STAGE_KEYS[stage]

  useEffect(() => { void ensureLoaded(LOADOUT_STAGE_KEYS[stage]) }, [ensureLoaded, reloadTick, stage])

  const loading = !keys.every((k) => loadedKeys.has(k))
  const error = keys.map((k) => errorMap[k]).find(Boolean) ?? null

  const data = useMemo<LoadoutGameData>(
    () => ({ pilots, forms, mechs, weapons, backpacks, neuralDriveAbilities, components }),
    [pilots, forms, mechs, weapons, backpacks, neuralDriveAbilities, components],
  )
  return { data, loading, error }
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
  /**
   * PLAN-043：背包技能庫。背包的 buff 自 Phase E 起只經 skillIds 反查此集合，
   * 未載入的症狀是「配了背包但 buff 池少了那幾條」——**不會報錯**，故必須進 SIMULATOR_KEYS。
   */
  backpackSkills: BackpackSkillDoc[]
  /**
   * PLAN-052-A E-2：機師形態。少了它，模擬器問不出「這位機師有幾套獨立配裝」
   * （equipSetKeys 會對海莉絲回 ['default']，三個分頁整排消失）也問不出形態的武裝鎖定
   * ——**都不會報錯**，只是靜默少一塊，故必須進 SIMULATOR_KEYS。
   * Worker 的 ARRAY_COLLECTIONS 已含 forms，那一側不用改。
   */
  forms: MechForm[]
}

const SIMULATOR_KEYS: CollectionKey[] = ['pilots', 'mechs', 'modules', 'weapons', 'backpacks', 'backpackSkills', 'components', 'globalResearch', 'buffs', 'pilotSkills', 'forms']

export function useAllGameData(): HookResult<AllGameData | null> {
  const { pilots, mechs, weapons, backpacks, backpackSkills, modules, components, globalResearch, buffs, pilotSkills, forms } = useGameData()
  const { loading, error } = useCollections(SIMULATOR_KEYS)

  const data = useMemo<AllGameData | null>(() => {
    if (loading) return null
    return { pilots, mechs, weapons, backpacks, backpackSkills, modules, components, globalResearch, buffs, pilotSkills, forms }
  }, [loading, pilots, mechs, weapons, backpacks, backpackSkills, modules, components, globalResearch, buffs, pilotSkills, forms])

  return { data, loading, error }
}

// ── 便利重新整理 ─────────────────────────────────────────────────────────────

export { EMPTY_GLOBAL_RESEARCH }
