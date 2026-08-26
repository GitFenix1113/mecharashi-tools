import { useAuth } from '../contexts/AuthContext'

/**
 * 配裝模擬器是否仍處於「內部測試」狀態。
 *
 * 2026-08-26：PLAN-052 的 MVP（A＋B＋C＋I＋J）在尚未經過內部人員測試的情況下被推上
 * 正式站。事後採「路由留著、入口收起」補回測試關卡——`/simulator` 路由完全不動，
 * 知道網址的內部人員照樣進得去（含 `?b=` 分享碼），一般訪客則在導覽列、個人頁、
 * 404 頁都看不到入口。
 *
 * 之所以不 revert：線上跑的是帶明確「建置中」標記的分階段 MVP，且模擬器全程沒有任何
 * Firestore 寫入（書架走 localStorage、分享碼是純前端 codec），回捲反而會一併殺掉
 * 052-A 的機甲詳情頁槽位表與 052-J 的雙手武器修復。
 *
 * 收尾：內部測試通過後把本旗標改為 `false` 即正式公開；確定不再需要時，連同本檔與
 * `useSimulatorEntryVisible()` 的四處呼叫一併刪除，即回到 052-B 的全面公開狀態。
 */
export const SIMULATOR_INTERNAL_ONLY = true

/**
 * 導覽入口是否要顯示。內部測試期間只有 ADMIN／OWNER 看得到入口——沿用 Layout 既有的
 * 角色判斷慣例，不另立一套測試者名單（測試者用直接網址即可，不需要被授予後台角色）。
 */
export function useSimulatorEntryVisible(): boolean {
  const { userProfile } = useAuth()
  if (!SIMULATOR_INTERNAL_ONLY) return true
  return userProfile?.role === 'ADMIN' || userProfile?.role === 'OWNER'
}
