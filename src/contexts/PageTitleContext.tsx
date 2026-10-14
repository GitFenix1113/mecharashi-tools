import {
  createContext, useContext, useEffect, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react'
import { matchRoutes, useLocation } from 'react-router-dom'
import { ROUTE_PATTERNS } from '../lib/analytics/routeKeys'
import { formatDocTitle, routeDocTitle } from '../lib/seo'

/**
 * 分頁標題（document.title）—— PLAN-061。
 *
 * 搜尋引擎以 <title> 判斷頁面主題；改版前全站共用 index.html 的同一個標題，
 * 幾十個機師頁在搜尋結果裡長得一模一樣，「鋼嵐 ＋ 機師名」這類搜尋也就對不上。
 *
 * 兩層來源：
 *   ① 路由預設：依命中的樣板查 src/lib/seo.ts 的 PAGE_TITLES。新增頁面不必接線。
 *   ② 頁面覆寫：詳情頁資料到了以後呼叫 usePageTitle('海莉絲 機師資料')。
 *
 * 覆寫記錄自己屬於哪個 pathname，換頁時即使舊頁的 cleanup 還沒跑，
 * 也不會把上一頁的名字套到新頁上。
 *
 * ⚠ 不用 React 19 的 <title> 元素：它會接管 index.html 原有的 <title>，
 *   元件卸載時連那個元素一起移除，換到沒有宣告標題的頁面就變成沒有標題。
 */

interface TitleOverride {
  pathname: string
  title: string
}

type SetOverride = Dispatch<SetStateAction<TitleOverride | null>>

const PageTitleContext = createContext<SetOverride | null>(null)

/** matchRoutes 的輸入；理由同 usePageTracking（元件式路由不能用 useMatches）。 */
const ROUTE_OBJECTS = ROUTE_PATTERNS.map((path) => ({ path }))

function routeDefaultTitle(pathname: string): string {
  const matches = matchRoutes(ROUTE_OBJECTS, pathname)
  const matched = matches?.[matches.length - 1]
  if (!matched) return formatDocTitle(null)
  return routeDocTitle(matched.route.path, matched.params as Record<string, string | undefined>)
}

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [override, setOverride] = useState<TitleOverride | null>(null)

  const title = override && override.pathname === pathname
    ? formatDocTitle(override.title)
    : routeDefaultTitle(pathname)

  useEffect(() => {
    document.title = title
  }, [title])

  return <PageTitleContext.Provider value={setOverride}>{children}</PageTitleContext.Provider>
}

/**
 * 以頁面自己的內容當頁名，例如 `usePageTitle(pilot ? `${pilot.name} 機師資料` : null)`。
 * 傳 null／undefined（資料還沒到、找不到實體）時沿用路由預設頁名。
 */
// eslint-disable-next-line react-refresh/only-export-components -- Provider 與 hook 成對放，比照 AuthContext
export function usePageTitle(title: string | null | undefined): void {
  const setOverride = useContext(PageTitleContext)
  const { pathname } = useLocation()

  useEffect(() => {
    if (!setOverride || !title) return
    const entry: TitleOverride = { pathname, title }
    setOverride(entry)
    // 只撤掉自己設的那筆：新頁的 effect 可能已經先寫進去了
    return () => setOverride((cur) => (cur === entry ? null : cur))
  }, [setOverride, pathname, title])
}
