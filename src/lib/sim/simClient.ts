// ─── 傷害模擬 API 用戶端（PLAN-065-C B-3）──────────────────────────────────────
//
// 打 `/sim/v1/ping` 與 `/sim/v1/run`。網址走 workerUrl()：正式站同源（/sim 由 Workers Route 接手），
// 本機 dev／preview 是跨源（Worker 的 CORS 白名單已放行 localhost:5173／4173）。
//
//   · 分批：Worker 限制每個請求的 jobs 筆數（每個 200 回應與 422 都附 limits）。
//     jobs 切成數批依序送出，結果依原本的 job 順序合併、job 重新編號。遇 422 依附帶的 limits 重切一次。
//   · 重試：429／502／503／504 沿用 workerData 的退避（fetchWithRetry）；
//     Retry-After 超過 10 秒不重試（Worker 關閉時回 503 + Retry-After 3600）。
//     跨源模式要 Worker 回 `access-control-expose-headers: retry-after` 才讀得到（065-C 起）；讀不到時退回預設間隔。
//   · 節流：批與批之間依 limits.maxRps 留間隔。
//   · 錯誤：最後仍不是 200 時拋 SimApiError（帶 HTTP 狀態、錯誤碼、detail）。
//     斷線照原樣拋 TypeError；呼叫端中止拋中止原因；逾時拋 name 為 'TimeoutError' 的 DOMException。
//   · 管理者：admin＝true 時帶 `Authorization: Bearer <Firebase ID token>`。token 不記錄、不放進錯誤訊息。
//     沒有登入使用者時照一般請求送出（Worker 會把 L2 降為 L1 並附 'levelDowngraded'）。
//
// 依賴（fetch／sleep／now／random／getIdToken）全部可注入，測試不打網路、不真的等。

import type {
  SimBudgetV1, SimErrorCode, SimErrorV1, SimLimits, SimPingV1, SimRequestV1, SimResponseV1, SimResultV1,
} from './contract.ts'
import { fetchWithRetry, retryAfterMs, workerUrl, type RetryDeps } from '../api/workerData.ts'

/** 還不知道 Worker 上限時，每批送幾筆 job。 */
export const DEFAULT_MAX_JOBS = 8
/** 單次 HTTP 請求的逾時（毫秒，到收到回應標頭為止）。 */
export const DEFAULT_TIMEOUT_MS = 15_000

export interface SimClientDeps extends RetryDeps {
  /** 取 Firebase ID token；沒有登入使用者時回 null。預設讀 src/lib/firebase.ts 的 auth。 */
  getIdToken?: () => Promise<string | null | undefined>
}

export interface SimCallOptions {
  signal?: AbortSignal
  /** 單次 HTTP 請求的逾時；0＝不設逾時。預設 DEFAULT_TIMEOUT_MS */
  timeoutMs?: number
  deps?: SimClientDeps
}

export interface RunSimOptions extends SimCallOptions {
  /** 以管理者身分送出（帶 ID token） */
  admin?: boolean
  /** 每批最多幾筆 job；省略＝最近一次回應的 limits.maxJobs，還沒有回應過時用 DEFAULT_MAX_JOBS */
  maxJobs?: number
}

/** 'unknown'＝回應不是契約內的錯誤（例如閘道錯誤頁、格式不對的回應）。 */
export type SimClientErrorCode = SimErrorCode | 'unknown'

/** `/sim/v1/*` 回了非 200（重試後仍是），或回應內容不合契約。 */
export class SimApiError extends Error {
  readonly status: number
  readonly error: SimClientErrorCode
  readonly detail?: string
  readonly limits?: SimLimits
  readonly budget?: SimBudgetV1
  /** 回應要求多久後再試（毫秒）；沒帶或讀不到時為 null */
  readonly retryAfterMs: number | null

  constructor(init: {
    status: number
    error: SimClientErrorCode
    detail?: string
    limits?: SimLimits
    budget?: SimBudgetV1
    retryAfterMs?: number | null
  }) {
    super(`傷害模擬 ${init.status} ${init.error}${init.detail ? `：${init.detail}` : ''}`)
    this.name = 'SimApiError'
    this.status = init.status
    this.error = init.error
    this.detail = init.detail
    this.limits = init.limits
    this.budget = init.budget
    this.retryAfterMs = init.retryAfterMs ?? null
  }
}

// ── 最近一次看到的上限（整個分頁共用；下一次 runSim 依它分批）────────────────────

let latestLimits: SimLimits | null = null

/** 最近一次回應附帶的 Worker 上限；還沒有回應過時為 null。 */
export function getLatestSimLimits(): SimLimits | null {
  return latestLimits
}

/** 忘掉記住的上限（測試用；引擎版本變更時也可呼叫）。 */
export function resetSimClientState(): void {
  latestLimits = null
}

// ── 低階：一次呼叫（含退避重試、逾時、中止）──────────────────────────────────────

const SIM_ERROR_CODES: ReadonlySet<string> = new Set<SimErrorCode>([
  'badRequest', 'forbidden', 'notFound', 'methodNotAllowed', 'payloadTooLarge',
  'overBudget', 'rateLimited', 'notImplemented', 'disabled',
])

const CODE_BY_STATUS: Readonly<Record<number, SimErrorCode>> = {
  400: 'badRequest', 403: 'forbidden', 404: 'notFound', 405: 'methodNotAllowed',
  413: 'payloadTooLarge', 422: 'overBudget', 429: 'rateLimited', 501: 'notImplemented', 503: 'disabled',
}

/** 可被 signal 中止的 sleep：中止時立刻以中止原因 reject。 */
function abortableSleep(signal?: AbortSignal) {
  return (ms: number) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** fetch ＋ 退避重試；每一次嘗試各自計逾時，並連動呼叫端的 signal。 */
function send(url: string, init: RequestInit, opts: SimCallOptions): Promise<Response> {
  const deps = opts.deps ?? {}
  const base = deps.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i))
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const outer = opts.signal

  const attempt = async (u: string, i?: RequestInit): Promise<Response> => {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort(outer?.reason)
    if (outer?.aborted) onAbort()
    else outer?.addEventListener('abort', onAbort, { once: true })
    const timer = timeoutMs > 0
      ? setTimeout(() => ctrl.abort(new DOMException('傷害模擬請求逾時', 'TimeoutError')), timeoutMs)
      : undefined
    try {
      return await base(u, { ...i, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onAbort)
    }
  }

  return fetchWithRetry(
    url,
    { ...deps, fetchImpl: attempt, sleep: deps.sleep ?? abortableSleep(outer) },
    { ...init, signal: outer },
  )
}

/** 非 200 的回應 → SimApiError。body 不是 JSON 時錯誤碼依狀態碼推。 */
async function toApiError(res: Response, now: number): Promise<SimApiError> {
  let body: Partial<SimErrorV1> = {}
  try {
    const parsed: unknown = await res.json()
    if (parsed && typeof parsed === 'object') body = parsed as Partial<SimErrorV1>
  } catch { /* 閘道錯誤頁之類的非 JSON 回應 */ }
  const code: SimClientErrorCode = typeof body.error === 'string' && SIM_ERROR_CODES.has(body.error)
    ? body.error
    : CODE_BY_STATUS[res.status] ?? 'unknown'
  return new SimApiError({
    status: res.status,
    error: code,
    detail: typeof body.detail === 'string' ? body.detail : undefined,
    limits: body.limits,
    budget: body.budget,
    retryAfterMs: retryAfterMs(res.headers.get('retry-after'), now),
  })
}

async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new SimApiError({ status: res.status, error: 'unknown', detail: '回應不是 JSON' })
  }
}

const invalid = (detail: string) => new SimApiError({ status: 200, error: 'unknown', detail })

async function defaultGetIdToken(): Promise<string | null> {
  // 用到才載入：本檔要能在 node --test 底下 import，而 firebase.ts 一載入就讀 import.meta.env
  const { auth } = await import('../firebase')
  return auth.currentUser ? auth.currentUser.getIdToken() : null
}

// ── GET /sim/v1/ping ─────────────────────────────────────────────────────────

/** 讀 Worker 的版本資訊。 */
export async function pingSim(opts: SimCallOptions = {}): Promise<SimPingV1> {
  const now = opts.deps?.now ?? Date.now
  const res = await send(workerUrl('/sim/v1/ping'), { method: 'GET' }, opts)
  if (!res.ok) throw await toApiError(res, now())
  return readJson<SimPingV1>(res)
}

// ── POST /sim/v1/run ─────────────────────────────────────────────────────────

const clampChunk = (n: number | undefined): number =>
  n !== undefined && Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX_JOBS

/** 422 之後該切成幾筆一批：先看 limits.maxJobs，再依工作量比例縮小；兩者都看不出來就對半。 */
function resplitSize(current: number, err: SimApiError): number {
  let next = current
  if (err.limits && err.limits.maxJobs >= 1) next = Math.min(next, Math.floor(err.limits.maxJobs))
  if (err.budget && err.budget.units > err.budget.max && err.budget.units > 0) {
    next = Math.min(next, Math.floor((current * err.budget.max) / err.budget.units))
  }
  if (next >= current) next = Math.floor(current / 2)
  return Math.max(1, next)
}

/**
 * 送出計算請求。jobs 超過每批上限時自動分批、依序送出，回傳合併後的單一回應：
 * results 依原本的 job 順序、job 為原本的索引；budget.units 為各批加總、max 為單批上限；
 * 其餘欄位（版本、limits）取最後一批。
 */
export async function runSim(req: SimRequestV1, opts: RunSimOptions = {}): Promise<SimResponseV1> {
  const jobs = req.jobs
  if (jobs.length === 0) throw new SimApiError({ status: 0, error: 'badRequest', detail: 'jobs 為空' })

  const deps = opts.deps ?? {}
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? abortableSleep(opts.signal)

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.admin) {
    const token = await (deps.getIdToken ?? defaultGetIdToken)()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const results: Array<SimResultV1 | undefined> = new Array(jobs.length)
  let size = clampChunk(opts.maxJobs ?? latestLimits?.maxJobs)
  let resplit = false
  let last: SimResponseV1 | null = null
  let units = 0
  let lastSentAt: number | null = null

  for (let start = 0; start < jobs.length;) {
    const slice = jobs.slice(start, start + size)

    // 批與批之間的間隔（第一批不等）
    const rps = latestLimits?.maxRps
    if (lastSentAt !== null && rps && rps > 0) {
      const wait = lastSentAt + 1000 / rps - now()
      if (wait > 0) await sleep(Math.ceil(wait))
    }
    lastSentAt = now()

    const res = await send(
      workerUrl('/sim/v1/run'),
      { method: 'POST', headers, body: JSON.stringify({ ...req, jobs: slice }) },
      opts,
    )

    if (res.ok) {
      const data = await readJson<SimResponseV1>(res)
      if (!data || !Array.isArray(data.results)) throw invalid('回應缺少 results')
      if (data.limits) latestLimits = data.limits
      for (const r of data.results) {
        if (!Number.isInteger(r?.job) || r.job < 0 || r.job >= slice.length) throw invalid(`job 索引 ${String(r?.job)} 超出範圍`)
        const idx = start + r.job
        if (results[idx]) throw invalid(`job ${idx} 重複`)
        results[idx] = { ...r, job: idx }
      }
      units += data.budget?.units ?? 0
      last = data
      start += slice.length
      if (data.limits?.maxJobs) size = Math.min(size, clampChunk(data.limits.maxJobs))
      continue
    }

    const err = await toApiError(res, now())
    if (res.status === 422 && err.limits && !resplit) {
      latestLimits = err.limits
      const next = resplitSize(slice.length, err)
      if (next < slice.length) {
        size = next
        resplit = true
        continue
      }
    }
    throw err
  }

  const merged = results.filter((r): r is SimResultV1 => r !== undefined)
  if (merged.length !== jobs.length || !last) throw invalid(`results 只有 ${merged.length}／${jobs.length} 筆`)
  return { ...last, budget: { units, max: last.budget?.max ?? 0 }, results: merged }
}
