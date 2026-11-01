// ─── 配裝 → 傷害模擬請求（PLAN-065-C B-2）──────────────────────────────────────
//
// 把站上的配裝草稿（LoadoutDraft）與武裝討伐資料轉成 `/sim/v1/run` 的請求物件（contract.ts）。
// 這一層只做「站上文件 → 遊戲 ID」的查表（各實體的 gameRef），不做任何數值計算（決策 C3）；
// 站上本來就有答案的東西（模組等級、形態分頁、部件來源）一律問既有的 helper，不另寫一份。
//
// 查不到的處理（保守）：
//   · 機師或機甲（含混搭部件的來源機甲）沒有 gameRef → 整套配裝送不出去（loadout: null）
//   · 其餘實體沒有 gameRef → 不送那一項，列進 unmapped，畫面據此標「未連結」
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import type { Boss, MechForm, RaidSeason, Stage } from '../../types/index.ts'
import type { LoadoutDraft, LoadoutMount } from '../../types/loadout.ts'
import type { SlotBank, SlotSide } from '../../types/slots.ts'
import type { MechPartPosition, RaidDifficulty } from '../../types/enums.ts'
import { RAID_DIFFICULTY_ORDER, WeaponEquipSlot } from '../../types/enums.ts'
import { buildContext, type LoadoutWorld } from '../../utils/loadoutRules.ts'
import { MECH_PART_ORDER } from '../../utils/chassisStats.ts'
import { stackLevelOf } from '../../utils/moduleRules.ts'
import { MAX_POTENTIAL } from '../../utils/talentLoadoutMods.ts'
import { DEFAULT_EQUIP_SET_KEY } from '../../utils/forms.ts'
import type {
  ActionSpecV1, AimPart, GameId, PartKey, SimLoadoutV1, SimModuleV1, SimOutputV1, SimPilotV1,
  SimRaidTargetV1, SimRefitV1, SimRequestV1, SimScenarioV1, SimTargetV1, SimWeaponV1,
  SkillCandidatesV1, WeaponSlot,
} from './contract.ts'

// ─── 輸入與輸出 ──────────────────────────────────────────────────────────────

/** 改裝假設（一把武器）。 */
export type RefitAssumption = Pick<SimRefitV1, 'normal' | 'advanced' | 'advValue'>

/** 養成假設：玩家在傷害模擬畫面上選的，不進分享碼。 */
export interface GrowthAssumptions {
  research: 'none' | 'full'
  /**
   * 改裝。整個省略＝每把都不送（交給引擎預設）。
   * `perWeapon` 的鍵是 `WeaponKeyEntry.key`；沒有逐把設定的武器用 `default`，兩者都沒有就不送。
   */
  refit?: {
    default?: RefitAssumption
    perWeapon?: Readonly<Record<string, RefitAssumption>>
  }
}

export interface BuildSimLoadoutInput {
  /** 解碼後的配裝草稿（分享碼 `decodeLoadout()`、本機書架、雲端存檔都是這個形狀） */
  draft: LoadoutDraft
  /**
   * 站上文件的查表（`buildWorld()` 產生）。
   * ⚠ 空 Map＝那個集合還沒載入（同 LoadoutWorld 的約定）：草稿裡指到的文件會被列成 `notLoaded`。
   *   `pilotSkills`／`forms`／`components`／`modules` 要先載入，結果才完整。
   */
  world: LoadoutWorld
  growth: GrowthAssumptions
}

/** 請求裡的一把武器 ↔ 站上的哪一格（回應的 weaponKey 用它對回畫面）。 */
export interface WeaponKeyEntry {
  /** SimWeaponV1.key */
  key: string
  bank: SlotBank
  slot: WeaponEquipSlot
  side?: SlotSide
  /** 請求裡的槽位 */
  simSlot: WeaponSlot
  weaponDocId: string
}

export type SimCollection =
  | 'pilots' | 'mechs' | 'weapons' | 'modules' | 'components' | 'backpacks' | 'pilotSkills' | 'forms'

/**
 * 沒送進請求的實體。
 * - `noGameRef`：文件在，但還沒連結遊戲 ID
 * - `notFound`：草稿指到的文件不存在
 * - `notLoaded`：那個集合還沒載入
 */
export type UnmappedReason = 'noGameRef' | 'notFound' | 'notLoaded'

export interface UnmappedEntity {
  collection: SimCollection
  docId: string
  /** 顯示名；查不到文件時為 docId */
  name: string
  reason: UnmappedReason
  /** 在配裝的哪裡（部位鍵或武器 key），顯示用 */
  where?: string
}

export interface BuiltSimLoadout {
  /** 機師或機甲送不出去、或一把武器都沒有時為 null（請求至少要一把武器） */
  loadout: SimLoadoutV1 | null
  /** 只列有送進請求的武器 */
  weaponKeys: WeaponKeyEntry[]
  unmapped: UnmappedEntity[]
  /** 給畫面顯示的附註（沒送的東西、站上做了什麼假設） */
  notes: string[]
}

// ─── 詞彙對照（站上 ↔ 契約）──────────────────────────────────────────────────

const PART_KEY: Readonly<Record<MechPartPosition, PartKey>> = {
  torso: 'body',
  leftArm: 'larm',
  rightArm: 'rarm',
  legs: 'leg',
}

/** 武器在請求裡的排列順序：第一組在前，同一組依槽位。讓同一套配裝永遠產生同一份請求（結果快取靠它）。 */
const SLOT_ORDER: readonly WeaponSlot[] = ['lh', 'rh', 'dual', 'ls', 'rs', 'back']

/** 站上的槽位座標 → 請求的槽位。單手／肩部沒有左右時無法對應，回 null。 */
export function simSlotOf(mount: Pick<LoadoutMount, 'slot' | 'side'>): WeaponSlot | null {
  switch (mount.slot) {
    case WeaponEquipSlot.SINGLE_HAND:
      return mount.side === 'left' ? 'lh' : mount.side === 'right' ? 'rh' : null
    case WeaponEquipSlot.DUAL_HAND:
      return 'dual'
    case WeaponEquipSlot.SHOULDER:
      return mount.side === 'left' ? 'ls' : mount.side === 'right' ? 'rs' : null
    case WeaponEquipSlot.BACK:
      return 'back'
    default:
      return null
  }
}

const bankNo = (bank: SlotBank): 0 | 1 => (bank === 'backup' ? 1 : 0)

/**
 * 武器 key：`m-rh`（第一組右手）、`b-ls`（第二組左肩）…。只由武器組＋槽位決定，
 * 所以畫面在組請求之前就能算出某一格的 key（例如設定 `GrowthAssumptions.refit.perWeapon`）。
 */
export const simWeaponKey = (bank: SlotBank, simSlot: WeaponSlot): string =>
  `${bank === 'backup' ? 'b' : 'm'}-${simSlot}`

/** 同組同槽重複（不合法的草稿）時加序號，保證同一套配裝內不重複。 */
function weaponKeyOf(bank: SlotBank, simSlot: WeaponSlot, taken: Set<string>): string {
  const base = simWeaponKey(bank, simSlot)
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`
  taken.add(key)
  return key
}

const uniq = (ids: readonly GameId[]): GameId[] => [...new Set(ids)]

/** 技能文件的 gameRef → SkillCandidatesV1；三個陣列都是空的回 null。 */
function skillCandidates(ref: SkillCandidatesV1 | undefined): SkillCandidatesV1 | null {
  if (!ref) return null
  const out: SkillCandidatesV1 = {}
  if (ref.mainSkillIds?.length) out.mainSkillIds = uniq(ref.mainSkillIds)
  if (ref.passiveSkillIds?.length) out.passiveSkillIds = uniq(ref.passiveSkillIds)
  if (ref.activeSkillIds?.length) out.activeSkillIds = uniq(ref.activeSkillIds)
  return Object.keys(out).length > 0 ? out : null
}

const clampPotential = (p: number | undefined): SimPilotV1['potential'] => {
  if (p === undefined || !Number.isFinite(p)) return MAX_POTENTIAL as SimPilotV1['potential']
  return Math.max(0, Math.min(MAX_POTENTIAL, Math.trunc(p))) as SimPilotV1['potential']
}

// ─── 配裝 ────────────────────────────────────────────────────────────────────

/**
 * 站上配裝草稿 → SimLoadoutV1。
 *
 * 只轉**目前分頁**（`draft.activeSetKey`）的那一套武器與背包；
 * 形態取自目前分頁（`default` 分頁不送形態）；天生模組與部件上的固定武裝不送（由引擎依套裝取得）。
 */
export function buildSimLoadout(input: BuildSimLoadoutInput): BuiltSimLoadout {
  const { draft, world, growth } = input
  const unmapped: UnmappedEntity[] = []
  const notes: string[] = []
  let fatal = false

  /** 查文件；查不到時記進 unmapped 並回 null。 */
  const lookup = <T extends { id: string; name: string }>(
    collection: SimCollection,
    map: ReadonlyMap<string, T> | readonly T[],
    id: string,
    where?: string,
  ): T | null => {
    const doc = Array.isArray(map)
      ? (map as readonly T[]).find((x) => x.id === id)
      : (map as ReadonlyMap<string, T>).get(id)
    if (doc) return doc
    const size = Array.isArray(map) ? map.length : (map as ReadonlyMap<string, T>).size
    unmapped.push({ collection, docId: id, name: id, reason: size === 0 ? 'notLoaded' : 'notFound', where })
    return null
  }
  const noRef = (collection: SimCollection, doc: { id: string; name: string }, where?: string) => {
    unmapped.push({ collection, docId: doc.id, name: doc.name, reason: 'noGameRef', where })
  }

  const ctx = buildContext(draft, draft.activeSetKey, world)

  // ── 機師 ──────────────────────────────────────────────────────────────────
  let pilotInfoId: GameId | null = null
  if (!draft.pilotId) {
    notes.push('尚未選擇機師')
    fatal = true
  } else {
    const pilot = lookup('pilots', world.pilots, draft.pilotId)
    if (!pilot) fatal = true
    else if (!pilot.gameRef) { noRef('pilots', pilot); fatal = true }
    else pilotInfoId = pilot.gameRef.pilotInfoId
  }

  // 攜帶技能：每支一筆，取技能文件的 gameRef 原樣送出
  const carried: SkillCandidatesV1[] = []
  for (const skillId of draft.skills?.carried ?? []) {
    const skill = lookup('pilotSkills', world.pilotSkills, skillId)
    if (!skill) continue
    const cands = skillCandidates(skill.gameRef)
    if (cands) carried.push(cands)
    else noRef('pilotSkills', skill)
  }

  // 形態：目前分頁就是形態時才送
  let form: SimPilotV1['form']
  if (draft.activeSetKey !== DEFAULT_EQUIP_SET_KEY) {
    const f: MechForm | null = ctx.form ?? lookup('forms', world.forms, draft.activeSetKey)
    if (f?.gameRef) form = { passiveSkillId: f.gameRef.passiveSkillId }
    else if (f) noRef('forms', f)
  } else if (draft.pilotId && world.forms.some((f) => f.pilotId === draft.pilotId)) {
    notes.push('這位機師有形態，但目前的配裝分頁不對應任何形態，未送出形態')
  }

  if ((ctx.pilot?.neuralDrive?.length ?? 0) > 0) {
    notes.push('神經驅動的生效等級尚未送出（站上以分區名記錄，尚無對應遊戲分區序號的對照）')
  }

  // ── 機甲：四部位各自的來源套裝 ────────────────────────────────────────────
  // 部件來源一律問 ResolvedChassis（與模擬器畫面同一個答案，混搭規則不在這裡重寫）
  let parts: SimLoadoutV1['mech']['parts'] | null = null
  if (!draft.mechId) {
    notes.push('尚未選擇機甲')
    fatal = true
  } else if (!ctx.mech) {
    lookup('mechs', world.mechs, draft.mechId)
    fatal = true
  } else if (!ctx.chassis) {
    notes.push(`機甲〈${ctx.mech.name}〉的部位資料不完整，無法送出`)
    fatal = true
  } else {
    const out = {} as Record<PartKey, { suitId: GameId }>
    let ok = true
    for (const pos of MECH_PART_ORDER) {
      const srcId = ctx.chassis.parts[pos].sourceMechId
      const src = world.mechs.get(srcId)
      if (!src) { lookup('mechs', world.mechs, srcId, PART_KEY[pos]); ok = false; continue }
      if (!src.gameRef) {
        // 同一台缺 gameRef 只列一次
        if (!unmapped.some((u) => u.collection === 'mechs' && u.docId === src.id)) noRef('mechs', src, PART_KEY[pos])
        ok = false
        continue
      }
      out[PART_KEY[pos]] = { suitId: src.gameRef.suitId }
    }
    if (ok) parts = out
    else fatal = true
  }

  // 模組：只送玩家裝在接口上的；等級＝站上模擬器顯示的等級（moduleStacks 的同族等級）
  const modules: SimModuleV1[] = []
  for (const pos of MECH_PART_ORDER) {
    const modId = ctx.modules[pos]
    if (!modId) continue
    const where = PART_KEY[pos]
    const mod = lookup('modules', world.modules, modId, where)
    if (!mod) continue
    if (!mod.gameRef) { noRef('modules', mod, where); continue }
    const level = stackLevelOf(ctx.stacks, mod)
    if (level < 1) {
      notes.push(`模組〈${mod.name}〉沒有等級資料，未送出`)
      continue
    }
    const m: SimModuleV1 = { position: where, entryId: mod.gameRef.entryId, level }
    if (mod.gameRef.itemId !== undefined) m.itemId = mod.gameRef.itemId
    modules.push(m)
  }
  for (const [key, st] of ctx.stacks) {
    if (st.positions.length > 0 && ctx.moduleBlocks.has(key)) {
      notes.push(`模組〈${st.mod.name}〉在站上顯示為未解鎖，仍照裝備送出`)
    }
  }

  if (ctx.occupied.size > 0) {
    notes.push('機甲部件帶有固定武裝，未列入請求的武器')
  }

  // ── 武器（目前分頁）──────────────────────────────────────────────────────
  const placed: Array<{ entry: WeaponKeyEntry; weapon: SimWeaponV1 }> = []
  const taken = new Set<string>()
  const mounts = [...ctx.set.mounts]
    .map((m) => ({ m, simSlot: simSlotOf(m) }))
    .sort((a, b) =>
      bankNo(a.m.bank) - bankNo(b.m.bank)
      || SLOT_ORDER.indexOf(a.simSlot ?? 'back') - SLOT_ORDER.indexOf(b.simSlot ?? 'back'))
  for (const { m, simSlot } of mounts) {
    const where = simSlot ? simWeaponKey(m.bank, simSlot) : undefined
    const weapon = lookup('weapons', world.weapons, m.weaponId, where)
    if (!weapon) continue
    if (!simSlot) {
      notes.push(`武器〈${weapon.name}〉的槽位缺少左右資訊，未送出`)
      continue
    }
    if (!weapon.gameRef) { noRef('weapons', weapon, where); continue }
    const key = weaponKeyOf(m.bank, simSlot, taken)

    const componentIds = (ids: readonly string[] | undefined): GameId[] => {
      const out: GameId[] = []
      for (const id of ids ?? []) {
        const c = lookup('components', world.components, id, key)
        if (!c) continue
        if (!c.gameRef) { noRef('components', c, key); continue }
        out.push(c.gameRef.weaponEntryId)
      }
      const u = uniq(out)
      if (u.length < out.length) notes.push(`武器〈${weapon.name}〉有重複的元件，只送一次`)
      return u
    }
    const trigger = componentIds(m.setup?.triggerComponentIds)
    const effect = componentIds(m.setup?.effectComponentIds)

    const w: SimWeaponV1 = { key, slot: simSlot, bank: bankNo(m.bank), weaponInfoId: weapon.gameRef.weaponInfoId }
    const refit = growth.refit?.perWeapon?.[key] ?? growth.refit?.default
    if (refit) w.refit = { ...refit }
    if (trigger.length > 0 || effect.length > 0) w.components = { trigger, effect }

    const entry: WeaponKeyEntry = { key, bank: m.bank, slot: m.slot, simSlot, weaponDocId: weapon.id }
    if (m.side) entry.side = m.side
    placed.push({ entry, weapon: w })
  }
  if (placed.length === 0) {
    notes.push('沒有可送出的武器')
    fatal = true
  }

  // ── 背包（目前分頁）──────────────────────────────────────────────────────
  let backpack: SimLoadoutV1['backpack']
  if (ctx.set.backpackId) {
    const bp = lookup('backpacks', world.backpacks, ctx.set.backpackId)
    if (bp?.gameRef) backpack = { backpackInfoId: bp.gameRef.backpackInfoId }
    else if (bp) noRef('backpacks', bp)
  }

  const weaponKeys = placed.map((p) => p.entry)
  if (fatal || pilotInfoId === null || !parts) return { loadout: null, weaponKeys, unmapped, notes }

  const pilot: SimPilotV1 = {
    pilotInfoId,
    potential: clampPotential(draft.potential),
    ndEffective: [],
    carried,
  }
  if (form) pilot.form = form

  const loadout: SimLoadoutV1 = {
    pilot,
    mech: { quality: 'SS', parts, modules },
    weapons: placed.map((p) => p.weapon),
    growth: { research: growth.research },
  }
  if (backpack) loadout.backpack = backpack
  return { loadout, weaponKeys, unmapped, notes }
}

// ─── 武裝討伐目標 ────────────────────────────────────────────────────────────

/** 難度編號（與 enums.ts RaidDifficulty 註解的編號相同）。 */
export const RAID_DIFFICULTY_NO: Readonly<Record<RaidDifficulty, number>> = {
  normal: 1,
  hard: 2,
  hell: 3,
  d4: 4,
}

/** 這一期的最高難度；沒有難度資料回 null。 */
export function highestRaidDifficulty(season: Pick<RaidSeason, 'difficulties'>): RaidDifficulty | null {
  for (let i = RAID_DIFFICULTY_ORDER.length - 1; i >= 0; i--) {
    if (season.difficulties.includes(RAID_DIFFICULTY_ORDER[i])) return RAID_DIFFICULTY_ORDER[i]
  }
  return null
}

export interface RaidTargetInput {
  season: RaidSeason
  /** 這一期的某個關卡組（stages 文件） */
  stage: Stage
  /** 首領文件（整個集合或至少這一關的） */
  bosses: ReadonlyMap<string, Boss> | readonly Boss[]
  /** 省略＝這一期的最高難度 */
  difficulty?: RaidDifficulty
  /** 首領文件 id；省略＝這個難度的第一位首領 */
  bossId?: string
  part?: AimPart
}

export type RaidTargetBuild =
  | { target: SimRaidTargetV1; reason?: undefined }
  | { target: null; reason: string }

/** 站上的武裝討伐資料 → SimRaidTargetV1。資料對不上時回 `{ target: null, reason }`。 */
export function buildRaidTarget(input: RaidTargetInput): RaidTargetBuild {
  const { season, stage } = input
  const fail = (reason: string): RaidTargetBuild => ({ target: null, reason })

  const raid = stage.raid
  if (!raid) return fail('這個關卡不是武裝討伐')
  if (raid.seasonId !== season.id) return fail('關卡不屬於這一期')

  const difficulty = input.difficulty ?? highestRaidDifficulty(season)
  if (!difficulty) return fail('這一期沒有難度資料')
  const variant = raid.variants[difficulty]
  if (!variant) return fail('這個難度沒有關卡資料')

  const bossId = input.bossId ?? variant.bossIds[0]
  const bossIndex = bossId === undefined ? -1 : variant.bossIds.indexOf(bossId)
  if (bossIndex < 0) return fail('首領不在這個難度的關卡裡')

  const boss = Array.isArray(input.bosses)
    ? (input.bosses as readonly Boss[]).find((b) => b.id === bossId)
    : (input.bosses as ReadonlyMap<string, Boss>).get(bossId)
  if (!boss) return fail('查不到首領文件')
  const templateId = boss.variants?.[difficulty]?.templateId
  if (!templateId) return fail('首領沒有這個難度的資料')

  const target: SimRaidTargetV1 = {
    kind: 'raid',
    seasonNo: season.seq,
    stageNo: raid.group,
    difficulty: RAID_DIFFICULTY_NO[difficulty],
    battleMapId: variant.battleId,
    templateId,
    bossIndex,
  }
  if (input.part) target.part = input.part
  return { target }
}

// ─── 請求組裝 ────────────────────────────────────────────────────────────────

/** 開關目錄版本：前端還沒有開關目錄時送這個（認不得的鍵會被忽略）。 */
export const DEFAULT_SWITCH_CATALOG = '0.0.0'

/** 預設情境：全部交給引擎，不帶任何開關、宣告或數值輸入。 */
export function defaultScenario(): SimScenarioV1 {
  return {
    switchCatalog: DEFAULT_SWITCH_CATALOG,
    attack: { timing: 'auto' },
    switches: {},
    declared: {},
    numeric: {},
    probability: 'expected',
    boss: { openingState: true },
  }
}

export interface SingleRequestInput {
  loadout: SimLoadoutV1
  target: SimTargetV1
  /** 每個動作一個 job */
  actions: readonly ActionSpecV1[]
  level: SimOutputV1['level']
  /** 回傳每擊結果（只在 L2 有效） */
  perHit?: boolean
  clientEngineVersion?: string
  clientDataVersion?: string
}

/** 一套配裝 × 一個目標 × 預設情境，每個動作一個 job 的單擊請求。 */
export function buildSingleRequest(input: SingleRequestInput): SimRequestV1 {
  const output: SimOutputV1 = input.perHit ? { level: input.level, perHit: true } : { level: input.level }
  const req: SimRequestV1 = {
    v: 1,
    locale: 'zh-TW',
    mode: 'single',
    loadouts: [input.loadout],
    targets: [input.target],
    scenarios: [defaultScenario()],
    jobs: input.actions.map((action) => ({ l: 0, t: 0, s: 0, action: { ...action } })),
    output,
  }
  if (input.clientEngineVersion) req.clientEngineVersion = input.clientEngineVersion
  if (input.clientDataVersion) req.clientDataVersion = input.clientDataVersion
  return req
}
