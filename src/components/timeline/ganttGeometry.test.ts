// PLAN-048 Phase 0（任務 0-6）：甘特幾何守衛測試
//   npm test   →   node --test "src/**/*.test.ts"
// 本檔已從 tsconfig.app build 排除，不影響 vite/tsc 打包。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityGeometry, todayPct, parseDate, addDays, DAY_MS } from './ganttGeometry.ts'
import type { TimedActivity } from '../../data/patchVersions/types.ts'

/** 2026/08/06 起連續 7 週（皆為週四），對應 v3.5 的軸 */
const WEEKS = Array.from({ length: 7 }, (_, i) => addDays(parseDate('2026/08/06'), i * 7))

function act(startDate: string, weeks: number): TimedActivity {
  return { name: 'x', startDate, weeks, type: 'limitedEvent' }
}

test('parseDate 容忍前綴文字與兩種分隔符', () => {
  assert.equal(parseDate('2026/08/06').getTime(), new Date(2026, 7, 6).getTime())
  assert.equal(parseDate('2026-08-06').getTime(), new Date(2026, 7, 6).getTime())
  assert.equal(parseDate('約 2026/08/06').getTime(), new Date(2026, 7, 6).getTime())
})

test('一週活動有實寬，不會塌成 0（舊版只畫得出一個點的成因）', () => {
  const g = activityGeometry(act('2026/08/06', 1), WEEKS)
  assert.ok(g)
  assert.equal(g.leftPct, 0)
  // 1 週 / 7 週 = 1/7
  assert.ok(Math.abs(g.widthPct - 100 / 7) < 1e-9, `widthPct=${g.widthPct}`)
  assert.ok(g.widthPct > 0)
})

test('週內起始保留日精度，不再量化到下一個週界', () => {
  // 8/09 是週日，落在第一欄第 4 天 → 3/49 ≈ 6.12%
  const g = activityGeometry(act('2026/08/09', 1), WEEKS)
  assert.ok(g)
  assert.ok(Math.abs(g.leftPct - (3 / 49) * 100) < 1e-9, `leftPct=${g.leftPct}`)
  assert.notEqual(g.leftPct, 0)
})

test('結束時刻是 exclusive：weeks=1 佔滿整整 7 天、不多不少', () => {
  const g = activityGeometry(act('2026/08/06', 1), WEEKS)
  assert.ok(g)
  const days = (g.widthPct / 100) * 49
  assert.ok(Math.abs(days - 7) < 1e-9, `days=${days}`)
})

test('跨越整條軸的活動（戰令）左右都切平', () => {
  const g = activityGeometry(act('2026/07/01', 20), WEEKS)
  assert.ok(g)
  assert.equal(g.leftPct, 0)
  assert.equal(g.widthPct, 100)
  assert.equal(g.clipStart, true)
  assert.equal(g.clipEnd, true)
})

test('完全落在軸外回 null（前後皆是）', () => {
  assert.equal(activityGeometry(act('2026/06/01', 1), WEEKS), null)
  assert.equal(activityGeometry(act('2027/01/01', 1), WEEKS), null)
})

test('剛好貼著軸尾結束的活動不算軸外', () => {
  const g = activityGeometry(act('2026/09/17', 1), WEEKS)
  assert.ok(g, '9/17 起算 1 週，末端正好等於軸尾，應該畫得出來')
  assert.ok(Math.abs(g.leftPct + g.widthPct - 100) < 1e-9)
})

test('空週軸回 null，不拋錯', () => {
  assert.equal(activityGeometry(act('2026/08/06', 1), []), null)
})

test('weeks 為 0 或負數時仍給最小可見寬度', () => {
  const g = activityGeometry(act('2026/08/06', 0), WEEKS)
  assert.ok(g)
  assert.ok(g.widthPct > 0)
})

test('leftPct + widthPct 永不超過 100', () => {
  for (let d = 0; d < 49; d++) {
    const start = new Date(WEEKS[0].getTime() + d * DAY_MS)
    const s = `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`
    const g = activityGeometry(act(s, 4), WEEKS)
    assert.ok(g, s)
    assert.ok(g.leftPct + g.widthPct <= 100 + 1e-9, `${s}: ${g.leftPct}+${g.widthPct}`)
  }
})

test('todayPct：軸內回百分比、軸外回 null', () => {
  assert.equal(todayPct(WEEKS, new Date(2026, 7, 6)), 0)
  assert.ok(Math.abs(todayPct(WEEKS, new Date(2026, 7, 13))! - (7 / 49) * 100) < 1e-9)
  assert.equal(todayPct(WEEKS, new Date(2026, 6, 1)), null)
  assert.equal(todayPct(WEEKS, new Date(2027, 0, 1)), null)
  assert.equal(todayPct([], new Date()), null)
})

test('todayPct 忽略時分秒（同一天不同時刻結果相同）', () => {
  const a = todayPct(WEEKS, new Date(2026, 7, 13, 0, 0, 0))
  const b = todayPct(WEEKS, new Date(2026, 7, 13, 23, 59, 59))
  assert.equal(a, b)
})
