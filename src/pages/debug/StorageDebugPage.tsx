import { useCallback, useEffect, useState } from 'react'

// ── 儲存持久化診斷頁（隱藏路由 /debug/storage，不連進導覽、不需登入）──
// 用途：驗證 navigator.storage.persist()（在 src/lib/firebase.ts 啟動時申請）是否真的被瀏覽器核准。
// persist 的核准與否綁定「瀏覽器 profile + 對本站的互動熱度」啟發式，無法從別的裝置代測，
// 因此提供這頁讓使用者（尤其常「莫名登出」者）在自己的日常裝置上打開、截圖回報。

interface Estimate {
  usage?: number
  quota?: number
}

function fmtBytes(n?: number): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

export default function StorageDebugPage() {
  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.persist === 'function'

  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [lastRequestResult, setLastRequestResult] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    if (!supported) return
    try {
      setPersisted(await navigator.storage.persisted())
    } catch {
      setPersisted(null)
    }
    try {
      const e = await navigator.storage.estimate()
      setEstimate({ usage: e.usage, quota: e.quota })
    } catch {
      setEstimate(null)
    }
  }, [supported])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const requestPersist = async () => {
    if (!supported) return
    setRequesting(true)
    try {
      const granted = await navigator.storage.persist()
      setLastRequestResult(granted)
    } catch {
      setLastRequestResult(false)
    } finally {
      setRequesting(false)
      await refresh()
    }
  }

  const pct =
    estimate?.usage != null && estimate?.quota
      ? Math.min(100, (estimate.usage / estimate.quota) * 100)
      : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 text-slate-100">
      <h1 className="mb-1 text-2xl font-bold">儲存持久化診斷</h1>
      <p className="mb-6 text-sm text-slate-400">
        用來確認本站是否取得「持久化儲存」授權。若未取得，裝置空間吃緊時瀏覽器可能會清除本站資料，
        導致登入狀態被清掉而「自動登出」。請在你平常會登出的那台裝置 / 瀏覽器打開此頁並截圖。
      </p>

      {!supported && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          此瀏覽器不支援 Storage API（<code>navigator.storage.persist</code>）。
          代表無法主動申請持久化，較舊或特殊瀏覽器（含部分 iOS 情境）會落在此類。
        </div>
      )}

      {supported && (
        <div className="space-y-4">
          {/* 是否已持久化 */}
          <div
            className={`rounded-lg border p-4 ${
              persisted
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-rose-500/40 bg-rose-500/10'
            }`}
          >
            <div className="text-sm text-slate-300">目前是否已持久化（persisted）</div>
            <div
              className={`mt-1 text-2xl font-bold ${
                persisted ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {persisted === null ? '查詢中…' : persisted ? '✅ 已持久化' : '❌ 未持久化'}
            </div>
            {persisted === false && (
              <p className="mt-2 text-xs text-rose-200/80">
                未持久化 → 空間壓力下資料可能被清除。按下方按鈕嘗試申請；若仍無法核准，
                建議把本站加入書籤 / 加到主畫面 / 常回訪以提高互動熱度，Chrome 才會核准。
              </p>
            )}
          </div>

          {/* 儲存用量 */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <div className="text-sm text-slate-300">本站儲存用量</div>
            <div className="mt-1 font-mono text-lg">
              {fmtBytes(estimate?.usage)} / {fmtBytes(estimate?.quota)}
              {pct != null && (
                <span className="ml-2 text-sm text-slate-400">（{pct.toFixed(1)}%）</span>
              )}
            </div>
            {pct != null && (
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-700">
                <div
                  className={`h-full ${pct > 80 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>

          {/* 手動申請 */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <button
              onClick={requestPersist}
              disabled={requesting || persisted === true}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {persisted === true
                ? '已持久化，無需申請'
                : requesting
                  ? '申請中…'
                  : '手動申請持久化'}
            </button>
            {lastRequestResult !== null && (
              <p
                className={`mt-2 text-sm ${
                  lastRequestResult ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                申請結果：{lastRequestResult ? '核准 ✅' : '未核准 ❌（瀏覽器依互動熱度判定）'}
              </p>
            )}
            <button
              onClick={() => void refresh()}
              className="ml-3 text-sm text-slate-400 underline hover:text-slate-200"
            >
              重新整理狀態
            </button>
          </div>

          <p className="text-xs text-slate-500">
            提示：截圖時把上方「是否已持久化」與「儲存用量」一起拍進去最有幫助。
          </p>
        </div>
      )}
    </div>
  )
}
