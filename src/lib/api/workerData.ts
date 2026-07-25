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

// 去尾斜線，避免 `${BASE}/api/...` 變成雙斜線。
const BASE = (import.meta.env.VITE_WORKER_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? ''

/**
 * Worker 代理是否啟用：
 *   · 需設定 VITE_WORKER_API_BASE（Worker 部署後的網址）；
 *   · VITE_USE_WORKER=false 為 kill-switch，可在不動 BASE 的情況下強制回退直連。
 * 未設 BASE → 一律關閉（預設安全：沿用現行 Firestore 直連，合併本階段零風險）。
 */
export const WORKER_ENABLED = !!BASE && import.meta.env.VITE_USE_WORKER !== 'false'

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
