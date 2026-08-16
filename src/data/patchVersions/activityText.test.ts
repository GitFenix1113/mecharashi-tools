// PLAN-048 Phase 0（任務 0-6）：活動名稱／獎勵拆解守衛測試
// 守的是「寧可少抽，也不要把機制說明顯示成獎勵」這條保守規則。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitActivityName } from './activityText.ts'

test('形狀一：括號內是「名稱*數量」→ 拆成獎勵 chip', () => {
  const r = splitActivityName({ name: '瑞歲百角戲(輕型通用改裝模組*1 仿生超導體*2)' })
  assert.equal(r.base, '瑞歲百角戲')
  assert.deepEqual(r.rewards, ['輕型通用改裝模組×1', '仿生超導體×2'])
})

test('全形括號與全形星號同樣支援', () => {
  const r = splitActivityName({ name: '王牌協議（專屬超導體＊1）' })
  assert.equal(r.base, '王牌協議')
  assert.deepEqual(r.rewards, ['專屬超導體×1'])
})

test('形狀二：括號是外觀名／復刻註記 → 整串保留為名稱', () => {
  const a = splitActivityName({ name: '白夜凍鋒（復刻）' })
  assert.equal(a.base, '白夜凍鋒（復刻）')
  assert.deepEqual(a.rewards, [])

  const b = splitActivityName({ name: '維娜外觀（夜話邀約）' })
  assert.equal(b.base, '維娜外觀（夜話邀約）')
  assert.deepEqual(b.rewards, [])
})

test('形狀三：括號是機制說明 → 不可誤判成獎勵', () => {
  const r = splitActivityName({ name: '限時商店(體力轉票券商店)' })
  assert.equal(r.base, '限時商店(體力轉票券商店)')
  assert.deepEqual(r.rewards, [])
})

test('形狀四：空括號 → 整串保留，不炸', () => {
  const r = splitActivityName({ name: '角雕輪盤()' })
  assert.equal(r.base, '角雕輪盤()')
  assert.deepEqual(r.rewards, [])
})

test('沒有括號的一般名稱原樣通過', () => {
  const r = splitActivityName({ name: '跨域海運' })
  assert.equal(r.base, '跨域海運')
  assert.deepEqual(r.rewards, [])
})

test('rewards 欄位已填時一律以欄位為準，且名稱去掉括號段', () => {
  const r = splitActivityName({
    name: '瑞歲百角戲(輕型通用改裝模組*1)',
    rewards: ['官方登錄的獎勵×3'],
  })
  assert.equal(r.base, '瑞歲百角戲')
  assert.deepEqual(r.rewards, ['官方登錄的獎勵×3'])
})

test('rewards 已填但名稱無括號時，名稱不被破壞', () => {
  const r = splitActivityName({ name: '跨域海運', rewards: ['芯片×5'] })
  assert.equal(r.base, '跨域海運')
  assert.deepEqual(r.rewards, ['芯片×5'])
})

test('rewards 為空陣列時走 fallback 解析，不當成「已填」', () => {
  const r = splitActivityName({ name: '瑞歲百角戲(改裝模組*1)', rewards: [] })
  assert.deepEqual(r.rewards, ['改裝模組×1'])
})

test('頓號／逗號分隔也切得開，數量符號一律正規化為 ×', () => {
  const r = splitActivityName({ name: '活動(甲*1、乙x2，丙×3)' })
  assert.deepEqual(r.rewards, ['甲×1', '乙×2', '丙×3'])
})

test('只要括號內含任一「符號+數字」就整段當獎勵解析', () => {
  // 混雜型：這是保守規則的已知取捨 —— 寧可把說明一起切進來，
  // 也不要因為有一項不像獎勵就整組放棄。
  const r = splitActivityName({ name: '活動(登入7天 芯片*10)' })
  assert.deepEqual(r.rewards, ['登入7天', '芯片×10'])
})

test('前後空白不影響判定', () => {
  const r = splitActivityName({ name: '  瑞歲百角戲 ( 改裝模組*1 )  ' })
  assert.equal(r.base, '瑞歲百角戲')
  assert.deepEqual(r.rewards, ['改裝模組×1'])
})
