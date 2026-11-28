// 劇情書頁的關卡導覽（storyNav.ts，PLAN-042-I A-2）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 用真實書檔測：關卡列的收納規則（計畫書決策三）是為了讓最長的幾本在桌機視窗裡放得下，
// 規則一旦被資料改版打破（例如遭遇戰開始有編號），這裡會先紅。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { StoryBook, StoryCatalog, StoryStage } from './storyTypes.ts'
import {
  OUTLINE_MAX_ENTRIES,
  legacyHashStage,
  locateStage,
  resolveStageIndex,
  stageLabel,
  stageNeighbors,
  stageOutline,
  stagePath,
  visibleRowCount,
} from './storyNav.ts'

const DIR = new URL('../../../data/story/', import.meta.url)
const catalog = JSON.parse(fs.readFileSync(new URL('index.json', DIR), 'utf8')) as StoryCatalog
const readBook = (id: string) => JSON.parse(fs.readFileSync(new URL(`${id.replace('-', '/')}.json`, DIR), 'utf8')) as StoryBook

const flatten = (stages: StoryStage[]) =>
  stageOutline(stages).flatMap((s) => s.entries.flatMap((e) => [e.index, ...e.minors]))

test('每一本：關卡列恰好涵蓋每一關一次，順序與書檔相同', () => {
  for (const entry of catalog.books) {
    const book = readBook(entry.id)
    assert.deepEqual(flatten(book.stages), book.stages.map((_, i) => i), entry.id)
  }
})

test('main-4 靜寂法蘭河：遭遇戰全掛在正關底下、4 個支線另成一段', () => {
  const book = readBook('main-4')
  const outline = stageOutline(book.stages)
  const main = outline.find((s) => s.key === 'main')!
  const branch = outline.find((s) => s.key === 'branch')!
  assert.equal(branch.label, '支線')
  assert.equal(branch.entries.length, 4)
  // 本體每一列都是有編號的正關，沒有編號的小關一場都不在列上
  for (const e of main.entries) assert.ok(book.stages[e.index].code, `${book.stages[e.index].name} 應該是正關`)
  assert.equal(main.entries.reduce((n, e) => n + e.minors.length, 0), 12)
  // 3-1 物資配送後面掛著兩場（遭遇戰、突襲戰）
  assert.equal(main.entries[0].minors.length, 2)
})

test('event-20 忤逆行於今：一幕一段，段標題是幕名', () => {
  const book = readBook('event-20')
  const outline = stageOutline(book.stages)
  const groups = [...new Set(book.stages.map((s) => s.group).filter(Boolean))]
  assert.equal(outline.length, groups.length)
  assert.deepEqual(outline.map((s) => s.label), groups)
})

test('收納後的關卡列：每一本、停在任何一關，桌機關卡列都不超過 20 列（決策三的前提）', () => {
  // 20 列 ×約 25px＋列頭列尾約 140px ≈ 640px，放得進 1366×768 的館內 scrollport（722px，留 16px 黏頂）
  for (const entry of catalog.books) {
    const { stages } = readBook(entry.id)
    const outline = stageOutline(stages)
    for (const sec of outline) assert.ok(sec.foldable || sec.entries.length <= OUTLINE_MAX_ENTRIES, `${entry.id} ${sec.key} 沒切開`)
    const worst = Math.max(...stages.map((_, i) => visibleRowCount(outline, i)))
    assert.ok(worst <= 20, `${entry.id} 最壞 ${worst} 列`)
  }
})

test('event-8 逆止之疑：22 個正關、沒有分幕 → 切成 1～10、11～20、21～22 三截', () => {
  const { stages } = readBook('event-8')
  const outline = stageOutline(stages)
  assert.deepEqual(outline.map((s) => s.label), ['1～10', '11～20', '21～22'])
  assert.ok(outline.every((s) => s.foldable))
  // 停在第 15 關：另兩截各收成一列＋展開那一截的標題與 10 列
  assert.equal(visibleRowCount(outline, 14), 1 + 1 + 10 + 1)
})

test('locateStage：小關找得到它掛在哪個正關底下', () => {
  const book = readBook('main-4')
  const outline = stageOutline(book.stages)
  const minor = outline[0].entries[0].minors[0]
  const hit = locateStage(outline, minor)
  assert.equal(hit?.entry.index, outline[0].entries[0].index)
  assert.equal(locateStage(outline, 9999), null)
})

test('resolveStageIndex：書根＝第一關、找不到回 -1', () => {
  const { stages } = readBook('main-2')
  assert.equal(resolveStageIndex(stages, undefined), 0)
  assert.equal(resolveStageIndex(stages, stages[2].key), 2)
  assert.equal(resolveStageIndex(stages, 'w0'), -1)
  assert.equal(resolveStageIndex([], undefined), -1)
})

test('legacyHashStage：舊版錨點 #w108 認得就回 key', () => {
  const { stages } = readBook('main-2')
  assert.equal(legacyHashStage(stages, `#${stages[3].key}`), stages[3].key)
  assert.equal(legacyHashStage(stages, '#nope'), null)
  assert.equal(legacyHashStage(stages, ''), null)
})

test('stagePath：第一關就是書根，其餘帶關卡 key', () => {
  const { stages } = readBook('main-2')
  assert.equal(stagePath('main-2', stages, 0), '/lore/story/main-2')
  assert.equal(stagePath('main-2', stages, 2), `/lore/story/main-2/${stages[2].key}`)
})

test('stageLabel：有編號帶編號，小關只有名字', () => {
  assert.equal(stageLabel({ code: '1-3', name: '全頻道阻塞' }), '1-3 全頻道阻塞')
  assert.equal(stageLabel({ code: '', name: '遭遇戰' }), '遭遇戰')
})

test('stageNeighbors：書內換關，首末兩端接到隔壁那一本', () => {
  const { stages } = readBook('main-2')
  const mains = catalog.books.filter((b) => b.kind === 'main')
  const books = { prev: mains[0], next: mains[2] }
  assert.deepEqual(stageNeighbors(stages, 3, books), { prev: { kind: 'stage', index: 2 }, next: { kind: 'stage', index: 4 } })
  assert.deepEqual(stageNeighbors(stages, 0, books).prev, { kind: 'book', entry: mains[0] })
  assert.deepEqual(stageNeighbors(stages, stages.length - 1, books).next, { kind: 'book', entry: mains[2] })
  // 第一本的首關、最後一本的末關：再往外就沒有了
  assert.equal(stageNeighbors(stages, 0, {}).prev, undefined)
  assert.equal(stageNeighbors(stages, stages.length - 1, {}).next, undefined)
})
