// PLAN-048 Phase 1（任務 1-7）：deprecated 欄位 → TimedActivity 的讀取端 shim
import type { PatchHalf, TimedActivity } from './types'

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
export function activitiesOfHalf(
  half: PatchHalf,
  side: 'tw' | 'cn',
  /** 本半版本的起始日與週數；推導自版本邊界，由呼叫端提供 */
  fallbackSpan: { startDate: string; weeks: number } | null,
): TimedActivity[] {
  const fresh = (side === 'tw' ? half.twActivities : half.cnActivities) ?? []
  if (fresh.length > 0) return fresh

  // 台版沒填但陸版有：不借用。兩服的活動檔期本來就不同，借用會顯示成錯誤事實。
  if (!fallbackSpan) return []

  const { startDate, weeks } = fallbackSpan
  const out: TimedActivity[] = []
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
