import { useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSimulatorEntryVisible } from '../hooks/useSimulatorEntry'

// 常見誤入路徑的熱門去處（對齊 Layout 導覽列的主要項目）
const SUGGESTIONS = [
  { to: '/',          label: '首頁' },
  { to: '/pilots',    label: '機師' },
  { to: '/mechs',     label: '機甲' },
  { to: '/weapons',   label: '武器' },
  { to: '/simulator', label: '配裝模擬器' },
  { to: '/documents', label: '文件' },
]

/**
 * 全站 catch-all 的 404 頁（`<Route path="*">`）。
 *
 * 為何需要：先前沒有 catch-all，任何未匹配路徑只會渲染出 Layout 外框、內容區整片空白，
 * 使用者無從判斷是打錯網址還是站台壞了。
 *
 * 為何要 noindex：站台掛在 GitHub Pages（無 SPA rewrite），深層路徑靠 public/404.html
 * 的跳轉還原。若日後在 Cloudflare 邊緣加上「未匹配路徑改寫到 /index.html」的 Transform
 * Rule，所有亂打的網址都會變成 HTTP 200，屆時搜尋引擎可能收錄大量垃圾 URL，故在此
 * 主動插入 robots noindex（離開本頁時移除，避免污染其他路由）。
 */
export default function NotFoundPage() {
  const { pathname } = useLocation()
  // 模擬器內部測試期間不對外露出入口（404 頁也算一處），見 hooks/useSimulatorEntry.ts
  const simulatorEntryVisible = useSimulatorEntryVisible()
  const suggestions = useMemo(
    () => (simulatorEntryVisible ? SUGGESTIONS : SUGGESTIONS.filter((s) => s.to !== '/simulator')),
    [simulatorEntryVisible]
  )

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])

  return (
    // 背景是高對比的人物插圖，純文字疊上去會糊；比照 NewsPage 加半透明底 + 模糊確保可讀性。
    <div className="max-w-2xl mx-auto my-16 px-4 py-16 text-center bg-bg-dark/40 backdrop-blur-md rounded-2xl border border-border">
      <span className="text-[10px] font-bold tracking-[3px] text-accent-orange uppercase font-[Orbitron,sans-serif]">
        Error 404
      </span>

      <h1 className="text-6xl md:text-7xl font-black mt-3 font-[Orbitron,sans-serif] text-text-primary">404</h1>

      <p className="text-lg font-bold mt-4 text-text-primary">找不到這個頁面</p>
      <p className="text-text-secondary mt-2 leading-relaxed">
        網址可能打錯了，或這個頁面已經搬家。
      </p>

      <div className="mt-5 inline-block max-w-full bg-bg-card border border-border rounded-lg px-4 py-2">
        <code className="text-[12px] text-text-dim font-mono break-all">{pathname}</code>
      </div>

      <div className="mt-10">
        <div className="text-[11px] text-text-dim tracking-[2px] uppercase font-[Orbitron,sans-serif] mb-4">
          試試這些頁面
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="text-[13px] px-4 py-2 rounded-lg border border-border bg-bg-card text-text-secondary
                         no-underline transition-colors hover:text-white hover:border-accent-cyan/50"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
