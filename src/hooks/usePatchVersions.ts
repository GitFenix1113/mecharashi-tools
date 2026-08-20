import { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { WORKER_ENABLED, fetchWorkerCollection } from '../lib/api/workerData'
import { PATCH_VERSIONS } from '../data/patchVersions'
import type { PatchVersion } from '../data/patchVersions'
import type { PatchHalf } from '../data/patchVersions/types'

function parseVersionDate(str: string): Date {
  const cleaned = str.replace(/^[^0-9]+/, '')
  const [y, m, d] = cleaned.split(/[\/\-]/).map(Number)
  return new Date(y, m - 1, d)
}

/**
 * 台服日期的「預測值」是**算出來的，不是勾出來的**。
 *
 * 台服未來的檔期沒有官方公告，全部照固定週期（21 天）往後推 —— 順帶一提，
 * 「上半／下半」本身也是玩家依卡池自行的分類，官方沒有這種說法（`PatchHalf.weeks`
 * 保留可調就是為了這個）。所以規則只有一句：**還沒發生的是預測，已經過去的才是事實**。
 *
 * 為什麼不靠後台那個 checkbox：手動旗標會過期。標成預測的版本一旦實際開跑，
 * 就得有人記得回去取消勾選 —— 那是必然會忘的事，而忘了的後果不只是顏色不對，
 * 見下方 applyTwCurrent（預測版本會被跳過，不會被選成「台服當前」）。
 *
 * `twIsPredicted` 欄位保留為**手動覆寫**（後台勾選 → 存 true，取消 → 存 undefined
 * 回到自動）。它要接的是推導唯一接不住的情境：**台服延期** —— 推算的日期已經過去、
 * 版本卻還沒開，這時自動判定會把它當成事實。勾起來就能讓它維持預測狀態，直到有人
 * 填上真正的日期。
 *
 * 實測 Firestore 上 50 個半版本目前全部沒有這個欄位（不是存了 false），
 * 所以 `undefined` 判斷一律走推導，不會與既有資料打架。
 */
function applyPredictedByDate(versions: PatchVersion[]): PatchVersion[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const decide = (h: PatchHalf): PatchHalf =>
    h.twIsPredicted !== undefined
      ? h
      : { ...h, twIsPredicted: !!h.twDate && parseVersionDate(h.twDate) > today }
  return versions.map(v => ({ ...v, upper: decide(v.upper), lower: decide(v.lower) }))
}

/** 資料進前台前的統一正規化。順序有意義：isTwCurrent 的計算會跳過預測版本。 */
function normalize(versions: PatchVersion[]): PatchVersion[] {
  return applyTwCurrent(applyPredictedByDate(versions))
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
      _cache = { data: normalize(raw), error: null }
      return _cache
    })
    .catch(err => {
      console.error('[usePatchVersions] 讀取失敗，改用靜態 fallback：', err)
      _cache = {
        data: normalize(PATCH_VERSIONS),
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
    _cache ?? { data: normalize(PATCH_VERSIONS), error: null },
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
