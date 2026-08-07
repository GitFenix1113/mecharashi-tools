import type { Timestamp } from 'firebase/firestore'
import type { LogoutReason, Tri } from '../lib/diag/sentinel'
import type { DiagEnvironment, DiagSession } from '../lib/diag/collect'

// ── 系統診斷日誌（PLAN-045）──────────────────────────────────────────────────
// 維護者「編輯到一半被登出」的證據記錄。獨立頂層集合 `systemLog`，僅可新增
// （規則層 append-only），且比照 changeHistory **刻意不註冊進** CollectionKey /
// GameDataContext —— 它是持續成長、只查最近幾頁的資料，塞進「整包載入 +
// localStorage」的版本快取只會撐爆快取。
//
// 與 changeHistory 的差異在讀取權限：changeHistory 是 read:if isAdmin()，
// 本集合收緊為 read:if isOwnerRole()。日誌含 UA、儲存用量等裝置指紋，
// 屬於維護者個人的環境資訊，不該讓其他 ADMIN 互看。

/**
 * 事件類型（分類軸一）。
 *
 * 兩者看似無關，但對 OWNER 而言是同一個問題的兩種面貌 —— 維護者說「我被登出了」時，
 * 實際發生的可能是 logout（真的失去登入狀態），也可能是 writeDenied
 * （仍登入著，只是存檔被拒，使用者從症狀上分不出來）。故共用同一頁檢視。
 */
export type SystemLogKind = 'logout' | 'writeDenied'

/**
 * 事件成因（分類軸二）。
 *
 * logout 事件用 LogoutReason（見 sentinel.ts 的三態判定）；
 * writeDenied 事件用 Firestore 的 error code（如 'permission-denied'）。
 * 兩者共用一個欄位，才能在同一組複合索引下做單軸篩選。
 */
export type SystemLogReason = LogoutReason | string

export const KIND_LABEL: Record<SystemLogKind, string> = {
  logout:      '登出',
  writeDenied: '寫入被拒',
}

/** 顯示用中文標籤。刻意用白話而非技術術語 —— 這頁是給人看的，不是給機器。 */
export const REASON_LABEL: Record<LogoutReason, string> = {
  explicit:       '主動登出',
  storageCleared: '瀏覽器清除了本站儲存',
  idbEvicted:     'IndexedDB 被清除（已停用）',
  tokenRevoked:   '登入憑證被撤銷',
  neverSignedIn:  '查無登入痕跡',
  unknown:        '無法判定',
}

/**
 * 各成因的嚴重度，決定列表色票與是否需要 OWNER 注意。
 *
 * explicit 是正常操作（本來就不該進日誌，留著只為完整性）；
 * storageCleared / idbEvicted 是我們要追的目標；
 * tokenRevoked 通常有明確人為原因（改密碼），不算故障。
 */
export const REASON_SEVERITY: Record<LogoutReason, 'normal' | 'notice' | 'alert'> = {
  explicit:       'normal',
  storageCleared: 'alert',
  idbEvicted:     'alert',
  tokenRevoked:   'notice',
  neverSignedIn:  'normal',
  unknown:        'notice',
}

/**
 * 登出事件的三顆探針原始值。保留原始值而非只存結論，日後判定邏輯改版可重新推算。
 *
 * ⚠ `authRecord` **不參與判定**，只作佐證（見 sentinel.ts 的 classifyLogout）。
 *   舊記錄用的是 `authIdb` 欄位、語意為「database 存不存在」，那顆探針恆為 present
 *   （Firebase 會自動重建 database），已停用。
 */
export interface SystemLogProbes {
  sentinel: Tri
  cookie: Tri
  /** Firebase 憑證記錄是否還在。舊記錄無此欄位 → UI 顯示「測不到」 */
  authRecord?: Tri
}

/** systemLog 集合的單筆記錄。 */
export interface SystemLogEntry {
  /** Firestore 自動 ID（診斷事件沒有自然 slug，用 addDoc） */
  id: string

  kind: SystemLogKind
  reason: SystemLogReason

  uid: string
  /** 操作者 displayName 快照（改名後仍看得出是誰） */
  actorName: string

  /**
   * 伺服器寫入時間戳。**這不等於事件發生時間** ——
   * logout 事件走 localStorage 佇列延遲上報，`at` 是「重新登入並 flush」的時刻。
   * 排序仍用 `at`（伺服器權威且可索引；本機時鐘不可信），
   * 實際發生時間看 `occurredAt`，兩者差距明顯時 UI 會標示為延遲上報。
   */
  at: Timestamp | null
  /** 事件在本機實際發生的時間（ms epoch）。可能早於 `at` 數小時 */
  occurredAt: number
  /** at + 90 天。由 Firestore 原生 TTL 政策讀取後自動清除 */
  expireAt: Timestamp | Date

  env?: DiagEnvironment
  session?: DiagSession

  /** 僅 logout：三顆探針的原始結果 */
  probes?: SystemLogProbes
  /** 僅 logout：哨兵從種下到被清活了多久（秒）。判斷是否吻合 Safari ITP 的 7 天週期 */
  sentinelAgeSec?: number

  /** 僅 writeDenied：目標集合 */
  coll?: string
  /** 僅 writeDenied：目標文件 ID */
  docId?: string
}

/** 日誌保留期限：90 天。診斷資料的價值隨時間急遽衰減，半年前的登出對今天沒有意義。 */
export const SYSTEM_LOG_TTL_DAYS = 90

/**
 * localStorage 佇列上限。
 *
 * 若使用者長期沒登入回來，佇列不該無限增長把 localStorage 配額吃光 ——
 * 那反而會誘發我們正在追查的儲存問題，讓診斷工具自己變成故障來源。
 */
export const DIAG_QUEUE_MAX = 20
