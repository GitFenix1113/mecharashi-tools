// 故事館編輯台的文字工具
//   node --test src/components/admin/lore/loreEditText.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chapterSections, cleanOcr, customSpeakerPresets, joinSections, makeChapterKey, mergeSoftWraps, middleSourceIssue, moveItem,
  normalizeCommentary, sectionIssues, splitSections,
} from './loreEditText.ts'

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

test('mergeSoftWraps：行內署名（—— 開頭的獨立行）不併上、也不吃下一行', () => {
  const text = '「我們再做決\n定。」\n——維斯珀爾內部通訊\n「在完善彌造者的過程中」'
  assert.equal(mergeSoftWraps(text), '「我們再做決定。」\n——維斯珀爾內部通訊\n「在完善彌造者的過程中」')
  // 上一行沒有句末標點時，署名也不能被併上去
  assert.equal(mergeSoftWraps('沒有句號的一行\n——某某日誌'), '沒有句號的一行\n——某某日誌')
})

// ── 引文段卡片（2026-10-15）─────────────────────────────────────────────────

const Q1 = '「能拿到解除限制的『遺產』都是你的功勞。」'
const Q2 = '「在完善彌造者的過程中，我重新解析了研究日誌。」'

test('splitSections：沒有行內署名 → 一張卡片，署名＝source', () => {
  assert.deepEqual(splitSections(`${Q1}\n第二段。`, '海莉絲研究日誌'), [{ body: `${Q1}\n第二段。`, source: '海莉絲研究日誌' }])
  assert.deepEqual(splitSections('', undefined), [{ body: '', source: '' }])
})

test('splitSections：淬鋒·凱登 PART 2 的兩出處結構 → 兩張卡片', () => {
  assert.deepEqual(splitSections(`${Q1}\n——維斯珀爾內部通訊\n${Q2}`, '海莉絲研究日誌'), [
    { body: Q1, source: '維斯珀爾內部通訊' },
    { body: Q2, source: '海莉絲研究日誌' },
  ])
})

test('splitSections ∘ joinSections 往返：資料 → 卡片 → 資料不變', () => {
  const cases: [string, string | undefined][] = [
    [`${Q1}\n第二段。`, '海莉絲研究日誌'],
    [`${Q1}\n——維斯珀爾內部通訊\n${Q2}`, '海莉絲研究日誌'],
    [`${Q1}\n——甲\n${Q2}\n——乙\n第三份。`, undefined],
    ['——開頭就是署名\n正文。', '結尾署名'],
    ['只有正文。', undefined],
  ]
  for (const [body, source] of cases) {
    assert.deepEqual(joinSections(splitSections(body, source)), { body, source }, body)
  }
})

test('joinSections ∘ splitSections 往返：卡片 → 資料 → 卡片不變（中間卡片都有署名時）', () => {
  const sections = [
    { body: Q1, source: '維斯珀爾內部通訊' },
    { body: '', source: '只有署名的卡片' },
    { body: `${Q2}\n第二段。`, source: '' },
  ]
  const { body, source } = joinSections(sections)
  assert.deepEqual(splitSections(body, source), sections)
})

test('joinSections：中間卡片沒署名 → 併入下一段（前台段落照樣分開）', () => {
  const joined = joinSections([{ body: Q1, source: '' }, { body: Q2, source: '海莉絲研究日誌' }])
  assert.deepEqual(joined, { body: `${Q1}\n${Q2}`, source: '海莉絲研究日誌' })
  assert.equal(splitSections(joined.body, joined.source).length, 1)
})

test('joinSections：署名開頭順手打的破折號拿掉、前後空白清掉；最後一張沒署名 → source undefined', () => {
  assert.deepEqual(joinSections([{ body: ` ${Q1}\n`, source: '—— 維斯珀爾內部通訊 ' }, { body: Q2, source: '  ' }]), {
    body: `${Q1}\n——維斯珀爾內部通訊\n${Q2}`,
    source: undefined,
  })
  assert.equal(joinSections([{ body: Q1, source: '——海莉絲研究日誌' }]).source, '海莉絲研究日誌')
})

test('middleSourceIssue：前台認得出的署名、空署名 → null；過長或含句末標點 → 說明', () => {
  assert.equal(middleSourceIssue('維斯珀爾內部通訊'), null)
  assert.equal(middleSourceIssue('——《沃爾特·紐曼相關恢復資料第13255條》'), null)
  assert.equal(middleSourceIssue('   '), null)
  assert.match(middleSourceIssue('長'.repeat(41)) ?? '', /40 字/)
  assert.match(middleSourceIssue('她說完了。') ?? '', /。！？/)
})

test('chapterSections：快取的序列化結果仍等於章節現值才沿用，否則重新切', () => {
  const sections = [{ body: Q1, source: '' }, { body: '', source: '' }] // 打字中：新增的空卡片
  const cache = { ...joinSections(sections), sections }
  assert.equal(chapterSections({ body: Q1, source: undefined }, cache), sections)
  // 正文被別處改掉（RefPicker 編譯、key 被新章撿走）→ 作廢
  assert.deepEqual(chapterSections({ body: Q2, source: undefined }, cache), [{ body: Q2, source: '' }])
  assert.deepEqual(chapterSections({ body: Q1, source: '新署名' }, cache), [{ body: Q1, source: '新署名' }])
  assert.deepEqual(chapterSections({ body: Q1, source: undefined }, undefined), [{ body: Q1, source: '' }])
})

test('sectionIssues：只查中間卡片，訊息帶章節標籤與卡片序號', () => {
  const bad = [{ body: Q1, source: '她說完了。' }, { body: Q2, source: '最後一張不受限制。' }]
  const chapters = [
    { key: 'part-1', title: '一', body: Q1 },
    { key: 'part-2', title: '二', ...joinSections(bad) },
  ]
  const issues = sectionIssues(chapters, { 'part-2': { ...joinSections(bad), sections: bad } })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /^PART 2 引文段 1：/)
  assert.deepEqual(sectionIssues(chapters, {}), []) // 沒編過的章節從資料切，切出來的必然合格
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
