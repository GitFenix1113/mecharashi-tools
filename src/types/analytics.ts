// ── 使用統計的型別（PLAN-046）────────────────────────────────────────────────
//
// 刻意**不放進 src/types/index.ts barrel**：比照 systemLog / enums / mechUpgrade
// 的既有慣例——這些不是遊戲資料領域模型，混進 barrel 只會讓前台頁面誤以為
// 它們也走 GameDataContext 的版本 gate 快取（統計沒有版本概念）。
//
// ⚠ 幾乎所有欄位都是選填：文件由 Firestore 的 increment transform 逐步長出來，
//   當天沒有任何登入使用者時就不會有 byAuth.user 這個鍵。讀取端一律要能吃 undefined。

/** 單一頁面的兩軌計數。pv 含來回點擊；upv 是同 session 同頁只算一次的去重值。 */
export interface RouteStat {
  pv?: number
  upv?: number
}

/** analyticsDaily/{YYYY-MM-DD}。日界線為 UTC+8（與 Worker 端一致）。 */
export interface AnalyticsDaily {
  date: string
  pv?: number
  upv?: number
  sessions?: number
  visitors?: number
  byRoute?: Record<string, RouteStat>
  byLang?: Record<string, number>
  byCountry?: Record<string, number>
  byAuth?: Record<string, number>
  byDevice?: Record<string, number>
  byRef?: Record<string, number>
  /** 當日寫入的文件數＝熔斷器的燃料表。 */
  writes?: number
  /**
   * 有值代表當日統計在該時刻因寫入預算熔斷而中止，**之後的資料全部沒有記到**。
   *
   * 消費此資料的任何介面都必須檢查它。最危險的不是熔斷，是熔斷了但報表看不出來——
   * 那會讓人拿「看起來正常但少了半天」的數字去做決策，比沒有統計更糟。
   */
  truncatedAt?: { seconds: number } | null
  truncatedReason?: string
}

/** analyticsEntity/{YYYY-MM}。key 是 Firestore 文件 ID（含中文）。 */
export interface AnalyticsEntityMonth {
  month: string
  pilots?: Record<string, number>
  mechs?: Record<string, number>
  weapons?: Record<string, number>
  modules?: Record<string, number>
}

export type EntityKind = 'pilots' | 'mechs' | 'weapons'

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  pilots: '機師',
  mechs: '機甲',
  weapons: '武器',
}

/** 語言分桶的顯示名。與 track.ts 的 langBucket 產出一一對應。 */
export const LANG_LABEL: Record<string, string> = {
  zh_tw:    '繁體中文',
  zh_cn:    '簡體中文',
  zh_other: '中文（其他）',
  en:       'English',
  ja:       '日本語',
  ko:       '한국어',
  other:    '其他語言',
}

export const AUTH_LABEL: Record<string, string> = {
  guest: '訪客',
  user:  '登入使用者',
}

export const DEVICE_LABEL: Record<string, string> = {
  mobile:  '手機',
  desktop: '桌機',
  tablet:  '平板',
}
