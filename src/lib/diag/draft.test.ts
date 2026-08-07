// 草稿暫存層的行為鎖定（PLAN-045 Phase D-1）
//
// 為什麼值得測：這一層唯一的失效模式是**靜默的資料遺失** —— 草稿被誤清時沒有任何
// 錯誤訊息，使用者要等到下次需要還原時才發現東西不見了。而初版正好踩了兩個坑：
//   ① autosave 接在列表層監聽 `editing`，但使用者打字改的是編輯器內部的 `form`，
//      存下來的是「打開編輯器那一刻的原始快照」（提示會跳、還原出來卻是舊資料）；
//   ② 表單回到基準值時無條件 clearDraft，導致「還原後還沒動過就切走」
//      會把剛救回來的內容清掉。
// ① 是架構問題（已改為 useDraftWrite 接在編輯器內部）；② 的決策已抽成
// shouldClearOnRevert 純函式，在此釘住。

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// draft.ts 以 `typeof window !== 'undefined'` 判斷環境，且只在函式被呼叫時才檢查，
// 故在 import 之前先把 window stub 掛上即可。
const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  },
}

const {
  readDraft, writeDraft, clearDraft, hasAnyDraft, listDrafts,
  markRestored, isRestored, unmarkRestored, shouldClearOnRevert,
} = await import('./draft.ts')

beforeEach(() => {
  store.clear()
  unmarkRestored('modules')
  unmarkRestored('pilots')
})

// ─── shouldClearOnRevert：三種「看起來一樣」的狀態 ───────────────────────────

test('改了又改回原樣 → 清掉自己寫的那份假草稿', () => {
  assert.equal(shouldClearOnRevert(true, false), true)
})

test('只是打開看看（沒寫過草稿）→ 不動作', () => {
  assert.equal(shouldClearOnRevert(false, false), false)
})

test('受還原保護 → 絕不可清（初版就是這裡漏了，會靜默吃掉救回來的內容）', () => {
  // 還原後尚未動過：hasWritten=false，但保護旗標必須讓它無論如何都不清
  assert.equal(shouldClearOnRevert(false, true), false)
  // 還原後改了又改回還原時的樣子：hasWritten=true，仍不可清
  assert.equal(shouldClearOnRevert(true, true), false)
})

// ─── 儲存層 ──────────────────────────────────────────────────────────────────

test('write → read 往返，內容完整', () => {
  writeDraft({ kind: 'modules', id: 'mod_a', name: '折光陣列', savedAt: 1234, data: { id: 'mod_a', dmg: 30 } })
  const d = readDraft<{ id: string; dmg: number }>('modules')
  assert.equal(d?.name, '折光陣列')
  assert.equal(d?.savedAt, 1234)
  assert.deepEqual(d?.data, { id: 'mod_a', dmg: 30 })
})

test('欄位不齊的草稿一律當作沒有（半殘的草稿還原只會產生垃圾）', () => {
  store.set('mecharashi_draft_modules', JSON.stringify({ name: '只有名字' }))
  assert.equal(readDraft('modules'), null)
})

test('格式壞掉的草稿不拋錯，回 null', () => {
  store.set('mecharashi_draft_modules', '{ 這不是 JSON')
  assert.equal(readDraft('modules'), null)
})

test('缺 name 時退回用 id 顯示，不至於讓提示變空白', () => {
  store.set('mecharashi_draft_modules', JSON.stringify({ id: 'mod_a', data: {} }))
  assert.equal(readDraft('modules')?.name, 'mod_a')
})

test('各分頁的草稿互不干擾', () => {
  writeDraft({ kind: 'modules', id: 'm1', name: 'M', savedAt: 1, data: {} })
  writeDraft({ kind: 'pilots', id: 'p1', name: 'P', savedAt: 2, data: {} })
  assert.equal(readDraft('modules')?.name, 'M')
  assert.equal(readDraft('pilots')?.name, 'P')
  clearDraft('modules')
  assert.equal(readDraft('modules'), null)
  assert.equal(readDraft('pilots')?.name, 'P', '清 modules 不該影響 pilots')
})

// ─── 還原保護 ────────────────────────────────────────────────────────────────

test('clearDraft 會一併解除還原保護（否則旗標會殘留到下一份草稿）', () => {
  writeDraft({ kind: 'modules', id: 'm1', name: 'M', savedAt: 1, data: {} })
  markRestored('modules')
  assert.equal(isRestored('modules'), true)
  clearDraft('modules')
  assert.equal(isRestored('modules'), false, '草稿都沒了，保護旗標不該還在')
})

test('unmarkRestored 只解除保護、不刪草稿（切換編輯對象時用）', () => {
  writeDraft({ kind: 'modules', id: 'm1', name: 'M', savedAt: 1, data: {} })
  markRestored('modules')
  unmarkRestored('modules')
  assert.equal(isRestored('modules'), false)
  assert.ok(readDraft('modules'), '草稿本身必須留著')
})

// ─── hasAnyDraft：登出橫幅靠它決定要不要說「你的編輯已保住」───────────────────

test('hasAnyDraft 只認草稿鍵，不被其他 localStorage 內容誤導', () => {
  assert.equal(hasAnyDraft(), false)
  // 站上還有版本快取等其他鍵，不可被算成草稿——否則橫幅會叫使用者去找不存在的還原入口
  store.set('mecharashi_gd_modules', '{}')
  store.set('mecharashi_diag_sentinel', '{}')
  assert.equal(hasAnyDraft(), false)
  writeDraft({ kind: 'modules', id: 'm1', name: 'M', savedAt: 1, data: {} })
  assert.equal(hasAnyDraft(), true)
})

test('listDrafts 依暫存時間新到舊，且略過非草稿鍵', () => {
  store.set('mecharashi_gd_modules', '{}')
  writeDraft({ kind: 'modules', id: 'm1', name: '舊', savedAt: 100, data: {} })
  writeDraft({ kind: 'pilots', id: 'p1', name: '新', savedAt: 200, data: {} })
  assert.deepEqual(listDrafts().map((d) => d.name), ['新', '舊'])
})
