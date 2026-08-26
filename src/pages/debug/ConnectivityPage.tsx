import { useCallback, useEffect, useState } from 'react'
import { WORKER_ENABLED, workerUrl } from '../../lib/api/workerData'
import { SITE_NAME } from '../../lib/siteMeta'

/**
 * 連線診斷頁（PLAN-029 Phase 5-3：中國讀取實測）
 *
 * 動機：請海外／中國使用者「幫忙測測看」，收到的回報通常是「還是有點慢」，無從比較也無法行動。
 * 這頁把該量的東西量出來，輸出一段可直接複製貼上的報告，測試者不必開 DevTools。
 *
 * 隱私：報告會刻意**移除 IP**（/cdn-cgi/trace 會回傳 ip=），只保留節點代碼與國別；
 * 這些足以判斷連到哪個 Cloudflare 邊緣，卻不會讓回報者把自己的 IP 貼進公開頻道。
 */

interface Result {
  key: string
  label: string
  hint: string
  status: 'pending' | 'ok' | 'fail'
  ms?: number
  detail?: string
}

const IMG = '/images/backpacks/Icon_backpack_60100101.png'
const FONT = '/fonts/orbitron-latin.woff2'
// 對照組：中國封鎖的 Google 網域。本站已不再依賴它，這裡只用來確認「封鎖確實存在」，
// 好讓回報者的數據能佐證移除 Google Fonts 是對的。逾時 4 秒即放棄，不拖慢診斷。
const BLOCKED_CONTROL = 'https://fonts.googleapis.com/css2?family=Orbitron&display=swap'

const TESTS: Omit<Result, 'status'>[] = [
  { key: 'trace',  label: 'Cloudflare 節點', hint: '你連到哪個邊緣機房（不含 IP）' },
  { key: 'api',    label: '資料端點 /api/versions', hint: '版本查詢，判斷資料層是否通' },
  { key: 'data',   label: '資料傳輸 /api/data', hint: '約 36KB 的實際內容，看傳輸速度' },
  { key: 'image',  label: '圖片 /images', hint: '靜態資源與邊緣快取' },
  { key: 'font',   label: '自託管字體 /fonts', hint: '改自託管後是否取得得到' },
  { key: 'google', label: '對照組：Google Fonts', hint: '本站已不依賴；失敗屬預期' },
]

async function timed(fn: () => Promise<string>): Promise<{ ms: number; detail: string }> {
  const t0 = performance.now()
  const detail = await fn()
  return { ms: Math.round(performance.now() - t0), detail }
}

export default function ConnectivityPage() {
  const [results, setResults] = useState<Result[]>(TESTS.map(t => ({ ...t, status: 'pending' })))
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [startedAt, setStartedAt] = useState('')

  const update = (key: string, patch: Partial<Result>) =>
    setResults(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)))

  const run = useCallback(async () => {
    setRunning(true)
    setCopied(false)
    setStartedAt(new Date().toISOString())
    setResults(TESTS.map(t => ({ ...t, status: 'pending' })))

    // cache: 'no-store' 只繞過**瀏覽器**快取，Cloudflare 邊緣快取仍會命中 → 量到的是真實訪客體驗
    const opts: RequestInit = { cache: 'no-store' }

    const steps: Record<string, () => Promise<string>> = {
      trace: async () => {
        const text = await (await fetch('/cdn-cgi/trace', opts)).text()
        const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]
        const colo = get('colo')
        // 本機開發沒有 Cloudflare 邊緣，dev server 會回 index.html → 解析不到 colo。
        // 這種情況要判為失敗，不能顯示一排「?」還打勾。
        if (!colo) throw new Error('取不到（非經 Cloudflare，例如本機開發環境）')
        return `節點 ${colo} · 國別 ${get('loc') ?? '?'} · ${get('http') ?? '?'} · ${get('tls') ?? '?'}`
      },
      api: async () => {
        if (!WORKER_ENABLED) throw new Error('未設定 VITE_WORKER_API_BASE')
        const res = await fetch(workerUrl('/api/versions'), opts)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await res.json() // 非 JSON（例如被導回 index.html）會在這裡拋錯，避免假成功
        return `OK · ${new URL(workerUrl('/api/versions'), location.href).host}`
      },
      data: async () => {
        if (!WORKER_ENABLED) throw new Error('未設定 VITE_WORKER_API_BASE')
        const res = await fetch(workerUrl('/api/data/glossaryTerms'), opts)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const type = res.headers.get('content-type') ?? ''
        if (!type.includes('json')) throw new Error(`回應非 JSON（${type || '未知'}）`)
        const kb = Math.round((await res.blob()).size / 1024)
        return `${kb} KB`
      },
      image: async () => {
        const res = await fetch(IMG, opts)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const kb = Math.round((await res.blob()).size / 1024)
        return `${kb} KB · 邊緣快取 ${res.headers.get('cf-cache-status') ?? '?'}`
      },
      font: async () => {
        const res = await fetch(FONT, opts)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return `${Math.round((await res.blob()).size / 1024)} KB`
      },
      google: async () => {
        // no-cors：跨源且對方不給 CORS header，只需知道「連不連得上」，不需讀內容
        await fetch(BLOCKED_CONTROL, { mode: 'no-cors', signal: AbortSignal.timeout(4000) })
        return '可連線（未被封鎖）'
      },
    }

    for (const t of TESTS) {
      try {
        const { ms, detail } = await timed(steps[t.key])
        update(t.key, { status: 'ok', ms, detail })
      } catch (e) {
        const msg = e instanceof Error ? (e.name === 'TimeoutError' ? '逾時（4 秒）' : e.message) : String(e)
        update(t.key, { status: 'fail', detail: msg })
      }
    }
    setRunning(false)
  }, [])

  // 進頁即自動開跑（測試者不必再按一次）。刻意排到下一個 tick：run() 一開頭就 setState，
  // 直接在 effect body 內呼叫會造成連鎖 render（react-hooks/set-state-in-effect）。
  useEffect(() => {
    const id = setTimeout(() => { void run() }, 0)
    return () => clearTimeout(id)
  }, [run])

  const report = [
    `【${SITE_NAME} 連線診斷】${startedAt}`,
    ...results.map(r => {
      const state = r.status === 'ok' ? '✅' : r.status === 'fail' ? '❌' : '…'
      const ms = r.ms !== undefined ? `${r.ms}ms` : '-'
      return `${state} ${r.label}：${ms}${r.detail ? ` · ${r.detail}` : ''}`
    }),
    `裝置：${navigator.userAgent}`,
  ].join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="mb-6">
        <span className="text-[10px] font-bold tracking-[3px] text-accent-cyan uppercase font-[Orbitron,sans-serif]">
          Diagnostics
        </span>
        <h1 className="text-3xl font-bold mt-2">連線診斷</h1>
        <p className="text-text-secondary mt-2 leading-relaxed">
          量測本站各項資源在你的網路環境下的實際表現。測完把下方報告複製給站方即可，
          <strong className="text-text-primary">報告不含你的 IP</strong>。
        </p>
      </div>

      <div className="bg-bg-card border border-border rounded-xl overflow-hidden mb-6">
        {results.map(r => (
          <div key={r.key} className="flex items-start gap-3 px-5 py-3 border-b border-border last:border-b-0">
            <span className="text-[15px] leading-6 w-5 shrink-0">
              {r.status === 'ok' ? '✅' : r.status === 'fail' ? '❌' : '⏳'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-text-primary">{r.label}</div>
              <div className="text-[11px] text-text-dim mt-0.5">{r.hint}</div>
              {r.detail && (
                <div className={`text-[12px] mt-1 font-mono break-all ${r.status === 'fail' ? 'text-accent-red' : 'text-text-secondary'}`}>
                  {r.detail}
                </div>
              )}
            </div>
            <span className="text-[13px] font-mono text-accent-cyan shrink-0">
              {r.ms !== undefined ? `${r.ms}ms` : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={() => void run()}
          disabled={running}
          className="text-[13px] px-4 py-2 rounded-lg border border-border bg-bg-card text-text-secondary
                     transition-colors hover:text-white hover:border-accent-cyan/50 disabled:opacity-50"
        >
          {running ? '測試中…' : '重新測試'}
        </button>
        <button
          onClick={() => void copy()}
          disabled={running}
          className="text-[13px] px-4 py-2 rounded-lg border border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan
                     transition-colors hover:bg-accent-cyan/20 disabled:opacity-50"
        >
          {copied ? '已複製 ✓' : '複製報告'}
        </button>
      </div>

      <div className="text-[11px] text-text-dim mb-2">報告內容（可自行全選複製）</div>
      <pre className="bg-bg-card border border-border rounded-xl p-4 text-[11px] text-text-secondary
                      font-mono whitespace-pre-wrap break-all overflow-x-auto">
        {report}
      </pre>

      <div className="text-[11px] text-text-dim mt-6 leading-relaxed">
        「對照組：Google Fonts」失敗是<strong className="text-text-secondary">正常且預期</strong>的——
        部分地區封鎖 Google 網域。本站已把字體改為自託管，不再依賴它，此項僅用於確認你的網路環境。
      </div>
    </div>
  )
}
