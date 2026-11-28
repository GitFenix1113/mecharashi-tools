// 劇情的閱讀進度（storyProgress.ts，PLAN-042-I A-3）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 重點不是「記得住」，而是「壞掉的時候不會把頁面一起拖垮」：無痕視窗、被清掉、別的程式寫進壞 JSON。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STORY_PROGRESS_KEY, createStoryProgress } from './storyProgress.ts'

function fakeStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) },
  }
}

test('記錄上次讀到哪、哪幾關讀完，並寫回 storage', () => {
  const s = fakeStorage()
  const p = createStoryProgress(() => s)
  assert.deepEqual(p.progressOf('main-2'), { last: null, read: [] })
  p.visit('main-2', 'w108')
  p.markRead('main-2', 'w106')
  p.markRead('main-2', 'w106') // 重複不會重複寫
  assert.deepEqual(p.progressOf('main-2'), { last: 'w108', read: ['w106'] })
  // 換一個存取器讀同一份 storage：真的有寫進去
  const again = createStoryProgress(() => s)
  assert.deepEqual(again.progressOf('main-2'), { last: 'w108', read: ['w106'] })
  assert.ok(s.data.has(STORY_PROGRESS_KEY))
})

test('壞 JSON：當成沒讀過，之後照常寫', () => {
  const s = fakeStorage({ [STORY_PROGRESS_KEY]: '{not json' })
  const p = createStoryProgress(() => s)
  assert.deepEqual(p.progressOf('main-2'), { last: null, read: [] })
  p.visit('main-2', 'w107')
  assert.equal(p.progressOf('main-2').last, 'w107')
})

test('形狀長歪的那一本被丟掉，不連累其他本', () => {
  const s = fakeStorage({
    [STORY_PROGRESS_KEY]: JSON.stringify({ 'main-2': { last: 'w108', read: ['w106', 3] }, 'main-3': 'oops', 'main-4': { read: 'x' } }),
  })
  const p = createStoryProgress(() => s)
  assert.deepEqual(p.progressOf('main-2'), { last: 'w108', read: ['w106'] })
  assert.deepEqual(p.progressOf('main-3'), { last: null, read: [] })
  assert.deepEqual(p.progressOf('main-4'), { last: null, read: [] })
})

test('storage 會丟例外（無痕視窗、被封鎖）：讀寫都不拋，這次工作階段記在記憶體裡', () => {
  const throwing = {
    getItem: () => { throw new Error('SecurityError') },
    setItem: () => { throw new Error('QuotaExceededError') },
  }
  const p = createStoryProgress(() => throwing)
  assert.deepEqual(p.progressOf('main-2'), { last: null, read: [] })
  p.markRead('main-2', 'w106')
  assert.deepEqual(p.progressOf('main-2').read, ['w106'])
})

test('連拿 storage 都會丟例外、或根本沒有 storage', () => {
  const p = createStoryProgress(() => { throw new Error('denied') })
  p.visit('main-2', 'w106')
  assert.equal(p.progressOf('main-2').last, 'w106')
  const none = createStoryProgress(() => null)
  assert.equal(none.readCount('main-2'), 0)
})

test('readCount 給了現有關卡就只數還存在的（改版拿掉的關不算）', () => {
  const p = createStoryProgress(() => fakeStorage())
  p.markRead('main-2', 'w106')
  p.markRead('main-2', 'w999')
  assert.equal(p.readCount('main-2'), 2)
  assert.equal(p.readCount('main-2', new Set(['w106', 'w107'])), 1)
})

test('subscribe／getVersion：寫入才通知，重複寫同一筆不通知', () => {
  const p = createStoryProgress(() => fakeStorage())
  let calls = 0
  const off = p.subscribe(() => { calls++ })
  const v0 = p.getVersion()
  p.visit('main-2', 'w106')
  p.visit('main-2', 'w106')
  p.markRead('main-2', 'w106')
  p.markRead('main-2', 'w106')
  assert.equal(calls, 2)
  assert.equal(p.getVersion(), v0 + 2)
  off()
  p.visit('main-2', 'w107')
  assert.equal(calls, 2)
})
