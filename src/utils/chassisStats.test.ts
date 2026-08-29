// PLAN-052-A A-3：機體數值 derive 的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chassisFirepower, chassisWeight, chassisOutput, mechParts, MECH_PART_ORDER, type MechPartsInput } from './chassisStats.ts'

/** 彌造者（mech_052）線上實測值：四部位火力各 1255、重量合計 825、軀幹出力 3375 */
const 彌造者 = {
  torso:    { position: 'torso',    firepower: 1255, weight: 240, output: 3375 },
  leftArm:  { position: 'leftArm',  firepower: 1255, weight: 175 },
  rightArm: { position: 'rightArm', firepower: 1255, weight: 175 },
  legs:     { position: 'legs',     firepower: 1255, weight: 235 },
// 刻意的部分 fixture（缺 durable / armor / interface）：這幾支只讀 firepower / weight / output
} as unknown as NonNullable<MechPartsInput>

test('本檔存在的理由：火力是 Σ 四部位，不是頂層欄位', () => {
  // 線上 mech_052 的頂層 firepower ＝ 1255 ＝ **單一部位值**（90 台中 83 台如此）
  // → MechsPage 直接讀頂層時，顯示的是實際火力的 1/4
  assert.equal(chassisFirepower(彌造者), 5020)
  assert.notEqual(chassisFirepower(彌造者), 1255)
})

test('重量 ＝ Σ 四部位（與頂層 825 一致，但仍走 derive 以支援混搭部位）', () => {
  assert.equal(chassisWeight(彌造者), 825)
})

test('出力 ＝ parts.torso.output，不是四部位加總', () => {
  assert.equal(chassisOutput(彌造者), 3375)
  // 只有軀幹有 output；若誤寫成加總，缺欄位的三部位會讓結果仍是 3375 而看不出錯 → 用缺軀幹反證
  assert.equal(chassisOutput({ leftArm: { firepower: 0, weight: 0, output: 999 } } as never), 0)
})

test('legacy 的四個耐久數字（MechPartsLegacy）一律當 0，不得產生 NaN', () => {
  const legacy = { torso: 3200, leftArm: 1800, rightArm: 1800, legs: 2400 } as never
  assert.equal(chassisFirepower(legacy), 0)
  assert.equal(chassisWeight(legacy), 0)
  assert.equal(chassisOutput(legacy), 0)
  assert.equal(mechParts(legacy).length, 0)
})

test('缺件／空值優雅降級（爬蟲抓不全的機甲不該讓整頁炸掉）', () => {
  assert.equal(chassisFirepower(null), 0)
  assert.equal(chassisFirepower(undefined), 0)
  assert.equal(chassisFirepower({ torso: 彌造者.torso } as never), 1255)
  assert.equal(mechParts({ torso: 彌造者.torso, legs: null } as never).length, 1)
})

test('MECH_PART_ORDER 是四部位的唯一順序來源', () => {
  assert.deepEqual([...MECH_PART_ORDER], ['torso', 'leftArm', 'rightArm', 'legs'])
  assert.deepEqual(mechParts(彌造者).map((p) => p.position), [...MECH_PART_ORDER])
})
