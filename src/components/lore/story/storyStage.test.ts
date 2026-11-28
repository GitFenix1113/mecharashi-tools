// 選章舞台（PLAN-042-K）的純函式：焦點、滾輪接管與累積、大綱轉換
//   node --test src/components/lore/story/storyStage.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultFocus, focusIndex, outlineStages, PAGE_SCROLL_GRACE_MS, WHEEL_COOLDOWN_MS, WHEEL_IDLE, WHEEL_QUIET_MS, WHEEL_THRESHOLD,
  wheelCapture, wheelStep, type WheelState,
} from './storyStage.ts'
import { stageOutline, stagePath } from './storyNav.ts'

const ids = ['main-1', 'main-2', 'main-3']

test('focusIndex：網址優先、不認得就用 fallback，fallback 夾在範圍內', () => {
  assert.equal(focusIndex(ids, 'main-3', 0), 2)
  assert.equal(focusIndex(ids, 'main-99', 1), 1)
  assert.equal(focusIndex(ids, null, 7), 2)
  assert.equal(focusIndex(ids, null, -3), 0)
  assert.equal(focusIndex([], null, 0), 0)
})

test('defaultFocus：停在讀到的那本；讀完了跳下一本；都沒讀停第一本', () => {
  const books = [{ id: 'a', stages: 5 }, { id: 'b', stages: 4 }, { id: 'c', stages: 3 }]
  assert.equal(defaultFocus(books, () => 0), 0)
  assert.equal(defaultFocus(books, (id) => ({ a: 5, b: 2 } as Record<string, number>)[id] ?? 0), 1)
  assert.equal(defaultFocus(books, (id) => ({ a: 5, b: 4 } as Record<string, number>)[id] ?? 0), 2)
  // 最後一本讀完了也停在最後一本，不會超出
  assert.equal(defaultFocus(books, () => 99), 2)
  // 跳著讀：以「最後一本有進度的」為準
  assert.equal(defaultFocus(books, (id) => (id === 'c' ? 1 : 0)), 2)
})

test('wheelCapture：舞台沒完整出現、頁面還在捲、頭尾往外，都放行給頁面', () => {
  const base = { dir: 1 as const, index: 1, count: 3, fullyVisible: true, msSincePageScroll: 10_000 }
  assert.equal(wheelCapture(base), true)
  assert.equal(wheelCapture({ ...base, fullyVisible: false }), false)
  assert.equal(wheelCapture({ ...base, msSincePageScroll: PAGE_SCROLL_GRACE_MS - 1 }), false)
  assert.equal(wheelCapture({ ...base, msSincePageScroll: PAGE_SCROLL_GRACE_MS }), true)
  assert.equal(wheelCapture({ ...base, index: 2 }), false, '最後一章往下＝捲頁面')
  assert.equal(wheelCapture({ ...base, index: 2, dir: -1 }), true)
  assert.equal(wheelCapture({ ...base, index: 0, dir: -1 }), false, '第一章往上＝捲頁面')
})

test('wheelStep：累積到門檻才換一章、換向重算、冷卻中整個吞掉', () => {
  let s: WheelState = WHEEL_IDLE
  let r = wheelStep(s, WHEEL_THRESHOLD - 1, 1000)
  assert.equal(r.step, 0)
  s = r.state
  r = wheelStep(s, 1, 1010)
  assert.equal(r.step, 1, '累積到門檻')
  s = r.state
  // 冷卻中再大的量都不換章
  r = wheelStep(s, 500, 1010 + WHEEL_COOLDOWN_MS - 1)
  assert.equal(r.step, 0)
  assert.equal(r.state.acc, 0)
  // 滑鼠一格一格滾（間隔夠長）：冷卻結束就接受下一格
  r = wheelStep({ acc: 0, lockUntil: 1010 + WHEEL_COOLDOWN_MS }, 500, 1010 + WHEEL_COOLDOWN_MS)
  assert.equal(r.step, 1, '冷卻結束才接受下一次')
  // 換方向：前面往下累積的量不抵銷往上的
  s = { acc: 30, lockUntil: -Infinity }
  r = wheelStep(s, -20, 5000)
  assert.equal(r.state.acc, -20)
  r = wheelStep(r.state, -20, 5001)
  assert.equal(r.step, -1)
})

test('wheelStep：觸控板慣性（一秒內連續湧入的小量）整串只換一章', () => {
  let s: WheelState = WHEEL_IDLE
  let steps = 0
  // 一次滑動：每 16ms 一下、量從 60 慢慢衰減到 1，持續約 1.2 秒
  for (let t = 0, d = 60; t < 1200; t += 16, d = Math.max(1, d * 0.95)) {
    const r = wheelStep(s, d, t)
    s = r.state
    steps += Math.abs(r.step)
  }
  assert.equal(steps, 1)
  // 手勢停下（超過 WHEEL_QUIET_MS 沒有事件）之後，下一次滑動又能換一章
  const r = wheelStep(s, 60, 1200 + WHEEL_QUIET_MS + 1)
  assert.equal(r.step, 1)
})

test('outlineStages：轉成 storyNav 吃的關卡，路徑與遭遇戰收納照舊', () => {
  const stages = outlineStages([
    ['w101', '1-1', '醫療廢物', 0],
    ['w102', '', '遭遇戰', 0],
    ['w103', '1-2', '重圍', 0],
    ['w190', '', '支線一', 1],
  ])
  assert.equal(stagePath('main-2', stages, 0), '/lore/story/main-2')
  assert.equal(stagePath('main-2', stages, 2), '/lore/story/main-2/w103')
  const outline = stageOutline(stages)
  assert.deepEqual(outline.map((s) => s.key), ['main', 'branch'])
  assert.deepEqual(outline[0].entries.map((e) => [e.index, e.minors]), [[0, [1]], [2, []]])
  assert.equal(stages[3].branch, true)
  assert.equal('branch' in stages[0], false)
})
