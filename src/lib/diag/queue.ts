// ── 診斷事件佇列（PLAN-045 Phase A-3）─────────────────────────────────────────
//
// 為什麼需要佇列：登出當下 `auth.currentUser` 已是 null，而 firestore.rules 全站
// `isAdmin()` —— 此刻寫任何 log 必定 permission-denied。證據只能先留在本機，
// 等下次登入成功再上報（report.ts）。
//
// 佇列本身刻意極簡：一個 localStorage 鍵、一個陣列、上限 20 筆。任何寫入失敗都
// 靜默吞掉 —— 診斷設施若因為自己寫不進去而拋錯干擾登入流程，就本末倒置了。

import { DIAG_QUEUE_MAX } from '../../types/systemLog'
import type { SystemLogKind, SystemLogProbes, SystemLogReason } from '../../types/systemLog'
import type { DiagEnvironment, DiagSession } from './collect'

const QUEUE_KEY = 'mecharashi_diag_queue'

/**
 * 待上報事件。形狀是 SystemLogEntry 去掉伺服器補的欄位
 * （id / at / expireAt / uid / actorName —— 後三者在 flush 時才由當下登入者補上）。
 *
 * ⚠ uid 刻意存在事件裡：flush 時要比對「這筆事件的當事人」與「現在登入的人」，
 *   換人登入時不可把前一個人的登出記在後一個人頭上。
 */
export interface QueuedEvent {
  kind: SystemLogKind
  reason: SystemLogReason
  /** 事件當事人的 uid。可能為空字串（哨兵已被清、查不到是誰） */
  uid: string
  occurredAt: number
  env?: DiagEnvironment
  session?: DiagSession
  probes?: SystemLogProbes
  sentinelAgeSec?: number
  coll?: string
  docId?: string
}

const isBrowser = (): boolean => typeof window !== 'undefined'

/** 讀佇列。任何解析失敗一律當空佇列 —— 壞掉的佇列不值得搶救，它只是診斷資料。 */
export function readQueue(): QueuedEvent[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : []
  } catch {
    return []
  }
}

/**
 * 推入一筆事件。超過上限時丟棄**最舊**的。
 *
 * 丟舊留新的理由：最近一次登出才是使用者正在回報的那次。若丟新留舊，
 * 使用者回報問題時查到的會是三個月前的記錄。
 */
export function enqueue(event: QueuedEvent): void {
  if (!isBrowser()) return
  try {
    const next = [...readQueue(), event].slice(-DIAG_QUEUE_MAX)
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(next))
  } catch {
    // 配額滿或隱私模式。診斷事件寫不進去就算了，絕不可影響登出流程本身。
  }
}

/** 清空佇列（flush 成功後呼叫）。 */
export function clearQueue(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(QUEUE_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 覆寫佇列（部分 flush 成功時，把剩下的寫回去）。 */
export function writeQueue(events: QueuedEvent[]): void {
  if (!isBrowser()) return
  try {
    if (events.length === 0) {
      window.localStorage.removeItem(QUEUE_KEY)
    } else {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-DIAG_QUEUE_MAX)))
    }
  } catch {
    /* 忽略 */
  }
}

// ── 同一次登出只記一筆（PLAN-045，實測補強）──────────────────────────────────
//
// `onAuthStateChanged(null)` 不是「登出的那一瞬間」才觸發 —— 只要處於未登入狀態，
// **每次重新載入頁面都會再觸發一次**。實測時刪掉 IndexedDB 就抓到兩筆：
// 一筆是刪除當下 Firebase 立即登出，一筆是接著按 F5 重整。
//
// 真實情境更糟：使用者被登出後若沒立刻重新登入，而是重整幾次、或關掉分頁隔天再開，
// 每一次都會記一筆一模一樣的記錄，把日誌灌成雜訊。
//
// 用 sessionStorage 而非 localStorage：它的生命週期正好是「這個分頁」——
// 重整會保留（擋掉重複記錄），關閉分頁後清除（新的瀏覽視為新的觀察，合理）。
// 重新登入成功時主動清掉，這樣「登入→被登出→再登入→再被登出」每次都記得到。

const REPORTED_KEY = 'mecharashi_diag_reported'

/** 本分頁是否已經記錄過這次登出。 */
export function alreadyReported(): boolean {
  if (!isBrowser()) return false
  try {
    return window.sessionStorage.getItem(REPORTED_KEY) !== null
  } catch {
    return false
  }
}

/** 標記本分頁已記錄過登出。 */
export function markReported(): void {
  if (!isBrowser()) return
  try {
    window.sessionStorage.setItem(REPORTED_KEY, String(Date.now()))
  } catch {
    /* 隱私模式下 sessionStorage 可能不可用；去重失效不影響正確性，只是會多幾筆 */
  }
}

/** 清除記錄標記（登入成功時呼叫，讓下一次登出重新記得到）。 */
export function clearReported(): void {
  if (!isBrowser()) return
  try {
    window.sessionStorage.removeItem(REPORTED_KEY)
  } catch {
    /* 忽略 */
  }
}
