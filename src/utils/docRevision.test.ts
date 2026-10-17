// 文件版本號與存檔衝突判定（PLAN-042-H 後續）
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRevision, revOf, revisionLabel, withoutRevisionMeta } from './docRevision.ts'

test('沒有 rev 欄位、文件不存在、亂值都算第 0 版', () => {
  assert.equal(revOf(null), 0)
  assert.equal(revOf(undefined), 0)
  assert.equal(revOf({}), 0)
  assert.equal(revOf({ rev: 3 }), 3)
  // 讀 Firestore 回來沒有型別保障：字串、負數、小數都不能當版本號用
  assert.equal(revOf({ rev: '3' }), 0)
  assert.equal(revOf({ rev: -1 }), 0)
  assert.equal(revOf({ rev: 1.5 }), 0)
})

test('基準與現值相等才放行，新版本號＝現值 + 1', () => {
  assert.deepEqual(checkRevision(4, { rev: 4 }), { ok: true, nextRev: 5 })
  // 功能上線前的舊文件：兩邊都是 0，第一次存檔變第 1 版
  assert.deepEqual(checkRevision(0, { chapters: [] }), { ok: true, nextRev: 1 })
  // 新建：文件還不存在
  assert.deepEqual(checkRevision(0, null), { ok: true, nextRev: 1 })
})

test('兩個分頁從同一版改起：先存的過、後存的被擋', () => {
  const server = { rev: 7 }
  const tabA = checkRevision(7, server)
  assert.equal(tabA.ok, true)
  if (tabA.ok) server.rev = tabA.nextRev
  assert.deepEqual(checkRevision(7, server), { ok: false, baseRev: 7, currentRev: 8 })
})

test('兩人同時替同一位建檔：後建的那份撞到先建的第 1 版', () => {
  assert.deepEqual(checkRevision(0, { rev: 1 }), { ok: false, baseRev: 0, currentRev: 1 })
})

test('現值比基準小也擋（被刪掉重建、或被改回舊值），文件被刪光也擋', () => {
  assert.deepEqual(checkRevision(5, { rev: 2 }), { ok: false, baseRev: 5, currentRev: 2 })
  assert.deepEqual(checkRevision(5, null), { ok: false, baseRev: 5, currentRev: 0 })
})

test('算 changedFields 前拿掉版本號欄位，其餘原樣保留', () => {
  const d = { rev: 3, updatedAt: '2026-10-17T00:00:00.000Z', intro: '簡介', chapters: [] }
  assert.deepEqual(withoutRevisionMeta(d), { intro: '簡介', chapters: [] })
  assert.equal(d.rev, 3, '不可改到傳入的物件')
})

test('提示文字：第 0 版不顯示編號', () => {
  assert.equal(revisionLabel(0), '未編號的舊版')
  assert.equal(revisionLabel(12), '第 12 版')
})
