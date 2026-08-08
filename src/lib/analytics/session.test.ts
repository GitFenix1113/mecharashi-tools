// 三層去重的核心邏輯（PLAN-046 決策二）
//
// 為什麼值得測：這是整個計畫唯一「算錯了也不會有人發現」的地方 —— 去重壞掉不會報錯、
// 不會白畫面，只會讓數字悄悄變成另一個意思（UPV 漂回 PV，或造訪數灌水好幾倍），
// 而你會拿那個數字去決定要改哪一頁。
//
// 手動驗證的成本又特別高：要驗「閒置 10 分鐘後開新 session」得真的等 10 分鐘，
// 要驗跨日得等到半夜。判定既然已抽成純函式，就用測試把全部情境一次釘死。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IDLE_MS,
  REPORTED_MAX,
  dayKey,
  markReported,
  nextState,
  type AnalyticsState,
} from './session.ts'

/** 固定序號的 id 產生器，讓「有沒有換 session」在斷言裡看得出來。 */
function seqGen() {
  let n = 0
  return () => `id-${++n}`
}

/** 2026-08-08 12:00 台北時間 = 04:00 UTC */
const NOON = Date.UTC(2026, 7, 8, 4, 0, 0)

test('首次造訪：開 session、算一個新訪客', () => {
  const r = nextState(null, NOON, seqGen())
  assert.equal(r.isNewSession, true)
  assert.equal(r.isNewVisitorToday, true)
  assert.equal(r.state.visitorId, 'id-1')
  assert.equal(r.state.sessionId, 'id-2')
  assert.deepEqual(r.state.reported, [])
})

test('閒置未逾時：沿用同一個 session，不重複計造訪與訪客', () => {
  const first = nextState(null, NOON, seqGen()).state
  markReported(first, 'pilots')

  const r = nextState(first, NOON + 9 * 60 * 1000, seqGen())
  assert.equal(r.isNewSession, false)
  assert.equal(r.isNewVisitorToday, false)
  assert.equal(r.state.sessionId, first.sessionId)
  // 已回報清單必須留著 —— 這正是「來回點擊不重複計 UPV」賴以成立的狀態
  assert.deepEqual(r.state.reported, ['pilots'])
})

test('閒置逾 10 分鐘：換新 session 並清空已回報清單', () => {
  const first = nextState(null, NOON, seqGen()).state
  markReported(first, 'pilots')

  const r = nextState(first, NOON + IDLE_MS + 1, seqGen())
  assert.equal(r.isNewSession, true)
  assert.notEqual(r.state.sessionId, first.sessionId)
  // 清空是刻意的：離開 10 分鐘再回來看同一頁，那確實是新的一次查詢
  assert.deepEqual(r.state.reported, [])
  // 但同一天內回來，不該再算一個新訪客
  assert.equal(r.isNewVisitorToday, false)
})

test('跨日：即使剛剛才有互動也強制斷 session，並重新計一個當日訪客', () => {
  const late = Date.UTC(2026, 7, 8, 15, 59, 0) // 台北 23:59
  const first = nextState(null, late, seqGen()).state
  markReported(first, 'pilots')

  const justAfterMidnight = Date.UTC(2026, 7, 8, 16, 1, 0) // 台北隔日 00:01，只隔 2 分鐘
  const r = nextState(first, justAfterMidnight, seqGen())

  assert.equal(r.isNewSession, true, '不斷的話凌晨的瀏覽會被寫進前一天的文件')
  assert.equal(r.isNewVisitorToday, true, '新的一天要重新計 UV')
  assert.deepEqual(r.state.reported, [])
  assert.equal(r.state.lastSeenDate, '2026-08-09')
})

test('visitorId 跨 session、跨日都不變（它識別的是裝置不是造訪）', () => {
  const gen = seqGen()
  const first = nextState(null, NOON, gen).state
  const second = nextState(first, NOON + IDLE_MS + 1, gen).state
  const nextDay = nextState(second, NOON + 24 * 60 * 60 * 1000, gen).state

  assert.equal(second.visitorId, first.visitorId)
  assert.equal(nextDay.visitorId, first.visitorId)
  assert.notEqual(nextDay.sessionId, first.sessionId)
})

test('markReported：同一頁只回 true 一次', () => {
  const s: AnalyticsState = {
    visitorId: 'v', sessionId: 's', lastActiveAt: 0, lastSeenDate: '', reported: [],
  }
  assert.equal(markReported(s, 'pilots'), true, '第一次瀏覽 → 計入 UPV')
  assert.equal(markReported(s, 'pilots'), false, '來回點擊回到同一頁 → 不再計入')
  assert.equal(markReported(s, 'pilots_detail'), true, '不同頁互不影響')
  assert.deepEqual(s.reported, ['pilots', 'pilots_detail'])
})

test('markReported：達到上限後停止累積，避免 localStorage 無限成長', () => {
  const s: AnalyticsState = {
    visitorId: 'v', sessionId: 's', lastActiveAt: 0, lastSeenDate: '', reported: [],
  }
  for (let i = 0; i < REPORTED_MAX; i++) markReported(s, `p${i}`)
  assert.equal(s.reported.length, REPORTED_MAX)
  assert.equal(markReported(s, 'overflow'), false)
  assert.equal(s.reported.length, REPORTED_MAX, '超過上限不再增加')
})

test('dayKey 以台北時間切日（UTC+8），與 Worker 端的文件日期一致', () => {
  // UTC 15:59:59 = 台北 23:59:59 → 仍算前一天
  assert.equal(dayKey(Date.UTC(2026, 7, 8, 15, 59, 59)), '2026-08-08')
  // UTC 16:00:00 = 台北隔日 00:00:00 → 換日
  assert.equal(dayKey(Date.UTC(2026, 7, 8, 16, 0, 0)), '2026-08-09')
  // 兩端若不一致，台灣早上 7 點的瀏覽會被前端當新的一天、卻寫進昨天的文件
  assert.equal(dayKey(Date.UTC(2026, 7, 8, 23, 0, 0)), '2026-08-09')
})
