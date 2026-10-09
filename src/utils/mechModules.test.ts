// 機甲自帶模組分組 —— 詳情頁與引用浮窗共用的那一份
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mechModuleSet } from './mechModules.ts'
import type { Module } from '../types/module.ts'

const mod = (id: string, slot: string, boundMechId: string | null = null) =>
  ({ id, slot, boundMechId }) as Module

const modules = [
  mod('mod_2059', '機甲特性模組'),
  mod('mod_3050', '機甲8級模組'),
  mod('sub_mod_增傷模組', '機甲副模組'),
  mod('mod_excl', '機甲專屬模組', 'mech_x'),
  mod('mod_other_excl', '機甲專屬模組', 'mech_other'),
]

test('四組各就各位，專屬模組以 boundMechId 反查', () => {
  const set = mechModuleSet(
    { id: 'mech_x', module4Id: 'mod_2059', module8Id: 'mod_3050', moduleFixedIds: ['sub_mod_增傷模組'] },
    modules,
  )
  assert.equal(set.mod4?.id, 'mod_2059')
  assert.equal(set.mod8?.id, 'mod_3050')
  assert.deepEqual(set.fixedMods.map((m) => m.id), ['sub_mod_增傷模組'])
  assert.deepEqual(set.exclusiveMods.map((m) => m.id), ['mod_excl'])
})

test('槽位不符的指向視為沒有，不硬塞進錯的那格', () => {
  const set = mechModuleSet(
    { id: 'mech_x', module4Id: 'mod_3050', module8Id: 'mod_2059', moduleFixedIds: [] },
    modules,
  )
  assert.equal(set.mod4, null)
  assert.equal(set.mod8, null)
})

test('專屬模組同時列在 moduleFixedIds 時只算專屬，不重複出現', () => {
  const set = mechModuleSet(
    { id: 'mech_x', moduleFixedIds: ['mod_excl', 'sub_mod_增傷模組', 'missing_id'] },
    modules,
  )
  assert.deepEqual(set.fixedMods.map((m) => m.id), ['sub_mod_增傷模組'])
  assert.deepEqual(set.exclusiveMods.map((m) => m.id), ['mod_excl'])
})

test('模組集合還沒載入（空陣列）時四組皆空', () => {
  const set = mechModuleSet({ id: 'mech_x', module4Id: 'mod_2059', moduleFixedIds: ['sub_mod_增傷模組'] }, [])
  assert.deepEqual(set, { mod4: null, mod8: null, fixedMods: [], exclusiveMods: [] })
})
