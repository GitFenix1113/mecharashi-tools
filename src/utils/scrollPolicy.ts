// 換頁時的捲動策略（2026-10-11）—— 純函式，DOM 的部分在 components/layout/ScrollManager.tsx
//
// 站上用的是元件式路由（<BrowserRouter><Routes>），React Router 的 <ScrollRestoration>
// 只支援 data router，所以在這之前**全站沒有任何換頁捲動處理**：從機甲圖鑑捲到第三排點進去，
// 詳情頁會直接開在同樣的高度，使用者得自己捲回頂端才看得到名稱與數值。
//
// 決策表（只看「路徑有沒有變」與「怎麼來的」）：
//
//   上一頁／下一頁（POP） → 回到那一頁離開時的位置（有記錄才回；沒記錄＝第一次載入，不動）
//   PUSH 且路徑變了       → 回到頂端（有 #錨點 就交給錨點）
//   PUSH 但路徑沒變       → 不動。只改 ?query（機師詳情頁的 ?tab=、圖鑑篩選、模擬器分享碼）
//                           是同一頁的狀態切換，捲回頂端會把人從正在看的地方拉走
//   REPLACE              → 不動。站上的 replace 全是「頁內狀態寫進網址」：時間線切換版本、
//                           故事館換章（故事館另有自己的捲動容器與捲頂邏輯）、
//                           後台版本建立後改網址；`<Navigate replace>` 的轉址則緊跟在一次
//                           PUSH 之後，那一次已經捲過頂了

export type NavType = 'POP' | 'PUSH' | 'REPLACE'

export type ScrollAction =
  | { kind: 'none' }
  | { kind: 'top' }
  | { kind: 'hash'; id: string }
  | { kind: 'restore'; y: number }

export function scrollActionFor(args: {
  navType: NavType
  prevPathname: string
  pathname: string
  hash: string
  /** 這個歷史項目上次離開時記下的 scrollY；沒記過就是 undefined */
  savedY: number | undefined
}): ScrollAction {
  const { navType, prevPathname, pathname, hash, savedY } = args
  if (navType === 'POP') return savedY === undefined ? { kind: 'none' } : { kind: 'restore', y: savedY }
  if (navType === 'REPLACE') return { kind: 'none' }
  if (prevPathname === pathname) return { kind: 'none' }
  if (hash.length > 1) return { kind: 'hash', id: decodeURIComponent(hash.slice(1)) }
  return { kind: 'top' }
}

/** 記錄表的上限：sessionStorage 只活在這個分頁，但長時間瀏覽仍會一直長，留最近的就夠 */
export const MAX_SAVED_POSITIONS = 100

/** 新增一筆並把最舊的擠掉（Map 保留插入順序；同 key 先刪再插，讓它變成最新） */
export function rememberPosition(map: Map<string, number>, key: string, y: number, max = MAX_SAVED_POSITIONS): void {
  map.delete(key)
  map.set(key, Math.max(0, Math.round(y)))
  while (map.size > max) map.delete(map.keys().next().value as string)
}
