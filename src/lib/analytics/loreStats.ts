// ── 故事館統計的彙總（PLAN-062）──────────────────────────────────────────────
//
// 本檔**只放純函式**（不 import React、不碰 Firestore）：`node --test` 直接載入 loreStats.test.ts。
//
// Phase A 只用 analyticsDaily.byRoute 既有的三個故事館 key，不需要任何新埋點。
//
// ⚠ 故事館的 pv 與其他頁面意思不同：章節翻頁、切換機師、從章節退回扉頁都會換網址，
//   每次都讓 pv +1。所以 pv／upv 在這裡代表「讀得多」，不是頁面熱度圖說的「折返」——
//   這也是儀表板把故事館三列的灰字 pv 從頁面熱度拿掉、改在故事館區塊解釋的原因。

import { toPageKey } from './routeKeys.ts'

/**
 * 故事館三頁的統計 key。
 *
 * 由 toPageKey 從路由樣板推導、不手寫字串：樣板若改名，key 會跟著變，
 * 這裡不會悄悄指向一個再也不會有資料的舊 key（routeKeys.test.ts 釘住樣板與 App.tsx 一致）。
 */
export const LORE_ROUTE_KEYS = {
  /** 館首頁（卡片牆） */
  home: toPageKey('/lore'),
  /** 機師扉頁（檔案） */
  file: toPageKey('/lore/pilots/:id'),
  /** 章節（閱讀模式） */
  chapter: toPageKey('/lore/pilots/:id/:part'),
} as const

/** 故事館三頁的 key 集合。頁面熱度用它判斷哪幾列不顯示「折返」灰字。 */
export const LORE_PAGE_KEYS: ReadonlySet<string> = new Set(Object.values(LORE_ROUTE_KEYS))

/**
 * 故事館正式開放日（siteChangelog 2026-10-13「機師故事館正式開放」）。
 *
 * 程式 2026-09-10 就上線了，但入口一直收著，之前只有零星的直接連結瀏覽。
 * 那段日子混進來會把「佔全站有效瀏覽」稀釋成看起來很冷清的數字，所以漏斗只算開放後。
 */
export const LORE_OPEN_DATE = '2026-10-13'

/**
 * 故事館與圖鑑開始分開統計的月份（PLAN-062 Phase C 前端上線的那個月）。
 *
 * 這個月的 analyticsEntity.pilots 前段含故事館讀者、後段不含，事後也無從拆分，
 * 所以儀表板只在這個月的熱門機師上加一行註記。
 * ⚠ 若 Phase C 跨月才合併上線，這裡要改成實際上線的月份。
 */
export const LORE_SPLIT_MONTH = '2026-10'

/** 只留正式開放後的日子。日期字串為 YYYY-MM-DD，可直接字典序比較。 */
export function sinceLoreOpen<T extends { date: string }>(days: readonly T[]): T[] {
  return days.filter((d) => d.date >= LORE_OPEN_DATE)
}

export interface RouteTotals {
  pv: number
  upv: number
}

export interface LoreFunnel {
  home: RouteTotals
  file: RouteTotals
  chapter: RouteTotals
  /** 故事館三頁 UPV 合計 ÷ 全站 UPV。全站為 0 時為 null。 */
  share: number | null
  /**
   * 章節 UPV ÷ 扉頁 UPV：打開機師的造訪中，有多少翻進了章節。
   *
   * ⚠ 不是嚴格的子集合：分享出去的章節連結會直接進閱讀模式、略過扉頁，
   *   所以理論上可能大於 1。照實回傳、不夾到 1 —— 夾掉會把「深連結很多」這件事藏起來。
   */
  fileToChapter: number | null
  /** 扉頁 pv ÷ 扉頁 UPV：每次造訪平均開幾次扉頁（含切換機師、從章節退回）。 */
  filesPerVisit: number | null
  /** 章節 pv ÷ 章節 UPV：每次閱讀平均看幾個章節頁（含翻頁）。 */
  chaptersPerVisit: number | null
}

const ZERO: RouteTotals = { pv: 0, upv: 0 }

/** 分母為 0 時回 null，由畫面顯示「—」，不顯示 0% 或 NaN。 */
function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null
}

/**
 * 從多天加總後的 byRoute（`sumRoutes` 的產出）算出故事館的進館漏斗。
 *
 * UPV 是「同一次造訪內同一個 key 只算一次」，所以三段的 UPV 本身就是
 * 「有幾次造訪走到這一步」：館首頁 → 扉頁 → 章節。
 */
export function loreFunnel(routes: Record<string, RouteTotals>): LoreFunnel {
  const pick = (key: string): RouteTotals => routes[key] ?? ZERO
  const home = pick(LORE_ROUTE_KEYS.home)
  const file = pick(LORE_ROUTE_KEYS.file)
  const chapter = pick(LORE_ROUTE_KEYS.chapter)

  let totalUpv = 0
  for (const v of Object.values(routes)) totalUpv += v.upv
  const loreUpv = home.upv + file.upv + chapter.upv

  return {
    home,
    file,
    chapter,
    share: ratio(loreUpv, totalUpv),
    fileToChapter: ratio(chapter.upv, file.upv),
    filesPerVisit: ratio(file.pv, file.upv),
    chaptersPerVisit: ratio(chapter.pv, chapter.upv),
  }
}
