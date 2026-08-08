import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { dayKey } from '../analytics/session'
import type { AnalyticsDaily, AnalyticsEntityMonth } from '../../types/analytics'

// ── 使用統計讀取（PLAN-046 Phase B-1）────────────────────────────────────────
//
// 三個刻意的選擇：
//
// · **用 getDocs 不用 onSnapshot**：統計數字不需要即時，卻會為此持續佔用連線與讀取
//   配額。看 30 天約 31 次讀取，一天開 50 次後台也才 1,550，佔免費額度 3%。
//
// · **不進 GameDataContext**：那層是「版本 gate 的遊戲資料快取」，統計沒有版本概念，
//   硬塞會汙染 CollectionKey 與 bumpDataVersion 的語意。比照 changeHistory /
//   systemLog 獨立取用。
//
// · **缺漏的日子由讀取端補零**：沒有流量的日子不會有文件。若讓圖表自己處理「陣列長度
//   不等於天數」，每個消費端都要重寫一次補洞邏輯，而且很容易寫成「把 7 天畫成 5 天」
//   這種看起來正常、實際上把週末悄悄壓縮掉的錯誤。

const DAILY_COLL = 'analyticsDaily'
const ENTITY_COLL = 'analyticsEntity'

/** 記憶體快取存活時間。統計是慢變量，5 分鐘內重複開後台不必再查一次。 */
const CACHE_TTL_MS = 5 * 60 * 1000

const cache = new Map<string, { at: number; data: unknown }>()

function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.data as T)
  return loader().then((data) => {
    cache.set(key, { at: Date.now(), data })
    return data
  })
}

/** 清掉快取（後台「重新整理」用）。 */
export function clearAnalyticsCache(): void {
  cache.clear()
}

/** 從今天往回數 n 天的日期字串（含今天），由舊到新。日界線為 UTC+8。 */
export function recentDayKeys(days: number, now: number = Date.now()): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * 86400_000))
  return out
}

/**
 * 取最近 N 天的日統計，**保證回傳長度等於 N**、由舊到新，缺漏的日子補成空物件。
 *
 * 用 `where('date','>=')` + `orderBy('date')`：兩者同欄位，Firestore 不需要複合索引。
 */
export async function getDailyRange(days: number): Promise<AnalyticsDaily[]> {
  const keys = recentDayKeys(days)
  const start = keys[0]
  return cached(`daily:${days}:${start}`, async () => {
    const snap = await getDocs(
      query(collection(db, DAILY_COLL), where('date', '>=', start), orderBy('date')),
    )
    const byDate = new Map<string, AnalyticsDaily>()
    for (const d of snap.docs) byDate.set(d.id, { ...(d.data() as AnalyticsDaily), date: d.id })
    return keys.map((k) => byDate.get(k) ?? { date: k })
  })
}

/** 取某月的 entity 熱度。不存在回 null（該月還沒有任何詳情頁被看過）。 */
export async function getEntityMonth(month: string): Promise<AnalyticsEntityMonth | null> {
  return cached(`entity:${month}`, async () => {
    const snap = await getDoc(doc(db, ENTITY_COLL, month))
    return snap.exists() ? ({ ...(snap.data() as AnalyticsEntityMonth), month }) : null
  })
}

// ── 彙總小工具（純函式，供儀表板組資料）──────────────────────────────────────

/** 把多天的某個 map 欄位加總成一張表。 */
export function sumMap(
  days: AnalyticsDaily[],
  pick: (d: AnalyticsDaily) => Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of days) {
    for (const [k, v] of Object.entries(pick(d) ?? {})) {
      if (typeof v === 'number') out[k] = (out[k] ?? 0) + v
    }
  }
  return out
}

/** 把多天的 byRoute 加總成 `{ key: { pv, upv } }`。 */
export function sumRoutes(days: AnalyticsDaily[]): Record<string, { pv: number; upv: number }> {
  const out: Record<string, { pv: number; upv: number }> = {}
  for (const d of days) {
    for (const [k, v] of Object.entries(d.byRoute ?? {})) {
      const slot = (out[k] ??= { pv: 0, upv: 0 })
      slot.pv += v?.pv ?? 0
      slot.upv += v?.upv ?? 0
    }
  }
  return out
}

/** 把多天的某個純量欄位加總。 */
export function sumField(days: AnalyticsDaily[], key: 'pv' | 'upv' | 'sessions' | 'visitors'): number {
  return days.reduce((n, d) => n + (d[key] ?? 0), 0)
}

/**
 * 取出資料不完整的日子。
 *
 * 儀表板必須把這些日子標示出來並排除在趨勢比較之外——熔斷後的曲線看起來完全正常，
 * 不標的話就是拿少了半天的數字在做決策。
 */
export function truncatedDays(days: AnalyticsDaily[]): AnalyticsDaily[] {
  return days.filter((d) => !!d.truncatedAt)
}

/** map 轉成由大到小的排行陣列，可限制筆數。 */
export function toRanking(
  map: Record<string, number>,
  limit = Infinity,
): Array<{ key: string; value: number }> {
  return Object.entries(map)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => ({ key, value }))
}
