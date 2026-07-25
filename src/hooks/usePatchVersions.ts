import { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { WORKER_ENABLED, fetchWorkerCollection } from '../lib/api/workerData'
import { PATCH_VERSIONS } from '../data/patchVersions'
import type { PatchVersion } from '../data/patchVersions'

function parseVersionDate(str: string): Date {
  const cleaned = str.replace(/^[^0-9]+/, '')
  const [y, m, d] = cleaned.split(/[\/\-]/).map(Number)
  return new Date(y, m - 1, d)
}

// 若有任一版本手動設定 isTwCurrent，優先採用；否則依 twDate 自動標記
function applyTwCurrent(versions: PatchVersion[]): PatchVersion[] {
  if (versions.some(v => v.isTwCurrent === true)) {
    return versions
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let currentIdx = -1
  for (let i = 0; i < versions.length; i++) {
    const twDate = versions[i].upper.twDate
    if (!twDate || versions[i].upper.twIsPredicted) continue
    if (parseVersionDate(twDate) <= today) currentIdx = i
  }

  return versions.map((v, i) => ({ ...v, isTwCurrent: i === currentIdx }))
}

export interface PatchVersionsResult {
  data: PatchVersion[]
  loading: boolean
  error: Error | null
}

interface CacheEntry {
  data: PatchVersion[]
  error: Error | null
}

// Module-level singleton: one fetch per app session, shared across all mounts.
let _cache: CacheEntry | null = null
let _promise: Promise<CacheEntry> | null = null

function _fetchOnce(): Promise<CacheEntry> {
  if (_cache !== null) return Promise.resolve(_cache)
  if (_promise !== null) return _promise
  // PLAN-029 Phase 3-1：Worker 模式改走代理（Phase 3-2 收緊 patchVersions 後仍運作）；
  // 兩條路徑都正規化成 PatchVersion[]，再套「空 → 靜態 fallback」與排序邏輯。
  const load: Promise<PatchVersion[]> = WORKER_ENABLED
    ? (fetchWorkerCollection('patchVersions') as Promise<PatchVersion[]>)
    : getDocs(collection(db, 'patchVersions')).then(snap => snap.docs.map(d => d.data() as PatchVersion))
  _promise = load
    .then(docs => {
      const raw = docs.length === 0
        ? PATCH_VERSIONS
        : docs.slice().sort((a, b) => parseFloat(a.version) - parseFloat(b.version))
      _cache = { data: applyTwCurrent(raw), error: null }
      return _cache
    })
    .catch(err => {
      console.error('[usePatchVersions] 讀取失敗，改用靜態 fallback：', err)
      _cache = {
        data: applyTwCurrent(PATCH_VERSIONS),
        error: err instanceof Error ? err : new Error(String(err)),
      }
      _promise = null
      return _cache
    })
  return _promise
}

/** Call after admin saves a version so the next usePatchVersions re-fetches. */
export function invalidatePatchVersionsCache(): void {
  _cache = null
  _promise = null
}

export function usePatchVersions(): PatchVersionsResult {
  const [result, setResult] = useState<CacheEntry>(
    _cache ?? { data: applyTwCurrent(PATCH_VERSIONS), error: null },
  )
  const [loading, setLoading] = useState(_cache === null)

  useEffect(() => {
    if (_cache !== null) {
      // Already resolved before mount — no async needed
      setResult(_cache)
      setLoading(false)
      return
    }
    let cancelled = false
    _fetchOnce().then(entry => {
      if (!cancelled) {
        setResult(entry)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  return { data: result.data, loading, error: result.error }
}
