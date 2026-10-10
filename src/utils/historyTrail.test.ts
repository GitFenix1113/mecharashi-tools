// 「返回清單」決策的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backToListAction } from './historyTrail.ts'

test('從清單點進來（前一格就是清單）⇒ 等同上一頁，回到清單原本的位置', () => {
  assert.equal(backToListAction('/mechs', 3, '/mechs'), 'back')
})

test('清單上的篩選條件不影響判斷 —— 那正是要原樣帶回去的狀態', () => {
  assert.equal(backToListAction('/mechs?armor=%E4%B8%AD%E7%94%B2', 3, '/mechs'), 'back')
})

test('從別處進來（引用浮窗、另一個詳情頁）⇒ 開一份新的清單', () => {
  assert.equal(backToListAction('/pilots/pilot_049_海莉絲', 3, '/mechs'), 'push')
  assert.equal(backToListAction('/mechs/mech_034_復仇女神', 3, '/mechs'), 'push')   // 機甲 A → 機甲 B
})

test('第一格（直接用網址打開詳情頁）或不知道前一格 ⇒ 開一份新的清單，絕不 navigate(-1) 離開本站', () => {
  assert.equal(backToListAction('/mechs', 0, '/mechs'), 'push')
  assert.equal(backToListAction(undefined, 2, '/mechs'), 'push')
})

test('路徑前綴相同但不是同一頁 ⇒ 不算（/mechs 不等於 /mechs/xxx）', () => {
  assert.equal(backToListAction('/mechsx', 1, '/mechs'), 'push')
})
