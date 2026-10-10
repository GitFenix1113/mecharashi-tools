// 換頁捲動策略的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrollActionFor, rememberPosition } from './scrollPolicy.ts'

const base = { prevPathname: '/mechs', pathname: '/mechs/mech_034_復仇女神', hash: '', savedY: undefined }

test('從圖鑑點進詳情頁（PUSH、路徑變了）⇒ 回到頂端 —— 本檔存在的理由', () => {
  assert.deepEqual(scrollActionFor({ ...base, navType: 'PUSH' }), { kind: 'top' })
})

test('上一頁回到圖鑑（POP）⇒ 回到離開時的位置，而不是頂端', () => {
  assert.deepEqual(
    scrollActionFor({ ...base, navType: 'POP', prevPathname: '/mechs/x', pathname: '/mechs', savedY: 1480 }),
    { kind: 'restore', y: 1480 },
  )
})

test('POP 但沒有記錄（第一次載入）⇒ 不動，交給瀏覽器', () => {
  assert.deepEqual(scrollActionFor({ ...base, navType: 'POP' }), { kind: 'none' })
})

test('只改 ?query（機師詳情頁的 ?tab=、圖鑑篩選）⇒ 不動', () => {
  assert.deepEqual(
    scrollActionFor({ ...base, navType: 'PUSH', prevPathname: '/pilots/p1', pathname: '/pilots/p1' }),
    { kind: 'none' },
  )
})

test('REPLACE（時間線切換版本、故事館換章）⇒ 不動', () => {
  assert.deepEqual(
    scrollActionFor({ ...base, navType: 'REPLACE', prevPathname: '/versions/timeline/3.5', pathname: '/versions/timeline/3.6' }),
    { kind: 'none' },
  )
})

test('同一路由換參數（從機甲 A 的引用浮窗跳到機甲 B）⇒ 回到頂端', () => {
  assert.deepEqual(
    scrollActionFor({ ...base, navType: 'PUSH', prevPathname: '/mechs/a', pathname: '/mechs/b' }),
    { kind: 'top' },
  )
})

test('帶 #錨點 ⇒ 交給錨點（已解碼）', () => {
  assert.deepEqual(
    scrollActionFor({ ...base, navType: 'PUSH', hash: '#%E6%A9%9F%E9%AB%94' }),
    { kind: 'hash', id: '機體' },
  )
  // 只有一個 # 不算錨點
  assert.deepEqual(scrollActionFor({ ...base, navType: 'PUSH', hash: '#' }), { kind: 'top' })
})

test('記錄表：同 key 覆寫並移到最新、超過上限擠掉最舊、負值與小數收斂', () => {
  const m = new Map<string, number>()
  rememberPosition(m, 'a', 10, 2)
  rememberPosition(m, 'b', 20, 2)
  rememberPosition(m, 'a', 30.6, 2)          // a 變成最新
  rememberPosition(m, 'c', -5, 2)            // 擠掉最舊的 b
  assert.deepEqual([...m.entries()], [['a', 31], ['c', 0]])
})
