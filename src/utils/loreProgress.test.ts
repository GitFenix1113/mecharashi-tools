// PLAN-042-E D-3：故事館編輯台的進度總覽
//   node --test src/utils/loreProgress.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasLoreGap, loreProgressOf, summarizeLoreProgress } from './loreProgress.ts'
import type { LoreDoc } from '../types'

const doc = (d: Partial<LoreDoc>): LoreDoc => ({ id: 'pilot_001', chapters: [], ...d })

test('loreProgressOf：還沒建文件 → 全部是零，外觀總數照 build 清單', () => {
  assert.deepEqual(loreProgressOf(undefined, ['Pilot_1B', 'Pilot_1C']), {
    hasIntro: false, dossierFields: 0, chapters: 0, drafts: 0, skinsTotal: 2, skinsDone: 0, hasLogo: false,
  })
})

test('loreProgressOf：簡介要有非空白字、檔案欄位數不含陣營、草稿章另計', () => {
  const p = loreProgressOf(doc({
    intro: '  \n ',
    dossier: { gender: '女', height: '', extra: [{ label: '生日', value: '3月2日' }, { label: '空的', value: '' }] },
    chapters: [{ key: 'part-1', title: 'a', body: '' }, { key: 'part-2', title: 'b', body: '', draft: true }],
    factionLogos: ['Icon_logo_0025_00'],
  }), [])
  assert.equal(p.hasIntro, false)
  assert.equal(p.dossierFields, 2)
  assert.equal(p.chapters, 2)
  assert.equal(p.drafts, 1)
  assert.equal(p.hasLogo, true)
})

test('loreProgressOf：外觀「已處理」＝有名稱或刻意隱藏；DB 有、清單沒有的 key 不算', () => {
  const p = loreProgressOf(doc({
    skins: [
      { key: 'Pilot_1B', name: '夏日' },
      { key: 'Pilot_1C', hidden: true },
      { key: 'Pilot_1D', name: '  ' },
      { key: 'Pilot_GONE', name: '已移除的外觀' },
    ],
  }), ['Pilot_1B', 'Pilot_1C', 'Pilot_1D', 'Pilot_1E'])
  assert.equal(p.skinsTotal, 4)
  assert.equal(p.skinsDone, 2)
  assert.ok(hasLoreGap(p, 'skinUnnamed'))
})

test('hasLoreGap：五種篩選', () => {
  const full = loreProgressOf(doc({
    intro: '簡介', dossier: { gender: '女' }, factionLogos: ['Icon_logo_0025_01'],
    chapters: [{ key: 'part-1', title: 'a', body: '' }], skins: [{ key: 'Pilot_1B', name: '夏日' }],
  }), ['Pilot_1B'])
  for (const g of ['noIntro', 'noDossier', 'hasDraft', 'skinUnnamed', 'noLogo'] as const) assert.equal(hasLoreGap(full, g), false, g)
  const empty = loreProgressOf(undefined, [])
  assert.ok(hasLoreGap(empty, 'noIntro'))
  assert.ok(hasLoreGap(empty, 'noDossier'))
  assert.ok(hasLoreGap(empty, 'noLogo'))
  assert.ok(!hasLoreGap(empty, 'hasDraft'))
  assert.ok(!hasLoreGap(empty, 'skinUnnamed'))   // 沒有外觀的機師不算「未命名」
})

test('summarizeLoreProgress：有逸聞的機師只算有非草稿章的', () => {
  const s = summarizeLoreProgress([
    loreProgressOf(doc({ intro: 'a', chapters: [{ key: 'part-1', title: '', body: '', draft: true }] }), ['Pilot_1B']),
    loreProgressOf(doc({ dossier: { height: '170' }, chapters: [{ key: 'part-1', title: '', body: '' }] }), []),
    loreProgressOf(undefined, ['Pilot_3B', 'Pilot_3C']),
  ])
  assert.deepEqual(s, { pilots: 3, intro: 1, dossier: 1, withChapters: 1, chapters: 2, drafts: 1, skinsDone: 0, skinsTotal: 3, logos: 0 })
})
