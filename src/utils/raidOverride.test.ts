import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyFieldOverrides, fieldLabel, getAt, pathDifficulty, sameValue, setAt } from './raidOverride.ts'
import type { Boss, RaidOverride, RaidSeason, Stage } from '../types/boss.ts'

const season = { id: 'raid-21', seq: 21, name: '伏影', rules: ['每週可設 3 組'], weekBuffs: [] } as unknown as RaidSeason
const stage = {
  id: 'raid-21-g1', name: '一號追擊者', category: '討伐', bossIds: [],
  raid: { seasonId: 'raid-21', group: 1, variants: { hell: { turnLimit: 8, reinforcements: [{ when: { kind: 'turn', turns: [3], timing: 'start' }, units: [{ unit: '1', count: 2 }] }] } } },
} as unknown as Stage
const boss = { id: 'raid-21-g1-b1', name: '盧克', variants: { d4: { level: 94, parts: { torso: { durable: 1000, armor: 50 } } } } } as unknown as Boss
const docs = { season, stages: [stage], bosses: [boss] }
const ov = (o: Partial<RaidOverride>): RaidOverride => ({ doc: 'stage', docId: 'raid-21-g1', path: '', base: null, value: null, updatedAt: '', updatedBy: 't', ...o })

test('getAt／setAt：點分隔路徑、陣列索引、沿路複製不改原物件', () => {
  assert.equal(getAt(stage, 'raid.variants.hell.reinforcements.0.when.turns.0'), 3)
  const next = setAt(stage, 'raid.variants.hell.reinforcements.0.when.turns.0', 4)!
  assert.equal(getAt(next, 'raid.variants.hell.reinforcements.0.when.turns.0'), 4)
  assert.equal(getAt(stage, 'raid.variants.hell.reinforcements.0.when.turns.0'), 3)
  assert.equal(setAt(stage, 'raid.variants.d4.turnLimit', 5), null) // 中間節點不存在：不憑空長結構
  assert.equal(setAt(stage, 'raid.variants.hell.reinforcements.9.units', []), null)
})

test('sameValue：鍵順序與 undefined 不影響', () => {
  assert.ok(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }))
  assert.ok(sameValue({ a: 1, x: undefined }, { a: 1 }))
  assert.ok(sameValue(undefined, null))
  assert.ok(!sameValue([1, 2], [2, 1]))
})

test('applyFieldOverrides：base 相符才套用、寫進 manualPaths；草稿值變了 → 暫停', () => {
  const r = applyFieldOverrides(docs, docs, [
    ov({ path: 'raid.variants.hell.turnLimit', base: 8, value: 10 }),
    ov({ doc: 'boss', docId: 'raid-21-g1-b1', path: 'variants.d4.parts.torso.durable', base: 999, value: 1200 }),
    ov({ doc: 'season', docId: 'raid-21', path: 'rules.0', base: '每週可設 3 組', value: '每週可設 4 組' }),
    ov({ docId: 'raid-21-g9', path: 'name', base: 'x', value: 'y' }),
  ])
  assert.equal(getAt(r.stages[0], 'raid.variants.hell.turnLimit'), 10)
  assert.deepEqual(r.stages[0].manualPaths, ['raid.variants.hell.turnLimit'])
  assert.equal(r.season.rules![0], '每週可設 4 組')
  assert.deepEqual(r.season.manualPaths, ['rules.0'])
  assert.equal(getAt(r.bosses[0], 'variants.d4.parts.torso.durable'), 1000)
  assert.equal(r.bosses[0].manualPaths, undefined)
  assert.deepEqual(r.suspended.map((s) => [s.o.path, s.current]), [['variants.d4.parts.torso.durable', 1000], ['name', undefined]])
  assert.equal(r.active.length, 2)
})

test('applyFieldOverrides：比對用草稿原文、寫值寫在已套譯名的文件上', () => {
  const translated = { ...docs, stages: [{ ...stage, name: '一號追擊者（已校）' }] }
  const r = applyFieldOverrides(docs, translated, [ov({ path: 'raid.variants.hell.turnLimit', base: 8, value: 9 })])
  assert.equal(r.stages[0].name, '一號追擊者（已校）')
  assert.equal(getAt(r.stages[0], 'raid.variants.hell.turnLimit'), 9)
})

test('fieldLabel／pathDifficulty', () => {
  assert.equal(fieldLabel('raid.variants.hell.reinforcements.2.when.turns.0'), '死境・增援 #3・時點・回合 #1')
  assert.equal(fieldLabel('raid.variants.hell.turnLimit', { omitDifficulty: true }), '回合上限')
  assert.equal(fieldLabel('variants.d4.parts.torso.durable', { difficultyNames: { d4: '煉獄（台）' } }), '煉獄（台）・面板・軀幹・耐久')
  assert.equal(fieldLabel('raid.unitDict.853501.name'), '單位（853501）・名稱')
  assert.equal(pathDifficulty('raid.variants.hard.units.0.count'), 'hard')
  assert.equal(pathDifficulty('rules.0'), null)
})
