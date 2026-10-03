// gh-pages 退役檔清理的規則測試（scripts/prune-gh-pages.mjs 的 plan()）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plan } from './prune-gh-pages.mjs'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-20T00:00:00Z')
const run = (built, onSite, book, days = 30) => plan({ built: new Set(built), onSite, book, now: NOW, graceMs: days * DAY })

test('仍在新版裡的檔：保留、標成在用', () => {
  const r = run(['index-a.js'], ['index-a.js'], { 'index-a.js': null })
  assert.deepEqual(r.del, [])
  assert.deepEqual(r.next, { 'index-a.js': null })
})

test('這次剛被取代的檔：從這次起算，不刪', () => {
  const r = run(['index-b.js'], ['index-a.js', 'index-b.js'], { 'index-a.js': null })
  assert.deepEqual(r.del, [])
  assert.equal(r.next['index-a.js'], NOW)
  assert.equal(r.next['index-b.js'], null)
})

test('退役滿寬限期才刪；差一點就不刪', () => {
  const book = { 'old.js': NOW - 30 * DAY, 'young.js': NOW - 30 * DAY + 1 }
  const r = run([], ['old.js', 'young.js'], book)
  assert.deepEqual(r.del, ['old.js'])
  assert.equal(r.next['young.js'], NOW - 30 * DAY + 1)
  assert.ok(!('old.js' in r.next))
})

test('第一次執行（沒有 ledger）：全部從今天開始倒數，什麼都不刪', () => {
  const r = run(['new.js'], ['a.js', 'b.js', 'new.js'], {})
  assert.deepEqual(r.del, [])
  assert.equal(r.next['a.js'], NOW)
  assert.equal(r.next['b.js'], NOW)
})

test('被回滾帶回來的檔：重新標成在用（退役時間清掉）', () => {
  const r = run(['back.js'], ['back.js'], { 'back.js': NOW - 40 * DAY })
  assert.deepEqual(r.del, [])
  assert.equal(r.next['back.js'], null)
})

test('線上已經不存在的條目自然從 ledger 消失', () => {
  const r = run([], [], { 'gone.js': NOW - DAY })
  assert.deepEqual(r.next, {})
})

test('寬限 0 天：一退役就刪（docs 類用得到）', () => {
  const r = run([], ['x.html'], {}, 0)
  assert.deepEqual(r.del, ['x.html'])
})
