// ── 登入狀態心跳（PLAN-045 追加：把「發現時刻」壓縮成「發生區間」）──────────────
//
// ── 這個檔案在解什麼問題 ──
// 原本的 `occurredAt` 記的是 `onAuthStateChanged(null)` 觸發的時刻，也就是使用者
// **發現**自己被登出的時刻。實測樣本顯示那幾乎都是「開新分頁／重整後的第 0~1 秒」，
// 意思是登出在頁面載入之前就已經是既成事實——真正的失效時刻完全落在觀測範圍外，
// 可能是 1 分鐘前，也可能是昨晚。這種情況下任何成因假說都能自圓其說，等於沒有證據。
//
// 心跳的作用是在登入期間持續留下「這一刻還好好的」的時間戳，於是登出事件從
// 一個孤立的時間點變成一個**有上下界的區間**：
//
//     lastSeen.at  ─────── 失效發生在這中間 ─────── occurredAt
//     （最後一眼）                                  （發現）
//
// 區間夠窄（≤60 秒且分頁可見）→ 是「用著用著就掉了」；
// 區間很寬且最後一眼是 hidden → 是「關著的期間掉的」。這兩者的成因完全不同，
// 而在加上心跳之前，它們在日誌上長得一模一樣。
//
// ── 負擔評估（刻意壓到可忽略）──
//   · 頻率：60 秒一次，且**只在分頁可見時**跑（背景分頁完全不動）
//   · 網路：零。probeToken 用非強制的 getIdToken()，有效期內純讀記憶體快取
//   · Firestore：零。心跳只寫 localStorage，不產生任何文件；證據是搭既有的
//     登出事件一起送上去的（多幾個欄位，不是多幾筆文件）
//   · localStorage：兩個鍵合計 < 1 KB，覆寫而非累積
//   · 分頁可見時每 60 秒一次 IndexedDB 唯讀開關 —— Firebase Auth 自己的跨分頁同步
//     是 800ms 輪詢一次，我們比它低兩個數量級

import {
  probeAuthLocal, probeCookie, probeSentinel, probeAuthRecord, touchSentinel, type Tri,
} from './sentinel'
import { probeActivePersistence, probeToken, type ActivePersistence } from './authInternals'
import { currentRoute } from './collect'
import { auth } from '../firebase'

/** 心跳間隔。60 秒是「區間夠窄，成本仍可忽略」的折衷。 */
const HEARTBEAT_MS = 60_000

const LAST_SEEN_KEY = 'mecharashi_diag_lastseen'
const AUTH_ERR_KEY = 'mecharashi_diag_autherr'

/** 保留幾筆 token 錯誤。只要最近的幾筆——三個月前的 refresh 失敗對今天沒有意義。 */
const AUTH_ERR_MAX = 5

/** 快照的觸發原因。判讀時很重要：`hidden` 那筆才是「分頁離開前的最後一眼」。 */
export type SnapshotTrigger = 'signin' | 'tick' | 'hidden' | 'visible'

/** 一次「這一刻還登入著」的快照。 */
export interface DiagLastSeen {
  /** 快照時間（ms epoch） */
  at: number
  trigger: SnapshotTrigger
  /** 快照當下分頁是否可見 */
  visible: boolean
  /** 快照當下所在路由 */
  route?: string

  // ── 四顆探針的當下值。與登出當下的值對照，就知道是「哪一項」變了 ──
  sentinel: Tri
  cookie: Tri
  authLocal: Tri
  /**
   * IndexedDB 憑證記錄。
   * `hidden` 觸發的快照可能來不及補上這欄（見 takeSnapshot 的兩段式寫入）→ 'unknown'。
   */
  authRecord: Tri

  /** SDK 當下實際生效的儲存層。出現 localStorage 就是降級 */
  persistence: ActivePersistence

  /** idToken 距到期秒數（負值＝已過期） */
  tokenExpiresInSec?: number
  /** idToken 簽發時間（ms epoch） */
  tokenIssuedAt?: number
}

/** 一次 idToken 取得失敗。 */
export interface DiagAuthError {
  at: number
  code: string
}

const isBrowser = (): boolean => typeof window !== 'undefined'

// ── 讀寫（全部靜默失敗：診斷設施不該因為自己寫不進去而影響任何事）─────────────

export function readLastSeen(): DiagLastSeen | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DiagLastSeen>
    return typeof parsed?.at === 'number' ? (parsed as DiagLastSeen) : null
  } catch {
    return null
  }
}

function writeLastSeen(snap: DiagLastSeen): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(snap))
  } catch { /* 配額滿或隱私模式 */ }
}

export function readAuthErrors(): DiagAuthError[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(AUTH_ERR_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DiagAuthError[]) : []
  } catch {
    return []
  }
}

function pushAuthError(code: string): void {
  try {
    const next = [...readAuthErrors(), { at: Date.now(), code }].slice(-AUTH_ERR_MAX)
    window.localStorage.setItem(AUTH_ERR_KEY, JSON.stringify(next))
  } catch { /* 忽略 */ }
}

/**
 * 重置心跳軌跡。**登入成功時**呼叫。
 *
 * 為什麼一定要清：上一輪留下的「最後一眼」屬於上一次登入。不清的話，下一次登出會
 * 拿到一個橫跨兩次登入的假區間，把 30 秒的失效說成 8 小時——比沒有證據更糟。
 *
 * token 錯誤記錄**刻意不清**：它本來就是要跨 session 累積的樣態證據
 * （ring buffer 只留最近 5 筆，不會無限成長）。
 */
export function resetTrail(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(LAST_SEEN_KEY)
  } catch { /* 忽略 */ }
}

// ── 快照 ─────────────────────────────────────────────────────────────────────

/**
 * 拍一張快照。
 *
 * **兩段式寫入**，順序有意義：先把同步取得的部分立刻寫進去，再補非同步的部分。
 * 反過來寫的話，`hidden` 觸發的那次很可能整張快照都遺失——分頁進入 hidden 之後
 * 隨時可能被凍結（Chrome 的 tab freeze）甚至丟棄，非同步工作不保證跑得完。
 * 先寫同步部分至少保住「這一刻哨兵與 localStorage 憑證還在」，那已經是可用的證據。
 */
export async function takeSnapshot(trigger: SnapshotTrigger): Promise<void> {
  if (!isBrowser()) return
  try {
    // 心跳只在登入著的時候有意義——它記錄的是「這一刻還登入著」。
    if (!auth.currentUser) return

    const base: DiagLastSeen = {
      at: Date.now(),
      trigger,
      visible: typeof document === 'undefined' || document.visibilityState === 'visible',
      route: currentRoute(),
      sentinel: probeSentinel(),
      cookie: probeCookie(),
      authLocal: probeAuthLocal(),
      authRecord: 'unknown',
      persistence: probeActivePersistence(),
    }
    writeLastSeen(base)

    // 順手把哨兵的 lastSeenAt 往前推：登出時 report.ts 用它算「距上次確認登入多久」
    touchSentinel()

    // ── 非同步部分：跑得完就補上，跑不完就維持 unknown ──
    //
    // ⚠ IndexedDB 探針**刻意不在每次 tick 跑**。它是四顆探針裡唯一會去開
    //   `firebaseLocalStorageDb` 連線的，而那正是我們懷疑會出事的子系統——
    //   每 60 秒戳一次被觀察對象，等於讓診斷工具自己變成可能的故障來源
    //   （Firebase 自己的跨分頁同步是 800ms 一次 getAll()，多一個連線進去攪和沒有好處）。
    //
    //   犧牲很小：失效區間的解析度來自 `at` 這個時間戳，不是來自這一欄。而真正需要
    //   知道「當時 IDB 憑證在不在」的是邊界那幾張快照（登入時、分頁離開前、分頁回來時），
    //   那些仍然照跑。tick 的快照留 'unknown'——誠實標示測不到，勝過為了填滿欄位而增加風險。
    const [authRecord, token] = await Promise.all([
      trigger === 'tick' ? Promise.resolve<Tri>('unknown') : probeAuthRecord(),
      probeToken(),
    ])
    if (token.error) pushAuthError(token.error)

    const full: DiagLastSeen = { ...base, authRecord }
    if (token.expiresInSec !== undefined) full.tokenExpiresInSec = token.expiresInSec
    if (token.issuedAt !== undefined) full.tokenIssuedAt = token.issuedAt

    // 期間可能已被登出，或別的分頁寫了更新的快照——只在自己仍是最新的那筆時才覆寫，
    // 否則會把新快照倒退成舊時間，區間下界反而變寬。
    const current = readLastSeen()
    if (!current || current.at <= base.at) writeLastSeen(full)
  } catch (err) {
    console.warn('[diag] 心跳快照失敗:', err)
  }
}

/**
 * 啟動心跳。回傳清理函式（掛在 AuthProvider 的 useEffect）。
 *
 * 三個觸發點各有分工，缺一不可：
 *   · `tick`    ── 使用中每 60 秒，提供區間上界的解析度
 *   · `hidden`  ── 分頁離開前的最後一眼，用來區分「使用中掉的」與「關著時掉的」
 *   · `visible` ── 分頁回來的第一眼；若憑證已不見，這一筆與 hidden 那筆正好夾出區間
 */
export function startHeartbeat(): () => void {
  if (!isBrowser()) return () => {}

  const tick = () => {
    // 背景分頁完全不動：使用者沒在看的分頁不該消耗任何資源，
    // 而且「離開前的最後一眼」已由 hidden 觸發那筆負責，這裡跑也是多餘。
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    void takeSnapshot('tick')
  }

  const onVisibility = () => {
    void takeSnapshot(document.visibilityState === 'visible' ? 'visible' : 'hidden')
  }

  const timer = window.setInterval(tick, HEARTBEAT_MS)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
