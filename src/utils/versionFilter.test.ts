// 登場版本篩選的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersions, groupVersionsByMajor, matchesVersionFilter,
  majorFilterValue, majorOfFilter, isMajorFilter,
} from './versionFilter.ts'

test('分組：依大版本分、組與組內都是新 → 舊；重複與空字串濾掉', () => {
  const groups = groupVersionsByMajor(['1.0', '3.6', '2.8', '3.7', '1.0', '', '2.0', '3.0'])
  assert.deepEqual(groups, [
    { major: '3', versions: ['3.7', '3.6', '3.0'] },
    { major: '2', versions: ['2.8', '2.0'] },
    { major: '1', versions: ['1.0'] },
  ])
})

test('版本比較逐段比數字：3.10 比 3.9 新（parseFloat 會排反）', () => {
  assert.ok(compareVersions('3.10', '3.9') > 0)
  assert.ok(compareVersions('4.0', '3.10') > 0)
  assert.equal(compareVersions('3.6', '3.6'), 0)
  assert.deepEqual(groupVersionsByMajor(['3.9', '3.10'])[0].versions, ['3.10', '3.9'])
})

test('篩選值的三種形狀：全部／整個大版本／單一版本', () => {
  assert.equal(majorFilterValue('3'), '3.x')
  assert.equal(isMajorFilter('3.x'), true)
  assert.equal(isMajorFilter('3.6'), false)
  assert.equal(majorOfFilter('3.x'), '3')
  assert.equal(majorOfFilter('3.6'), '3')
  assert.equal(majorOfFilter(''), null)
})

test('比對：全部 ⇒ 都要（含沒有登場版本的）', () => {
  assert.equal(matchesVersionFilter('1.0', ''), true)
  assert.equal(matchesVersionFilter(undefined, ''), true)
})

test('比對：整個大版本 ⇒ 該大版本底下所有小版本；沒有登場版本的不算', () => {
  assert.equal(matchesVersionFilter('3.6', '3.x'), true)
  assert.equal(matchesVersionFilter('3.0', '3.x'), true)
  assert.equal(matchesVersionFilter('2.8', '3.x'), false)
  assert.equal(matchesVersionFilter(undefined, '3.x'), false)
  // 大版本 3 不會誤配 30.x 這種前綴相同的版本
  assert.equal(matchesVersionFilter('30.1', '3.x'), false)
})

test('比對：單一版本 ⇒ 完全相等', () => {
  assert.equal(matchesVersionFilter('3.6', '3.6'), true)
  assert.equal(matchesVersionFilter('3.7', '3.6'), false)
  assert.equal(matchesVersionFilter(null, '3.6'), false)
})
