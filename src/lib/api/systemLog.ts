import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import type { SystemLogEntry, SystemLogKind, SystemLogReason } from '../../types/systemLog'
import { SYSTEM_LOG_TTL_DAYS } from '../../types/systemLog'
import type { PageCursor } from './firestoreCore'
import type { QueuedEvent } from '../diag/queue'

// ── 系統診斷日誌 API（PLAN-045 Phase B-1）─────────────────────────────────────
// 比照 changeHistory：append-only、伺服器分頁、不進 GameDataContext 快取。
// 讀取限 OWNER（規則層把關），寫入限 ADMIN 且 uid 必須是自己。

const COLL = 'systemLog'

// ─── 寫入 ────────────────────────────────────────────────────────────────────

/**
 * 組出要寫入的文件。
 *
 * ⚠ 刻意「不」經過 stripUndefined：它會遞迴走物件，把 serverTimestamp() 這種
 *   哨兵值拆成普通物件而失效（同 changeHistory 的既有註解）。改為在組裝時就
 *   不放進 undefined 欄位。
 */
function buildEntry(event: QueuedEvent) {
  const user = auth.currentUser
  const expireAt = new Date()
  expireAt.setDate(expireAt.getDate() + SYSTEM_LOG_TTL_DAYS)

  const data: Record<string, unknown> = {
    kind:       event.kind,
    reason:     event.reason,
    // uid 必須是「現在登入的人」——寫入規則要求 uid == request.auth.uid。
    // 事件裡記的當事人 uid 由呼叫端（report.ts）事先比對過，不相符的不會送進來。
    uid:        user?.uid ?? '',
    actorName:  user?.displayName || user?.email || '(未知)',
    at:         serverTimestamp(),
    occurredAt: event.occurredAt,
    expireAt,   // 由 Firestore 原生 TTL 政策讀取後自動清除
  }
  if (event.env)                        data.env            = event.env
  if (event.session)                    data.session        = event.session
  if (event.probes)                     data.probes         = event.probes
  if (event.sentinelAgeSec !== undefined) data.sentinelAgeSec = event.sentinelAgeSec
  if (event.sinceSentinelSeenSec !== undefined) data.sinceSentinelSeenSec = event.sinceSentinelSeenSec
  if (event.persistence)                data.persistence    = event.persistence
  if (event.lastSeen)                   data.lastSeen       = event.lastSeen
  if (event.authErrors?.length)         data.authErrors     = event.authErrors
  if (event.coll)                       data.coll           = event.coll
  if (event.docId)                      data.docId          = event.docId
  return data
}

/** 寫入一筆診斷事件，**失敗時拋錯**。給 report.ts 用（它需要知道哪幾筆沒送成功）。 */
export async function writeSystemLogOrThrow(event: QueuedEvent): Promise<string> {
  const ref = await addDoc(collection(db, COLL), buildEntry(event))
  return ref.id
}

/**
 * 寫入一筆診斷事件，**失敗時只警告不拋錯**（fire-and-forget）。
 *
 * 給 writeDenied 路徑使用：那條路徑當下仍登入著，可以直接寫、不必走佇列，
 * 但診斷 log 是輔助設施，絕不可因為它失敗而讓原本的錯誤處理變形。
 * 沿用 changeHistory 的 logChange 慣例。
 */
export function logSystemEvent(event: QueuedEvent): void {
  void writeSystemLogOrThrow(event).catch((err) => {
    console.warn('[systemLog] 寫入診斷記錄失敗（不影響主操作）:', err)
  })
}

// ─── 讀取 ────────────────────────────────────────────────────────────────────

export interface SystemLogQuery {
  /** 分類軸一：只看某種事件 */
  kind?: SystemLogKind
  /** 分類軸二：只看某種成因 */
  reason?: SystemLogReason
  cursor?: PageCursor
  pageSize?: number
}

export interface SystemLogPage {
  items: SystemLogEntry[]
  hasMore: boolean
  cursor: PageCursor
}

/**
 * 分頁查詢診斷日誌，固定依伺服器寫入時間新到舊。
 *
 * 排序用 `at` 而非 `occurredAt`：`at` 是伺服器權威時間且已建索引，
 * 而 `occurredAt` 來自使用者本機時鐘（可能錯得離譜，甚至是刻意調過的）。
 * 代價是延遲上報的事件會排在「上報時刻」而非「發生時刻」，UI 端會標示出來。
 *
 * kind / reason 皆為選填、可任意組合，對應三組複合索引：
 *   (kind, at↓) / (reason, at↓) / (kind, reason, at↓)
 */
export async function getSystemLogPage({
  kind,
  reason,
  cursor = null,
  pageSize = 30,
}: SystemLogQuery = {}): Promise<SystemLogPage> {
  const constraints: QueryConstraint[] = []
  if (kind) constraints.push(where('kind', '==', kind))
  if (reason) constraints.push(where('reason', '==', reason))
  constraints.push(orderBy('at', 'desc'))
  if (cursor) constraints.push(startAfter(cursor as QueryDocumentSnapshot))
  constraints.push(limit(pageSize))

  const snap = await getDocs(query(collection(db, COLL), ...constraints))
  return {
    items: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as SystemLogEntry),
    hasMore: snap.docs.length === pageSize,
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
  }
}

/**
 * 取最近 N 筆做成因分布摘要。
 *
 * 這是本計畫的產出重點：要靠這個分布決定對策方向（是該換儲存策略、還是該針對
 * Safari 另想登入延續機制），而不是再一次憑印象猜。
 *
 * 刻意獨立一次查詢而非複用列表資料——列表會被使用者的篩選條件影響，
 * 摘要必須永遠是「未篩選的最近 N 筆」才有代表性。
 */
export async function getSystemLogSummary(sampleSize = 100): Promise<{
  total: number
  byReason: Record<string, number>
}> {
  const snap = await getDocs(
    query(collection(db, COLL), orderBy('at', 'desc'), limit(sampleSize)),
  )
  const byReason: Record<string, number> = {}
  for (const d of snap.docs) {
    const r = (d.data().reason as string) ?? 'unknown'
    byReason[r] = (byReason[r] ?? 0) + 1
  }
  return { total: snap.docs.length, byReason }
}
