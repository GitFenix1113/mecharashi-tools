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

const RAW_BASE = (import.meta.env.VITE_WORKER_API_BASE as string | undefined)?.trim() ?? ''

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
export const WORKER_ENABLED = !!RAW_BASE && import.meta.env.VITE_USE_WORKER !== 'false'

// 刻意只送簡單請求（不帶自訂 header）→ 保證是 CORS「simple request」、免 preflight。
async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`Worker ${path} 失敗 ${res.status}`)
  return res.json() as Promise<T>
}

/** 讀版本資訊（對應 meta/gameData）；Worker 內部以 Admin 憑證代讀，Phase 3 收緊後仍運作。 */
export const getWorkerDataVersions = (): Promise<DataVersions> => fetchJson<DataVersions>('/api/versions')

/** 讀單一公開集合，回傳形狀與對應的 firestoreApi getter 完全一致。 */
export const fetchWorkerCollection = (key: string): Promise<unknown> => fetchJson<unknown>(`/api/data/${key}`)
