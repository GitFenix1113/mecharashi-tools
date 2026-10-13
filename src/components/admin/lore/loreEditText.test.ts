// 故事館編輯台的文字工具
//   node --test src/components/admin/lore/loreEditText.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanOcr, customSpeakerPresets, makeChapterKey, mergeSoftWraps, moveItem, normalizeCommentary } from './loreEditText.ts'

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

test('customSpeakerPresets：同名合併（trim 後比對）、頭像取第一個有填的、常用的排前面', () => {
  const ch = (...commentary: { speakerId: string; speaker?: { name: string; art?: string }; text: string }[]) => ({ key: 'part-1', title: '', body: '', commentary })
  const docs = [
    { chapters: [ch({ speakerId: '', speaker: { name: '匿名使用者' }, text: 'a' }, { speakerId: 'pilot_001', text: '機師不算' })] },
    { chapters: [ch({ speakerId: '', speaker: { name: ' 匿名使用者 ', art: 'Pilot_99999' }, text: 'b' }, { speakerId: '', speaker: { name: '士兵' }, text: 'c' })] },
    { chapters: [ch({ speakerId: '', speaker: { name: '  ' }, text: '空名不算' })] },
    {},
  ]
  assert.deepEqual(customSpeakerPresets(docs), [{ name: '匿名使用者', art: 'Pilot_99999' }, { name: '士兵' }])
})

test('normalizeCommentary：名稱 trim、名稱與頭像都空就拿掉 speaker、機師列原樣', () => {
  assert.equal(normalizeCommentary(undefined), undefined)
  assert.equal(normalizeCommentary([]), undefined)
  assert.deepEqual(
    normalizeCommentary([
      { speakerId: '', speaker: { name: ' 匿名使用者 ', art: 'Pilot_99999' }, text: '卑劣的騙子。' },
      { speakerId: '', speaker: { name: '  ' }, text: '只剩文字' },
      { speakerId: '', speaker: { name: '', art: 'Pilot_19990A' }, text: '只有頭像' },
      { speakerId: 'pilot_001', text: '機師' },
    ]),
    [
      { speakerId: '', speaker: { name: '匿名使用者', art: 'Pilot_99999' }, text: '卑劣的騙子。' },
      { speakerId: '', text: '只剩文字' },
      { speakerId: '', speaker: { name: '', art: 'Pilot_19990A' }, text: '只有頭像' },
      { speakerId: 'pilot_001', text: '機師' },
    ],
  )
})
