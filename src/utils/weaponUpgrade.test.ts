// PLAN-031 A-3：武器進階圖 utils 單元測試
//   npm test   →   node --test "src/**/*.test.ts"
// 本檔已從 tsconfig.app build 排除，不影響 vite/tsc 打包。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUpgradeIndex, deriveFusedSkillNames, isCompositeWeapon,
  isSpecialBackpackCraft, projectedBackpackType, weaponArmorTypes,
} from './weaponUpgrade.ts'
import type { Weapon, Backpack } from '../types'

/** 只給 utils 會讀到的欄位（id / upgrade / mechRestriction），其餘以 unknown 轉型略過。 */
const w = (id: string, upgrade?: Weapon['upgrade'], mechRestriction = 'none'): Weapon =>
  ({ id, upgrade, mechRestriction } as unknown as Weapon)
const bp = (id: string, rarity: string, type = 'PowerAdd'): Backpack =>
  ({ id, rarity, type } as unknown as Backpack)

test('buildUpgradeIndex：正向 parentOf 直接讀 upgrade.fromWeaponId', () => {
  const idx = buildUpgradeIndex([w('A'), w('B', { fromWeaponId: 'A' })])
  assert.equal(idx.parentOf.get('B'), 'A')
  assert.equal(idx.parentOf.has('A'), false)   // 無母武器者不入表
})

test('buildUpgradeIndex：反向 childrenOf 承受 fan-out（一母多子）', () => {
  const idx = buildUpgradeIndex([
    w('A'),
    w('B', { fromWeaponId: 'A' }),
    w('C', { fromWeaponId: 'A' }),
  ])
  assert.deepEqual(idx.childrenOf.get('A'), ['B', 'C'])
  assert.equal(idx.childrenOf.has('B'), false)  // 葉節點無子
})

test('buildUpgradeIndex：空輸入與無 upgrade 皆回空表', () => {
  const idx = buildUpgradeIndex([w('A'), w('B')])
  assert.equal(idx.parentOf.size, 0)
  assert.equal(idx.childrenOf.size, 0)
})

test('deriveFusedSkillNames：子技能 − 母技能差集，保序', () => {
  assert.deepEqual(deriveFusedSkillNames(['充沛', '鼎新', '固有'], ['固有']), ['充沛', '鼎新'])
  // 複合武器：|delta| = 1
  assert.deepEqual(deriveFusedSkillNames(['a', 'b', '首攻強化Ⅲ'], ['a', 'b']), ['首攻強化Ⅲ'])
})

test('deriveFusedSkillNames：無新增技能 → 空陣列', () => {
  assert.deepEqual(deriveFusedSkillNames(['a', 'b'], ['a', 'b', 'c']), [])
  assert.deepEqual(deriveFusedSkillNames([], ['a']), [])
})

test('isCompositeWeapon：僅 station === specialBackpack 為真', () => {
  assert.equal(isCompositeWeapon(w('X', { fromWeaponId: 'Y', station: 'specialBackpack' })), true)
  assert.equal(isCompositeWeapon(w('X', { fromWeaponId: 'Y' })), false)  // 純進階非複合
  assert.equal(isCompositeWeapon(w('X')), false)                         // 無 upgrade
})

test('isSpecialBackpackCraft：SS 背包為真，其餘為假', () => {
  assert.equal(isSpecialBackpackCraft(bp('a', 'SS')), true)
  assert.equal(isSpecialBackpackCraft(bp('b', 'S+')), false)
})

test('projectedBackpackType：由 fusedBackpackId 查表取 type，無值回 null', () => {
  const byId = new Map([['60102405', bp('60102405', 'S+', 'PowerAdd')]])
  assert.equal(projectedBackpackType(w('裁決者', { fromWeaponId: 'X', station: 'specialBackpack', fusedBackpackId: '60102405' }), byId), 'PowerAdd')
  assert.equal(projectedBackpackType(w('待實機', { fromWeaponId: 'X', station: 'specialBackpack' }), byId), null)  // 無 fusedBackpackId
  assert.equal(projectedBackpackType(w('孤兒', { fromWeaponId: 'X', station: 'specialBackpack', fusedBackpackId: 'nope' }), byId), null)  // 查無
})

test('weaponArmorTypes：mechRestriction → 背包 armor key（none→[]）', () => {
  assert.deepEqual(weaponArmorTypes(w('a', undefined, 'medium')), ['Medium'])
  assert.deepEqual(weaponArmorTypes(w('b', undefined, 'light')), ['Light'])
  assert.deepEqual(weaponArmorTypes(w('c', undefined, 'heavy')), ['Heavy'])
  assert.deepEqual(weaponArmorTypes(w('d', undefined, 'none')), [])
})
