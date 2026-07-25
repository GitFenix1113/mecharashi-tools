// ── 資料版本號（對應前端 meta/gameData 機制）──────────────────────────────────
// 邊緣快取以「集合版本號」為 key：後台 bumpDataVersion 改了版本號 → key 改變 →
// 舊快取自然失效、下次 miss 重讀。與前端 GameDataContext 的版本 gate 同一套邏輯。

import type { ServiceAccount } from './gcpAuth'
import { getDocument } from './firestoreRest'

export interface DataVersions {
  global: string | null
  byKey: Record<string, string>
}

// module scope 快取（同一 isolate、60s 內復用）：避免每個資料請求都讀一次 meta/gameData。
// 代價是 bumpDataVersion 後最多 60s 才對「快取仍熱」的 isolate 生效，對靜態遊戲資料可接受。
let cached: { v: DataVersions; at: number } | null = null
const TTL_MS = 60_000

export async function getDataVersions(sa: ServiceAccount, token: string): Promise<DataVersions> {
  const now = Date.now()
  if (cached && now - cached.at < TTL_MS) return cached.v

  const doc = await getDocument(sa, token, 'meta', 'gameData')
  const v: DataVersions = {
    global: (doc?.version as string | undefined) ?? null,
    byKey: (doc?.versions as Record<string, string> | undefined) ?? {},
  }
  cached = { v, at: now }
  return v
}

/** 某集合有效版本 = byKey[key] ?? global ?? 'v0'（無版本時給固定值，快取仍運作）。 */
export function effectiveVersion(key: string, versions: DataVersions): string {
  return versions.byKey[key] ?? versions.global ?? 'v0'
}
