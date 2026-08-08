// 哨兵的 localStorage 側行為（PLAN-045 追加：persistence 降級探針 + 心跳）
//
// classifyLogout 的分支已由 sentinel.test.ts 覆蓋，那測的是「給定探針值 → 判定」。
// 本檔補的是另一層：**探針值本身有沒有測到該測的東西**——初版被 `authIdb` 恆 present
// 坑到，正是因為沒有人驗證過探針的輸出對不對（見 sentinel.test.ts 開頭的檢討）。
//
// 這裡能測的是純 localStorage 那兩顆（probeAuthLocal / touchSentinel）；
// IndexedDB 與 Firebase 內部欄位那兩顆只有真實瀏覽器測得出來，故刻意不假裝測得到。

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// sentinel.ts 以 `typeof window !== 'undefined'` 判斷環境，且只在函式被呼叫時才檢查，
// 故在 import 之前先把 window stub 掛上即可（同 draft.test.ts 的作法）。
const store = new Map<string, string>()
/** 設成 true 可模擬隱私模式：localStorage 存取直接拋 SecurityError。 */
let throwOnAccess = false

const guard = <T>(fn: () => T): T => {
  if (throwOnAccess) throw new Error('SecurityError')
  return fn()
}

;(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => guard(() => store.get(k) ?? null),
    setItem: (k: string, v: string) => guard(() => { store.set(k, v) }),
    removeItem: (k: string) => guard(() => { store.delete(k) }),
    key: (i: number) => guard(() => [...store.keys()][i] ?? null),
    get length() { return guard(() => store.size) },
  },
}

const { probeAuthLocal, touchSentinel, readSentinel, SENTINEL_KEY } =
  await import('./sentinel.ts')

beforeEach(() => {
  store.clear()
  throwOnAccess = false
})

// ─── probeAuthLocal：persistence 降級的指紋 ──────────────────────────────────

test('沒有任何 Firebase 憑證鍵 → absent', () => {
  store.set('mecharashi_gd_pilots', '[]')
  store.set(SENTINEL_KEY, JSON.stringify({ uid: 'u1', plantedAt: 1, lastSeenAt: 1, sessionId: 's' }))
  assert.equal(probeAuthLocal(), 'absent')
})

test('localStorage 有 firebase:authUser:* → present', () => {
  // Firebase 的實際鍵名格式：firebase:authUser:<apiKey>:<appName>
  // （@firebase/auth 的 _persistenceKeyName）
  store.set('firebase:authUser:AIzaSyFAKE:[DEFAULT]', '{"uid":"u1"}')
  assert.equal(probeAuthLocal(), 'present')
})

test('不被相似鍵名誤導（前綴必須完整含冒號）', () => {
  // 少了結尾冒號的鍵不是憑證，認錯會產生假的「降級」指紋，
  // 而那個指紋正是我們要拿來下結論的東西——寧可漏報也不能誤報。
  store.set('firebase:authUserSomethingElse', 'x')
  store.set('firebase:heartbeat:xxx', 'x')
  store.set('firebase:redirectUser:AIzaSyFAKE:[DEFAULT]', 'x')
  assert.equal(probeAuthLocal(), 'absent')
})

test('localStorage 不可用 → unknown（絕不可回 absent）', () => {
  // 隱私模式下「讀不到」與「沒有」是兩件事。回 absent 會讓判讀以為憑證被刪了。
  throwOnAccess = true
  assert.equal(probeAuthLocal(), 'unknown')
})

// ─── touchSentinel：心跳推進「最後一次確認登入」的時間戳 ─────────────────────

test('只更新 lastSeenAt，不動 plantedAt / uid / sessionId', () => {
  // plantedAt 若被順手改掉，「哨兵存活多久」會恆等於一次心跳間隔，
  // 那個欄位（用來對照 Safari ITP 的 7 天週期）就徹底廢掉了。
  const planted = Date.now() - 3 * 60 * 60 * 1000
  store.set(SENTINEL_KEY, JSON.stringify({
    uid: 'u1', plantedAt: planted, lastSeenAt: planted, sessionId: 'sess-a',
  }))

  touchSentinel()

  const after = readSentinel()
  assert.equal(after?.uid, 'u1')
  assert.equal(after?.plantedAt, planted)
  assert.equal(after?.sessionId, 'sess-a')
  assert.ok(after && after.lastSeenAt > planted, 'lastSeenAt 應被推進到現在')
})

test('哨兵不存在時不建立（不可無中生有出「登入過」的假證據）', () => {
  touchSentinel()
  assert.equal(store.size, 0)
  assert.equal(readSentinel(), null)
})

test('localStorage 不可用時靜默失敗，不拋錯', () => {
  // 心跳每 60 秒跑一次，若會拋錯就是每分鐘往 console 噴一次，
  // 而診斷設施沒有任何理由干擾正常使用。
  throwOnAccess = true
  assert.doesNotThrow(() => touchSentinel())
})
