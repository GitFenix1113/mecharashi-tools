// PLAN-065-C B-3：傷害模擬 API 用戶端
//
// 驗分批合併、422 重切、退避重試、Worker 關閉時不重試、管理者 header、Content-Type。
// fetch／sleep／now／random／getIdToken 全部注入：不打網路、不真的等。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SimLimits, SimRequestV1, SimResponseV1 } from './contract.ts'
import { SimApiError, getLatestSimLimits, pingSim, resetSimClientState, runSim, type SimClientDeps } from './simClient.ts'

const LIMITS: SimLimits = { maxJobs: 8, maxBodyBytes: 16384, maxUnits: 2000, maxMcSamples: 0, rotationMaxTurns: 0, maxRps: 2 }

/** n 筆 job 的請求；每筆的 distance 是它的原始索引，方便驗證合併順序。 */
function requestWith(n: number): SimRequestV1 {
  return {
    v: 1, locale: 'zh-TW', mode: 'single',
    loadouts: [], targets: [], scenarios: [],
    jobs: Array.from({ length: n }, (_, i) => ({ l: 0, t: 0, s: 0, action: { weaponKey: 'm-rh', skill: 'default', distance: i } })),
    output: { level: 'L1' },
  }
}

interface Call { url: string; init: RequestInit; body: SimRequestV1 | null }

type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

/**
 * 假 Worker：`plan` 依序決定每次呼叫的回應；函式型的回應拿到請求本體，
 * 預設回 200 並把每筆 job 回成 { job: i, L0.perAction.mean = 原始 distance }。
 */
function fakeWorker(plan: Array<Reply | ((req: SimRequestV1) => Reply)> = [], limits: SimLimits = LIMITS) {
  const calls: Call[] = []
  const ok = (req: SimRequestV1): Reply => ({
    status: 200,
    body: {
      contract: 'v1', engineVersion: '0.2.0', dataVersion: 'd1', buildNum: '376', overridesVersion: 'none', flagsDigest: 'none',
      limits, budget: { units: req.jobs.length * 10, max: 2000 },
      results: req.jobs.map((j, i) => ({
        job: i, status: 'ok', switches: [], derived: { panel: {} }, warnings: [],
        L0: { perAction: { mean: j.action.distance ?? -1 }, segments: [], approx: true, badge: 'approx' },
      })),
    } satisfies SimResponseV1,
  })
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as SimRequestV1) : null
    calls.push({ url, init: init ?? {}, body })
    const step = plan[calls.length - 1]
    const r = typeof step === 'function' ? step(body!) : step ?? ok(body!)
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers })
  }
  return { fetchImpl, calls, ok }
}

function deps(fetchImpl: SimClientDeps['fetchImpl'], extra: Partial<SimClientDeps> = {}) {
  const waits: number[] = []
  const d: SimClientDeps = {
    fetchImpl,
    sleep: async (ms) => { waits.push(ms) },
    now: () => 1_000_000,
    random: () => 0.5,
    getIdToken: async () => { throw new Error('非管理者請求不該取 token') },
    ...extra,
  }
  return { d, waits }
}

const headerOf = (c: Call, name: string) => new Headers(c.init.headers).get(name)

test('單批：POST /sim/v1/run，Content-Type 為 application/json，回應原樣交回', async () => {
  resetSimClientState()
  const w = fakeWorker()
  const { d, waits } = deps(w.fetchImpl)
  const res = await runSim(requestWith(3), { deps: d })
  assert.equal(w.calls.length, 1)
  assert.equal(w.calls[0].url, '/sim/v1/run')
  assert.equal(w.calls[0].init.method, 'POST')
  assert.equal(headerOf(w.calls[0], 'content-type'), 'application/json')
  assert.equal(headerOf(w.calls[0], 'authorization'), null)
  assert.deepEqual(res.results.map((r) => [r.job, r.L0?.perAction.mean]), [[0, 0], [1, 1], [2, 2]])
  assert.deepEqual(res.budget, { units: 30, max: 2000 })
  assert.deepEqual(waits, [])
  assert.deepEqual(getLatestSimLimits(), LIMITS)
})

test('分批：11 筆 → 8＋3，依原順序合併、job 重新編號；批間依 maxRps 留間隔', async () => {
  resetSimClientState()
  const w = fakeWorker()
  const { d, waits } = deps(w.fetchImpl)
  const res = await runSim(requestWith(11), { deps: d })
  assert.deepEqual(w.calls.map((c) => c.body?.jobs.length), [8, 3])
  assert.deepEqual(w.calls[1].body?.jobs.map((j) => j.action.distance), [8, 9, 10])
  assert.deepEqual(res.results.map((r) => r.job), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual(res.results.map((r) => r.L0?.perAction.mean), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual(res.budget, { units: 110, max: 2000 })
  assert.deepEqual(waits, [500])   // maxRps 2 → 兩批之間 500 ms（now 固定）
})

test('分批：沿用最近一次回應的 limits.maxJobs', async () => {
  resetSimClientState()
  const small = { ...LIMITS, maxJobs: 4, maxRps: 0 }
  const w = fakeWorker([], small)
  const { d } = deps(w.fetchImpl)
  await runSim(requestWith(10), { deps: d })
  // 第一批還不知道上限 → 8；回應說 4 → 之後每批 4
  assert.deepEqual(w.calls.map((c) => c.body?.jobs.length), [8, 2])
  const w2 = fakeWorker([], small)
  await runSim(requestWith(10), { deps: deps(w2.fetchImpl).d })
  assert.deepEqual(w2.calls.map((c) => c.body?.jobs.length), [4, 4, 2])
})

test('422 overBudget：依附帶的 limits 重切一次再送', async () => {
  resetSimClientState()
  const w = fakeWorker([
    { status: 422, body: { error: 'overBudget', detail: 'jobs 8 筆，超過上限 5 筆', limits: { ...LIMITS, maxJobs: 5 }, budget: { units: 80, max: 2000 } } },
  ])
  const { d } = deps(w.fetchImpl)
  const res = await runSim(requestWith(8), { deps: d })
  assert.deepEqual(w.calls.map((c) => c.body?.jobs.length), [8, 5, 3])
  assert.deepEqual(res.results.map((r) => r.L0?.perAction.mean), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.equal(getLatestSimLimits()?.maxJobs, 8)   // 之後成功的回應帶回 8
})

test('422 只重切一次：再遇 422 就拋 SimApiError（帶 limits 與 budget）', async () => {
  resetSimClientState()
  const over = { status: 422, body: { error: 'overBudget', detail: '工作量 3000，超過上限 2000', limits: LIMITS, budget: { units: 3000, max: 2000 } } }
  const w = fakeWorker([over, over])
  const { d } = deps(w.fetchImpl)
  await assert.rejects(runSim(requestWith(6), { deps: d }), (e: unknown) => {
    assert.ok(e instanceof SimApiError)
    assert.equal(e.status, 422)
    assert.equal(e.error, 'overBudget')
    assert.deepEqual(e.budget, { units: 3000, max: 2000 })
    return true
  })
  // 6 筆 × 2000/3000 → 4 筆
  assert.deepEqual(w.calls.map((c) => c.body?.jobs.length), [6, 4])
})

test('429：照 Retry-After 退避後重送同一批', async () => {
  resetSimClientState()
  const w = fakeWorker([{ status: 429, body: { error: 'rateLimited' }, headers: { 'Retry-After': '2' } }])
  const { d, waits } = deps(w.fetchImpl)
  const res = await runSim(requestWith(2), { deps: d })
  assert.equal(w.calls.length, 2)
  assert.deepEqual(w.calls[0].body, w.calls[1].body)
  assert.deepEqual(waits, [2500])
  assert.equal(res.results.length, 2)
})

test('503 + Retry-After 3600（Worker 關閉）：不重試，拋 disabled', async () => {
  resetSimClientState()
  const w = fakeWorker([{ status: 503, body: { error: 'disabled' }, headers: { 'Retry-After': '3600' } }])
  const { d, waits } = deps(w.fetchImpl)
  await assert.rejects(runSim(requestWith(2), { deps: d }), (e: unknown) => {
    assert.ok(e instanceof SimApiError)
    assert.equal(e.status, 503)
    assert.equal(e.error, 'disabled')
    assert.equal(e.retryAfterMs, 3_600_000)
    return true
  })
  assert.equal(w.calls.length, 1)
  assert.deepEqual(waits, [])
})

test('400：帶 detail 的 SimApiError；非 JSON 的閘道錯誤依狀態碼推錯誤碼', async () => {
  resetSimClientState()
  const bad = fakeWorker([{ status: 400, body: { error: 'badRequest', detail: 'Content-Type 必須是 application/json' } }])
  await assert.rejects(runSim(requestWith(1), { deps: deps(bad.fetchImpl).d }), (e: unknown) => {
    assert.ok(e instanceof SimApiError)
    assert.equal(e.error, 'badRequest')
    assert.equal(e.detail, 'Content-Type 必須是 application/json')
    return true
  })
  const gw = fakeWorker([{ status: 500, body: undefined }])
  await assert.rejects(runSim(requestWith(1), { deps: deps(gw.fetchImpl).d }), (e: unknown) => {
    assert.ok(e instanceof SimApiError)
    assert.equal(e.status, 500)
    assert.equal(e.error, 'unknown')
    return true
  })
})

test('管理者：帶 Bearer token；不是管理者時不取 token、不帶 header', async () => {
  resetSimClientState()
  const w = fakeWorker()
  let asked = 0
  const { d } = deps(w.fetchImpl, { getIdToken: async () => { asked++; return 'tok-123' } })
  await runSim(requestWith(9), { deps: d, admin: true })
  assert.equal(asked, 1)
  assert.deepEqual(w.calls.map((c) => headerOf(c, 'authorization')), ['Bearer tok-123', 'Bearer tok-123'])
  assert.ok(w.calls.every((c) => headerOf(c, 'content-type') === 'application/json'))

  const anon = fakeWorker()
  await runSim(requestWith(1), { deps: deps(anon.fetchImpl).d })   // 預設的 getIdToken 會拋錯：沒被呼叫才會過
  assert.equal(headerOf(anon.calls[0], 'authorization'), null)

  const loggedOut = fakeWorker()
  await runSim(requestWith(1), { deps: deps(loggedOut.fetchImpl, { getIdToken: async () => null }).d, admin: true })
  assert.equal(headerOf(loggedOut.calls[0], 'authorization'), null)
})

test('回應的 job 索引越界：視為不合契約', async () => {
  resetSimClientState()
  const w = fakeWorker([(req) => {
    const r = fakeWorker().ok(req)
    ;(r.body as SimResponseV1).results[0].job = 99
    return r
  }])
  await assert.rejects(runSim(requestWith(2), { deps: deps(w.fetchImpl).d }), (e: unknown) =>
    e instanceof SimApiError && e.error === 'unknown')
})

test('jobs 為空：不送出', async () => {
  resetSimClientState()
  const w = fakeWorker()
  await assert.rejects(runSim(requestWith(0), { deps: deps(w.fetchImpl).d }), SimApiError)
  assert.equal(w.calls.length, 0)
})

test('逾時：中止這次請求並拋 TimeoutError', async () => {
  resetSimClientState()
  const hang = (_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })
  await assert.rejects(runSim(requestWith(1), { deps: deps(hang).d, timeoutMs: 5 }), { name: 'TimeoutError' })
})

test('呼叫端中止：拋中止原因、不重試', async () => {
  resetSimClientState()
  const ctrl = new AbortController()
  const w = fakeWorker([{ status: 503, body: { error: 'disabled' } }])
  const { d } = deps(w.fetchImpl, { sleep: async () => { ctrl.abort(new Error('使用者取消')) } })
  await assert.rejects(runSim(requestWith(1), { deps: d, signal: ctrl.signal }), { message: '使用者取消' })
  assert.equal(w.calls.length, 1)
})

test('pingSim：GET /sim/v1/ping，不帶自訂 header', async () => {
  resetSimClientState()
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ ok: true, engineVersion: '0.2.0', dataVersion: 'd1' }), { status: 200 })
  }
  const ping = await pingSim({ deps: deps(fetchImpl).d })
  assert.deepEqual(ping, { ok: true, engineVersion: '0.2.0', dataVersion: 'd1' })
  assert.equal(calls[0].url, '/sim/v1/ping')
  assert.equal(calls[0].init?.method, 'GET')
  assert.equal(new Headers(calls[0].init?.headers).get('content-type'), null)

  const down = async () => new Response(JSON.stringify({ error: 'disabled' }), { status: 503, headers: { 'Retry-After': '3600' } })
  await assert.rejects(pingSim({ deps: deps(down).d }), (e: unknown) => e instanceof SimApiError && e.error === 'disabled')
})
