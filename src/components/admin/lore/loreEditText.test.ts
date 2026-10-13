// 故事館編輯台的文字工具
//   node --test src/components/admin/lore/loreEditText.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanOcr, makeChapterKey, mergeSoftWraps, moveItem } from './loreEditText.ts'

test('makeChapterKey：從章數＋1 起跳，跳過已用號碼（不撿回刪掉的舊號碼）', () => {
  assert.equal(makeChapterKey([]), 'part-1')
  assert.equal(makeChapterKey([{ key: 'part-1' }, { key: 'part-2' }]), 'part-3')
  // 刪掉 part-2 後剩兩章 → 從 part-3 起跳，part-3 已被用 → part-4
  assert.equal(makeChapterKey([{ key: 'part-1' }, { key: 'part-3' }]), 'part-4')
})

test('cleanOcr：換行正規化、去頭尾（含全形）空白、三個以上換行收成一個空行', () => {
  assert.equal(cleanOcr('\u3000\u3000第一行  \r\n第二行\r\n\r\n\r\n\r\n第三行\n'), '第一行\n第二行\n\n第三行')
})

test('mergeSoftWraps：非句末的行尾接回下一行；空行與句末標點保留', () => {
  assert.equal(mergeSoftWraps('本質是什\n麼。\n\n她說：\n「走吧」'), '本質是什麼。\n\n她說：\n「走吧」')
})

test('moveItem：互換、越界原樣回傳', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b'])
  const list = ['a', 'b']
  assert.equal(moveItem(list, 0, -1), list)
  assert.equal(moveItem(list, 1, 1), list)
})
