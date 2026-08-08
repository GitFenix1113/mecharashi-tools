import type { Timestamp } from 'firebase/firestore'
import type { AuthRecordDetail, LogoutReason, Tri } from '../lib/diag/sentinel'
import type { DiagEnvironment, DiagSession } from '../lib/diag/collect'
import type { DiagAuthError, DiagLastSeen } from '../lib/diag/heartbeat'

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
  /** Firebase 在 **IndexedDB** 的憑證記錄是否還在。舊記錄無此欄位 → UI 顯示「測不到」 */
  authRecord?: Tri
  /**
   * Firebase 在 **localStorage** 的憑證記錄是否還在。
   *
   * `authRecord=absent` + `authLocal=present` 是 persistence 降級的指紋
   * （SDK 這次沒讀到 IndexedDB，改用了 localStorage，兩層互不相通 → 表現為登出）。
   */
  authLocal?: Tri

  /**
   * `authRecord` 為何「不見」的細分：`noDb` / `noStore` / `noKey`。
   *
   * 三者對應三個完全不同的成因，壓成同一個 `absent` 就等於把最關鍵的區別丟掉了。
   * 其中 `noStore` 是 Firebase `_openDatabase()` 觸發「刪庫重建」的條件——抓到它
   * 等於在資料庫被砍掉前留下證據。詳見 sentinel.ts 的 AuthRecordDetail。
   */
  authDetail?: AuthRecordDetail
  /** auth object store 內的 key 總數（不含內容）。store 在卻是 0 → 剛被重建的空庫 */
  authKeyCount?: number
  /** `firebaseLocalStorageDb` 的版本號。Firebase 固定用 1；非 1 表示有別的東西動過它 */
  authDbVersion?: number
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

  /** 僅 logout：四顆探針的原始結果 */
  probes?: SystemLogProbes
  /** 僅 logout：哨兵從種下到被清活了多久（秒）。判斷是否吻合 Safari ITP 的 7 天週期 */
  sentinelAgeSec?: number

  /**
   * 僅 logout：距上次心跳確認「還登入著」過了多久（秒）。
   *
   * **這是本記錄裡最重要的一個數字**：`occurredAt` 只是「發現」的時刻，
   * 真正的失效發生在 `occurredAt - sinceSentinelSeenSec` 到 `occurredAt` 之間。
   * 沒有它的話，區間寬度是「不知道」，任何成因假說都能自圓其說。
   */
  sinceSentinelSeenSec?: number

  /**
   * 僅 logout：發現登出那一刻，Firebase SDK 在**本次載入**實際挑中的 persistence 層。
   *
   * ── 為什麼這一欄可能直接指出真因 ──
   * `getAuth()` 的 persistence 是一個階梯（IndexedDB → localStorage → sessionStorage
   * → inMemory），開站時由 `PersistenceUserManager.create` 逐層測可用性後挑一個。
   * 而 SDK 那段邏輯有兩個危險性質（見 @firebase/auth 的 create 實作）：
   *
   *   ① 讀取既有憑證時 `catch {}` 靜默吞掉錯誤 —— IndexedDB 讀取拋錯會被當成
   *      「查無使用者」，與真的沒登入無法區分；
   *   ② 選定一層之後，會主動 `_remove(key)` 清掉**其他所有層**的憑證。
   *
   * 兩者相加：IndexedDB 只要在初始化那一瞬間不可用（磁碟 I/O 抖動、被其他分頁的
   * versionchange 卡住、測試寫入逾時），使用者就會被登出，**而且 IndexedDB 裡的憑證
   * 會被順手刪掉**，不可逆。
   *
   * 所以本欄若不是 `indexedDB`，就等於直接抓到那一刻降級發生了。
   */
  persistence?: string
  /** 僅 logout：登出前最後一張心跳快照（區間的下界，含當時各探針值） */
  lastSeen?: DiagLastSeen
  /** 最近幾次 idToken 取得失敗。跨 session 累積，用來看是不是 refresh 側的問題 */
  authErrors?: DiagAuthError[]

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
