// PLAN-048 Phase 0（任務 0-6）：活動衍生狀態守衛測試
// 重點守 exclusive 結束日 —— 一日之差是本計畫最可能的 bug 型態。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityStatus } from './activityStatus.ts'
import type { TimedActivity } from '../../data/patchVersions/types.ts'

/** 2026/08/06（週四）起 3 週 → 最後一天是 8/26（週三），8/27 00:00 結束 */
const ACT: TimedActivity = { name: '瑞歲百角戲', startDate: '2026/08/06', weeks: 3, type: 'limitedEvent' }

test('endExclusive = 起始日 + weeks*7 天', () => {
  const st = activityStatus(ACT, new Date(2026, 7, 10))
  assert.equal(st.endExclusive.getTime(), new Date(2026, 7, 27).getTime())
  assert.equal(st.totalWeeks, 3)
})

test('開始前一天是 upcoming，開始當天就是 ongoing', () => {
  assert.equal(activityStatus(ACT, new Date(2026, 7, 5)).phase, 'upcoming')
  assert.equal(activityStatus(ACT, new Date(2026, 7, 6)).phase, 'ongoing')
})

test('最後一天仍是 ongoing，隔天才是 ended（exclusive 的關鍵邊界）', () => {
  assert.equal(activityStatus(ACT, new Date(2026, 7, 26)).phase, 'ongoing', '8/26 是最後一天')
  assert.equal(activityStatus(ACT, new Date(2026, 7, 27)).phase, 'ended', '8/27 才結束')
})

test('weekIndex 是 1-based，且在週界正確跳格', () => {
  assert.equal(activityStatus(ACT, new Date(2026, 7, 6)).weekIndex, 1)
  assert.equal(activityStatus(ACT, new Date(2026, 7, 12)).weekIndex, 1, '8/12 仍是第 1 週最後一天')
  assert.equal(activityStatus(ACT, new Date(2026, 7, 13)).weekIndex, 2, '8/13 進第 2 週')
  assert.equal(activityStatus(ACT, new Date(2026, 7, 20)).weekIndex, 3)
})

test('daysLeft 含今天：最後一天剩 1 天', () => {
  assert.equal(activityStatus(ACT, new Date(2026, 7, 26)).daysLeft, 1)
  assert.equal(activityStatus(ACT, new Date(2026, 7, 25)).daysLeft, 2)
  assert.equal(activityStatus(ACT, new Date(2026, 7, 6)).daysLeft, 21)
})

test('非進行中時 weekIndex / daysLeft 歸零，不輸出誤導數字', () => {
  const up = activityStatus(ACT, new Date(2026, 7, 1))
  assert.equal(up.weekIndex, 0)
  assert.equal(up.daysLeft, 0)
  const ended = activityStatus(ACT, new Date(2026, 8, 10))
  assert.equal(ended.weekIndex, 0)
  assert.equal(ended.daysLeft, 0)
})

test('isFinalWeek 只在最後一週為真', () => {
  assert.equal(activityStatus(ACT, new Date(2026, 7, 12)).isFinalWeek, false)
  assert.equal(activityStatus(ACT, new Date(2026, 7, 20)).isFinalWeek, true)
  assert.equal(activityStatus(ACT, new Date(2026, 7, 26)).isFinalWeek, true)
  assert.equal(activityStatus(ACT, new Date(2026, 7, 27)).isFinalWeek, false, '已結束不算末週')
})

test('一週活動：第 1 週即末週', () => {
  const one: TimedActivity = { ...ACT, weeks: 1 }
  const st = activityStatus(one, new Date(2026, 7, 6))
  assert.equal(st.weekIndex, 1)
  assert.equal(st.isFinalWeek, true)
  assert.equal(st.daysLeft, 7)
})

test('progress 夾在 0–1，結束後固定為 1', () => {
  assert.equal(activityStatus(ACT, new Date(2026, 7, 1)).progress, 0, '未開始不給負值')
  assert.equal(activityStatus(ACT, new Date(2026, 7, 6)).progress, 0)
  assert.equal(activityStatus(ACT, new Date(2026, 8, 10)).progress, 1)
  const mid = activityStatus(ACT, new Date(2026, 7, 16)).progress
  assert.ok(mid > 0 && mid < 1, `mid=${mid}`)
})

test('weeks<=0 視為 1 週，不產生負寬度或 NaN', () => {
  const st = activityStatus({ ...ACT, weeks: 0 }, new Date(2026, 7, 6))
  assert.equal(st.totalWeeks, 1)
  assert.equal(st.endExclusive.getTime(), new Date(2026, 7, 13).getTime())
})

test('同一天不同時刻結果相同（now 被正規化到當日 00:00）', () => {
  const a = activityStatus(ACT, new Date(2026, 7, 26, 0, 0, 1))
  const b = activityStatus(ACT, new Date(2026, 7, 26, 23, 59, 59))
  assert.equal(a.phase, b.phase)
  assert.equal(a.daysLeft, b.daysLeft)
})
