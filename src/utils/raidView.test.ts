import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRaidText, plainRaidText, whenLabel, turnTimeline, skillChangedFromNormal, sortBossSkills, unitCount, raidRewardsFromTimeline, relatedSeasons } from './raidView.ts'
import type { BossSkill, RaidReinforcement } from '../types/boss.ts'

test('parseRaidText：文字、強調、引用（含標籤）、單位', () => {
  assert.deepEqual(parseRaidText('對⟦unit:853501⟧施加⟦em:2⟧層⟦buf:98409012⟧與⟦buf:5|宕機⟧'), [
    { t: 'text', v: '對' }, { t: 'unit', key: '853501' }, { t: 'text', v: '施加' }, { t: 'em', v: '2' },
    { t: 'text', v: '層' }, { t: 'ref', key: 'buf:98409012' }, { t: 'text', v: '與' }, { t: 'ref', key: 'buf:5', label: '宕機' },
  ])
  assert.deepEqual(parseRaidText(''), [])
  assert.deepEqual(parseRaidText('沒有記號'), [{ t: 'text', v: '沒有記號' }])
})

test('plainRaidText：記號換成名稱', () => {
  const s = plainRaidText('⟦unit:1⟧獲得⟦buf:2⟧（⟦em:10%⟧）', { unit: () => '盧克', ref: () => '共振護盾' })
  assert.equal(s, '盧克獲得共振護盾（10%）')
})

test('whenLabel', () => {
  assert.equal(whenLabel({ kind: 'turn', turns: [2, 7], timing: 'start' }), '第 2、7 回合開始')
  assert.equal(whenLabel({ kind: 'everyTurn', timing: 'end' }), '每回合結束')
  assert.equal(whenLabel({ kind: 'everyTurn', timing: 'start', from: 3 }), '第 3 回合起每回合開始')
  assert.equal(whenLabel({ kind: 'start' }), '開戰時')
  assert.equal(whenLabel({ kind: 'unknown' }), '特定條件觸發')
})

test('turnTimeline：增援、預警、懸賞期限、回合上限排進回合格；其他時點另列', () => {
  const rf = (turns: number[], warn?: number[]): RaidReinforcement => ({
    when: { kind: 'turn', turns, timing: 'start' }, ...(warn ? { warn: { kind: 'turn', turns: warn, timing: 'start' } } : {}),
    units: [{ unit: '2203012', count: 2 }],
  })
  const guard: RaidReinforcement = { when: { kind: 'everyTurn', timing: 'end' }, units: [{ unit: '840902', count: 1 }] }
  const tl = turnTimeline({
    turnLimit: 8,
    reinforcements: [rf([2], [1]), rf([3], [2]), guard],
    bounties: [{ name: '速戰速決', desc: '6回合勝利' }, { name: '安然無恙', desc: '我方全員存活' }],
  })
  assert.equal(tl.cells.length, 8)
  assert.equal(tl.cells[0].warns.length, 1)
  assert.equal(tl.cells[1].arrivals.length, 1)
  assert.equal(tl.cells[1].warns.length, 1)
  assert.deepEqual(tl.cells[5].bounties, ['速戰速決'])
  assert.ok(tl.cells[7].isLimit)
  assert.deepEqual(tl.others, [guard])
})

test('turnTimeline：沒有回合上限時以最後一次增援決定格數', () => {
  const tl = turnTimeline({ turnLimit: 0, bounties: [], reinforcements: [{ when: { kind: 'turn', turns: [5], timing: 'end' }, units: [] }] })
  assert.equal(tl.cells.length, 5)
  assert.equal(tl.cells[4].arrivals[0].timing, 'end')
})

test('skillChangedFromNormal：同名不同說明＝changed、初試沒有＝new、初試本身不標', () => {
  const normal: BossSkill[] = [{ name: '無畏前行Ⅰ', description: '3 格', kind: 'talent' }]
  assert.equal(skillChangedFromNormal({ name: '無畏前行Ⅰ', description: '4 格', kind: 'talent' }, normal, false), 'changed')
  assert.equal(skillChangedFromNormal({ name: '無畏前行Ⅰ', description: '3 格', kind: 'talent' }, normal, false), null)
  assert.equal(skillChangedFromNormal({ name: '新技能', description: 'x', kind: 'passive' }, normal, false), 'new')
  assert.equal(skillChangedFromNormal({ name: '無畏前行Ⅰ', description: '4 格', kind: 'talent' }, normal, true), null)
})

test('raidRewardsFromTimeline：期名比對（忽略空白）、專武對專屬機師', () => {
  const versions = [
    { upper: { armamentRaids: [{ name: '伏影', weapons: ['歸零協議', '誓殮'], weaponPilots: ['哈達威', '瑪阿特'], backpacks: ['重載者背包'] }] } },
    { lower: { armamentRaids: [{ name: '逐火之心' }] } },
  ]
  assert.deepEqual(raidRewardsFromTimeline(versions, '伏 影'), {
    weapons: [{ name: '歸零協議', pilot: '哈達威' }, { name: '誓殮', pilot: '瑪阿特' }], backpacks: ['重載者背包'],
  })
  assert.deepEqual(raidRewardsFromTimeline(versions, '逐火之心'), { weapons: [], backpacks: [] })
  assert.equal(raidRewardsFromTimeline(versions, '晨星困獸'), null)
})

test('sortBossSkills／unitCount', () => {
  const s = sortBossSkills([{ name: 'a', description: '', kind: 'passive' }, { name: 'b', description: '', kind: 'main' }, { name: 'c', description: '', kind: 'talent' }])
  assert.deepEqual(s.map((x) => x.name), ['b', 'c', 'a'])
  assert.equal(unitCount([{ unit: '1', count: 2 }, { unit: '2', count: 3 }]), 5)
})

test('relatedSeasons：同名首領互連，只列已公開的期、依期序、不含本期', () => {
  const seasons = [
    { id: 'raid-01', seq: 1, name: '一', published: true },
    { id: 'raid-16', seq: 16, name: '十六', published: true },
    { id: 'raid-20', seq: 20, name: '二十', published: true },
    { id: 'raid-21', seq: 21, name: '二一', published: false },
  ]
  const bosses = [
    { id: 'raid-20-g1-b1', name: '曼恩', seasonId: 'raid-20' },
    { id: 'raid-20-g2-b1', name: '只出現一次', seasonId: 'raid-20' },
    { id: 'raid-16-g3-b1', name: '曼恩', seasonId: 'raid-16' },
    { id: 'raid-01-g1-b1', name: '曼恩', seasonId: 'raid-01' },
    { id: 'raid-21-g1-b1', name: '曼恩', seasonId: 'raid-21' },
  ]
  assert.deepEqual(relatedSeasons('raid-20', bosses, seasons), {
    'raid-20-g1-b1': [{ id: 'raid-01', seq: 1, name: '一' }, { id: 'raid-16', seq: 16, name: '十六' }],
  })
})
