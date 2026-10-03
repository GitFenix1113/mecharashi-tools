import { useAuth } from '../contexts/AuthContext'

/**
 * 機師故事館（PLAN-042-A／042-C）是否仍處於「內部」狀態。
 *
 * 2026-10-03 站長決定：故事館的雛形已經能看，但還不算完成——先**收起入口**、合併回 main，
 * 不讓它卡住其他計畫（PLAN-054 要從 main 開分支）。做法比照 `SIMULATOR_INTERNAL_ONLY`
 * 的「路由留著、入口收起」：`/lore/*` 路由完全不動，知道網址的人照樣進得去；
 * 一般訪客在導覽列、手機 More 面板、機師詳情頁都看不到入口，網站更新履歷裡介紹故事館的
 * 條目也先不顯示（`ChangelogEntry.unreleased`）。
 *
 * ⚠ 機師詳情頁不能只把「讀完整故事 ▸」藏掉：042-A D-4 把那一區改成「首句＋入館連結」，
 *   只藏連結的話，一般訪客就**連完整逸聞都讀不到了**。旗標關著時那一區退回 042-A 之前的
 *   全文顯示（見 PilotDetailPage 的「機師故事」）。
 *
 * 收尾：故事館完成後把本旗標改為 `false` 即正式公開，並同步做三件事——
 *   ① 把 siteChangelog 裡 `unreleased: true` 的故事館條目拿掉旗標、日期改成公開日；
 *   ② Cloudflare Transform Rule 的 SPA fallback 白名單補上 `/lore`（CLAUDE.md 第 3 節）；
 *   ③ 確定穩定後連同本檔與 `useLoreEntryVisible()` 的呼叫一起刪除。
 */
export const LORE_INTERNAL_ONLY = true

/**
 * 故事館入口是否要顯示。內部期間只有 ADMIN／OWNER 看得到——與模擬器內測期間同一套角色判斷，
 * 不另立名單（其他測試者用直接網址即可）。
 */
export function useLoreEntryVisible(): boolean {
  const { userProfile } = useAuth()
  if (!LORE_INTERNAL_ONLY) return true
  return userProfile?.role === 'ADMIN' || userProfile?.role === 'OWNER'
}
