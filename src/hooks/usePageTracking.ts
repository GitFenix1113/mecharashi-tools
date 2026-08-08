// ── 前端埋點掛載點（PLAN-046 A-2）───────────────────────────────────────────
//
// SPA 的路由變更**不觸發任何原生事件**（瀏覽器對伺服器一個請求都沒發），所以統計
// 必須自己接 React Router。這也正是「靠 Cloudflare 請求日誌反推」在本站行不通的原因：
// 換頁不產生請求，加上三層快取讓資料請求與瀏覽次數脫鉤，被動日誌結構性地測不準。

import { useEffect } from 'react'
import { matchRoutes, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ROUTE_PATTERNS } from '../lib/analytics/routeKeys'
import { installTracking, setRole, trackPageView } from '../lib/analytics/track'

/**
 * matchRoutes 的輸入。
 *
 * ⚠ 為什麼不用 useMatches()：本專案是元件式路由（<BrowserRouter><Routes>），
 *   **不是 data router**。useMatches 只在 RouterProvider 底下有效，在這裡會直接拋錯。
 *   matchRoutes 接受純物件陣列，能在不重構路由架構的前提下取得「命中的樣板」
 *   而非「實際網址」—— 後者當 key 會讓 byRoute 長出上百個鍵並撐爆日文件。
 */
const ROUTE_OBJECTS = ROUTE_PATTERNS.map((path) => ({ path }))

/** 在 Layout 內呼叫一次即可涵蓋全站。 */
export function usePageTracking(): void {
  const location = useLocation()
  const { userProfile, loading } = useAuth()

  useEffect(() => installTracking(), [])

  // 角色是非同步載入的，第一次瀏覽極可能在角色確定前就發生。track.ts 的做法是
  // 先照常緩衝，等確認為特權身分時再把整個 buffer 丟掉並永久排除 ——
  // 事後補救比「等角色回來才開始統計」可靠，也不會拖累一般使用者的資料。
  useEffect(() => {
    setRole(loading ? null : (userProfile?.role ?? null))
  }, [loading, userProfile?.role])

  useEffect(() => {
    const matches = matchRoutes(ROUTE_OBJECTS, location.pathname)
    const matched = matches?.[matches.length - 1]
    if (!matched) return
    trackPageView(
      matched.route.path ?? '*',
      matched.params as Record<string, string | undefined>,
    )
  }, [location.pathname])
}
