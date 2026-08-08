// ── Firebase Auth 內部狀態探針（PLAN-045 追加：persistence 降級假說）─────────────
//
// 全站**唯一**會碰 Firebase SDK 私有欄位的地方，刻意隔離成獨立檔案並集中所有防護，
// 這樣「哪裡會因為 SDK 升版而失效」只有一個答案。
//
// ── 為什麼值得冒這個險 ──
// sentinel.ts 的 probeAuthLocal 能看出「憑證躺在 localStorage 那層」，但那是**間接**
// 推論——殘留的舊鍵也會長成一樣。真正想知道的是「SDK 這次實際挑了哪一層」，
// 而那個事實只存在於 SDK 內部，公開 API 沒有出口。
//
// 風險控制：
//   · 全程 optional chaining + try/catch，任何一步測不到就回 'unknown'
//   · 只讀不寫，不呼叫任何內部方法（純欄位存取，不可能產生副作用）
//   · 三段式判定（instanceof → storage 物件比對 → type 字串），任一段命中即可，
//     升版打掉其中一段還有其他段頂著
//
// 探針壞掉時的正確行為是「少一個欄位」，絕不是讓登出流程一起壞掉。

import {
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  inMemoryPersistence,
} from 'firebase/auth'
import { auth } from '../firebase'

/**
 * SDK 當下實際生效的 persistence 層。
 *
 * 正常情況恆為 `indexedDB`。**只要出現 `localStorage` 就是降級**——
 * 那正是我們懷疑造成「哨兵完好、憑證卻不見」的機制。
 */
export type ActivePersistence =
  | 'indexedDB'
  | 'localStorage'
  | 'sessionStorage'
  | 'inMemory'
  | 'unknown'

/**
 * Firebase 匯出的 persistence 常數其實是**類別本身**（`_getInstance()` 才 new 出實例），
 * 所以能拿來做 instanceof。型別上要繞一下：公開型別是 `Persistence` 介面，
 * 但執行期是 constructor。
 */
type PersistenceCtor = new () => unknown
const asCtor = (p: unknown): PersistenceCtor => p as unknown as PersistenceCtor

/** 依序嘗試三種辨識法，全部失敗才回 unknown。 */
export function probeActivePersistence(): ActivePersistence {
  try {
    // AuthImpl.persistenceManager 是 TS 的 private，執行期就是一般欄位；
    // PersistenceUserManager.persistence 本身是 public。
    const manager = (auth as unknown as { persistenceManager?: { persistence?: unknown } })
      .persistenceManager
    const p = manager?.persistence
    if (!p) return 'unknown'

    // ① instanceof：最準，但依賴 SDK 匯出的仍是 constructor
    try {
      if (p instanceof asCtor(indexedDBLocalPersistence)) return 'indexedDB'
      if (p instanceof asCtor(browserLocalPersistence)) return 'localStorage'
      if (p instanceof asCtor(browserSessionPersistence)) return 'sessionStorage'
      if (p instanceof asCtor(inMemoryPersistence)) return 'inMemory'
    } catch { /* 匯出的不是 constructor（SDK 改實作），往下一段 */ }

    // ② storage 物件比對：BrowserPersistenceClass 的 `storage` getter 直接回傳
    //    window.localStorage / window.sessionStorage，身分比對不會認錯
    try {
      const storage = (p as { storage?: unknown }).storage
      if (storage && typeof window !== 'undefined') {
        if (storage === window.localStorage) return 'localStorage'
        if (storage === window.sessionStorage) return 'sessionStorage'
      }
    } catch { /* getter 拋錯，往下一段 */ }

    // ③ type 字串：只分得出 LOCAL/SESSION/NONE，分不出 LOCAL 底下是 IDB 還是 localStorage。
    //    仍然值得回報——'inMemory' 本身就是重要訊號（憑證根本沒落地，關掉分頁必登出）。
    const type = (p as { type?: string }).type
    if (type === 'NONE') return 'inMemory'
    if (type === 'SESSION') return 'sessionStorage'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 一次 idToken 狀態快照。全部欄位選填——取不到就少一欄，不影響其他證據。 */
export interface TokenSnapshot {
  /** 距離 idToken 到期還有幾秒。負值代表已過期 */
  expiresInSec?: number
  /** idToken 簽發時間（ms epoch）。與 session 起點比對即可看出本次 session 有沒有 refresh 過 */
  issuedAt?: number
  /** getIdToken() 失敗時的 error code，如 'auth/user-token-expired' */
  error?: string
}

/**
 * 取 idToken 狀態。
 *
 * ⚠ 刻意用 `getIdToken()` 而非 `getIdToken(true)`：
 *   · 非強制版在 token 仍有效時**直接回傳記憶體快取，完全不發網路請求**（零負擔）；
 *   · 只有在快取即將到期時才觸發 refresh，而那正是我們想觀察失敗的那一刻。
 *   強制版則是每次心跳都打一次 Google 端點，既無謂又可能自己製造出限流問題。
 *
 * 失敗時不拋錯，把 error code 放進快照——「refresh 失敗」本身就是要記錄的證據。
 */
export async function probeToken(): Promise<TokenSnapshot> {
  const user = auth.currentUser
  if (!user) return {}
  try {
    const res = await user.getIdTokenResult()
    const snap: TokenSnapshot = {}
    const exp = Date.parse(res.expirationTime)
    const iat = Date.parse(res.issuedAtTime)
    if (Number.isFinite(exp)) snap.expiresInSec = Math.round((exp - Date.now()) / 1000)
    if (Number.isFinite(iat)) snap.issuedAt = iat
    return snap
  } catch (err) {
    const code = (err as { code?: string })?.code
    return { error: code || String(err).slice(0, 120) }
  }
}
