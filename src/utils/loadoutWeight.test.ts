// PLAN-052-A A-1：配裝總重的 golden fixture
//   npm test   →   node --test "src/**/*.test.ts"
//
// 四組 fixture 全部來自**官方整備截圖**（海莉絲 × 彌造者，四個形態各一張），
// 驗收條件是四個總重 ±0。武器重量取自線上 weapons 集合（2026-08-23 實測），
// 底盤 825 ＝ 彌造者 Σ 四部位重量、軀幹出力 3375。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { totalWeight, weightBreakdown } from './loadoutWeight.ts'

/** 彌造者（mech_052）：Σ parts.weight ＝ 825，parts.torso.output ＝ 3375 */
const 彌造者 = { weight: 825 }

// 線上實測值（id 一併記下，日後改資料時能回頭對照）
const 群山之力   = { weight: 800 }   // weapon_008 · 格鬥/長柄 · dualHand
const 貝奧武夫   = { weight: 850 }   // weapon_089 · 格鬥/電鋸 · dualHand
const 伊夫裡特   = { weight: 800 }   // weapon_020 · 突擊/重機槍 · dualHand
const 藝術突襲   = { weight: 420 }   // weapon_016 · 突擊/機槍 · singleHand
const 夜魘       = { weight: 500 }   // weapon_017 · 突擊/機槍 · singleHand
const 熔火       = { weight: 1200 }  // weapon_044 · 戰術/火箭 · shoulder
const 炬塔       = { weight: 1100 }  // weapon_049 · 戰術/電磁炮 · back
const 耀星       = { weight: 100 }   // weapon_176 · 固定武裝 · singleHand
const 隕星       = { weight: 100 }   // weapon_177 · 固定武裝 · singleHand
const 千星       = { weight: 100 }   // weapon_178 · 固定武裝 · back
const 強襲者背包 = { weight: 150 }   // backpacks/60101706 · BackupEquipment

test('golden fixture ①先鋒形態 ＝ 1825（備用組較重，取備用）', () => {
  const set = {
    mainHand:   [群山之力],
    backupHand: [貝奧武夫],
    back:       強襲者背包,
  }
  assert.equal(totalWeight(set, 彌造者), 1825)     // 825 + max(800, 850) + 150
  const b = weightBreakdown(set, 彌造者)
  assert.equal(b.heavierBank, 'backup')
  assert.equal(b.hands, 850)
})

test('golden fixture ②突擊形態 ＝ 1895（備用兩把單手 420+500）', () => {
  const set = {
    mainHand:   [伊夫裡特],
    backupHand: [藝術突襲, 夜魘],
    back:       強襲者背包,
  }
  assert.equal(totalWeight(set, 彌造者), 1895)     // 825 + max(800, 920) + 150
})

test('golden fixture ③戰術形態 ＝ 3125（無手部武器、肩＋背）', () => {
  // 戰術類武器全庫只有 shoulder(22) 與 back(22)，手部一把都沒有 —— 手部空著是正確狀態
  const set = { shoulder: [熔火], back: 炬塔 }
  assert.equal(totalWeight(set, 彌造者), 3125)     // 825 + 0 + 1200 + 1100
})

test('golden fixture ④虛粒子形態 ＝ 1125（三把固定武裝各 100）', () => {
  const set = { mainHand: [耀星, 隕星], back: 千星 }
  assert.equal(totalWeight(set, 彌造者), 1125)     // 825 + 200 + 100
})

test('本測試存在的理由：手部若寫成加總，先鋒會多算 800（誤差 44%）', () => {
  const set = { mainHand: [群山之力], backupHand: [貝奧武夫], back: 強襲者背包 }
  const b = weightBreakdown(set, 彌造者)
  // 五份獨立設計都寫成 mainHand + backupHand，會得到 2625 —— 而且是往「裝不下」的方向錯
  assert.notEqual(b.chassis + b.mainHand + b.backupHand + b.back, b.total)
  assert.equal(b.chassis + b.mainHand + b.backupHand + b.back, 2625)
  assert.equal(b.total, 1825)
})

test('沒有備用槽（非強襲者背包）時一律採計主手', () => {
  const set = { mainHand: [群山之力], back: { weight: 150 } }
  const b = weightBreakdown(set, 彌造者)
  assert.equal(b.backupHand, 0)
  assert.equal(b.heavierBank, 'main')
  assert.equal(b.total, 825 + 800 + 150)
})

test('主手與備用同重時採計主手（顯示以主手為準，數字本來就一樣）', () => {
  const b = weightBreakdown({ mainHand: [群山之力], backupHand: [伊夫裡特] }, 彌造者)
  assert.equal(b.heavierBank, 'main')
  assert.equal(b.hands, 800)
})

test('重量 0 的純封鎖型固定武裝不影響總重（但仍佔槽，那是 mechSlots 的事）', () => {
  const 嵐質儲能艙 = { weight: 0 }
  assert.equal(totalWeight({ shoulder: [嵐質儲能艙, 嵐質儲能艙] }, 彌造者), 825)
})

test('空配裝 ＝ 底盤重量；缺欄位不得產生 NaN', () => {
  assert.equal(totalWeight({}, 彌造者), 825)
  assert.equal(totalWeight({ mainHand: [], shoulder: [], back: null }, 彌造者), 825)
})
