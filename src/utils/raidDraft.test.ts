import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { applyTermOverrides, diffDraft, indexTerms, termHash, termKey } from './raidDraft.ts'
import type { Boss, RaidSeason, Stage } from '../types/boss.ts'

const season = { id: 'raid-21', seq: 21, name: '伏影', nameCn: '伏影', difficulties: ['normal'], difficultyNames: { normal: '初試' },
  twStatus: 'planned', groups: [], weekBuffs: [], published: true, parserVersion: 2, sourceBuild: 'x' } as unknown as RaidSeason
const stage = { id: 'raid-21-g1', name: '一號追擊者', category: '討伐', bossIds: ['raid-21-g1-b1'],
  raid: { kind: 'dungeon', seasonId: 'raid-21', group: 1, order: 4, isFinal: false, refDict: {},
    unitDict: { '853501': { name: '盧克', kind: 'unit' }, '2203012': { name: '老練傭兵', kind: 'unit' } },
    variants: { normal: { levelId: 1, battleId: 2, name: '一號追擊者', turnLimit: 8, bossIds: [], units: [], reinforcements: [], bounties: [], winText: '擊敗盧克' } } } } as unknown as Stage
const boss = { id: 'raid-21-g1-b1', name: '盧克', seasonId: 'raid-21', stageId: 'raid-21-g1', skills: [] } as unknown as Boss

test('termHash：與匯入端（scripts/lib/raidI18n.mjs，Node crypto sha1 前 16 碼）一致', async () => {
  for (const s of ['卢克', '回血版Raid强化新1(S+)', 'a.b/c']) {
    assert.equal(await termHash(s), createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 16))
  }
})

test('applyTermOverrides：已校譯名換掉整字串相符的值；長文裡夾帶的不換', () => {
  const terms = indexTerms([{ kind: 'unit', entries: { h: { cn: '卢克', tw: '路克', status: 'verified', source: 'manual' } } }])
  const r = applyTermOverrides({ season, stages: [stage], bosses: [boss], pending: [{ kind: 'unit', cn: '卢克', tw: '盧克', source: 'machine', count: 3 }] }, terms)
  assert.equal(r.bosses[0].name, '路克')
  assert.equal(r.stages[0].raid!.unitDict['853501'].name, '路克')
  assert.equal(r.stages[0].raid!.variants.normal!.winText, '擊敗盧克') // 長文：要重跑匯入
  assert.deepEqual(r.applied, [{ kind: 'unit', cn: '卢克', from: '盧克', to: '路克' }])
  assert.deepEqual(r.stillPending, [])
})

test('applyTermOverrides：對照表沒有或仍待校 → 留在 stillPending；待校條目的譯文仍優先於機轉', () => {
  const terms = indexTerms([{ kind: 'unit', entries: { h: { cn: '老练佣兵', tw: '資深傭兵', status: 'pending', source: 'infodata' } } }])
  const r = applyTermOverrides({ season, stages: [stage], bosses: [boss], pending: [
    { kind: 'unit', cn: '老练佣兵', tw: '老練傭兵', source: 'machine', count: 5 },
    { kind: 'unit', cn: '卢克', tw: '盧克', source: 'machine', count: 3 },
  ] }, terms)
  assert.equal(r.stages[0].raid!.unitDict['2203012'].name, '資深傭兵')
  assert.deepEqual(r.stillPending.map((p) => p.cn).sort(), ['卢克', '老练佣兵'])
})

test('applyTermOverrides：同一個草稿譯文對到兩種新譯名 → 不換，留人工', () => {
  const terms = indexTerms([
    { kind: 'unit', entries: { a: { cn: '甲', tw: 'A', status: 'verified', source: 'manual' } } },
    { kind: 'skill', entries: { b: { cn: '甲', tw: 'B', status: 'verified', source: 'manual' } } },
  ])
  const r = applyTermOverrides({ season, stages: [], bosses: [{ ...boss, name: '甲' }], pending: [
    { kind: 'unit', cn: '甲', tw: '甲', source: 'machine', count: 1 },
    { kind: 'skill', cn: '甲', tw: '甲', source: 'machine', count: 1 },
  ] }, terms)
  assert.equal(r.bosses[0].name, '甲')
  assert.equal(r.applied.length, 0)
  assert.equal(r.stillPending.length, 2)
})

test('termKey', () => assert.equal(termKey('unit', '卢克'), 'unit\u0000卢克'))

test('diffDraft：新期／欄位差異細到難度／被拿掉的文件', () => {
  assert.deepEqual(diffDraft({ season, stages: [stage], bosses: [boss] }, { seasons: [], stages: [], bosses: [] }).map((d) => d.status), ['new', 'new', 'new'])
  const changedStage = JSON.parse(JSON.stringify(stage))
  changedStage.raid.variants.normal.turnLimit = 10
  const old = { id: 'raid-21-g9', name: 'x', category: '討伐', bossIds: [], raid: { ...stage.raid!, group: 9 } } as Stage
  const d = diffDraft({ season, stages: [changedStage], bosses: [boss] }, { seasons: [{ ...season, published: false }], stages: [stage, old], bosses: [boss] })
  assert.deepEqual(d, [
    { id: 'raid-21-g1', kind: 'stage', status: 'changed', fields: ['raid.variants.normal'] },
    { id: 'raid-21-g9', kind: 'stage', status: 'removed', fields: [] },
  ])
})

test('applyTermOverrides：已校（含照原樣確認）的名稱拿掉待校標記', () => {
  const pendingBoss = { ...boss, i18nPending: ['name'] } as Boss
  const pendingStage = JSON.parse(JSON.stringify(stage))
  pendingStage.raid.unitDict['853501'].pending = true
  pendingStage.raid.unitDict['2203012'].pending = true
  const terms = indexTerms([{ kind: 'unit', entries: { h: { cn: '卢克', tw: '盧克', status: 'verified', source: 'manual' } } }])
  const r = applyTermOverrides({ season: { ...season, i18nPending: ['name'] }, stages: [pendingStage], bosses: [pendingBoss], pending: [
    { kind: 'unit', cn: '卢克', tw: '盧克', source: 'machine', count: 3 },
    { kind: 'unit', cn: '老练佣兵', tw: '老練傭兵', source: 'machine', count: 5 },
  ] }, terms)
  assert.equal(r.bosses[0].i18nPending, undefined)
  assert.equal(r.stages[0].raid!.unitDict['853501'].pending, undefined)
  assert.equal(r.stages[0].raid!.unitDict['2203012'].pending, true)
  assert.deepEqual(r.season.i18nPending, ['name'])
})
