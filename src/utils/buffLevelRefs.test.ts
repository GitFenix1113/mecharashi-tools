// PLAN-034 E-2：階梯 buff 單一等級反查單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findBuffLevelRefs, findRemovedLevelsInUse, sortLevelsAscending } from './buffLevelRefs.ts'
import type { RefScanData } from './entityRefs.ts'
import type { Pilot, PilotSkillDoc, NeuralDriveAbility } from '../types'

const scanData = (over: Partial<RefScanData>): RefScanData => ({
  pilots: [], pilotSkills: [], buffs: [], glossaryTerms: [], neuralDriveAbilities: [],
  modules: [], weapons: [], backpacks: [], components: [],
  ...over,
})

const skill = (id: string, over: Record<string, unknown>) => ({
  id, name: id, type: '主動技能', description: '', icon: '', iconLocal: '',
  effects: [], buffIds: [], ...over,
}) as unknown as PilotSkillDoc

test('findBuffLevelRefs：descriptionRefs 依 EntityRef.level 命中', () => {
  const data = scanData({
    pilotSkills: [
      skill('s_lv1', { descriptionRefs: { 凝勢Ⅰ: { refType: 'buff', refId: 'buff_凝勢', level: 1 } } }),
      skill('s_lv3', { descriptionRefs: { 凝勢Ⅲ: { refType: 'buff', refId: 'buff_凝勢', level: 3 } } }),
    ],
  })
  assert.deepEqual(findBuffLevelRefs('buff_凝勢', 3, data).map(h => h.docId), ['s_lv3'])
  assert.deepEqual(findBuffLevelRefs('buff_凝勢', 2, data), [])
})

test('findBuffLevelRefs：buffIds 的 @N 命中', () => {
  const data = scanData({ pilotSkills: [skill('s', { buffIds: ['buff_凝勢@2'] })] })
  assert.equal(findBuffLevelRefs('buff_凝勢', 2, data).length, 1)
  assert.equal(findBuffLevelRefs('buff_凝勢', 1, data).length, 0)
})

test('findBuffLevelRefs：buffUpgrades 也算（PLAN-034 D-1 註冊的站點）', () => {
  const ability = {
    id: 'nd_x', name: 'X', description: '', effects: [], buffIds: [], buffUpgrades: ['buff_凝勢@3'],
  } as unknown as NeuralDriveAbility
  const data = scanData({ neuralDriveAbilities: [ability] })
  const hits = findBuffLevelRefs('buff_凝勢', 3, data)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].siteId, 'neuralDriveAbilities.buffUpgrades')
})

test('findBuffLevelRefs：正文 <id.lvN.attr> token 依 lv 段命中（RefHit.level 不填）', () => {
  const pilot = {
    id: 'p1', name: 'P',
    talents: [{ name: 'T', description: '可疊加<buff_凝勢.lv2.maxStack>層' }],
    skills: [], neuralDrive: [],
  } as unknown as Pilot
  const data = scanData({ pilots: [pilot] })
  assert.equal(findBuffLevelRefs('buff_凝勢', 2, data).length, 1)
  assert.equal(findBuffLevelRefs('buff_凝勢', 1, data).length, 0)
})

test('findBuffLevelRefs：沒指定級的引用不算命中（它們指的是家族本身）', () => {
  const data = scanData({
    pilotSkills: [skill('s', {
      buffIds: ['buff_凝勢'],                                        // 裸 id
      descriptionRefs: { 凝勢: { refType: 'buff', refId: 'buff_凝勢' } }, // 無 level
    })],
  })
  for (const n of [1, 2, 3]) assert.deepEqual(findBuffLevelRefs('buff_凝勢', n, data), [])
})

test('findRemovedLevelsInUse：只回報「被移除且仍被引用」的級', () => {
  const data = scanData({
    pilotSkills: [
      skill('s1', { descriptionRefs: { a: { refType: 'buff', refId: 'buff_凝勢', level: 2 } } }),
      skill('s2', { descriptionRefs: { b: { refType: 'buff', refId: 'buff_凝勢', level: 3 } } }),
    ],
  })
  const before = [{ level: 1 }, { level: 2 }, { level: 3 }]

  // 移除 lv3（有人用）→ 擋
  const b1 = findRemovedLevelsInUse('buff_凝勢', before, [{ level: 1 }, { level: 2 }], data)
  assert.deepEqual(b1.map(b => b.level), [3])

  // 移除 lv1（沒人用）→ 放行
  assert.deepEqual(findRemovedLevelsInUse('buff_凝勢', before, [{ level: 2 }, { level: 3 }], data), [])

  // 全部保留 → 放行（順序改變不算移除）
  assert.deepEqual(findRemovedLevelsInUse('buff_凝勢', before, [{ level: 3 }, { level: 1 }, { level: 2 }], data), [])
})

test('findRemovedLevelsInUse：before/after 為空或 undefined 不炸', () => {
  const data = scanData({})
  assert.deepEqual(findRemovedLevelsInUse('buff_x', undefined, undefined, data), [])
  assert.deepEqual(findRemovedLevelsInUse('buff_x', [], [{ level: 1 }], data), [])
})

test('sortLevelsAscending：依 level 昇冪；空 / undefined 原樣回傳', () => {
  // 實測 buff_迴避率降低 的 levels 順序就是 [2,3,5,4]
  assert.deepEqual(
    sortLevelsAscending([{ level: 2 }, { level: 3 }, { level: 5 }, { level: 4 }]),
    [{ level: 2 }, { level: 3 }, { level: 4 }, { level: 5 }],
  )
  assert.equal(sortLevelsAscending(undefined), undefined)
  assert.deepEqual(sortLevelsAscending([]), [])
})

test('sortLevelsAscending：不就地改動輸入（避免 React state 被偷改）', () => {
  const input = [{ level: 3 }, { level: 1 }]
  const out = sortLevelsAscending(input)
  assert.deepEqual(input, [{ level: 3 }, { level: 1 }])
  assert.deepEqual(out, [{ level: 1 }, { level: 3 }])
})
