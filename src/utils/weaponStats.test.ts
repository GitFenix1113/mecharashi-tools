// PLAN-040 D-1：naStats 渲染判定的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { naOr, isNaStat, NA_STAT_TEXT } from './weaponStats.ts'

test('沒有 naStats 的武器（既有 172 筆）一律原樣返回', () => {
  const w = {}
  assert.equal(naOr(w, 'attack', 876), 876)
  assert.equal(naOr(w, 'ammoCount', '∞'), '∞')
  assert.equal(isNaStat(w, 'attack'), false)
  // 空陣列與 undefined 同義，不得誤判成「全部不適用」
  assert.equal(naOr({ naStats: [] }, 'attack', 876), 876)
  assert.equal(isNaStat({ naStats: [] }, 'attack'), false)
})

test('列入 naStats 的欄位顯示「—」，未列入的照常顯示', () => {
  // 衝擊炮（Q1 定案）：五欄不適用，射程與彈藥量是真值
  const 衝擊炮 = { naStats: ['attack', 'accuracy', 'critValue', 'weight', 'kindCoefficient'] }
  assert.equal(naOr(衝擊炮, 'attack', 0), NA_STAT_TEXT)
  assert.equal(naOr(衝擊炮, 'accuracy', '0'), NA_STAT_TEXT)
  assert.equal(naOr(衝擊炮, 'critValue', '0'), NA_STAT_TEXT)
  assert.equal(naOr(衝擊炮, 'weight', 0), NA_STAT_TEXT)
  assert.equal(naOr(衝擊炮, 'kindCoefficient', '0.00'), NA_STAT_TEXT)
  // 真值不得被吃掉：ammoCount 1 可由戰術家［裝填］補充、射程 1-3 是實際值
  assert.equal(naOr(衝擊炮, 'ammoCount', 1), 1)
  assert.equal(naOr(衝擊炮, ['minRange', 'maxRange'], '1-3'), '1-3')
  assert.equal(naOr(衝擊炮, 'hitCount', 1), 1)
})

test('本計畫存在的理由：ammoCount 0 列入 naStats 時不得渲染成「∞」', () => {
  // 純封鎖型（嵐質儲能艙 / 多功能彈倉）：遊戲連數值區塊都不渲染
  const 純封鎖 = { naStats: ['kindCoefficient', 'attack', 'accuracy', 'critValue', 'minRange', 'maxRange', 'weight', 'ammoCount', 'hitCount'] }
  const 呼叫端寫法 = (w: { naStats?: string[] }, ammoCount: number) =>
    naOr(w, 'ammoCount', ammoCount === 0 ? '∞' : ammoCount)
  // DB 存 0（型別不變），但渲染必須是「—」而不是「無限彈藥」——
  // 後者是與遊戲相反的**肯定陳述**，正是決策七否決「填 0」的原因
  assert.equal(呼叫端寫法(純封鎖, 0), NA_STAT_TEXT)
  // 對照組：既有武器的 0 仍要顯示 ∞（172 筆中 129 筆靠這條規則）
  assert.equal(呼叫端寫法({}, 0), '∞')
  assert.equal(呼叫端寫法({}, 3), 3)
})

test('射程是 minRange + maxRange 合成，必須整組判斷', () => {
  // 任一列入即視為不適用，否則會渲染出「—-0」這種半真半假的字串
  assert.equal(naOr({ naStats: ['minRange'] }, ['minRange', 'maxRange'], '0-0'), NA_STAT_TEXT)
  assert.equal(naOr({ naStats: ['maxRange'] }, ['minRange', 'maxRange'], '0-0'), NA_STAT_TEXT)
  assert.equal(isNaStat({ naStats: ['minRange', 'maxRange'] }, ['minRange', 'maxRange']), true)
  // 射程適用時，射程型態才該一起顯示
  assert.equal(isNaStat({ naStats: ['attack'] }, ['minRange', 'maxRange']), false)
})

test('naStats 不影響同名以外的欄位（不做前綴或模糊比對）', () => {
  const w = { naStats: ['attack'] }
  assert.equal(naOr(w, 'attackSpeed', 5), 5)      // 不得被 'attack' 前綴命中
  assert.equal(naOr(w, 'accuracy', 3368), 3368)
  assert.equal(isNaStat(w, 'atta'), false)        // 不得被子字串命中
})
