// ── PLAN-029 Phase 2-3：公開資料改打 Cloudflare Worker 代理（與直連並存、可灰度）──
// flag 開 → 前端公開集合改走 Worker /api/data/:collection（Worker 以 service account
// 代讀 Firestore）；flag 關 → 沿用既有的 Firestore SDK 直連。兩者可無縫切換／回退。
//
// Worker 回應格式刻意對齊 fetchCollection 的 `{ ...data, id }`（陣列集合）與
// fetchDocument 的 `{ ...data, id }`（singleton），故前端消費端零轉換。
//
// 為何版本號也走 Worker：Phase 3 會把 meta/gameData 收成 read:if false，屆時前端
// 無法再直讀 meta；改由 Worker（Admin 憑證）代讀版本，前端的版本 gate 三層快取
// 邏輯（記憶體 / localStorage / 遠端）得以原封不動延續到 Phase 3。

import type { DataVersions } from './versions'
import type { SiteTeamMember } from '../../types'

/**
 * 讀建置期環境變數。包一層 try 是為了讓本檔能在 `node --test` 底下被 import（PLAN-065-A D-1 的退避測試）：
 * Node 沒有 `import.meta.env`，模組層級直接取會讓整個檔案一 import 就拋 TypeError。
 * Vite 照樣逐字替換 `import.meta.env.VITE_*`，打包結果與原本相同。
 */
function readEnv(): { base?: string; useWorker?: string } {
  try {
    return {
      base: import.meta.env.VITE_WORKER_API_BASE as string | undefined,
      useWorker: import.meta.env.VITE_USE_WORKER as string | undefined,
    }
  } catch {
    return {}
  }
}
const ENV = readEnv()

const RAW_BASE = ENV.base?.trim() ?? ''

/**
 * 請求前綴。兩種模式：
 *   · 絕對網址（如 https://mecharashi-worker.….workers.dev）→ 跨源請求，靠 CORS 白名單放行
 *   · 'same-origin'（PLAN-029 Phase 5 路線 B）→ 前綴留空，打相對路徑 /api/…，
 *     由 mecharashi.wiki 的 Workers Route 接手。免 CORS、隱藏 origin、吃得到 zone 限流。
 * 去尾斜線避免 `${BASE}/api/...` 產生雙斜線。
 */
const BASE = RAW_BASE === 'same-origin' ? '' : RAW_BASE.replace(/\/+$/, '')

/**
 * Worker 代理是否啟用：
 *   · 需設定 VITE_WORKER_API_BASE（Worker 網址，或 'same-origin'）；
 *   · VITE_USE_WORKER=false 為 kill-switch，可在不動 BASE 的情況下強制回退直連。
 * 未設 → 一律關閉。注意：Phase 3-2 之後 Firestore 公開集合已是 read:if isAdmin()，
 * 「回退直連」對匿名訪客等同讀不到資料，kill-switch 現在只剩管理者自救的意義。
 * （判斷用 RAW_BASE：'same-origin' 模式下 BASE 刻意為空字串。）
 */
export const WORKER_ENABLED = !!RAW_BASE && ENV.useWorker !== 'false'

/**
 * 組出 Worker endpoint 的完整網址。同源模式回傳相對路徑、絕對模式回傳完整 URL。
 * 對外導出供連線診斷頁使用——診斷若自己寫死 `/api/…`，在本機與 preview（皆為跨源設定）
 * 會打到站台本身而不是 Worker，量到的數字毫無意義。
 */
export const workerUrl = (path: string): string => `${BASE}${path}`

// ── 退避重試（PLAN-065-A D-1）────────────────────────────────────────────────────
// /api 前面有 zone 限流（PLAN-029），/sim 上線後同一個 zone 的請求只會更多。被限流（429）或碰上
// 暫時性的閘道錯誤（502／503／504）時，原本是直接拋錯、整頁讀不到資料；改成等一下再試。
//
//   · 等多久：回應帶 Retry-After 就照它（秒數或 HTTP 日期，再加最多 1 秒抖動），否則依序約 3／5／9 秒
//     （各 ±30% 抖動）；最多重試 3 次。累計至少約 12 秒：Free 方案的 zone 限流固定封鎖 10 秒（PLAN-029），
//     等太短的話三次重試全落在封鎖期內、白等一場。
//   · 為什麼要抖動：GameDataContext 會同時抓好幾個集合，大家同一刻被擋、又同一刻重試，會再踩一次門檻。
//   · Retry-After 超過 MAX_RETRY_AFTER_MS 就不等了，直接把那個回應交回去照舊拋錯——
//     讓畫面卡在「載入中」幾分鐘，比看到錯誤更難懂。
//   · 只看狀態碼。斷線（fetch 本身 reject）、500、404 等一律照舊、不重試：
//     500 是 Worker 自己的錯，重試結果一樣；斷線交給上層既有的錯誤處理。
//   · 跨源模式（本機／preview）讀不到 Retry-After（不是 CORS 白名單內的回應標頭），自動退回預設間隔；
//     被 zone 限流擋下的 429 在跨源模式下根本沒有 CORS 標頭，會以斷線的形式出現、不會重試。
//     正式站是同源，兩者都不受影響。
//   · 成功路徑、回應內容與快取完全不變（快取在 GameDataContext，這裡沒有）。

/** 會退避重試的狀態碼 */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503, 504])
/** 沒有 Retry-After 時第 1／2／3 次重試前等的毫秒數（再乘上抖動）；長度＝最多重試次數 */
export const RETRY_DELAYS_MS: readonly number[] = [3000, 5000, 9000]
/** 預設間隔的抖動比例（±） */
export const RETRY_JITTER = 0.3
/** 照 Retry-After 等的時候，額外加的隨機毫秒數上限（只往後延，不提早） */
export const RETRY_AFTER_JITTER_MS = 1000
/** Retry-After 要求等超過這麼久就放棄重試（照舊拋錯） */
export const MAX_RETRY_AFTER_MS = 10_000

/**
 * 解析 Retry-After（秒數或 HTTP 日期）成毫秒；沒有或看不懂回 null。
 * 日期只認開頭是星期縮寫的寫法（"Wed, 28 Oct 2026 04:00:05 GMT" 等三種 HTTP-date 都是）：
 * V8 的 Date.parse 很寬鬆，"-1"、"1.5" 都會被當成某個日期，不先擋會變成「立刻重試」。
 */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (header == null) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  if (!/^[A-Za-z]{3}/.test(value)) return null
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/** 測試用的注入點：預設就是全域 fetch／setTimeout／Date.now／Math.random。 */
export interface RetryDeps {
  fetchImpl?: (url: string) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  random?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * fetch ＋ 退避重試。回傳最後一次的 Response（可能仍是 !ok，由呼叫端照舊判斷），
 * 所以錯誤訊息、成功路徑都跟沒有重試時一模一樣。
 */
export async function fetchWithRetry(url: string, deps: RetryDeps = {}): Promise<Response> {
  // 包成箭頭函式、呼叫當下才取全域 fetch：直接把 fetch 存成別的物件的方法再呼叫（this 不是 window）
  // 瀏覽器會拋 Illegal invocation；晚綁定也讓測試替換 globalThis.fetch 有效
  const doFetch = deps.fetchImpl ?? ((u: string) => fetch(u))
  const sleep = deps.sleep ?? defaultSleep
  const now = deps.now ?? Date.now
  const random = deps.random ?? Math.random
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(url)
    if (!RETRYABLE_STATUS.has(res.status) || attempt >= RETRY_DELAYS_MS.length) return res
    const hinted = retryAfterMs(res.headers.get('retry-after'), now())
    if (hinted !== null && hinted > MAX_RETRY_AFTER_MS) return res
    void res.body?.cancel().catch(() => {})   // 丟掉這次的回應本體，連線才能早點回收
    const r = random()
    await sleep(hinted !== null
      ? hinted + Math.round(r * RETRY_AFTER_JITTER_MS)
      : Math.round(RETRY_DELAYS_MS[attempt] * (1 + RETRY_JITTER * (2 * r - 1))))
  }
}

// 刻意只送簡單請求（不帶自訂 header）→ 保證是 CORS「simple request」、免 preflight。
async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(workerUrl(path))
  if (!res.ok) throw new Error(`Worker ${path} 失敗 ${res.status}`)
  return res.json() as Promise<T>
}

/** 讀版本資訊（對應 meta/gameData）；Worker 內部以 Admin 憑證代讀，Phase 3 收緊後仍運作。 */
export const getWorkerDataVersions = (): Promise<DataVersions> => fetchJson<DataVersions>('/api/versions')

/** 讀單一公開集合，回傳形狀與對應的 firestoreApi getter 完全一致。 */
export const fetchWorkerCollection = (key: string): Promise<unknown> => fetchJson<unknown>(`/api/data/${key}`)

/**
 * 讀首頁維護團隊名單（PLAN-051）。
 *
 * 與其他 getter 不同，這裡走 Worker 的理由不是「規則收緊後讀不到」而是**欄位過濾**：
 * Firestore 沒有欄位級讀取授權，允許匿名讀 profile 就等於連 email 一起送出去。
 * Worker 以 Admin 憑證代讀後只回白名單欄位，profile 仍然只有一份資料來源。
 */
export const fetchWorkerSiteTeam = (): Promise<SiteTeamMember[]> =>
  fetchJson<SiteTeamMember[]>('/api/site-team')
