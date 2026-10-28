// /api 退避重試（PLAN-065-A D-1）
//
// 為什麼值得測：重試只在「被限流」「閘道暫時掛掉」時才會走到，平常開發幾乎碰不到；
// 寫錯了也不會報錯，只會變成「該重試的沒重試」或「不該重試的狂打」——後者在限流當下等於火上加油。
// 計時一律注入假的 sleep：真的等好幾秒，整份測試會慢到沒人想跑。抖動固定 random＝0.5（預設間隔不變、Retry-After 加 500ms）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchWithRetry,
  retryAfterMs,
  getWorkerDataVersions,
  RETRY_DELAYS_MS,
  MAX_RETRY_AFTER_MS,
} from './workerData.ts'

/** 依序回傳指定狀態碼的假 fetch，並記下被呼叫幾次。 */
function fakeFetch(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  let calls = 0
  const impl = async (): Promise<Response> => {
    const r = responses[Math.min(calls, responses.length - 1)]
    calls++
    // 204／304 之類不能帶 body；這裡只會用到一般狀態碼
    return new Response(r.body ?? null, { status: r.status, headers: r.headers })
  }
  return { impl, calls: () => calls }
}

/** 記錄每次要等多久、但不真的等。 */
function fakeSleep() {
  const waits: number[] = []
  return { sleep: async (ms: number) => { waits.push(ms) }, random: () => 0.5, waits }
}

test('成功：只打一次、不等待', async () => {
  const f = fakeFetch([{ status: 200, body: '{"ok":1}' }])
  const s = fakeSleep()
  const res = await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: s.sleep, random: s.random })
  assert.equal(res.status, 200)
  assert.equal(await res.text(), '{"ok":1}')
  assert.equal(f.calls(), 1)
  assert.deepEqual(s.waits, [])
})

test('503 兩次後成功：依預設間隔退避，回傳成功的那次', async () => {
  const f = fakeFetch([{ status: 503 }, { status: 503 }, { status: 200, body: 'done' }])
  const s = fakeSleep()
  const res = await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: s.sleep, random: s.random })
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'done')
  assert.equal(f.calls(), 3)
  assert.deepEqual(s.waits, [3000, 5000])
})

test('429／502／503／504 都會重試；最多 3 次，之後交回最後一個失敗回應', async () => {
  for (const status of [429, 502, 503, 504]) {
    const f = fakeFetch([{ status }])
    const s = fakeSleep()
    const res = await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: s.sleep, random: s.random })
    assert.equal(res.status, status, `status ${status}`)
    assert.equal(f.calls(), 1 + RETRY_DELAYS_MS.length, `status ${status}`)
    assert.deepEqual(s.waits, [3000, 5000, 9000], `status ${status}`)
  }
})

test('其他錯誤照舊：500、404、400 不重試', async () => {
  for (const status of [500, 404, 400]) {
    const f = fakeFetch([{ status }, { status: 200 }])
    const s = fakeSleep()
    const res = await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: s.sleep, random: s.random })
    assert.equal(res.status, status)
    assert.equal(f.calls(), 1)
    assert.deepEqual(s.waits, [])
  }
})

test('斷線（fetch 本身 reject）照舊往上拋、不重試', async () => {
  let calls = 0
  const impl = async (): Promise<Response> => { calls++; throw new TypeError('Failed to fetch') }
  const s = fakeSleep()
  await assert.rejects(fetchWithRetry('/api/x', { fetchImpl: impl, sleep: s.sleep, random: s.random }), TypeError)
  assert.equal(calls, 1)
  assert.deepEqual(s.waits, [])
})

test('Retry-After 秒數優先於預設退避', async () => {
  const f = fakeFetch([{ status: 429, headers: { 'Retry-After': '3' } }, { status: 200 }])
  const s = fakeSleep()
  const res = await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: s.sleep, random: s.random })
  assert.equal(res.status, 200)
  assert.deepEqual(s.waits, [3500])
})

test('Retry-After 為 HTTP 日期：等到那個時間點', async () => {
  const now = Date.UTC(2026, 9, 28, 4, 0, 0)
  const at = new Date(now + 5000).toUTCString()
  const f = fakeFetch([{ status: 503, headers: { 'Retry-After': at } }, { status: 200 }])
  const s = fakeSleep()
  await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: s.sleep, random: s.random, now: () => now })
  assert.deepEqual(s.waits, [5500])
})

test('Retry-After 看不懂：退回預設間隔', async () => {
  const f = fakeFetch([{ status: 503, headers: { 'Retry-After': 'soon' } }, { status: 200 }])
  const s = fakeSleep()
  await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: s.sleep, random: s.random })
  assert.deepEqual(s.waits, [3000])
})

test('Retry-After 要等太久：不等，直接交回失敗回應', async () => {
  const tooLong = String(MAX_RETRY_AFTER_MS / 1000 + 1)
  const f = fakeFetch([{ status: 429, headers: { 'Retry-After': tooLong } }, { status: 200 }])
  const s = fakeSleep()
  const res = await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: s.sleep, random: s.random })
  assert.equal(res.status, 429)
  assert.equal(f.calls(), 1)
  assert.deepEqual(s.waits, [])
})

test('retryAfterMs：秒數、日期、過去的日期、空值', () => {
  const now = Date.UTC(2026, 9, 28, 4, 0, 0)
  assert.equal(retryAfterMs('0', now), 0)
  assert.equal(retryAfterMs(' 12 ', now), 12000)
  assert.equal(retryAfterMs(new Date(now + 2000).toUTCString(), now), 2000)
  assert.equal(retryAfterMs(new Date(now - 60_000).toUTCString(), now), 0)   // 已經過了 → 立刻重試
  assert.equal(retryAfterMs(null, now), null)
  // V8 的 Date.parse 會把這些當成日期；不擋的話會變成「立刻重試」
  assert.equal(retryAfterMs('-1', now), null)
  assert.equal(retryAfterMs('1.5', now), null)
})

// ── 接到實際的 getter：成功路徑與錯誤訊息都不能變 ─────────────────────────────────
// 這裡走全域 fetch（getter 不吃注入），所以只用「不會真的等」的情境：
// 成功、不重試的錯誤、Retry-After: 0。

async function withGlobalFetch(impl: () => Promise<Response>, run: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = impl as typeof fetch
  try { await run() } finally { globalThis.fetch = original }
}

test('getter 成功路徑：回傳解析後的 JSON', async () => {
  const f = fakeFetch([{ status: 200, body: '{"pilots":"v1"}' }])
  await withGlobalFetch(f.impl, async () => {
    assert.deepEqual(await getWorkerDataVersions(), { pilots: 'v1' })
  })
})

test('getter 錯誤訊息照舊：Worker <path> 失敗 <status>', async () => {
  const f = fakeFetch([{ status: 500 }])
  await withGlobalFetch(f.impl, async () => {
    await assert.rejects(getWorkerDataVersions(), { message: 'Worker /api/versions 失敗 500' })
    assert.equal(f.calls(), 1)
  })
})

test('getter 遇 429 會重試（Retry-After: 0，只等不到 1 秒的抖動）', async () => {
  const f = fakeFetch([
    { status: 429, headers: { 'Retry-After': '0' } },
    { status: 200, body: '{"pilots":"v2"}' },
  ])
  await withGlobalFetch(f.impl, async () => {
    assert.deepEqual(await getWorkerDataVersions(), { pilots: 'v2' })
    assert.equal(f.calls(), 2)
  })
})

test('抖動：預設間隔在 ±30% 內、三次累計至少涵蓋 zone 的 10 秒封鎖', async () => {
  for (const r of [0, 1]) {
    const f = fakeFetch([{ status: 429 }])
    const waits: number[] = []
    await fetchWithRetry('/api/x', { fetchImpl: f.impl, sleep: async (ms) => { waits.push(ms) }, random: () => r })
    RETRY_DELAYS_MS.forEach((base, i) => {
      assert.ok(Math.abs(waits[i] - base) <= base * 0.3 + 1, `r=${r} 第 ${i + 1} 次 ${waits[i]}`)
    })
    assert.ok(waits.reduce((a, b) => a + b, 0) > 10_000, `r=${r} 累計 ${waits.join('+')}`)
  }
})
