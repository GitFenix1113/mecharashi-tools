// 故事館統計（PLAN-062）：Phase A 進館漏斗、Phase D 章節留存
//
// 漏斗算錯不會報錯、不會白畫面，只會讓「多少人真的讀下去」悄悄變成另一個數字。
// 計算既然是純函式，就把分母為 0、深連結、key 推導這幾個容易出錯的地方釘住。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LORE_OPEN_DATE,
  LORE_PAGE_KEYS,
  LORE_ROUTE_KEYS,
  chapterRetention,
  loreFunnel,
  sinceLoreOpen,
  type RetentionDoc,
} from './loreStats.ts'
import { ROUTE_LABELS } from './routeKeys.ts'

test('LORE_ROUTE_KEYS：由路由樣板推導，且三個都有中文頁名', () => {
  assert.deepEqual(LORE_ROUTE_KEYS, {
    home: 'lore',
    file: 'lore_pilots_detail',
    chapter: 'lore_pilots_detail_detail',
  })
  for (const key of LORE_PAGE_KEYS) assert.ok(ROUTE_LABELS[key], `${key} 沒有頁名`)
})

test('loreFunnel：沒有任何資料時三段為 0、比例為 null（不是 0% 也不是 NaN）', () => {
  const f = loreFunnel({})
  assert.deepEqual(f.home, { pv: 0, upv: 0 })
  assert.deepEqual(f.file, { pv: 0, upv: 0 })
  assert.deepEqual(f.chapter, { pv: 0, upv: 0 })
  assert.equal(f.share, null)
  assert.equal(f.fileToChapter, null)
  assert.equal(f.filesPerVisit, null)
  assert.equal(f.chaptersPerVisit, null)
})

test('loreFunnel：一般情況的三段與各比例', () => {
  const f = loreFunnel({
    home: { pv: 300, upv: 110 },
    lore: { pv: 50, upv: 40 },
    lore_pilots_detail: { pv: 120, upv: 30 },
    lore_pilots_detail_detail: { pv: 90, upv: 20 },
  })
  assert.deepEqual(f.home, { pv: 50, upv: 40 })
  // 故事館 UPV 40+30+20 = 90，全站 110+90 = 200
  assert.equal(f.share, 0.45)
  assert.equal(f.fileToChapter, 20 / 30)
  assert.equal(f.filesPerVisit, 4)
  assert.equal(f.chaptersPerVisit, 4.5)
})

test('loreFunnel：只有其他頁面有流量時，故事館佔比是 0 而不是 null', () => {
  const f = loreFunnel({ home: { pv: 10, upv: 8 } })
  assert.equal(f.share, 0)
  assert.equal(f.fileToChapter, null)
})

test('loreFunnel：深連結讓章節 UPV 多於扉頁時照實回傳，不夾到 100%', () => {
  const f = loreFunnel({
    lore_pilots_detail: { pv: 10, upv: 10 },
    lore_pilots_detail_detail: { pv: 30, upv: 15 },
  })
  assert.equal(f.fileToChapter, 1.5)
})

test('loreFunnel：有章節卻沒有扉頁（全是深連結）時，扉頁 → 章節為 null', () => {
  const f = loreFunnel({ lore_pilots_detail_detail: { pv: 4, upv: 2 } })
  assert.equal(f.fileToChapter, null)
  assert.equal(f.chaptersPerVisit, 2)
})

test('sinceLoreOpen：只留正式開放日（含）之後的日子，順序不變', () => {
  const days = [{ date: '2026-10-11' }, { date: '2026-10-12' }, { date: LORE_OPEN_DATE }, { date: '2026-10-14' }]
  assert.deepEqual(sinceLoreOpen(days).map((d) => d.date), [LORE_OPEN_DATE, '2026-10-14'])
  assert.deepEqual(sinceLoreOpen([{ date: '2026-09-30' }]), [])
})

// ── 章節留存 ──────────────────────────────────────────────────────────────

const doc = (id: string, name: string, keys: string[]): RetentionDoc => ({
  id,
  name,
  chapters: keys.map((key) => ({ key, title: `${name} ${key}` })),
})

test('chapterRetention：依真實章節順序列出各章讀者數與佔打開的比例', () => {
  const { rows, belowMin } = chapterRetention(
    { 'pilot_049_海莉絲': 10 },
    { 'pilot_049_海莉絲--part-1': 8, 'pilot_049_海莉絲--part-2': 5 },
    [doc('pilot_049_海莉絲', '海莉絲', ['part-1', 'part-2', 'part-3'])],
  )
  assert.equal(belowMin, 0)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, '海莉絲')
  assert.equal(rows[0].opens, 10)
  assert.deepEqual(
    rows[0].chapters.map((c) => [c.label, c.readers, c.rate]),
    [['PART 1', 8, 0.8], ['PART 2', 5, 0.5], ['PART 3', 0, 0]],
  )
})

test('chapterRetention：不存在的章節（已刪除、手打錯網址）與草稿章不顯示', () => {
  // 呼叫端傳進來的 chapters 已經濾掉草稿；統計裡的 part-9、garbage 對不到真實章節
  const { rows } = chapterRetention(
    { a: 5 },
    { 'a--part-1': 4, 'a--part-9': 3, 'a--garbage': 1, 'not-a-chapter-id': 2 },
    [doc('a', 'A', ['part-1'])],
  )
  assert.deepEqual(rows[0].chapters.map((c) => c.key), ['part-1'])
})

test('chapterRetention：章節自訂標籤優先，未設定時依已發布順序產生 PART n', () => {
  const { rows } = chapterRetention({ a: 3 }, {}, [
    { id: 'a', chapters: [{ key: 'part-2', title: 'x' }, { key: 'part-5', label: '終章', title: 'y' }] },
  ])
  assert.deepEqual(rows[0].chapters.map((c) => c.label), ['PART 1', '終章'])
  assert.equal(rows[0].name, 'a', '故事資料沒有名字時退回 id')
})

test('chapterRetention：未達門檻的機師計入 belowMin；沒有章節或已不存在的機師不列也不計', () => {
  const { rows, belowMin } = chapterRetention(
    { a: 9, b: 2, c: 7, gone: 50, empty: 20 },
    {},
    [doc('a', 'A', ['part-1']), doc('b', 'B', ['part-1']), doc('c', 'C', ['part-1']), doc('empty', 'E', [])],
  )
  assert.deepEqual(rows.map((r) => r.pilotId), ['a', 'c'], '依打開次數由多到少')
  assert.equal(belowMin, 1)
})

test('chapterRetention：月文件還沒有故事館類別時回空結果，不拋錯', () => {
  assert.deepEqual(chapterRetention(undefined, undefined, [doc('a', 'A', ['part-1'])]), { rows: [], belowMin: 0 })
})
