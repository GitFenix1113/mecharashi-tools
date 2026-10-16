import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMechLineage, incomingRelations, relationIssues } from './mechLineage.ts'
import type { Mech, MechLoreDoc } from '../../types'

const mech = (id: string) => ({ id, name: id }) as unknown as Mech
const mechs = ['a', 'b', 'c', 'd'].map(mech)
const doc = (id: string, relations: MechLoreDoc['relations'], modelNo?: string): MechLoreDoc => ({ id, chapters: [], relations, modelNo })

test('自己連出去的在前（照陣列順序），反查的在後；同一台只出現一次', () => {
  const docs = [
    doc('a', [{ mechId: 'c', kind: 'base' }, { mechId: 'b', kind: 'rival' }]),
    doc('b', [{ mechId: 'a', kind: 'rival' }], 'B-01'),
    doc('d', [{ mechId: 'a', kind: 'variant', note: '重裝版' }]),
  ]
  const out = buildMechLineage('a', docs[0].relations, mechs, docs)
  assert.deepEqual(out.map((x) => [x.mech.id, x.dir, x.kind]), [['c', 0, 'base'], ['b', 0, 'rival'], ['d', 1, 'variant']])
  assert.equal(out[1].modelNo, 'B-01')
  assert.equal(out[2].note, '重裝版')
})

test('relations 用呼叫端給的那份（編輯台預覽吃表單），不讀 DB 裡自己的文件', () => {
  const docs = [doc('a', [{ mechId: 'b' }])]
  assert.deepEqual(buildMechLineage('a', [{ mechId: 'c', kind: 'series' }], mechs, docs).map((x) => x.mech.id), ['c'])
})

test('指向已刪掉的機甲、指向自己的略過', () => {
  const docs = [doc('a', [{ mechId: 'gone' }, { mechId: 'a' }, { mechId: 'b' }]), doc('a2', [{ mechId: 'a' }])]
  assert.deepEqual(buildMechLineage('a', docs[0].relations, mechs, docs).map((x) => x.mech.id), ['b'])
})

test('relationIssues：沒選機甲、同一台兩次', () => {
  assert.deepEqual(relationIssues(undefined), [])
  assert.deepEqual(relationIssues([{ mechId: 'a' }, { mechId: 'b', kind: 'base' }]), [])
  assert.deepEqual(relationIssues([{ mechId: '' }, { mechId: 'a' }, { mechId: 'a' }]), ['1 條還沒選機甲', '同一台選了兩次：a'])
})

test('incomingRelations：只列別台的、不含自己', () => {
  const docs = [doc('a', [{ mechId: 'a' }]), doc('b', [{ mechId: 'a', kind: 'base' }, { mechId: 'c' }]), doc('c', [{ mechId: 'a' }])]
  assert.deepEqual(incomingRelations('a', docs).map((x) => [x.from, x.relation.kind]), [['b', 'base'], ['c', undefined]])
})
