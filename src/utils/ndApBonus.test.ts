// 神經驅動 AP 加成（ndApBonus.ts，2026-11-21）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 釘的是「錯了畫面不會報錯、只會多一兩點」的兩件事：
//   ① 加總只看 apBonus，說明文字寫得再像加成也不算（條件式 6 位多算的那個坑）；
//   ② 共用能力掛在多個等級、查不到的 abilityId、舊嵌入格式都不會讓總和出錯。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NeuralDrive, NeuralDriveAbility } from '../types/index.ts'
import { sumNdApBonus, hasApBonus, mentionsApBonus } from './ndApBonus.ts'
import { buildNdAbilityMap } from './neuralDriveAbilities.ts'

const ability = (id: string, description: string, apBonus?: NeuralDriveAbility['apBonus']): NeuralDriveAbility =>
  ({ id, name: id, description, effects: [], buffIds: [], ...(apBonus ? { apBonus } : {}) })

const zone = (name: string, abilityIds: (string | undefined)[]): NeuralDrive =>
  ({
    name, icon: '', slots: [],
    levels: abilityIds.map((abilityId, i) => ({
      level: i + 1, minSum: 1 + 3 * i, abilityId, skillName: '', effect: abilityId ? '' : 'AP的回復值+1', effects: [], buffIds: [],
    })),
  }) as NeuralDrive

const LIB = buildNdAbilityMap([
  ability('nd_AP優化1', 'AP的初始值+1', { init: 1 }),
  ability('nd_AP優化2', 'AP的上限值+1', { max: 1 }),
  ability('nd_AP優化3', 'AP的上限值+1', { max: 1 }),
  ability('nd_動力革新1', 'AP的回復值+1', { recovery: 1 }),
  // 條件式：文字和永久加成長得一樣，但沒有 apBonus
  ability('nd_天才4', '[同步率]大於等於85%時，AP的回復值+1'),
  ability('nd_元氣滿滿2', '施放單體修理技能時，使目標AP上限+1，該效果無法重複疊加'),
])

test('加總各區各等級的 apBonus（常見形狀：明日香 1/3/1）', () => {
  const nd = [
    zone('α', ['nd_無', 'nd_動力革新1', 'nd_AP優化1']),
    zone('β', ['nd_無', 'nd_無', 'nd_AP優化2']),
    zone('γ1', ['nd_無', 'nd_AP優化3']),
    zone('γ2', ['nd_無', 'nd_AP優化3', 'nd_無', 'nd_無', 'nd_無', 'nd_天才4']),
  ]
  assert.deepEqual(sumNdApBonus(nd, LIB), { init: 1, max: 3, recovery: 1 })
})

test('條件式與給隊友的效果：文字有「+1」也不算', () => {
  assert.deepEqual(sumNdApBonus([zone('γ2', ['nd_天才4', 'nd_元氣滿滿2'])], LIB), { init: 0, max: 0, recovery: 0 })
})

test('舊嵌入格式（沒有 abilityId）不回退去掃文字', () => {
  // zone() 對 undefined 的等級塞了 effect「AP的回復值+1」
  assert.deepEqual(sumNdApBonus([zone('α', [undefined])], LIB), { init: 0, max: 0, recovery: 0 })
})

test('查不到能力、沒有神經驅動：都是 0，不丟例外', () => {
  assert.deepEqual(sumNdApBonus([zone('α', ['nd_不存在'])], LIB), { init: 0, max: 0, recovery: 0 })
  assert.deepEqual(sumNdApBonus(undefined, LIB), { init: 0, max: 0, recovery: 0 })
  assert.deepEqual(sumNdApBonus([zone('α', ['nd_AP優化1'])], new Map()), { init: 0, max: 0, recovery: 0 })
})

test('hasApBonus：全 0／未填＝沒有', () => {
  assert.equal(hasApBonus(undefined), false)
  assert.equal(hasApBonus({}), false)
  assert.equal(hasApBonus({ apBonus: {} }), false)
  assert.equal(hasApBonus({ apBonus: { init: 0, max: 0 } }), false)
  assert.equal(hasApBonus({ apBonus: { max: 2 } }), true)
})

test('mentionsApBonus：只當提示用，條件式也會中', () => {
  assert.equal(mentionsApBonus('AP的回復值+1'), true)
  assert.equal(mentionsApBonus('AP的上限值+2'), true)
  assert.equal(mentionsApBonus('場上存在敵方首領時，AP回復+1'), true)
  assert.equal(mentionsApBonus('AP的回覆值+1'), true)   // 機轉沒修好的「回覆」也要提醒得到
  assert.equal(mentionsApBonus('電磁炮的AP消耗-1'), false)
  assert.equal(mentionsApBonus('擊破部位時，戰後回復1AP'), false)
  assert.equal(mentionsApBonus(undefined), false)
})
