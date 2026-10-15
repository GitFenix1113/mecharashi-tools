// 故事館進館漏斗（PLAN-062 Phase A）
//
// 漏斗算錯不會報錯、不會白畫面，只會讓「多少人真的讀下去」悄悄變成另一個數字。
// 計算既然是純函式，就把分母為 0、深連結、key 推導這幾個容易出錯的地方釘住。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LORE_OPEN_DATE, LORE_PAGE_KEYS, LORE_ROUTE_KEYS, loreFunnel, sinceLoreOpen } from './loreStats.ts'
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
