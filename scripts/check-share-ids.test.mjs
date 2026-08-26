/**
 * `scripts/check-share-ids.mjs` 的純邏輯測試 —— PLAN-052-C A-1
 *
 * 只測不碰 Firestore 的那幾支（`observeKind` / `diffKind` / `checkAliases` / `isFatal`）。
 * import 這支腳本不會啟動 CLI，也不會讀 serviceAccountKey —— 由 `import.meta.main` 守住。
 *
 * 為什麼這幾條值得測：這支腳本是「改號會不會炸掉既有分享碼」的唯一守門員，
 * 而它自己壞掉的症狀是**靜默放行** —— 跑起來一片綠，然後所有舊碼指到別人身上。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observeKind, diffKind, checkAliases, isFatal } from './check-share-ids.mjs'
import { buildShareIndex, ALIAS_BASE, SHARE_ID_MAX } from '../src/utils/loadoutCode/shareId.ts'

// ─── observeKind ─────────────────────────────────────────────────────────────

test('observeKind：推得出號碼的進 derived，別名的不進（兩區分開記帳）', () => {
  const o = observeKind('module', ['mod_4001', 'mod_4001_2'], { mod_4001_2: ALIAS_BASE + 1 })
  assert.deepEqual(o.derived, { 4001: 'mod_4001' })
  assert.deepEqual(o.unshareable, [])
})

test('observeKind：maxAssigned 只增不減 —— 刪掉最後一筆不可以讓水位倒退', () => {
  // 曾經發到 182，現在線上只剩到 100：水位必須守在 182，
  // 否則後台續號會從 101 重新發，把已經流出的 101‥182 全部回收
  const o = observeKind('weapon', ['weapon_100_甲'], {}, 182)
  assert.equal(o.maxAssigned, 182)
})

test('observeKind：線上出現比水位更高的號碼就抬高水位', () => {
  const o = observeKind('weapon', ['weapon_190_乙'], {}, 182)
  assert.equal(o.maxAssigned, 190)
})

test('observeKind：推導不出又沒別名的落進 unshareable，且已排序', () => {
  const o = observeKind('module', ['mod_乙', 'mod_甲', 'mod_4001'])
  assert.deepEqual(o.unshareable, ['mod_乙', 'mod_甲'].sort())
  assert.deepEqual(o.derived, { 4001: 'mod_4001' })
})

// ─── diffKind：分類本身就是嚴重度 ─────────────────────────────────────────────

test('diffKind：純新增 —— 既有分享碼一個都不受影響', () => {
  const locked = { derived: { 1: 'weapon_001_甲' } }
  const d = diffKind({ derived: { 1: 'weapon_001_甲', 2: 'weapon_002_乙' } }, locked)
  assert.deepEqual(d.added, [{ shareId: 2, docId: 'weapon_002_乙' }])
  assert.deepEqual(d.removed, [])
  assert.deepEqual(d.repointed, [])
})

test('diffKind：改指 —— 同一個號碼指到另一份文件（最危險的那一種）', () => {
  const locked = { derived: { 178: 'weapon_178_甲' } }
  const d = diffKind({ derived: { 178: 'weapon_178_乙' } }, locked)
  assert.deepEqual(d.repointed, [{ shareId: 178, from: 'weapon_178_甲', to: 'weapon_178_乙' }])
  assert.equal(d.added.length + d.removed.length, 0, '改指不可以被拆成一加一減')
})

test('diffKind：改號 = 舊號消失 ＋ 新號新增，兩邊都要看得到', () => {
  const locked = { derived: { 178: 'weapon_178_甲' } }
  const d = diffKind({ derived: { 179: 'weapon_179_甲' } }, locked)
  assert.deepEqual(d.removed, [{ shareId: 178, docId: 'weapon_178_甲' }])
  assert.deepEqual(d.added, [{ shareId: 179, docId: 'weapon_179_甲' }])
})

test('diffKind：沒有 lock（首次 --init）時一切都算新增，不會誤報改指', () => {
  const d = diffKind({ derived: { 1: 'a', 2: 'b' } }, null)
  assert.equal(d.added.length, 2)
  assert.equal(d.removed.length + d.repointed.length, 0)
})

// ─── checkAliases ────────────────────────────────────────────────────────────

test('checkAliases：別名掉進推導區要抓出來 —— 那是未來與新實體撞號的種子', () => {
  const r = checkAliases({ mod_x: 4001, mod_y: ALIAS_BASE + 1 }, null)
  assert.deepEqual(r.outOfBand, [{ docId: 'mod_x', shareId: 4001 }])
})

test('checkAliases：超過 varint 上限也算越界', () => {
  const r = checkAliases({ mod_x: SHARE_ID_MAX + 1 }, null)
  assert.equal(r.outOfBand.length, 1)
})

test('checkAliases：同一個號碼指派給兩份文件 —— 人工區沒有自動剔除，必須大聲說', () => {
  const n = ALIAS_BASE + 7
  const r = checkAliases({ mod_甲: n, mod_乙: n }, null)
  assert.deepEqual(r.reused, [{ shareId: n, docIds: ['mod_乙', 'mod_甲'].sort() }])
})

test('checkAliases：別名指向已不存在的文件 ⇒ stale（那個號碼從此解不開）', () => {
  const aliases = { mod_已刪除: ALIAS_BASE + 1 }
  const index = buildShareIndex('module', ['mod_4001'], aliases)
  assert.deepEqual(checkAliases(aliases, index).stale, ['mod_已刪除'])
})

// ─── isFatal ─────────────────────────────────────────────────────────────────

const emptyKind = () => ({
  diff: { added: [], removed: [], repointed: [] },
  collisions: [],
  aliasIssues: { outOfBand: [], reused: [], stale: [] },
})

test('isFatal：只有新增不算致命 —— 每次改版都會新增，讓它每次都紅等於訓練大家無視', () => {
  const k = emptyKind()
  k.diff.added = [{ shareId: 9, docId: 'x' }]
  assert.equal(isFatal({ kinds: { weapon: k } }), false)
})

test('isFatal：改指／消失／撞號／別名三種問題，任何一種都要 exit 1', () => {
  const cases = [
    (k) => { k.diff.repointed = [{ shareId: 1, from: 'a', to: 'b' }] },
    (k) => { k.diff.removed = [{ shareId: 1, docId: 'a' }] },
    (k) => { k.collisions = [{ shareId: 1, docIds: ['a', 'b'] }] },
    (k) => { k.aliasIssues.outOfBand = [{ docId: 'a', shareId: 1 }] },
    (k) => { k.aliasIssues.reused = [{ shareId: 1, docIds: ['a', 'b'] }] },
    (k) => { k.aliasIssues.stale = ['a'] },
  ]
  for (const [i, mutate] of cases.entries()) {
    const k = emptyKind()
    mutate(k)
    assert.equal(isFatal({ kinds: { weapon: k } }), true, `第 ${i + 1} 種致命情形沒被抓到`)
  }
})
