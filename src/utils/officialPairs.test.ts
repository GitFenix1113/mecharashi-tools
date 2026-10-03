// 官配推導（PLAN-054）—— 只存機師側、機甲側推導
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duplicatePairs, pairedPilotOf } from './officialPairs.ts'

const pilots = [
  { id: 'pilot_001_葉夫根尼', pairedMechId: 'mech_014_戴亞斯' },
  { id: 'pilot_005_馬庫斯', pairedMechId: 'mech_001_都卜勒' },
  { id: 'pilot_088_賽文' },                          // 官方贈送角色：沒有官配
  { id: 'pilot_090_索妮婭', pairedMechId: undefined },
]

test('機甲側由機師側推導出官配機師', () => {
  assert.equal(pairedPilotOf('mech_014_戴亞斯', pilots)?.id, 'pilot_001_葉夫根尼')
  assert.equal(pairedPilotOf('mech_001_都卜勒', pilots)?.id, 'pilot_005_馬庫斯')
})

test('沒有官配的機甲回 undefined（畫面上不顯示該列）', () => {
  assert.equal(pairedPilotOf('mech_022_帕斯卡', pilots), undefined)
  assert.equal(pairedPilotOf('mech_022_帕斯卡', []), undefined)
})

test('兩位機師配到同一台：抓得出來，且推導結果穩定（取 ID 最小者，不看陣列順序）', () => {
  const bad = [
    { id: 'pilot_030_b', pairedMechId: 'mech_010_青鳥' },
    { id: 'pilot_012_a', pairedMechId: 'mech_010_青鳥' },
    ...pilots,
  ]
  assert.deepEqual([...duplicatePairs(bad)], [['mech_010_青鳥', ['pilot_012_a', 'pilot_030_b']]])
  assert.equal(pairedPilotOf('mech_010_青鳥', bad)?.id, 'pilot_012_a')
  assert.equal(pairedPilotOf('mech_010_青鳥', [...bad].reverse())?.id, 'pilot_012_a')
})

test('正常的 1:1 資料沒有重複', () => {
  assert.equal(duplicatePairs(pilots).size, 0)
})
