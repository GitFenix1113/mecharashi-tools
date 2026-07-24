// PLAN-035 A-1：backpackClassify 純函式單元測試
//   npm test   →   node --test "src/**/*.test.ts"
// ⚠ 單元測試只覆蓋手挑名字；「全 180 個真實名字可解析」由 audit 腳本佐證。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tierFromRarity,
  parseBackpackName,
  prereqBackpackType,
  blueprintName,
  TIER_LABELS,
  TIER_ORDER,
  DEFAULT_TIERS,
} from './backpackClassify.ts'
import type { Backpack } from '../types'

// 測試用最小背包建構器（只填必要欄位，其餘用預設）
function bp(partial: Partial<Backpack> & Pick<Backpack, 'id' | 'name'>): Backpack {
  return {
    type: 'PowerAdd', rarity: 'S', weight: 0, slot: 'back',
    assemblableArmorType: [], repairAmount: 0, ...partial,
  }
}

test('tierFromRarity：rarity → 階層（A/B 皆素材）', () => {
  assert.equal(tierFromRarity('SS'), 'special')
  assert.equal(tierFromRarity('S+'), 'composite')
  assert.equal(tierFromRarity('S'), 'base')
  assert.equal(tierFromRarity('A'), 'material')
  assert.equal(tierFromRarity('B'), 'material')
})

test('tierFromRarity：未知 rarity → null', () => {
  assert.equal(tierFromRarity('X'), null)
  assert.equal(tierFromRarity(''), null)
})

test('parseBackpackName：S+ 複合（有基礎功能前綴）', () => {
  assert.deepEqual(parseBackpackName('出力強化背包·首攻'), {
    baseFunction: '出力', line: '強化', variant: '首攻',
  })
  assert.deepEqual(parseBackpackName('出力干擾背包·攻擊'), {
    baseFunction: '出力', line: '干擾', variant: '攻擊',
  })
  assert.deepEqual(parseBackpackName('移動強化背包·追擊'), {
    baseFunction: '移動', line: '強化', variant: '追擊',
  })
})

test('parseBackpackName：base 階線名無基礎功能前綴 → baseFunction=null', () => {
  assert.deepEqual(parseBackpackName('強化背包·首攻'), {
    baseFunction: null, line: '強化', variant: '首攻',
  })
  assert.deepEqual(parseBackpackName('干擾背包·攻擊'), {
    baseFunction: null, line: '干擾', variant: '攻擊',
  })
})

test('parseBackpackName：純功能背包（無線無變體）→ 全 null，優雅降級', () => {
  assert.deepEqual(parseBackpackName('出力背包'), {
    baseFunction: null, line: null, variant: null,
  })
  assert.deepEqual(parseBackpackName('誘導背包'), {
    baseFunction: null, line: null, variant: null,
  })
})

test('parseBackpackName：SS 特種名不含「強化背包」token → 不被誤判為強化線', () => {
  // 「強襲者」含「強」但不含「強化背包」——這正是用整個 token 當標記的理由
  assert.deepEqual(parseBackpackName('強襲者背包'), {
    baseFunction: null, line: null, variant: null,
  })
  assert.deepEqual(parseBackpackName('征服者背包'), {
    baseFunction: null, line: null, variant: null,
  })
})

test('parseBackpackName：容錯 katakana 間隔號（・, U+30FB）', () => {
  assert.deepEqual(parseBackpackName('出力強化背包・首攻'), {
    baseFunction: '出力', line: '強化', variant: '首攻',
  })
})

test('prereqBackpackType：查 craft.prereqBackpackId 取前置背包的 type', () => {
  const prereq = bp({ id: 'backpack_移動干擾護甲', name: '移動干擾背包·護甲', type: 'MovePointAdd' })
  const ss = bp({ id: 'backpack_征服者', name: '征服者背包', rarity: 'SS', craft: { prereqBackpackId: prereq.id } })
  const byId = new Map([[prereq.id, prereq], [ss.id, ss]])
  assert.equal(prereqBackpackType(ss, byId), 'MovePointAdd')
})

test('prereqBackpackType：無 craft → null（優雅降級）', () => {
  const ss = bp({ id: 'backpack_強襲者', name: '強襲者背包', rarity: 'SS' })
  assert.equal(prereqBackpackType(ss, new Map()), null)
})

test('prereqBackpackType：craft 指向查不到的 id → null（優雅降級）', () => {
  const ss = bp({ id: 'backpack_x', name: 'X 背包', rarity: 'SS', craft: { prereqBackpackId: 'backpack_missing' } })
  assert.equal(prereqBackpackType(ss, new Map([[ss.id, ss]])), null)
})

test('blueprintName：背包名 + 設計圖', () => {
  assert.equal(blueprintName(bp({ id: 'backpack_征服者', name: '征服者背包' })), '征服者背包設計圖')
})

test('常數自洽：TIER_ORDER / DEFAULT_TIERS 覆蓋合法階層、DEFAULT 不含素材', () => {
  const tiers = Object.keys(TIER_LABELS)
  assert.equal(TIER_ORDER.length, 4)
  for (const t of TIER_ORDER) assert.ok(tiers.includes(t))
  assert.deepEqual([...DEFAULT_TIERS].sort(), ['base', 'composite', 'special'])
  assert.ok(!DEFAULT_TIERS.includes('material' as never))
})
