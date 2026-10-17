import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMechGroups, byMakerOrder, MAKER_UNKNOWN_GROUP } from './mechRoster.ts'
import { UNVERSIONED, WEIGHT_UNKNOWN } from './loreRoster.ts'
import type { MechMaker } from '../../types/index.ts'

const M = (id: string, debutVersion?: string, maker?: string) => ({ id, debutVersion, maker })
const makers: MechMaker[] = [
  { id: 'Doll', name: '多爾集團', order: 5 },
  { id: 'Obsidian', name: '黑曜石集團', order: 2 },
  { id: 'AP', name: '', order: 11 },
  { id: 'DONAU', name: '多瑙河公司' },
]
const makerOf = (m: { maker?: string }) => m.maker

test('依廠商：照 order 排、組內新版本在前、未知與對不到的廠商歸「廠商未載」殿後', () => {
  const g = buildMechGroups([
    M('mech_002', '1.0', 'Doll'), M('mech_010', '3.2', 'Doll'), M('mech_001', '1.0', 'Obsidian'),
    M('mech_093', undefined, undefined), M('mech_050', '2.0', 'NotAMaker'),
  ], 'class', makerOf, makers)
  assert.deepEqual(g.map((x) => x.key), ['Obsidian', 'Doll', MAKER_UNKNOWN_GROUP])
  assert.deepEqual(g[1].items.map((x) => x.id), ['mech_010', 'mech_002'])
  assert.deepEqual(g[2].items.map((x) => x.id), ['mech_050', 'mech_093'], '有版本的在前，沒版本的殿後')
  assert.equal(g[0].maker?.id, 'Obsidian')
  assert.equal(g[2].maker, undefined)
})

test('依廠商：沒有成員的廠商不出現；沒有名字的廠商用 id 當組名', () => {
  const g = buildMechGroups([M('mech_050', '2.0', 'AP')], 'class', makerOf, makers)
  assert.deepEqual(g.map((x) => [x.key, x.label]), [['AP', 'AP']])
})

test('依登場版本：版本遞減、未標註殿後', () => {
  const g = buildMechGroups([M('a', '1.0'), M('b', '3.6'), M('c', undefined), M('d', '3.6')], 'debut', makerOf, makers)
  assert.deepEqual(g.map((x) => x.label), ['v3.6', 'v1.0', UNVERSIONED])
  assert.deepEqual(g[0].items.map((x) => x.id), ['b', 'd'])
})

test('byMakerOrder：沒填 order 的排在有值的後面，再依 id', () => {
  const s = [...makers].sort(byMakerOrder).map((m) => m.id)
  assert.deepEqual(s, ['Obsidian', 'Doll', 'AP', 'DONAU'])
})

test('依類型：輕→中→重；armorType 的「中甲」併成畫面短名「中型」；空值歸「類型未載」殿後', () => {
  const T = (id: string, armorType: string | undefined, debutVersion?: string) => ({ id, debutVersion, armorType })
  const g = buildMechGroups([T('a', '重型', '1.0'), T('b', '中甲', '1.0'), T('c', '輕型', '2.0'), T('d', '中甲', '3.6'), T('e', undefined)], 'weight', () => undefined, makers)
  assert.deepEqual(g.map((x) => [x.key, x.label]), [['輕型', '輕型'], ['中型', '中型'], ['重型', '重型'], [WEIGHT_UNKNOWN, WEIGHT_UNKNOWN]])
  assert.deepEqual(g[1].items.map((x) => x.id), ['d', 'b'])
  assert.equal(g[0].maker, undefined, '依類型分組不帶廠商')
})
