import { test } from 'node:test'
import assert from 'node:assert/strict'
import { halvesOf, halfListOf, hasMiddle, nextHalfOf, halfLabel, isHalfKey } from './halves.ts'

const two = { upper: { cnDate: '2026/01/01' }, lower: { cnDate: '2026/01/22' } }
const three = { upper: { cnDate: '2026/01/01' }, middle: { cnDate: '2026/01/22' }, lower: { cnDate: '2026/02/12' } }

test('halvesOf：兩段版本（現行模式）只回上半、下半', () => {
  assert.deepEqual(halvesOf(two).map(h => [h.key, h.label]), [['upper', '上半'], ['lower', '下半']])
  assert.equal(hasMiddle(two), false)
})

test('halvesOf：三段版本依時間順序回上半、中半、下半', () => {
  assert.deepEqual(halvesOf(three).map(h => [h.key, h.label]), [['upper', '上半'], ['middle', '中半'], ['lower', '下半']])
  assert.deepEqual(halfListOf(three).map(h => h.cnDate), ['2026/01/01', '2026/01/22', '2026/02/12'])
  assert.equal(hasMiddle(three), true)
})

test('halvesOf：缺席的段不出現（精簡型別的 upper／lower 也可能沒有）', () => {
  assert.deepEqual(halvesOf({ lower: { x: 1 } }).map(h => h.key), ['lower'])
  assert.deepEqual(halvesOf({}), [])
})

test('nextHalfOf：中半插進上半與下半之間', () => {
  assert.equal(nextHalfOf(two, 'upper')?.key, 'lower')
  assert.equal(nextHalfOf(three, 'upper')?.key, 'middle')
  assert.equal(nextHalfOf(three, 'middle')?.key, 'lower')
  assert.equal(nextHalfOf(three, 'lower'), undefined)
  assert.equal(nextHalfOf(two, 'middle'), undefined, '兩段版本沒有中半，也就沒有「中半的下一段」')
})

test('halfLabel：不認得的鍵退回上半（與 targetHalf ?? upper 的預設一致）', () => {
  assert.equal(halfLabel('middle'), '中半')
  assert.equal(halfLabel(undefined), '上半')
  assert.equal(halfLabel('???'), '上半')
  assert.equal(isHalfKey('middle'), true)
  assert.equal(isHalfKey('mid'), false)
})
