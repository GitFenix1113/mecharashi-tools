import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateUnknownTypes,
  aggregateUnmatched,
  collectPendingFixes,
  missingFields,
  normalizeUnmatched,
} from './announcementInsights.ts'
import type { PatchVersion } from '../../data/patchVersions/types.ts'

// PLAN-048 Phase 2：「規則待擴充」彙總

test('missingFields：只認真正缺的欄位', () => {
  assert.deepEqual(missingFields({ name: 'A', startDate: '2026/08/06', weeks: 1, type: 'roulette' }), [])
  assert.deepEqual(missingFields({ name: 'A', startDate: '2026/08/06', type: 'roulette' }), ['週數'])
  assert.deepEqual(
    missingFields({ name: '', startDate: '2026/08/06', type: '' } as never),
    ['名稱', '週數', '型別'],
  )
  // weeks: 0 是缺失，但 hidden:false 不是 —— 別把布林欄位算進來
  assert.deepEqual(missingFields({ name: 'A', startDate: 'd', weeks: 1, type: 't', hidden: false }), [])
})

const VERSIONS = [
  {
    id: 'v3.3', version: '3.3',
    upper: {
      cnDate: '', twActivities: [
        { name: '正常', startDate: '2026/07/09', weeks: 1, type: 'roulette' },
        { name: '待補甲', startDate: '2026/07/09', type: 'specificPilotBanner', hidden: true, note: '待確認結束日' },
      ],
    },
    lower: {
      cnDate: '', twActivities: [
        { name: '待補乙', startDate: '2026/08/13', weeks: 2, type: 'limitedEvent', hidden: true },
      ],
    },
  },
] as unknown as (PatchVersion & { id?: string })[]

test('collectPendingFixes：撈出隱藏或缺長度的，新的排前面', () => {
  const fixes = collectPendingFixes(VERSIONS)
  assert.deepEqual(fixes.map(f => f.act.name), ['待補乙', '待補甲'])
  assert.equal(fixes[1].half, 'upper')
  assert.equal(fixes[1].versionId, 'v3.3')
  assert.deepEqual(fixes[1].missing, ['週數'])
  // 已標 hidden 但欄位其實齊全的，也要列出來（不然它會永遠藏著沒人記得放行）
  assert.deepEqual(fixes[0].missing, [])
})

test('normalizeUnmatched：抹掉每則必然不同的部分，留下句子骨架', () => {
  // 卡池標題的主題名與職業每則都不同，但那組文法我們已經知道怎麼拆 —— 一起正規化掉，
  // 兩則「即將結束」通知才併得起來
  const a = normalizeUnmatched('【特選】星途無終 – S級調構師「海莉絲」及【跨域海運】即將結束')
  const b = normalizeUnmatched('【特選】千機巧弈 – S級機械師「唐小葵」及【角雕特遣】即將結束')
  assert.equal(a, b, a + ' vs ' + b)

  assert.equal(normalizeUnmatched('2026/08/13(四) 04:50:00起'), '⟨日期⟩(四) ⟨時刻⟩起')
  assert.equal(
    normalizeUnmatched('對於每個獨立的【跨域海運】,首次S級整機或4個嵐質框體的保障購置次數為9'),
    '對於每個獨立的【⟨名稱⟩】,首次S級整機或⟨數⟩個嵐質框體的保障購置次數為⟨數⟩',
  )
  // 不同句型不可以被併在一起
  assert.notEqual(
    normalizeUnmatched('危境重構商店新增「憑證IV」'),
    normalizeUnmatched('【邊境自貿地】'),
  )
})

test('aggregateUnmatched：重複的句型排前面，只出現一次的不吵人', () => {
  const groups = aggregateUnmatched([
    { id: 'tw_1', unmatched: ['【甲池】補充說明', '【邊境自貿地】'] },
    { id: 'tw_2', unmatched: ['【乙池】補充說明'] },
    { id: 'tw_3', unmatched: ['【丙池】補充說明'] },
    { id: 'tw_4', unmatched: [] },
    { id: 'tw_5' },
  ])
  assert.equal(groups[0].pattern, '【⟨名稱⟩】補充說明')
  assert.equal(groups[0].count, 3, '碰到三次的句型要排最前面 —— 那才是值得加規則的')
  assert.equal(groups[0].samples.length, 3)
  assert.deepEqual(groups[0].draftIds, ['tw_1', 'tw_2', 'tw_3'])

  // 只出現一次的預設不列（minCount=2）：滿頁雜訊等於沒有清單
  assert.ok(!groups.some(g => g.samples.includes('【邊境自貿地】')))
  assert.ok(
    aggregateUnmatched([{ id: 'x', unmatched: ['【邊境自貿地】'] }], { minCount: 1 }).length > 0,
  )

  // 樣本上限 3，不該無限累積
  const many = aggregateUnmatched([
    { id: 'x', unmatched: Array.from({ length: 5 }, (_, i) => `【第${i}項】補充說明`) },
  ])
  assert.equal(many[0].count, 5)
  assert.equal(many[0].samples.length, 3)
})

test('aggregateUnknownTypes：只收未登錄的，依次數排序', () => {
  const isKnown = (t: string) => ['roulette', 'limitedEvent'].includes(t)
  const gaps = aggregateUnknownTypes([
    { extracted: { type: 'roulette' } },
    { extracted: { type: '星海拓荒祭', typeLabel: '星海拓荒祭' } },
    { extracted: { type: '星海拓荒祭', typeLabel: '星海拓荒祭' } },
    { extracted: { type: 'limitedEvent' } },
    { extracted: {}, rawTypeLabel: '特殊活動' },
  ], isKnown)
  assert.deepEqual(gaps, [
    { label: '星海拓荒祭', count: 2 },
    { label: '特殊活動', count: 1 },
  ])
})

test('計畫書的升級觸發點：未登錄型別穩定超過 20 種才開新集合', () => {
  const gaps = aggregateUnknownTypes(
    Array.from({ length: 25 }, (_, i) => ({ extracted: { type: `t${i}`, typeLabel: `型別${i}` } })),
    () => false,
  )
  assert.equal(gaps.length, 25)
  assert.ok(gaps.length > 20, '這張表就是拿來判斷有沒有到門檻的')
})
