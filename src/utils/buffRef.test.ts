// PLAN-024 A-3：buffIds 帶等級解析單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBuffRef, formatBuffRef } from './buffRef.ts'

test('parseBuffRef：解析 id@N 為 { buffId, level }', () => {
  assert.deepEqual(parseBuffRef('buff_傷害提升@3'), { buffId: 'buff_傷害提升', level: 3 })
  assert.deepEqual(parseBuffRef('buff_凝勢@1'), { buffId: 'buff_凝勢', level: 1 })
})

test('parseBuffRef：裸 id（無尾綴）→ level undefined（向後相容）', () => {
  assert.deepEqual(parseBuffRef('buff_虛粒子形態'), { buffId: 'buff_虛粒子形態' })
  assert.deepEqual(parseBuffRef('buff_凝勢I'), { buffId: 'buff_凝勢I' }) // 舊式分級 id 不被誤拆
})

test('parseBuffRef：非數字尾綴不誤拆（@ 視為 id 一部分）', () => {
  assert.deepEqual(parseBuffRef('buff_a@b'), { buffId: 'buff_a@b' })
})

test('formatBuffRef：有/無 level 兩態，與 parseBuffRef 互逆', () => {
  assert.equal(formatBuffRef('buff_傷害提升', 3), 'buff_傷害提升@3')
  assert.equal(formatBuffRef('buff_凝勢'), 'buff_凝勢')
  assert.deepEqual(parseBuffRef(formatBuffRef('buff_x', 2)), { buffId: 'buff_x', level: 2 })
  assert.equal(formatBuffRef('buff_y', undefined), 'buff_y')
})
