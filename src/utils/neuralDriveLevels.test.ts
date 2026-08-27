// 神經驅動等級／算力門檻規則的測試 —— 2026-08-28
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這裡只測純函式。「全庫是否仍符合規則」由 `scripts/check-nd-minsum-drift.mjs`
// 的 ④ 規則檢查負責（連線正式 Firestore，涵蓋官方 API 對帳不到的 manual 機師）——
// 不做成 fixture 的理由：官方機師的 minSum 早已有逐級對帳官方 API 的守門，
// 再存一份快照只是把同一件事守兩遍，而快照會過期。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ND_MIN_SUM_BASE,
  ND_MIN_SUM_STEP,
  ndMinSumForLevel,
  ndZoneMaxLevel,
  expectedNdLevels,
  isNdMinSumOffRule,
  ndZoneOffRule,
} from './neuralDriveLevels.ts'

test('ndMinSumForLevel：1 起跳、每級 +3', () => {
  assert.equal(ND_MIN_SUM_BASE, 1)
  assert.equal(ND_MIN_SUM_STEP, 3)
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(ndMinSumForLevel), [1, 4, 7, 10, 13, 16])
})

test('ndMinSumForLevel：不合法的等級回 null，不回 0', () => {
  // minSum 0 在 PLAN-034 覆寫層是**零門檻恆真**（首屏即生效），
  // 讓它變成某個輸入的「合理輸出」等於把那個 bug 內建進規則。
  assert.equal(ndMinSumForLevel(0), null)
  assert.equal(ndMinSumForLevel(-1), null)
  assert.equal(ndMinSumForLevel(1.5), null)
  assert.equal(ndMinSumForLevel(NaN), null)
})

test('ndZoneMaxLevel：α β 三級、γ 系六級', () => {
  assert.equal(ndZoneMaxLevel('α'), 3)
  assert.equal(ndZoneMaxLevel('β'), 3)
  // γ 單區（10 位 B 級機師）與 γ1 / γ2（79 位）都是 6 級，故走前綴比對
  assert.equal(ndZoneMaxLevel('γ'), 6)
  assert.equal(ndZoneMaxLevel('γ1'), 6)
  assert.equal(ndZoneMaxLevel('γ2'), 6)
})

test('ndZoneMaxLevel：未知分區回 null —— 「不知道」不等於「0 級」', () => {
  assert.equal(ndZoneMaxLevel('δ'), null)
  assert.equal(ndZoneMaxLevel(''), null)
  assert.equal(ndZoneMaxLevel('   '), null)
  assert.equal(expectedNdLevels('δ'), null)
})

test('expectedNdLevels：兩種分區的完整序列', () => {
  assert.deepEqual(expectedNdLevels('α'), [
    { level: 1, minSum: 1 }, { level: 2, minSum: 4 }, { level: 3, minSum: 7 },
  ])
  assert.deepEqual(expectedNdLevels('γ2'), [
    { level: 1, minSum: 1 }, { level: 2, minSum: 4 }, { level: 3, minSum: 7 },
    { level: 4, minSum: 10 }, { level: 5, minSum: 13 }, { level: 6, minSum: 16 },
  ])
})

test('isNdMinSumOffRule：undefined 與 0 等價，且都算偏離', () => {
  assert.equal(isNdMinSumOffRule(1, 1), false)
  assert.equal(isNdMinSumOffRule(5, 13), false)
  assert.equal(isNdMinSumOffRule(1, undefined), true)
  assert.equal(isNdMinSumOffRule(3, 0), true)
  assert.equal(isNdMinSumOffRule(0, 1), true)
})

test('ndZoneOffRule：抓出真實資料裡那三筆手打錯字', () => {
  // 這三筆是 2026-08-28 普查時全庫僅有的偏離，全部來自 manual:true 手動建檔，當日已更正。
  // 官方 API 對帳（check-nd-minsum-drift 的 ①②）看不到它們 —— 那正是本規則存在的理由，
  // 所以把當時的原始值釘在這裡：規則哪天被改鬆，這幾筆會先亮。
  const 尼爾α = ndZoneOffRule('α', [{ level: 1, minSum: 1 }, { level: 2, minSum: 4 }, { level: 3, minSum: 0 }])
  assert.deepEqual(尼爾α, { levelCountOff: false, expectedCount: 3, offIndexes: [2] })

  const 凱登β = ndZoneOffRule('β', [{ level: 1, minSum: 1 }, { level: 2, minSum: 4 }, { level: 3, minSum: 6 }])
  assert.deepEqual(凱登β, { levelCountOff: false, expectedCount: 3, offIndexes: [2] })

  const 安γ1 = ndZoneOffRule('γ1', [
    { level: 1, minSum: 1 }, { level: 2, minSum: 4 }, { level: 3, minSum: 7 },
    { level: 4, minSum: 10 }, { level: 5, minSum: 12 }, { level: 6, minSum: 16 },
  ])
  assert.deepEqual(安γ1, { levelCountOff: false, expectedCount: 6, offIndexes: [4] })
})

test('ndZoneOffRule：合規的分區零偏離；等級數不足會被指出', () => {
  const ok = ndZoneOffRule('γ2', expectedNdLevels('γ2') as { level: number; minSum: number }[])
  assert.deepEqual(ok, { levelCountOff: false, expectedCount: 6, offIndexes: [] })

  const 少兩級 = ndZoneOffRule('γ1', [{ level: 1, minSum: 1 }, { level: 2, minSum: 4 }])
  assert.deepEqual(少兩級, { levelCountOff: true, expectedCount: 6, offIndexes: [] })
})

test('ndZoneOffRule：以陣列順序判定，序號錯位會被抓到而非只補 minSum', () => {
  // 中間刪掉一列的典型殘骸：level 欄位跳號。該修的是整段序號。
  const 跳號 = ndZoneOffRule('α', [{ level: 1, minSum: 1 }, { level: 3, minSum: 7 }, { level: 4, minSum: 10 }])
  assert.deepEqual(跳號, { levelCountOff: false, expectedCount: 3, offIndexes: [1, 2] })
})

test('ndZoneOffRule：未知分區回 null —— 不對沒有規則的東西做判斷', () => {
  assert.equal(ndZoneOffRule('δ', [{ level: 1, minSum: 99 }]), null)
  assert.equal(ndZoneOffRule('', []), null)
})
