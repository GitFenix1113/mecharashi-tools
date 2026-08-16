// PLAN-048 Phase 1（任務 1-7）：deprecated 欄位 → TimedActivity 的讀取端 shim
import type { PatchHalf, TimedActivity, VisibleActivity } from './types'

/**
 * 為什麼需要這層：甘特只讀 `cnActivities` / `twActivities`，但
 * `src/data/patchVersions/*.ts` 的靜態 fallback 資料（v2.8–v3.3）至今仍只填了
 * 舊欄位（`skinGacha` / `rouletteEvent` / `specialEvents` / `revivedBanners`）。
 * 於是只要 Worker 掛掉、前台退回靜態資料，甘特就是一片空的 —— 明明有資料。
 *
 * 這是**讀取端**的降級補償，不是資料遷移：新欄位一存在就完全以它為準，
 * 舊欄位只在新欄位整個缺席時才被翻譯出來，兩者不會疊加。
 *
 * 舊欄位沒有起訖資訊，只能以「本半版本整段」近似 —— 所以一律標成
 * `confidence: 'predicted'`，讓前台以虛線呈現，不冒充查證過的資料。
 */
/**
 * 前台可顯示的活動：唯一的顯示閘門。
 *
 * 兩個排除條件是**同一件事的兩半**，缺一不可：
 *   · `hidden` —— 維護者明確標記「還沒好，先別上」。
 *   · 缺 `weeks` —— 沒有長度就畫不出甘特長條。這條不倚賴 hidden 有沒有被正確設定：
 *     寫入端漏標的後果不該是前台崩掉或畫出一條長度是猜的長條。
 *
 * 型別上 `weeks?: number`，但通過這道閘門之後保證有值 —— 用回傳型別把這件事編碼進
 * 型別系統，下游（ganttGeometry / activityStatus）才不必各自再防一次。
 */
export function isVisibleActivity(act: TimedActivity): act is VisibleActivity {
  return act.hidden !== true && typeof act.weeks === 'number' && act.weeks > 0
}

export function activitiesOfHalf(
  half: PatchHalf,
  side: 'tw' | 'cn',
  /** 本半版本的起始日與週數；推導自版本邊界，由呼叫端提供 */
  fallbackSpan: { startDate: string; weeks: number } | null,
): VisibleActivity[] {
  const raw = (side === 'tw' ? half.twActivities : half.cnActivities) ?? []
  const fresh = raw.filter(isVisibleActivity)
  // 注意判斷用 raw 而非 fresh：整半期的活動剛好全被藏起來時，那代表「已登錄但未就緒」，
  // 不該退回去把 deprecated 舊欄位翻譯出來當成資料 —— 那會顯示成早就被取代的舊內容。
  if (raw.length > 0) return fresh

  // 台版沒填但陸版有：不借用。兩服的活動檔期本來就不同，借用會顯示成錯誤事實。
  if (!fallbackSpan) return []

  const { startDate, weeks } = fallbackSpan
  const out: VisibleActivity[] = []
  const push = (name: string, type: TimedActivity['type']) => {
    const trimmed = name.trim()
    if (trimmed) out.push({ name: trimmed, startDate, weeks, type, confidence: 'predicted' })
  }

  if (half.skinGacha) push(half.skinGacha, 'skinGacha')
  if (half.rouletteEvent) push('角雕輪盤', 'roulette')
  for (const e of half.specialEvents ?? []) push(e, 'limitedEvent')
  for (const b of half.revivedBanners ?? []) push(b, 'specificPilotBanner')

  return out
}
