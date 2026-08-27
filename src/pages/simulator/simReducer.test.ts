// PLAN-052-B A-1：級聯（reconcile）的驗收
//   npm test   →   node --test "src/**/*.test.ts"
//
// 每一則測試對應計畫書決策三那張表的一列。表上寫「換機甲（中甲→輕/重）→ 肩槽整列消失」，
// 這裡就要真的看到肩部武器被移除、而且 toast 講得出被移除了什麼。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Backpack, Component, Mech, MechForm, Module, NeuralDrive, Pilot, Weapon } from '../../types/index.ts'
import { INITIAL_SIM_STATE, reconcile, simReduce, type SimState } from './simReducer.ts'
import { buildWorld, buildContext, loadoutBudget } from '../../utils/loadoutRules.ts'
import { ArmorType, BackpackType, MechLicense, MechRestriction, WeaponEquipSlot, WeaponType, MechPartPosition, ModuleSlot, PartInterface } from '../../types/enums.ts'

// ─── fixtures ───────────────────────────────────────────────────────────────

const part = (weight: number, output?: number) =>
  ({ position: 'torso', durable: 0, armor: 0, firepower: 0, weight, output, interface: 'Ⅱ型接口' }) as never

const mech = (id: string, name: string, armorType: ArmorType): Mech => ({
  id, name, armorType, firepower: 0, armor: 0, evasion: 0, mobility: 0, weight: 825, output: 3375,
  parts: { torso: part(300, 3375), leftArm: part(175), rightArm: part(175), legs: part(175) },
  moduleFixedIds: [],
})

const 彌造者 = mech('mech_052', '彌造者', ArmorType.MEDIUM)
const 輕型機 = mech('mech_light', '輕型機', ArmorType.LIGHT)
const 重型機 = mech('mech_heavy', '重型機', ArmorType.HEAVY)
/** 第二台中甲：換機甲時「同機種換一台」用（執照一對一之後，跨機種那種換法會先被擋下） */
const 中甲機2 = mech('mech_053', '中甲機2', ArmorType.MEDIUM)

const weapon = (over: Partial<Weapon> & Pick<Weapon, 'id' | 'name' | 'weight' | 'equipSlot'>): Weapon => ({
  type: WeaponType.Melee, kind: '刀劍', kindCoefficient: 1, attack: 0, accuracy: 0, critValue: 0,
  rangeType: 'manhattan', minRange: 1, maxRange: 1, ammoCount: 0, hitCount: 1, rarity: 'SS',
  mechRestriction: MechRestriction.NONE, isExclusive: false, triggerSlots: 3, effectSlots: 3, componentLimit: 4,
  fixedMod: { planName: '', maxLevel: 0, effects: [] },
  floatingMod: { planName: '', slots: 0, possibleEffects: [] }, skills: [], ...over,
} as Weapon)

const 群山之力 = weapon({ id: 'w_008', name: '群山之力', weight: 800, equipSlot: WeaponEquipSlot.DUAL_HAND })
const 藝術突襲 = weapon({ id: 'w_016', name: '藝術突襲', weight: 420, equipSlot: WeaponEquipSlot.SINGLE_HAND, type: WeaponType.Assault })
const 夜魘     = weapon({ id: 'w_017', name: '夜魘',     weight: 500, equipSlot: WeaponEquipSlot.SINGLE_HAND, type: WeaponType.Assault })
const 熔火     = weapon({ id: 'w_044', name: '熔火', weight: 1200, equipSlot: WeaponEquipSlot.SHOULDER, type: WeaponType.Heavy, mechRestriction: MechRestriction.MEDIUM_ONLY })
const 炬塔     = weapon({ id: 'w_049', name: '炬塔', weight: 1100, equipSlot: WeaponEquipSlot.BACK,     type: WeaponType.Heavy, mechRestriction: MechRestriction.MEDIUM_ONLY })

const backpack = (over: Partial<Backpack> & Pick<Backpack, 'id' | 'name' | 'weight'>): Backpack => ({
  type: BackpackType.HEAL, rarity: 'S', slot: WeaponEquipSlot.BACK, assemblableArmorType: [],
  repairAmount: 0, skillIds: [], ...over,
})
const 強襲者背包 = backpack({ id: '60101706', name: '強襲者背包', weight: 150, type: BackpackType.BACKUP_EQUIPMENT })
const 出力背包Ⅲ  = backpack({ id: '60100104', name: '出力背包Ⅲ', weight: 150, type: BackpackType.POWERADD })

/**
 * 神經驅動分區 fixture。`minSum` 階梯**逐機師不同**是本組測試的重點 ——
 * 兩位機師都有 γ1／γ2，但同一個 Lv 換出來的算力值不一樣，所以換機師時不能沿用舊 Lv。
 */
const drive = (name: string, minSums: number[]): NeuralDrive => ({
  name, icon: '', slots: [],
  levels: minSums.map((minSum, i) => ({
    level: i + 1, minSum, effect: '', skillName: `${name}能力${i + 1}`,
    skillIcon: '', iconLocal: '', effects: [], buffIds: [],
  })),
})

const 海莉絲: Pilot = { id: 'pilot_h', name: '海莉絲', license: MechLicense.MEDIUM } as Pilot
const 輕型機師: Pilot = { id: 'pilot_l', name: '小輕', license: MechLicense.LIGHT } as Pilot
/** 無形態的中型執照機師：測純結構級聯時用它，免得形態白名單搶先把武器擋掉 */
const 中型機師: Pilot = { id: 'pilot_m', name: '阿中', license: MechLicense.MEDIUM } as Pilot
/** 帶神經驅動的兩位機師（PLAN-052-I D-2）。γ 階梯刻意不同：ND甲 Lv3=7、ND乙 Lv3=13 */
const ND甲: Pilot = {
  id: 'pilot_nd_a', name: 'ND甲', license: MechLicense.MEDIUM,
  neuralDrive: [drive('γ1', [1, 4, 7, 10, 13, 16]), drive('γ2', [1, 4, 7, 10, 13, 16])],
} as Pilot
const ND乙: Pilot = {
  id: 'pilot_nd_b', name: 'ND乙', license: MechLicense.MEDIUM,
  neuralDrive: [drive('γ1', [4, 8, 13]), drive('α1', [2, 5])],
} as Pilot

const form = (id: string, name: string, order: number, allow: string[]): MechForm => ({
  id, pilotId: 海莉絲.id, name, order, description: '', independentLoadout: true,
  restrict: { kind: 'weaponType', allow },
} as MechForm)
const 先鋒形態 = form('form_h_先鋒', '先鋒形態', 1, [WeaponType.Melee, WeaponType.Sniper])
const 突擊形態 = form('form_h_突擊', '突擊形態', 2, [WeaponType.Assault])

// ─── 元件 fixture（PLAN-052-D Phase B）──────────────────────────────────────

const comp = (over: Partial<Component> & Pick<Component, 'id' | 'name' | 'componentType'>): Component => ({
  moduleSubtype: 1, probabilityLevel: 5, description: '', rarity: 'S',
  allowedWeaponTypes: [WeaponType.Sniper, WeaponType.Melee, WeaponType.Assault, WeaponType.Heavy],
  componentsWType: 'Normal',
  ...(over.componentType === 'Condition' ? { conditionType: 'always', condition: '' } : {}),
  ...over,
} as Component)

const 觸憑逸W = comp({ id: 'c_001', name: '觸元件W-憑逸', componentType: 'Condition', componentsWType: 'W' })
const 觸憑逸  = comp({ id: 'c_002', name: '觸元件-憑逸',  componentType: 'Condition' })
const 觸沉著  = comp({ id: 'c_003', name: '觸元件-沉著',  componentType: 'Condition' })
const 觸壓迫  = comp({ id: 'c_004', name: '觸元件-壓迫',  componentType: 'Condition' })
const 觸擊破  = comp({ id: 'c_005', name: '觸元件-擊破',  componentType: 'Condition' })
const 應戰慄  = comp({ id: 'c_101', name: '應元件-戰慄',  componentType: 'Function' })
const 應穿甲  = comp({ id: 'c_102', name: '應元件-穿甲',  componentType: 'Function' })
/** 警戒族實測限定「射擊」（7 筆部分限定之一） */
const 觸警戒  = comp({ id: 'c_006', name: '觸元件-警戒', componentType: 'Condition', allowedWeaponTypes: [WeaponType.Sniper] })

const COMPONENTS = [觸憑逸W, 觸憑逸, 觸沉著, 觸壓迫, 觸擊破, 應戰慄, 應穿甲, 觸警戒]

// ─── 模組 fixture（PLAN-052-G C-1）──────────────────────────────────────────
//   接口 ＝ f(quality, position)：S ⇒ ⅡⅡⅡⅡ／A ⇒ ⅠⅡⅡⅠ／B ⇒ 無接口（mechInterface.ts）

const ifacePart = (weight: number, iface: string, output?: number) =>
  ({ position: 'torso', durable: 0, armor: 0, firepower: 0, weight, output, interface: iface }) as never

/** A 品質中甲：軀幹與腿部 Ⅰ 型（只收 A 級模組），雙臂 Ⅱ 型 */
const A級中甲: Mech = {
  ...mech('mech_a', 'A級中甲', ArmorType.MEDIUM),
  parts: {
    torso:    ifacePart(300, PartInterface.TYPE_I, 3375),
    leftArm:  ifacePart(175, PartInterface.TYPE_II),
    rightArm: ifacePart(175, PartInterface.TYPE_II),
    legs:     ifacePart(175, PartInterface.TYPE_I),
  },
}

/** B 品質中甲：四格全空 ＝ **這台沒有模組接口**（不是「未建檔」） */
const B級中甲: Mech = {
  ...mech('mech_b', 'B級中甲', ArmorType.MEDIUM),
  parts: {
    torso:    ifacePart(300, '', 3375),
    leftArm:  ifacePart(175, ''),
    rightArm: ifacePart(175, ''),
    legs:     ifacePart(175, ''),
  },
}

const mod = (over: Partial<Module> & Pick<Module, 'id' | 'name' | 'rarity'>): Module => ({
  slot: ModuleSlot.UNIVERSAL, boundMechId: null, boundPart: null,
  dmg: 0, crit_rate: 0, critDmg: 0, acc_rate: 0, firepower_rate: 0, armor_rate: 0,
  crit_resist_rate: 0, output_bonus: 0, dodge_rate: 0, durable_rate: 0, dmg_resist_rate: 0,
  description: '',
  levels: [1, 2, 3, 4].map((level) => ({ level, dmg: level * 2 })) as never,
  ...over,
} as Module)

const 通用S = mod({ id: 'mod_4101', name: '通用S模組', rarity: 'S' })
const 通用S2 = mod({ id: 'mod_4103', name: '第二顆S模組', rarity: 'S' })
const 通用A = mod({ id: 'mod_4102', name: '通用A模組', rarity: 'A' })
/** 綁機甲的專屬模組：分享碼可能把它灌進來，但只有那台裝得上 */
const 破曉專屬 = mod({ id: 'mod_9001', name: '匯流樞紐', rarity: 'S', slot: ModuleSlot.EXCLUSIVE, boundMechId: 'mech_026' })

const MODULES = [通用S, 通用S2, 通用A, 破曉專屬]

const TORSO = { kind: 'module', position: MechPartPosition.TORSO } as const
const L_ARM = { kind: 'module', position: MechPartPosition.LEFT_ARM } as const
const LEGS  = { kind: 'module', position: MechPartPosition.LEGS } as const

const WORLD = buildWorld({
  pilots: [海莉絲, 輕型機師, 中型機師, ND甲, ND乙],
  mechs: [彌造者, 輕型機, 重型機, 中甲機2, A級中甲, B級中甲],
  weapons: [群山之力, 藝術突襲, 夜魘, 熔火, 炬塔],
  backpacks: [強襲者背包, 出力背包Ⅲ],
  forms: [先鋒形態, 突擊形態],
  components: COMPONENTS,
  modules: MODULES,
})

/**
 * 元件與模組**尚未載入**的世界（PLAN-052-D 決策六 ／ PLAN-052-G 決策六）。
 * 分享碼／本機書架／雲端存檔都可能在這兩個集合到齊之前就把草稿灌進來。
 */
const WORLD_LOADING = buildWorld({
  pilots: [海莉絲, 輕型機師, 中型機師, ND甲, ND乙],
  mechs: [彌造者, 輕型機, 重型機, 中甲機2, A級中甲, B級中甲],
  weapons: [群山之力, 藝術突襲, 夜魘, 熔火, 炬塔],
  backpacks: [強襲者背包, 出力背包Ⅲ],
  forms: [先鋒形態, 突擊形態],
})

const HAND_L = { bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' } as const
const HAND_R = { bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' } as const
const DUAL   = { bank: 'main', slot: WeaponEquipSlot.DUAL_HAND } as const
const BKUP_L = { bank: 'backup', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' } as const
const SHO_L  = { bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'left' } as const
const BACK   = { bank: 'main', slot: WeaponEquipSlot.BACK } as const

/** 依序派發一串動作，回傳最終狀態。每一步都真的走 reducer —— 這裡測的就是「連著做」。 */
const run = (...actions: Parameters<typeof simReduce>[1][]): SimState =>
  actions.reduce<SimState>((s, a) => simReduce(s, a, WORLD), INITIAL_SIM_STATE)

const setOf = (s: SimState, key = s.draft.activeSetKey) => s.draft.sets[key] ?? { mounts: [] }
const names = (s: SimState) => (s.notice?.removed ?? []).map((r) => r.name)

// ─── 基本流程 ───────────────────────────────────────────────────────────────

test('選機師 → 選機甲 → 裝武器：一路走下來沒有任何級聯回饋（沒事就不跳 toast）', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: DUAL, weaponId: 群山之力.id },
  )
  assert.equal(setOf(s).mounts.length, 1)
  assert.equal(s.notice, null)
})

test('分頁鍵一律取自 equipSetKeys()：海莉絲有 2 個獨立配裝分頁，預設落在第一個', () => {
  const s = run({ type: 'selectPilot', pilotId: 海莉絲.id })
  assert.equal(s.draft.activeSetKey, 先鋒形態.id)
})

test('換機師會讓舊 formId 分頁整批失效（不是留著一個點不到的孤兒分頁）', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: DUAL, weaponId: 群山之力.id },
    { type: 'selectPilot', pilotId: 輕型機師.id },
  )
  assert.equal(s.draft.activeSetKey, 'default')
  assert.deepEqual(Object.keys(s.draft.sets), [])
})

// ─── 決策三那張表 ───────────────────────────────────────────────────────────

test('換機師（執照容不下）→ 機甲移除 → 連帶 mounts 與背包', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: DUAL, weaponId: 群山之力.id },
    { type: 'selectPilot', pilotId: 輕型機師.id },
  )
  assert.equal(s.draft.mechId, undefined)
  assert.ok(names(s).includes('彌造者'))
  assert.match(s.notice!.removed[0].why, /輕型執照/)
})

// ⚠ 執照與裝甲一對一（2026-08-25）之後，一位機師換不到別的機種，而槽位形狀是 armorType 的函式，
//   所以「換機甲→肩槽整列消失」在 reducer 層已經走不到了：跨機種的那一步會先被執照擋下。
//   槽位縮水本身仍有覆蓋 —— loadoutRules.test「非中甲沒有肩槽 → NO_SLOT」與下面的換背包那則。
test('換機甲跨機種（中甲→輕型）→ 執照擋下，整台連同該套裝備退回', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 中型機師.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: SHO_L, weaponId: 熔火.id },
    { type: 'equipWeapon', ref: DUAL, weaponId: 群山之力.id },
    { type: 'selectMech', mechId: 輕型機.id },
  )
  assert.equal(s.draft.mechId, undefined)
  assert.deepEqual(names(s), ['輕型機'])
  assert.match(s.notice!.removed[0].why, /中型執照/)
  assert.equal(setOf(s).mounts.length, 0)
})

test('換機甲不清空其餘裝備：「試試看換一台」不該每次都要重配一輪', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 中型機師.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: DUAL, weaponId: 群山之力.id },
    { type: 'equipBackpack', backpackId: 出力背包Ⅲ.id },
    { type: 'selectMech', mechId: 中甲機2.id },        // 同機種換一台 —— 執照擋不住的那種換法
  )
  assert.equal(s.draft.mechId, 中甲機2.id)
  assert.equal(setOf(s).mounts.length, 1)
  assert.equal(setOf(s).backpackId, 出力背包Ⅲ.id)
})

test('換背包（強襲者→一般）→ 備用槽消失 → 兩格武器移除 ＋ 出力變化寫進 toast', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'setActiveSet', key: 突擊形態.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipBackpack', backpackId: 強襲者背包.id },
    { type: 'equipWeapon', ref: BKUP_L, weaponId: 藝術突襲.id },
    { type: 'equipWeapon', ref: { bank: 'backup', slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' }, weaponId: 夜魘.id },
    { type: 'equipBackpack', backpackId: 出力背包Ⅲ.id },
  )
  assert.deepEqual(names(s).sort(), ['夜魘', '藝術突襲'])
  // 強襲者 +300、出力背包Ⅲ +300 → 這一則的 note 只有在數字真的變了才出現
  assert.equal(setOf(s).mounts.length, 0)
})

test('裝背部武器 → 背包自動卸下（背槽擇一），且 toast 可 [復原]', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'setActiveSet', key: 突擊形態.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipBackpack', backpackId: 出力背包Ⅲ.id },
    { type: 'equipWeapon', ref: BACK, weaponId: 炬塔.id },
  )
  assert.equal(setOf(s).backpackId, undefined)
  assert.ok(names(s).includes('出力背包Ⅲ'))
  assert.equal(s.notice!.undoable, true)
  // 背包 +300 出力沒了 —— 這是玩家最容易漏看的一件事，所以與移除項並列
  assert.ok(s.notice!.notes.some((n) => n.includes('可用出力') && n.includes('-300')))
})

test('[復原] 還原整批，而不是逐件', () => {
  const before = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'setActiveSet', key: 突擊形態.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipBackpack', backpackId: 強襲者背包.id },
    { type: 'equipWeapon', ref: BKUP_L, weaponId: 藝術突襲.id },
  )
  const after = simReduce(before, { type: 'equipBackpack', backpackId: 出力背包Ⅲ.id }, WORLD)
  assert.equal((after.draft.sets[突擊形態.id]?.mounts ?? []).length, 0)
  const undone = simReduce(after, { type: 'undo' }, WORLD)
  assert.deepEqual(undone.draft, before.draft)
  assert.equal(undone.undo, null)          // 復原不可再被復原
})

test('裝雙手武器 → 兩隻手都被取代；再裝單手 → 雙手武器被取代', () => {
  const a = run(
    { type: 'selectPilot', pilotId: 中型機師.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: HAND_L, weaponId: 藝術突襲.id },
    { type: 'equipWeapon', ref: HAND_R, weaponId: 夜魘.id },
  )
  assert.equal(setOf(a).mounts.length, 2)

  const b = simReduce(a, { type: 'equipWeapon', ref: DUAL, weaponId: 群山之力.id }, WORLD)
  assert.equal(setOf(b).mounts.length, 1)
  assert.equal(setOf(b).mounts[0].slot, WeaponEquipSlot.DUAL_HAND)
  assert.deepEqual(names(b).sort(), ['夜魘', '藝術突襲'])

  const c = simReduce(b, { type: 'equipWeapon', ref: HAND_L, weaponId: 藝術突襲.id }, WORLD)
  assert.equal(setOf(c).mounts.length, 1)
  assert.deepEqual(names(c), ['群山之力'])
})

// ─── 超重：不自動卸、不阻擋 ─────────────────────────────────────────────────

test('超重不自動移除任何東西（決策三：擋了就會把人卡在既不能改也不能存的死狀態）', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 中型機師.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: SHO_L, weaponId: 熔火.id },
    { type: 'equipWeapon', ref: { bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'right' }, weaponId: 熔火.id },
    { type: 'equipWeapon', ref: BACK, weaponId: 炬塔.id },
  )
  const ctx = buildContext(s.draft, s.draft.activeSetKey, WORLD)
  assert.equal(loadoutBudget(ctx).over, true)
  assert.equal(setOf(s).mounts.length, 3)
})

test('[自動卸至符合] 由重到輕卸，且每一步重算（手部取較重組會讓一次算完的版本卸不夠）', () => {
  const over = run(
    { type: 'selectPilot', pilotId: 中型機師.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: SHO_L, weaponId: 熔火.id },
    { type: 'equipWeapon', ref: { bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'right' }, weaponId: 熔火.id },
    { type: 'equipWeapon', ref: BACK, weaponId: 炬塔.id },
  )
  assert.equal(loadoutBudget(buildContext(over.draft, over.draft.activeSetKey, WORLD)).over, true)
  const fixed = simReduce(over, { type: 'autoUnloadToFit' }, WORLD)
  const ctx = buildContext(fixed.draft, fixed.draft.activeSetKey, WORLD)
  assert.equal(loadoutBudget(ctx).over, false)
  assert.ok(fixed.notice!.removed.some((r) => r.why === '自動卸至符合出力'))
})

// ─── reconcile 本身 ─────────────────────────────────────────────────────────

test('reconcile 對合法草稿是恆等的（不會每次 render 都製造一則假 toast）', () => {
  const draft = {
    pilotId: 海莉絲.id, mechId: 彌造者.id, activeSetKey: 先鋒形態.id,
    sets: { [先鋒形態.id]: { mounts: [{ weaponId: 群山之力.id, bank: 'main' as const, slot: WeaponEquipSlot.DUAL_HAND }] } },
  }
  const { draft: after, removed } = reconcile(draft, WORLD)
  assert.deepEqual(removed, [])
  assert.deepEqual(after, draft)
})

test('reconcile 掃得掉指向已刪除資料的裝備（改版下架一把武器不該讓整頁壞掉）', () => {
  const draft = {
    pilotId: 海莉絲.id, mechId: 彌造者.id, activeSetKey: 先鋒形態.id,
    sets: { [先鋒形態.id]: { mounts: [{ weaponId: 'w_不存在', bank: 'main' as const, slot: WeaponEquipSlot.DUAL_HAND }] } },
  }
  const { draft: after, removed } = reconcile(draft, WORLD)
  assert.equal(after.sets[先鋒形態.id].mounts.length, 0)
  assert.match(removed[0].why, /已不存在/)
})

test('loadDraft（舊存檔／分享碼）一樣要過 reconcile，不合法的部分會被掃掉', () => {
  const s = simReduce(INITIAL_SIM_STATE, {
    type: 'loadDraft',
    draft: {
      pilotId: 輕型機師.id, mechId: 重型機.id, activeSetKey: 'default',
      sets: { default: { mounts: [{ weaponId: 炬塔.id, bank: 'main', slot: WeaponEquipSlot.BACK }] } },
    },
  }, WORLD)
  assert.equal(s.draft.mechId, undefined)          // 輕型執照駕駛不了重型機甲
  assert.equal(s.notice!.undoable, false)          // 載入不提供復原
})

// ─── 算力配置 ndLevels（PLAN-052-I D-2）──────────────────────────────────────

const ndDraft = (pilotId: string, ndLevels?: Record<string, number>) => ({
  pilotId, mechId: 彌造者.id, activeSetKey: 'default', sets: {},
  ...(ndLevels ? { ndLevels } : {}),
})

test('ndLevels：合法配置原封不動，且不生出任何 removed', () => {
  const draft = ndDraft(ND甲.id, { 'γ1': 3, 'γ2': 4 })   // 7 + 10 = 17 ≤ 23
  const { draft: after, removed } = reconcile(draft, WORLD)
  assert.deepEqual(removed, [])
  assert.deepEqual(after.ndLevels, { 'γ1': 3, 'γ2': 4 })
})

test('ndLevels：不屬於這位機師的分區鍵會被掃掉（換機師的殘留）', () => {
  const { draft } = reconcile(ndDraft(ND乙.id, { 'γ1': 2, 'γ2': 5, 'β9': 1 }), WORLD)
  // γ2 / β9 不在 ND乙 身上 → 丟掉。**沒被提到的分區（α1）不會被補成 0**：
  // 那是「未設定」，讀取端一律 `{ ...defaultNdLevels(), ...ndLevels }` 疊上去，
  // 補 0 等於把一個玩家沒下過的「全關」決定寫死進草稿。
  assert.deepEqual(draft.ndLevels, { 'γ1': 2 })
})

test('ndLevels：Lv 超出該區級數會被 clamp，不會留下一個查無此級的數字', () => {
  const { draft } = reconcile(ndDraft(ND乙.id, { 'γ1': 99, 'α1': -3 }), WORLD)
  assert.deepEqual(draft.ndLevels, { 'γ1': 3, 'α1': 0 })
})

test('ndLevels：γ 合計超過上限 → 整份退場，回到「未設定」而不是被砍一半', () => {
  // γ1 Lv6 = 16、γ2 Lv6 = 16 → 合計 32 > 23
  const { draft } = reconcile(ndDraft(ND甲.id, { 'γ1': 6, 'γ2': 6 }), WORLD)
  assert.equal('ndLevels' in draft, false)
})

test('ndLevels：未設定時欄位不存在（不是 undefined —— 三態撞上 stripUndefined 會清不掉）', () => {
  const { draft } = reconcile(ndDraft(ND甲.id), WORLD)
  assert.equal('ndLevels' in draft, false)
  // 沒有機師時同樣整份退場
  const { draft: noPilot } = reconcile({ activeSetKey: 'default', sets: {}, ndLevels: { 'γ1': 3 } }, WORLD)
  assert.equal('ndLevels' in noPilot, false)
})

test('換機師時算力重置：兩位機師都有 γ1，但 Lv3 的算力值不同，不得沿用', () => {
  const a = simReduce(INITIAL_SIM_STATE, { type: 'selectPilot', pilotId: ND甲.id }, WORLD)
  const withNd = simReduce(a, { type: 'setNdLevels', levels: { 'γ1': 3, 'γ2': 2 } }, WORLD)
  assert.deepEqual(withNd.draft.ndLevels, { 'γ1': 3, 'γ2': 2 })

  const b = simReduce(withNd, { type: 'selectPilot', pilotId: ND乙.id }, WORLD)
  assert.equal('ndLevels' in b.draft, false)
})

test('setNdLevels：不動裝備、不跳 toast，且同一份配置重送是恆等的', () => {
  const base = simReduce(INITIAL_SIM_STATE, { type: 'selectPilot', pilotId: ND甲.id }, WORLD)
  const s1 = simReduce(base, { type: 'setNdLevels', levels: { 'γ1': 2, 'γ2': 2 } }, WORLD)
  assert.equal(s1.notice, null)
  const s2 = simReduce(s1, { type: 'setNdLevels', levels: { 'γ1': 2, 'γ2': 2 } }, WORLD)
  assert.equal(s2, s1)
})

// ─── 方案名稱 name（PLAN-052-I E-1）────────────────────────────────────────────

test('setName：寫入時就清洗（換行折成空白、前後空白 trim），不留給渲染端', () => {
  const s = simReduce(INITIAL_SIM_STATE, { type: 'setName', name: '  星芒\n雙持流  ' }, WORLD)
  assert.equal(s.draft.name, '星芒 雙持流')
  assert.equal(s.notice, null)      // 命名不跳 toast
})

test('setName：清成空 → 欄位不存在（不是空字串）', () => {
  const named = simReduce(INITIAL_SIM_STATE, { type: 'setName', name: '甲案' }, WORLD)
  assert.equal(named.draft.name, '甲案')
  const cleared = simReduce(named, { type: 'setName', name: '   ' }, WORLD)
  assert.equal('name' in cleared.draft, false)
})

test('setName：同一個清洗結果重送是恆等的（每一鍵都新建 draft 會一直寫 localStorage）', () => {
  const a = simReduce(INITIAL_SIM_STATE, { type: 'setName', name: '甲案' }, WORLD)
  const b = simReduce(a, { type: 'setName', name: '甲案 ' }, WORLD)   // 清洗後同字
  assert.equal(b, a)
})

test('reconcile：外部來源（分享碼／localStorage 手改）的髒名稱一樣要被清掉', () => {
  const { draft } = reconcile({
    pilotId: 海莉絲.id, mechId: 彌造者.id, activeSetKey: 先鋒形態.id, sets: {},
    name: '換行\n進來的\t名字',
  }, WORLD)
  assert.equal(draft.name, '換行 進來的 名字')

  const { draft: blank } = reconcile({
    pilotId: 海莉絲.id, mechId: 彌造者.id, activeSetKey: 先鋒形態.id, sets: {}, name: '   ',
  }, WORLD)
  assert.equal('name' in blank, false)
})

test('reconcile：乾淨名稱不觸發改寫（合法草稿必須是恆等的）', () => {
  const draft = {
    pilotId: 海莉絲.id, mechId: 彌造者.id, activeSetKey: 先鋒形態.id,
    sets: { [先鋒形態.id]: { mounts: [] } }, name: '乾淨名稱',
  }
  const { draft: after } = reconcile(draft, WORLD)
  assert.deepEqual(after, draft)
})


// ─── 元件（PLAN-052-D Phase B）──────────────────────────────────────────────

/** 走到「已選機師機甲、雙手裝了群山之力」的起點 */
const armed = () => run(
  { type: 'selectPilot', pilotId: 中型機師.id },
  { type: 'selectMech', mechId: 彌造者.id },
  { type: 'equipWeapon', ref: DUAL, weaponId: 群山之力.id },
)
const setupOf = (s: SimState, i = 0) => setOf(s).mounts[i]?.setup

test('B-1：裝上一顆觸元件，落在 triggerComponentIds', () => {
  const s = simReduce(armed(), { type: 'equipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD)
  assert.deepEqual(setupOf(s)?.triggerComponentIds, [觸沉著.id])
  assert.equal(setupOf(s)?.effectComponentIds, undefined, '空的那一條不留空陣列')
  // 沒有任何東西被移除 ⇒ 不跳 toast（沿用既有設計：每個動作都跳就等於沒有提示）。
  // 那顆元件就在面板上，看得見；與裝上武器、改算力、改名同一條理由。
  assert.equal(s.notice, null)
})

test('B-1：應元件落在 effectComponentIds（兩條清單分開）', () => {
  const s = simReduce(armed(), { type: 'equipComponent', ref: DUAL, componentId: 應戰慄.id }, WORLD)
  assert.deepEqual(setupOf(s)?.effectComponentIds, [應戰慄.id])
  assert.equal(setupOf(s)?.triggerComponentIds, undefined)
})

test('B-1：空格裝不了元件（元件掛在武器上，不是掛在格子上）', () => {
  const before = armed()
  const after = simReduce(before, { type: 'equipComponent', ref: SHO_L, componentId: 觸沉著.id }, WORLD)
  assert.equal(after, before, '狀態原樣回傳，不產生 notice')
})

test('B-1：重複裝同一顆不動作（不是裝兩份，也不是報錯）', () => {
  const s1 = simReduce(armed(), { type: 'equipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD)
  const s2 = simReduce(s1, { type: 'equipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD)
  assert.equal(s2, s1)
})

test('B-1：卸下最後一顆之後，setup 欄位整個消失（不留 {} 也不留空陣列）', () => {
  const s1 = simReduce(armed(), { type: 'equipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD)
  const s2 = simReduce(s1, { type: 'unequipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD)
  assert.equal(setupOf(s2), undefined)
  assert.equal(s2.notice, null, '卸下是玩家主動且看得見的動作，不需要 toast')
})

test('B-1：卸下沒裝的元件不動作', () => {
  const before = armed()
  assert.equal(simReduce(before, { type: 'unequipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD), before)
})

test('B-1：解法按鈕派來的 unequipComponent 走的是同一條路（形狀與 ResolutionAction 一致）', () => {
  // 同族已滿時 canEquipComponent 給的 action，直接餵給 reducer 要能生效
  const s1 = simReduce(armed(), { type: 'equipComponent', ref: DUAL, componentId: 觸憑逸W.id }, WORLD)
  const s2 = simReduce(s1, { type: 'unequipComponent', ref: DUAL, componentId: 觸憑逸W.id }, WORLD)
  assert.equal(setupOf(s2), undefined)
})

test('B-2：換掉武器，元件跟著清空（placeWeapon 不帶 setup）', () => {
  const s1 = simReduce(armed(), { type: 'equipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD)
  const s2 = simReduce(s1, { type: 'equipWeapon', ref: HAND_L, weaponId: 藝術突襲.id }, WORLD)
  // 雙手武器被單手擠掉 ⇒ 那筆 mount 連同 setup 一起消失
  assert.equal(setOf(s2).mounts.length, 1)
  assert.equal(setupOf(s2), undefined)
  assert.ok(names(s2).includes('群山之力'), 'toast 說得出被取代的是哪一把')
})

test('B-2：換機甲讓武器整批失效時，元件跟著走（不需要第二條級聯）', () => {
  const s1 = run(
    { type: 'selectPilot', pilotId: 中型機師.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipWeapon', ref: SHO_L, weaponId: 熔火.id },
  )
  const s2 = simReduce(s1, { type: 'equipComponent', ref: SHO_L, componentId: 觸沉著.id }, WORLD)
  assert.deepEqual(setupOf(s2)?.triggerComponentIds, [觸沉著.id])
  // 中甲限定的熔火在輕型機上裝不了 —— 但中型執照開不了輕型機，改用 reconcile 直接驗
  const moved = reconcile({ ...s2.draft, mechId: 輕型機.id }, WORLD)
  assert.equal(moved.draft.sets[s2.draft.activeSetKey]?.mounts.length ?? 0, 0)
})

test('B-2 ⚠ 最危險的一條：components 尚未載入時，元件原樣保留', () => {
  // 分享碼／本機書架／雲端存檔都可能比集合早到。照抄武器那套「查不到就刪」，
  // 症狀是貼一次分享碼、元件就被靜默清空一次，而且連 toast 都不會跳。
  const draft = {
    pilotId: 中型機師.id, mechId: 彌造者.id, activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: 群山之力.id, bank: 'main' as const, slot: WeaponEquipSlot.DUAL_HAND,
      setup: { triggerComponentIds: [觸沉著.id, 觸壓迫.id], effectComponentIds: [應戰慄.id] },
    }] } },
  }
  const { draft: out, removed } = reconcile(draft, WORLD_LOADING)
  assert.deepEqual(out.sets.default.mounts[0].setup?.triggerComponentIds, [觸沉著.id, 觸壓迫.id])
  assert.deepEqual(out.sets.default.mounts[0].setup?.effectComponentIds, [應戰慄.id])
  assert.deepEqual(removed, [], '一句話都不該說 —— 它根本沒有資格判斷')
})

test('B-2：載入完成後同一份草稿會被正常驗證（證明上一則不是因為規則沒接上）', () => {
  const draft = {
    pilotId: 中型機師.id, mechId: 彌造者.id, activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: 群山之力.id, bank: 'main' as const, slot: WeaponEquipSlot.DUAL_HAND,
      setup: { triggerComponentIds: [觸憑逸W.id, 觸憑逸.id] },   // 同族兩顆
    }] } },
  }
  const { draft: out, removed } = reconcile(draft, WORLD)
  assert.deepEqual(out.sets.default.mounts[0].setup?.triggerComponentIds, [觸憑逸W.id], '第一顆留下')
  assert.equal(removed.length, 1)
  assert.equal(removed[0].kind, 'component')
  assert.equal(removed[0].name, '觸元件-憑逸')
})

test('B-2：元件 doc 不存在（後台刪了）⇒ 移除並說得出來', () => {
  const draft = {
    pilotId: 中型機師.id, mechId: 彌造者.id, activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: 群山之力.id, bank: 'main' as const, slot: WeaponEquipSlot.DUAL_HAND,
      setup: { triggerComponentIds: ['c_已刪除'] },
    }] } },
  }
  const { draft: out, removed } = reconcile(draft, WORLD)
  assert.equal(out.sets.default.mounts[0].setup, undefined)
  assert.equal(removed[0].why, '元件資料已不存在')
  assert.equal(removed[0].name, 'c_已刪除', '查不到就退回 id，讓斷鏈被看見')
})

test('B-2：壞掉的外部來源把同一顆掛兩次 ⇒ 留一顆並報出重複', () => {
  const draft = {
    pilotId: 中型機師.id, mechId: 彌造者.id, activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: 群山之力.id, bank: 'main' as const, slot: WeaponEquipSlot.DUAL_HAND,
      setup: { triggerComponentIds: [觸沉著.id, 觸沉著.id] },
    }] } },
  }
  const { draft: out, removed } = reconcile(draft, WORLD)
  assert.deepEqual(out.sets.default.mounts[0].setup?.triggerComponentIds, [觸沉著.id])
  assert.match(removed[0].why, /重複/)
})

test('B-2：超量的 setup（外部來源帶 5 顆）截到 componentLimit，且逐顆說明', () => {
  const draft = {
    pilotId: 中型機師.id, mechId: 彌造者.id, activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: 群山之力.id, bank: 'main' as const, slot: WeaponEquipSlot.DUAL_HAND,
      setup: {
        triggerComponentIds: [觸沉著.id, 觸壓迫.id, 觸擊破.id],
        effectComponentIds: [應戰慄.id, 應穿甲.id],
      },
    }] } },
  }
  const { draft: out, removed } = reconcile(draft, WORLD)
  const setup = out.sets.default.mounts[0].setup!
  assert.equal((setup.triggerComponentIds?.length ?? 0) + (setup.effectComponentIds?.length ?? 0), 4)
  assert.equal(removed.length, 1)
  assert.equal(removed[0].name, '應元件-穿甲', '超出的是最後一顆')
})

test('B-2：武器種類限定的元件在換了武器之後會被移除，並指名是哪一把', () => {
  const draft = {
    pilotId: 中型機師.id, mechId: 彌造者.id, activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: 藝術突襲.id, bank: 'main' as const, slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' as const,
      setup: { triggerComponentIds: [觸警戒.id] },   // 警戒限定「射擊」，藝術突襲是「突擊」
    }] } },
  }
  const { removed } = reconcile(draft, WORLD)
  assert.equal(removed.length, 1)
  assert.match(removed[0].why, /藝術突襲/)
  assert.match(removed[0].why, /射擊/)
})

test('B-3：元件被移除時 where 是純槽位標籤（混進武器名會讓 flash 對不上任何一格）', () => {
  const draft = {
    pilotId: 中型機師.id, mechId: 彌造者.id, activeSetKey: 'default',
    sets: { default: { mounts: [{
      weaponId: 藝術突襲.id, bank: 'main' as const, slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' as const,
      setup: { triggerComponentIds: [觸警戒.id] },
    }] } },
  }
  const { removed } = reconcile(draft, WORLD)
  assert.equal(removed[0].where, '右手')
  assert.ok(!removed[0].where!.includes('藝術突襲'), '武器名歸 why 講')
})

test('B-3：元件的移除會跳 toast，而且 [復原] 拿得回來', () => {
  const s1 = simReduce(armed(), { type: 'equipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD)
  const s2 = simReduce(s1, { type: 'equipWeapon', ref: HAND_L, weaponId: 藝術突襲.id }, WORLD)
  assert.ok(s2.notice, '換武器丟掉元件必須有回饋')
  assert.equal(s2.notice?.undoable, true)
  const s3 = simReduce(s2, { type: 'undo' }, WORLD)
  assert.deepEqual(s3.draft.sets[s3.draft.activeSetKey].mounts[0].setup?.triggerComponentIds, [觸沉著.id])
})

test('B-3：換掉一把帶元件的武器，toast 要說出連同幾顆元件一起沒了', () => {
  // 元件隨 mount 一起走、不各自進 removed；但「已由 X 取代」讀起來像只換掉一把武器，
  // 而玩家配的四顆元件也一起沒了 —— 數量補在 why 裡
  const s1 = simReduce(armed(), { type: 'equipComponent', ref: DUAL, componentId: 觸沉著.id }, WORLD)
  const s2 = simReduce(s1, { type: 'equipComponent', ref: DUAL, componentId: 應戰慄.id }, WORLD)
  const s3 = simReduce(s2, { type: 'equipWeapon', ref: HAND_L, weaponId: 藝術突襲.id }, WORLD)
  const item = (s3.notice?.removed ?? []).find((r) => r.name === '群山之力')
  assert.match(item!.why, /連同 2 顆元件/)
})

test('B-3：沒有元件的武器被取代時，不畫蛇添足加「連同 0 顆」', () => {
  const s = simReduce(armed(), { type: 'equipWeapon', ref: HAND_L, weaponId: 藝術突襲.id }, WORLD)
  const item = (s.notice?.removed ?? []).find((r) => r.name === '群山之力')
  assert.ok(!item!.why.includes('連同'))
})

test('B-3：主手與備用各裝一把同型武器，元件互不影響', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 中型機師.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipBackpack', backpackId: 強襲者背包.id },
    { type: 'equipWeapon', ref: HAND_L, weaponId: 藝術突襲.id },
    { type: 'equipWeapon', ref: BKUP_L, weaponId: 藝術突襲.id },
    { type: 'equipComponent', ref: HAND_L, componentId: 觸沉著.id },
    { type: 'equipComponent', ref: BKUP_L, componentId: 觸壓迫.id },
  )
  const main = setOf(s).mounts.find((m) => m.bank === 'main')
  const backup = setOf(s).mounts.find((m) => m.bank === 'backup')
  assert.deepEqual(main?.setup?.triggerComponentIds, [觸沉著.id])
  assert.deepEqual(backup?.setup?.triggerComponentIds, [觸壓迫.id])
})

// ─── 模組接口（PLAN-052-G C-1）─────────────────────────────────────────────

test('052-G：裝上一顆模組 —— 寫進 draft.modules，未裝的部位欄位不存在', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
  )
  assert.deepEqual(s.draft.modules, { torso: 通用S.id })
  // ⚠ 沒裝的三格**不可以**是 null（stripUndefined 的老坑）
  assert.equal('leftArm' in (s.draft.modules ?? {}), false)
  // 沒有任何東西被移除 ⇒ 不跳 toast（每個動作都跳就等於沒有提示，見 commit()）
  assert.equal(s.notice, null)
})

test('052-G：卸下最後一顆之後，modules 欄位本身消失（不留一個空物件）', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
    { type: 'unequipModule', ref: TORSO },
  )
  assert.equal('modules' in s.draft, false)
  assert.equal(s.notice, null)
})

test('052-G：同一格換一顆 —— 被換掉的那顆要進 toast（不是靜默覆蓋）', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S2.id },
  )
  assert.deepEqual(s.draft.modules, { torso: 通用S2.id })
  assert.deepEqual(names(s), [通用S.name])
  assert.match(s.notice!.removed[0].why, /已由第二顆S模組取代/)
  assert.equal(s.notice!.removed[0].where, '軀幹')
})

test('052-G：四個接口各裝一顆，彼此不互斥（模組沒有同族、也沒有容量帳）', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
    { type: 'equipModule', ref: L_ARM, moduleId: 通用S2.id },
    { type: 'equipModule', ref: LEGS, moduleId: 通用A.id },
  )
  assert.deepEqual(s.draft.modules, { torso: 通用S.id, leftArm: 通用S2.id, legs: 通用A.id })
  assert.equal(s.notice, null)
})

test('052-G 級聯：換到 A 級機甲 —— Ⅰ 型的軀幹／腿部掉 S 級模組，Ⅱ 型的手臂留著', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
    { type: 'equipModule', ref: L_ARM, moduleId: 通用S2.id },
    { type: 'equipModule', ref: LEGS, moduleId: 通用A.id },
    { type: 'selectMech', mechId: A級中甲.id },
  )
  // 軀幹是 Ⅰ 型 ⇒ S 級掉；左臂是 Ⅱ 型 ⇒ 留；腿部是 Ⅰ 型但裝的是 A 級 ⇒ 留
  assert.deepEqual(s.draft.modules, { leftArm: 通用S2.id, legs: 通用A.id })
  assert.deepEqual(names(s), [通用S.name])
  assert.match(s.notice!.removed[0].why, /只能裝 A 級模組/)
})

test('052-G 級聯：換到 B 級機甲 —— 四格全掉，且每一顆都講得出原因', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
    { type: 'equipModule', ref: L_ARM, moduleId: 通用S2.id },
    { type: 'selectMech', mechId: B級中甲.id },
  )
  assert.equal('modules' in s.draft, false)
  assert.deepEqual(names(s).sort(), [通用S.name, 通用S2.name].sort())
  for (const r of s.notice!.removed) assert.match(r.why, /沒有模組接口/)
})

test('052-G 級聯：同品質換一台 —— 模組原封不動留著（不是「換機甲就清空」）', () => {
  // 與同一支 reconcile() 對武器的處置一致：直接清空會讓「試試看換一台」
  // 這個最常見的動作變成每次都要重配一輪。模組不綁機甲，S 模組在另一台 S 機甲上照樣合法。
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
    { type: 'selectMech', mechId: 中甲機2.id },
  )
  assert.deepEqual(s.draft.modules, { torso: 通用S.id })
  assert.equal(s.notice, null)
})

test('052-G 級聯：移除機甲 —— 四格全清，理由是「沒有機甲就沒有模組接口」', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
    { type: 'clearMech' },
  )
  assert.equal('modules' in s.draft, false)
  assert.match(s.notice!.removed.find((r) => r.kind === 'module')!.why, /沒有機甲就沒有模組接口/)
})

test('052-G 級聯：外來草稿帶進別台機甲的專屬模組 —— 過 reconcile 被擋下並說明', () => {
  const { draft, removed } = reconcile(
    {
      activeSetKey: 'default', sets: {},
      pilotId: 海莉絲.id, mechId: 彌造者.id,
      modules: { torso: 破曉專屬.id, leftArm: 通用S.id, legs: 'mod_不存在' },
    },
    WORLD,
  )
  assert.deepEqual(draft.modules, { leftArm: 通用S.id })
  assert.deepEqual(
    removed.filter((r) => r.kind === 'module').map((r) => r.why).sort(),
    ['模組資料已不存在', `${破曉專屬.name}是另一台機甲的專屬模組，不可自由裝配`].sort(),
  )
})

test('052-G 決策六（本計畫最重要的一條）：modules 未載入時，reconcile 不動 draft.modules', () => {
  // 空 Map ＝ 還沒載入，不是「這個世界沒有模組」。照抄武器那套「查不到就刪」的症狀是
  // **貼一次分享碼、四顆模組就被靜默清空一次**，而畫面上什麼都不會說。
  const before = {
    activeSetKey: 'default', sets: {},
    pilotId: 海莉絲.id, mechId: 彌造者.id,
    // 連「這台 B 級機甲根本沒有接口」這種必定非法的組合都不可以動 ——
    // 因為我們現在還不知道 mod_4101 是什麼，任何判斷都是猜的
    modules: { torso: 通用S.id, leftArm: 破曉專屬.id },
  }
  const { draft, removed } = reconcile(before, WORLD_LOADING)
  assert.deepEqual(draft.modules, before.modules)
  assert.deepEqual(removed.filter((r) => r.kind === 'module'), [])
})

test('052-G：合法草稿過 reconcile 恆等（不產生新參考、也不跳 toast）', () => {
  const before = {
    activeSetKey: 'default', sets: {},
    pilotId: 海莉絲.id, mechId: 彌造者.id,
    modules: { torso: 通用S.id, leftArm: 通用A.id },
  }
  const { draft, removed } = reconcile(before, WORLD)
  assert.deepEqual(removed.filter((r) => r.kind === 'module'), [])
  assert.equal(draft.modules, before.modules, 'modules 應原樣傳遞，不必要地換參考會讓 memo 全部失效')
})

test('052-G：[復原] 把被級聯清掉的模組整批救回來', () => {
  const s = run(
    { type: 'selectPilot', pilotId: 海莉絲.id },
    { type: 'selectMech', mechId: 彌造者.id },
    { type: 'equipModule', ref: TORSO, moduleId: 通用S.id },
    { type: 'selectMech', mechId: B級中甲.id },
  )
  assert.equal('modules' in s.draft, false)
  const back = simReduce(s, { type: 'undo' }, WORLD)
  assert.deepEqual(back.draft.modules, { torso: 通用S.id })
})
