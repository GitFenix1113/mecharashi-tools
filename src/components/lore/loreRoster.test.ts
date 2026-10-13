import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLoreGroups, byDebutDesc, loreOrder, matchesLoreQuery, UNCLASSIFIED, UNVERSIONED, withLoreNames, type RosterPilot } from './loreRoster.ts'
import type { Pilot } from '../../types'

const P = (id: string, cls: string, debutVersion?: string, extra: Partial<RosterPilot> = {}): RosterPilot =>
  ({ id, name: id, class: cls as RosterPilot['class'], debutVersion, fullName: '', faction: '', ...extra })

const pilots = [
  P('pilot_001', '守護者', '1.0'),
  P('pilot_002', '格鬥家', '3.4'),
  P('pilot_003', '格鬥家', '1.1'),
  P('pilot_004', '突擊手'),
  P('pilot_005', '???', '2.0'),
  P('pilot_006', '格鬥家', '3.4'),
]

test('依職業：遊戲內順序（格鬥家→突擊手→…→守護者），未知職業殿後；組內新版本在前、同版依 id', () => {
  const g = buildLoreGroups(pilots, 'class')
  assert.deepEqual(g.map((x) => x.key), ['格鬥家', '突擊手', '守護者', UNCLASSIFIED])
  assert.deepEqual(g[0].items.map((p) => p.id), ['pilot_002', 'pilot_006', 'pilot_003'])
  assert.equal(g[0].label, '格鬥家')
})

test('依登場版本：數值遞減、未標註殿後；標題加 v', () => {
  const g = buildLoreGroups(pilots, 'debut')
  assert.deepEqual(g.map((x) => x.key), ['3.4', '2.0', '1.1', '1.0', UNVERSIONED])
  assert.deepEqual(g.map((x) => x.label), ['v3.4', 'v2.0', 'v1.1', 'v1.0', UNVERSIONED])
})

test('loreOrder 就是分組攤平：切換列的「下一位」＝牆上的下一位', () => {
  assert.deepEqual(loreOrder(pilots, 'class').map((p) => p.id), ['pilot_002', 'pilot_006', 'pilot_003', 'pilot_004', 'pilot_001', 'pilot_005'])
})

test('byDebutDesc：未填版本不當成 0，排在所有有版本的後面', () => {
  const sorted = [P('b', 'x'), P('a', 'x', '0.5'), P('c', 'x')].sort(byDebutDesc)
  assert.deepEqual(sorted.map((p) => p.id), ['a', 'b', 'c'])
})

test('搜尋：英文名、全名、陣營、版本都比得到，不分大小寫；空字串全部通過', () => {
  const rosa = P('pilot_003_洛莎', '突擊手', '1.0', { name: '洛莎', fullName: '洛莎·迪亞茲', nameEn: 'Rosa Diaz', faction: '北陸聯合' })
  assert.ok(matchesLoreQuery(rosa, 'ros'))
  assert.ok(matchesLoreQuery(rosa, 'DIAZ'))
  assert.ok(matchesLoreQuery(rosa, '迪亞茲'))
  assert.ok(matchesLoreQuery(rosa, '北陸'))
  assert.ok(matchesLoreQuery(rosa, 'v1.0'))
  assert.ok(matchesLoreQuery(rosa, '  '))
  assert.ok(!matchesLoreQuery(rosa, '尼爾'))
})

test('withLoreNames：英文名從 pilotLore 依 id 併進來（PLAN-042-E）；沒有就不加欄位、順序不變', () => {
  const ps = [P('pilot_003_洛莎', '突擊手'), P('pilot_001', '守護者')] as unknown as Pilot[]
  const out = withLoreNames(ps, [{ id: 'pilot_003_洛莎', nameEn: ' Rosa Diaz ' }, { id: 'pilot_001', nameEn: '' }, { id: 'pilot_x', nameEn: 'Ghost' }])
  assert.deepEqual(out.map((p) => p.id), ['pilot_003_洛莎', 'pilot_001'])
  assert.equal(out[0].nameEn, 'Rosa Diaz')
  assert.ok(!('nameEn' in out[1]))
  assert.equal(out[1], ps[1])   // 沒有英文名的那位原物件直接沿用
  assert.ok(matchesLoreQuery(out[0], 'rosa'))
  // pilotLore 讀不到（空陣列）→ 原樣回傳
  assert.deepEqual(withLoreNames(ps, []), ps)
})
