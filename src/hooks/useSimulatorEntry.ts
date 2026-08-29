import { useAuth } from '../contexts/AuthContext'

/**
 * 配裝模擬器是否仍處於「內部測試」狀態。
 *
 * 2026-08-26：PLAN-052 的 MVP（A＋B＋C＋I＋J）在尚未經過內部人員測試的情況下被推上
 * 正式站。事後採「路由留著、入口收起」補回測試關卡——`/simulator` 路由完全不動，
 * 知道網址的內部人員照樣進得去（含 `?b=` 分享碼），一般訪客則在導覽列、個人頁、
 * 404 頁都看不到入口。
 *
 * 之所以不 revert：線上跑的是帶明確「建置中」標記的分階段 MVP，且**當時**模擬器全程沒有
 * 任何 Firestore 寫入（書架走 localStorage、分享碼是純前端 codec），回捲反而會一併殺掉
 * 052-A 的機甲詳情頁槽位表與 052-J 的雙手武器修復。
 *
 * ⚠ **「沒有任何 Firestore 寫入」這個前提已於 2026-08-29 失效**（PLAN-052-E）：
 *   登入者的雲端書架會寫 `users/{uid}/builds/{pilotId}`。上面那段是**當時**的判斷依據，
 *   保留原文以說明「為何當初選擇不 revert」，但別再拿它推論「模擬器不會動到資料庫」。
 *   連帶影響：讀寫額度、離線行為、規則被拒的錯誤呈現，三者從 052-E 起才第一次存在。
 *
 * 收尾：內部測試通過後把本旗標改為 `false` 即正式公開；確定不再需要時，連同本檔與
 * `useSimulatorEntryVisible()` 的四處呼叫一併刪除，即回到 052-B 的全面公開狀態。
 *
 * ✅ **2026-08-29：已改為 `false`，模擬器正式對外開放。** 這是一次獨立裁決，不夾帶在任何
 *   PLAN 裡（052-H 那條「前置條件不是程式，是流量」也因此解除）。旗標**留著不刪**是刻意的：
 *   052-E 是模擬器第一次寫 Firestore，讀寫額度、離線行為、規則被拒的實際樣子都要等真實
 *   流量進來才看得到，把收回的代價保持在「改一個字」很划算。確定穩定後再依上一段連檔帶
 *   四處呼叫一起刪。
 */
export const SIMULATOR_INTERNAL_ONLY = false

/**
 * 導覽入口是否要顯示。內部測試期間只有 ADMIN／OWNER 看得到入口——沿用 Layout 既有的
 * 角色判斷慣例，不另立一套測試者名單（測試者用直接網址即可，不需要被授予後台角色）。
 */
export function useSimulatorEntryVisible(): boolean {
  const { userProfile } = useAuth()
  if (!SIMULATOR_INTERNAL_ONLY) return true
  return userProfile?.role === 'ADMIN' || userProfile?.role === 'OWNER'
}
