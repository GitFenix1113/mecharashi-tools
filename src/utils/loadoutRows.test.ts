// PLAN-052-I D-3：武器與元件列的資料來源（weaponRows）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這一組測的全是「少列一把」的情境 —— 那是本函式唯一會出錯、而且錯了不會報錯的方式。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mech, MechForm, Pilot, Weapon } from '../types/index.ts'
import { ArmorType, MechLicense, MechRestriction, WeaponEquipSlot, WeaponType } from '../types/enums.ts'
import { buildWorld, buildContext } from './loadoutRules.ts'
import { weaponRows } from './loadoutRows.ts'

// ─── fixtures ───────────────────────────────────────────────────────────────

const part = (weight: number, output?: number, fixedArmament?: unknown[]) =>
  ({ position: 'torso', durable: 0, armor: 0, firepower: 0, weight, output, interface: 'Ⅱ型接口', fixedArmament }) as never

const weapon = (over: Partial<Weapon> & Pick<Weapon, 'id' | 'name' | 'weight' | 'equipSlot'>): Weapon => ({
  type: WeaponType.Melee, kind: '刀劍', kindCoefficient: 1, attack: 0, accuracy: 0, critValue: 0,
  rangeType: 'manhattan', minRange: 1, maxRange: 1, ammoCount: 0, hitCount: 1, rarity: 'SS',
  mechRestriction: MechRestriction.NONE, isExclusive: false, triggerSlots: 0, effectSlots: 0, componentLimit: 4,
  fixedMod: { planName: '', maxLevel: 0, effects: [] },
  floatingMod: { planName: '', slots: 0, possibleEffects: [] }, skills: [], ...over,
} as Weapon)

const 雙手劍 = weapon({ id: 'w_dual', name: '雙手劍', weight: 800, equipSlot: WeaponEquipSlot.DUAL_HAND })
const 單手刀 = weapon({ id: 'w_one', name: '單手刀', weight: 300, equipSlot: WeaponEquipSlot.SINGLE_HAND })
const 肩炮   = weapon({ id: 'w_sho', name: '肩炮', weight: 500, equipSlot: WeaponEquipSlot.SHOULDER, type: WeaponType.Heavy, mechRestriction: MechRestriction.MEDIUM_ONLY })
/** 固定武裝：官方 type 是「特殊」，componentLimit 為 0（裝不了元件） */
const 衝擊炮 = weapon({ id: 'w_fix', name: '衝擊炮', weight: 0, equipSlot: WeaponEquipSlot.SHOULDER, type: WeaponType.Special, componentLimit: 0 })

const 基本機 = (): Mech => ({
  id: 'mech_a', name: '基本機', armorType: ArmorType.MEDIUM,
  firepower: 0, armor: 0, evasion: 0, mobility: 0, weight: 825, output: 5000,
  parts: { torso: part(300, 5000), leftArm: part(175), rightArm: part(175), legs: part(175) },
  moduleFixedIds: [],
}) as Mech

/** 右臂焊死一門衝擊炮 → 佔住右肩（ARM_SIDE：右臂帶右肩） */
const 固定武裝機: Mech = {
  ...基本機(),
  id: 'mech_fix', name: '固定武裝機',
  parts: {
    torso: part(300, 5000), leftArm: part(175),
    rightArm: part(175, undefined, [{ weaponId: 衝擊炮.id, slot: WeaponEquipSlot.SHOULDER }]),
    legs: part(175),
  },
} as Mech

const 機師: Pilot = { id: 'p1', name: '阿中', license: MechLicense.MEDIUM } as Pilot
const 鎖形態機師: Pilot = { id: 'p2', name: '海莉絲', license: MechLicense.MEDIUM } as Pilot

/** 全鎖形態：整套配裝由 form.restrict.mounts derive，玩家改不了但一樣要出現在清單上 */
const 虛粒子: MechForm = {
  id: 'form_虛粒子', pilotId: 鎖形態機師.id, name: '虛粒子', order: 1, description: '',
  independentLoadout: true,
  restrict: { kind: 'fixedArmament', mounts: [{ weaponId: 單手刀.id, slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] },
} as MechForm

const WORLD = buildWorld({
  pilots: [機師, 鎖形態機師],
  mechs: [基本機(), 固定武裝機],
  weapons: [雙手劍, 單手刀, 肩炮, 衝擊炮],
  backpacks: [],
  forms: [虛粒子],
})

const ctxOf = (draft: Parameters<typeof buildContext>[0], key = 'default') => buildContext(draft, key, WORLD)

// ─── 測試 ───────────────────────────────────────────────────────────────────

test('雙手武器只出現一列（它橫跨左右手兩格，列兩次就會多算一把）', () => {
  const rows = weaponRows(ctxOf({
    pilotId: 機師.id, mechId: 'mech_a',
    sets: { default: { mounts: [{ weaponId: 雙手劍.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] } },
  }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, '雙手劍')
  assert.equal(rows[0].ref.slot, WeaponEquipSlot.DUAL_HAND)
})

test('順序跟著 enumerateSlots（手 → 肩），不是玩家的裝備順序', () => {
  const rows = weaponRows(ctxOf({
    pilotId: 機師.id, mechId: 'mech_a',
    sets: {
      default: {
        mounts: [
          // 刻意先放肩、後放手，看輸出會不會被裝備順序帶著走
          { weaponId: 肩炮.id, bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'left' },
          { weaponId: 單手刀.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' },
        ],
      },
    },
  }))
  assert.deepEqual(rows.map((r) => r.name), ['單手刀', '肩炮'])
})

test('機甲固定武裝要進清單（它一樣佔槽、一樣計入總重）', () => {
  const rows = weaponRows(ctxOf({ pilotId: 機師.id, mechId: 'mech_fix', sets: {} }))
  assert.deepEqual(rows.map((r) => [r.name, r.locked]), [['衝擊炮', 'fixed']])
  // 固定武裝的 componentLimit 是 0 → UI 要印「不可裝元件」而不是 0/0
  assert.equal(rows[0].limit, 0)
})

test('全鎖形態的武裝要進清單（玩家改不了，但那正是他最想確認有沒有看漏的一把）', () => {
  const rows = weaponRows(ctxOf(
    { pilotId: 鎖形態機師.id, mechId: 'mech_a', sets: {} },
    虛粒子.id,
  ))
  assert.deepEqual(rows.map((r) => [r.name, r.locked]), [['單手刀', 'form']])
})

test('武器資料斷鏈時退回 doc id 而不是靜默留白', () => {
  const rows = weaponRows(ctxOf({
    pilotId: 機師.id, mechId: 'mech_a',
    sets: { default: { mounts: [{ weaponId: 'w_已下架', bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] } },
  }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'w_已下架')
  assert.equal(rows[0].weapon, null)
  assert.equal(rows[0].limit, 0)
})

test('空槽與背包不進清單（元件掛在武器上，背包沒有 componentLimit）', () => {
  const rows = weaponRows(ctxOf({ pilotId: 機師.id, mechId: 'mech_a', sets: { default: { mounts: [] } } }))
  assert.deepEqual(rows, [])
})

test('已裝元件數 ＝ 觸 ＋ 應（分母是 componentLimit，不是兩種各自的格數相加）', () => {
  const rows = weaponRows(ctxOf({
    pilotId: 機師.id, mechId: 'mech_a',
    sets: {
      default: {
        mounts: [{
          weaponId: 單手刀.id, bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left',
          setup: { triggerComponentIds: ['c1'], effectComponentIds: ['c2', 'c3'] },
        }],
      },
    },
  }))
  assert.equal(rows[0].used, 3)
  assert.equal(rows[0].limit, 4)
})
