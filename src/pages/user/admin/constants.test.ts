// 後台武器種類下拉的防呆
//   npm test   →   node --test "src/**/*.test.ts"
//
// WEAPON_KIND_BY_TYPE 是**手寫**的「類型 → 種類」清單，WeaponAdmin 的種類下拉只吃它。
// 新增 WeaponKind 卻忘了這裡，結果是「後台選不到、建不出來」——tsc 與 eslint 都抓不到：
//   PLAN-040 加「固定武裝」時就漏過一次；2026-11 陸版新增「浮游刃」時補上本測試。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WeaponKind, WeaponType } from '../../../types/enums.ts'
import { ALL_WEAPON_KINDS, WEAPON_KIND_BY_TYPE } from './constants.ts'

test('每個 WeaponKind 都能在後台種類下拉選到', () => {
  const inAdmin = new Set(ALL_WEAPON_KINDS.map((o) => o.value))
  const missing = Object.values(WeaponKind).filter((k) => !inAdmin.has(k))
  assert.deepEqual(missing, [], `enums.ts 有、後台 WEAPON_KIND_BY_TYPE 沒有：${missing.join('、')}`)
})

test('後台種類下拉沒有 enum 以外的值、也沒有重複', () => {
  const kinds = new Set<string>(Object.values(WeaponKind))
  const values = ALL_WEAPON_KINDS.map((o) => o.value)
  assert.deepEqual(values.filter((v) => !kinds.has(v)), [])
  assert.equal(new Set(values).size, values.length)
})

test('WEAPON_KIND_BY_TYPE 的鍵都是合法的 WeaponType', () => {
  const types = new Set<string>(Object.values(WeaponType))
  assert.deepEqual(Object.keys(WEAPON_KIND_BY_TYPE).filter((t) => !types.has(t)), [])
})

test('浮游刃歸在格鬥類', () => {
  assert.ok(WEAPON_KIND_BY_TYPE[WeaponType.Melee].some((o) => o.value === WeaponKind.FloatingBlade))
})
