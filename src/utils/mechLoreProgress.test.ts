import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasMechLoreGap, mechLoreProgressOf, summarizeMechLoreProgress } from './mechLoreProgress.ts'
import type { MechLoreDoc } from '../types'

const makers = new Set(['Doll', 'UKB'])

test('還沒建文件：全缺；塗裝總數仍照 build 清單', () => {
  const p = mechLoreProgressOf(undefined, ['S1', '02'], makers)
  assert.deepEqual(p, { hasIntro: false, hasModel: false, hasMaker: false, relations: 0, specs: 0, chapters: 0, drafts: 0, skinsTotal: 2, skinsDone: 0 })
  for (const g of ['noIntro', 'noModel', 'noMaker', 'skinUnnamed'] as const) assert.ok(hasMechLoreGap(p, g), g)
  assert.ok(!hasMechLoreGap(p, 'hasDraft'))
})

test('maker 對不到任何一家算缺；空白介紹與型號算缺；半填的技術檔案列不算', () => {
  const doc: MechLoreDoc = {
    id: 'm', chapters: [], intro: '  ', modelNo: ' ', maker: 'Nope',
    specs: [{ label: '量產', value: '是' }, { label: '核心', value: '' }],
  }
  const p = mechLoreProgressOf(doc, [], makers)
  assert.equal(p.hasIntro, false)
  assert.equal(p.hasModel, false)
  assert.equal(p.hasMaker, false)
  assert.equal(p.specs, 1)
})

test('塗裝：有名稱或刻意隱藏都算處理過；DB 裡對不到圖的殘留不算', () => {
  const doc: MechLoreDoc = { id: 'm', chapters: [], maker: 'Doll', skins: [{ key: 'S1', name: '雪原' }, { key: '02', hidden: true }, { key: 'gone', name: 'x' }] }
  const p = mechLoreProgressOf(doc, ['S1', '02', '03'], makers)
  assert.equal(p.hasMaker, true)
  assert.equal(p.skinsDone, 2)
  assert.ok(hasMechLoreGap(p, 'skinUnnamed'))
})

test('總計：有章節以「非草稿章」算', () => {
  const a = mechLoreProgressOf({ id: 'a', chapters: [{ key: 'p1', title: '', body: '' }, { key: 'p2', title: '', body: '', draft: true }], relations: [{ mechId: 'b' }] }, [], makers)
  const b = mechLoreProgressOf({ id: 'b', chapters: [{ key: 'p1', title: '', body: '', draft: true }] }, ['S1'], makers)
  const s = summarizeMechLoreProgress([a, b])
  assert.equal(s.mechs, 2)
  assert.equal(s.withChapters, 1)
  assert.equal(s.chapters, 3)
  assert.equal(s.drafts, 2)
  assert.equal(s.withRelations, 1)
  assert.equal(s.skinsTotal, 1)
})
