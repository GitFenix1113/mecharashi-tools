// PLAN-065-C C-2：驗證台的目標選擇（resolveTarget）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 換算本身由 requestBuilder 的 buildRaidTarget 負責（那邊有逐筆對過引擎資料的測試）；
// 這裡只守驗證台自己的部分：手動模式要填齊、預設難度與首領、瞄準「自動」不送、顯示名稱與對不上時的原因。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Boss, RaidSeason, Stage } from '../../../types/boss.ts'
import { resolveTarget, type RaidCatalogSeason } from './simTarget.ts'

const season = (seq: number, name: string, difficulties: readonly string[]): RaidSeason => ({
  id: `raid-${seq}`, seq, name, difficulties: [...difficulties],
  difficultyNames: { normal: '初試', hard: '磨鍊', hell: '死境', d4: '煉獄' },
} as unknown as RaidSeason)

/** variants：難度 → [battleId, 變體名, bossIds] */
const stage = (seasonId: string, group: number, variants: Record<string, [number, string, string[]]>): Stage => ({
  id: `${seasonId}-g${group}`, name: `關卡${group}`, category: '討伐', bossIds: [],
  raid: {
    kind: 'dungeon', seasonId, group, order: 1, isFinal: false, unitDict: {}, refDict: {},
    variants: Object.fromEntries(Object.entries(variants).map(([d, [battleId, name, bossIds]]) =>
      [d, { levelId: 0, battleId, name, turnLimit: 0, bossIds, units: [], reinforcements: [], bounties: [] }])),
  },
} as unknown as Stage)

const boss = (id: string, name: string, variants: Record<string, number>): Boss => ({
  id, name, skills: [],
  variants: Object.fromEntries(Object.entries(variants).map(([d, templateId]) => [d, { templateId, level: 0, weapons: [], skills: [], estimated: false }])),
} as unknown as Boss)

// 第 18 期 18-1（單首領、四個難度）；第 11 期 11-1（雙首領、只有煉獄）
const CATALOG: RaidCatalogSeason[] = [
  {
    season: season(18, '逐火之心', ['normal', 'hard', 'hell', 'd4']),
    stages: [stage('raid-18', 1, { hell: [8467, '群舞', ['b18']], d4: [8468, '群舞', ['b18']] })],
    bosses: [boss('b18', '黛博拉', { hell: 846799, d4: 846899 })],
    source: 'draft',
  },
  {
    season: season(11, '末路盡頭', ['d4']),
    stages: [stage('raid-11', 1, { d4: [8356, '雙雄', ['b11a', 'b11b']] })],
    bosses: [boss('b11a', '隼人', { d4: 835601 }), boss('b11b', '桑尼', { d4: 835602 })],
    source: 'published',
  },
]

test('武裝討伐：預設最高難度、第一位首領；瞄準「自動」不送', () => {
  const r = resolveTarget(CATALOG, { mode: 'raid', seasonId: 'raid-18', stageId: 'raid-18-g1', part: 'auto' })
  assert.deepEqual(r.target, { kind: 'raid', seasonNo: 18, stageNo: 1, difficulty: 4, battleMapId: 8468, templateId: 846899, bossIndex: 0 })
  assert.equal(r.label, '#18 逐火之心・1 群舞・煉獄・黛博拉')
  assert.equal(r.reason, undefined)
})

test('武裝討伐：指定難度、第二位首領、瞄準部位', () => {
  const hell = resolveTarget(CATALOG, { mode: 'raid', seasonId: 'raid-18', stageId: 'raid-18-g1', difficulty: 'hell', part: 'body' })
  assert.deepEqual(hell.target, { kind: 'raid', seasonNo: 18, stageNo: 1, difficulty: 3, battleMapId: 8467, templateId: 846799, bossIndex: 0, part: 'body' })
  assert.equal(hell.label, '#18 逐火之心・1 群舞・死境・黛博拉')

  const second = resolveTarget(CATALOG, { mode: 'raid', seasonId: 'raid-11', stageId: 'raid-11-g1', bossId: 'b11b' })
  assert.equal(second.target?.templateId, 835602)
  assert.equal(second.target?.bossIndex, 1)
  assert.ok(second.label.endsWith('・桑尼'))
})

test('武裝討伐：還沒選期或關卡、關卡不屬於這一期 → 沒有目標', () => {
  assert.deepEqual(resolveTarget(CATALOG, { mode: 'raid' }), { target: null, label: '', reason: '請選擇期與關卡' })
  assert.equal(resolveTarget(CATALOG, { mode: 'raid', seasonId: 'raid-18', stageId: 'raid-11-g1' }).target, null)
})

test('武裝討伐：這一關沒有選到的難度 → 沒有目標，但保留顯示名稱與原因', () => {
  const r = resolveTarget(CATALOG, { mode: 'raid', seasonId: 'raid-18', stageId: 'raid-18-g1', difficulty: 'normal' })
  assert.equal(r.target, null)
  assert.equal(typeof r.reason, 'string')
  assert.ok(r.label.startsWith('#18 逐火之心'))
})

test('手動：五個必填欄位填齊才送；首領序號選填、瞄準自動不送', () => {
  const partial = resolveTarget([], { mode: 'manual', manual: { seasonNo: 18, stageNo: 1, difficulty: 4, battleMapId: 8468 } })
  assert.equal(partial.target, null)
  assert.equal(partial.reason, '手動目標的欄位還沒填完')

  const full = resolveTarget([], { mode: 'manual', part: 'auto', manual: { seasonNo: 18, stageNo: 1, difficulty: 4, battleMapId: 8468, templateId: 846899 } })
  assert.deepEqual(full.target, { kind: 'raid', seasonNo: 18, stageNo: 1, difficulty: 4, battleMapId: 8468, templateId: 846899 })
  assert.equal(full.label, '手動 18-1（8468:846899）')

  const withBoss = resolveTarget([], { mode: 'manual', part: 'leg', manual: { seasonNo: 11, stageNo: 1, difficulty: 4, battleMapId: 8356, templateId: 835602, bossIndex: 1 } })
  assert.deepEqual(withBoss.target, { kind: 'raid', seasonNo: 11, stageNo: 1, difficulty: 4, battleMapId: 8356, templateId: 835602, bossIndex: 1, part: 'leg' })
})
