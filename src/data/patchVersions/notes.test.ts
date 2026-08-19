import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNotes } from './notes.ts'

test('normalizeNotes：未填回空陣列', () => {
  assert.deepEqual(normalizeNotes(undefined), [])
  assert.deepEqual(normalizeNotes(''), [])
})

test('normalizeNotes：舊的單一字串按換行拆成多條', () => {
  assert.deepEqual(
    normalizeNotes('【倉庫物品儲存上限提升】\n【常駐海運新增S級重型機甲】\r\n\n'),
    ['【倉庫物品儲存上限提升】', '【常駐海運新增S級重型機甲】'],
  )
})

test('normalizeNotes：陣列去掉空白項並修剪', () => {
  assert.deepEqual(normalizeNotes([' A ', '', '   ', 'B']), ['A', 'B'])
})
