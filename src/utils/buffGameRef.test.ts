// BUFF 官方 ID（BuffGameRef）的解析與連結狀態
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GameBuff } from '../types'
import { parseBufIds, toBuffGameRef, formatBufIds, buffLinkState, indexBufIds, otherHolders, isKeywordBufId } from './buffGameRef.ts'

test('parseBufIds：各種分隔字元、去重、由小到大', () => {
  assert.deepEqual(parseBufIds('7100304, 7100303'), { ids: [7100303, 7100304], invalid: [] })
  assert.deepEqual(parseBufIds('1004021、6003061，5007516；1004021'), { ids: [1004021, 5007516, 6003061], invalid: [] })
  assert.deepEqual(parseBufIds('  900133\n1017503  '), { ids: [900133, 1017503], invalid: [] })
  assert.deepEqual(parseBufIds(''), { ids: [], invalid: [] })
  assert.deepEqual(parseBufIds(' , ，'), { ids: [], invalid: [] })
})

test('parseBufIds：不是正整數的片段列為 invalid，不混進 ID', () => {
  assert.deepEqual(parseBufIds('123, abc, 0, -5, 1.5, 99999999999999999999'), { ids: [123], invalid: ['abc', '0', '-5', '1.5', '99999999999999999999'] })
})

test('toBuffGameRef／formatBufIds：空陣列＝未連結（undefined），來回一致', () => {
  assert.equal(toBuffGameRef([]), undefined)
  assert.deepEqual(toBuffGameRef([1, 2]), { bufIds: [1, 2] })
  assert.equal(formatBufIds(undefined), '')
  assert.equal(formatBufIds({ bufIds: [1, 2] }), '1, 2')
  assert.deepEqual(parseBufIds(formatBufIds({ bufIds: [5, 9] })).ids, [5, 9])
})

test('isKeywordBufId：900000–900999', () => {
  assert.equal(isKeywordBufId(900133), true)
  assert.equal(isKeywordBufId(900000), true)
  assert.equal(isKeywordBufId(901000), false)
  assert.equal(isKeywordBufId(7100303), false)
})

const buff = (over: Partial<GameBuff> = {}): GameBuff => ({ id: 'buff_甲', name: '甲', description: '', buffType: 'state', effects: [], ...over })

test('buffLinkState：無等級看頂層', () => {
  assert.equal(buffLinkState(buff()), 'unlinked')
  assert.equal(buffLinkState(buff({ gameRef: { bufIds: [] } })), 'unlinked')
  assert.equal(buffLinkState(buff({ gameRef: { bufIds: [1] } })), 'linked')
})

test('buffLinkState：分級看每一級，頂層的關鍵字記錄只算部分', () => {
  const lv = (level: number, ids?: number[]) => ({ level, ...(ids && { gameRef: { bufIds: ids } }) })
  assert.equal(buffLinkState(buff({ levels: [lv(1), lv(2)] })), 'unlinked')
  assert.equal(buffLinkState(buff({ levels: [lv(1, [10]), lv(2)] })), 'partial')
  assert.equal(buffLinkState(buff({ gameRef: { bufIds: [900133] }, levels: [lv(1), lv(2)] })), 'partial')
  assert.equal(buffLinkState(buff({ levels: [lv(1, [10]), lv(2, [10])] })), 'linked')
})

test('indexBufIds／otherHolders：同一份 BUFF 的不同級共用 ID 不算重複，跨 BUFF 才算', () => {
  const all = [
    buff({ id: 'buff_幹勁', name: '幹勁', levels: [{ level: 1, gameRef: { bufIds: [3014508] } }, { level: 2, gameRef: { bufIds: [3014508] } }] }),
    buff({ id: 'buff_乙', name: '乙', gameRef: { bufIds: [3014508, 7] } }),
  ]
  const idx = indexBufIds(all)
  assert.equal(idx.get(3014508)?.length, 3)
  assert.deepEqual(otherHolders([3014508], idx, 'buff_幹勁'), [{ id: 3014508, holders: [{ buffId: 'buff_乙', buffName: '乙' }] }])
  assert.deepEqual(otherHolders([3014508, 7], idx, 'buff_乙').map((x) => [x.id, x.holders.map((h) => h.level)]), [[3014508, [1, 2]]])
  assert.deepEqual(otherHolders([999], idx, 'buff_乙'), [])
})
