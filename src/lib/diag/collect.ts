// ── 環境證據採集（PLAN-045 Phase A-2）─────────────────────────────────────────
//
// 光知道「被登出了」沒有用，要能回答「為什麼」。sentinel.ts 判定成因，本檔負責
// 蒐集佐證那個判定所需的環境快照。
//
// ── persisted() 為什麼是關鍵欄位 ──
// storageCleared 有兩個成因完全不同、對策也完全不同的來源：
//
//   · Chrome 系：裝置空間吃緊時 evict quota-managed storage。
//     可用 navigator.storage.persist() 申請豁免，且 Chrome 對有互動的站台通常會核准。
//     → firebase.ts 已經在做這件事。若日誌顯示 persisted === true 卻仍被清，
//       表示這條路走不通，要改方向。
//
//   · Safari：**一律不核准 persist()**（除非站台被加入主畫面），且 ITP 政策是
//     7 天無互動就清除 script-writable storage。
//     → 現有的 persist() 對 Safari 使用者完全無效，他們被登出是必然而非偶然。
//
// 兩者在使用者眼中是同一個症狀，但一個要調整儲存策略、一個只能改用其他登入延續機制。
// 沒有 persisted() + UA 就分不出來，只能繼續猜。

/** 一次登出／寫入被拒事件的環境快照。欄位皆為選填——採集失敗不該讓事件本身丟失。 */
export interface DiagEnvironment {
  /** navigator.storage.persisted() 的結果。Safari 恆為 false（它不給） */
  persisted?: boolean
  /** 已用儲存空間（bytes） */
  storageUsage?: number
  /** 配額上限（bytes）。無痕模式下通常異常小，可據此推測 */
  storageQuota?: number
  /** User-Agent 原文。用來分辨 Chrome eviction 與 Safari ITP */
  ua?: string
  /** navigator.platform（部分瀏覽器已棄用，故選填） */
  platform?: string
  /** 是否以 PWA / 加入主畫面的形式開啟（Safari 唯一會給 persist 的情境） */
  standalone?: boolean
  /** 螢幕尺寸，形如 '1920x1080'。用來粗略分辨桌機/手機 */
  screen?: string
  /** 語言設定 */
  language?: string
}

/** 一次事件的 session 上下文。 */
export interface DiagSession {
  /** 本次分頁 session 識別子，把同一次瀏覽的多筆事件串起來 */
  sessionId: string
  /** session 已持續多久（秒） */
  sessionAgeSec?: number
  /** 距離最後一次 idToken refresh 過了多久（秒）。長時間未 refresh 是 token 側失效的訊號 */
  sinceTokenRefreshSec?: number
  /** 本次 session 累計離線時長（秒） */
  offlineSec?: number
  /** 事件發生時所在的路由 */
  route?: string
  /** 事件發生時是否有未存檔的草稿（決定橫幅要不要提「你的編輯已保住」） */
  hadDraft?: boolean
}

// ── session 追蹤狀態 ──────────────────────────────────────────────────────────
// module-scope 而非 React state：這些是「整個分頁的生命週期」層級的事實，
// 且採集端（AuthContext / firestoreCore）分散在 React 樹內外，用 state 傳遞只會綁死結構。

/**
 * session 識別子。
 *
 * 刻意不用 crypto.randomUUID()——它在非安全上下文（http 的區網 IP）不存在，
 * 而本機開發正是那種情境。用時間戳 + 隨機碼即可，這裡不需要密碼學強度。
 */
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const SESSION_START = Date.now()

let lastTokenRefreshAt: number | null = null
let offlineAccumMs = 0
let offlineSince: number | null = null

/** 記錄一次 idToken refresh。由 AuthContext 的 onIdTokenChanged 呼叫。 */
export function markTokenRefresh(): void {
  lastTokenRefreshAt = Date.now()
}

/** 目前的 session id（哨兵也會存一份，用來跨事件對照）。 */
export const getSessionId = (): string => SESSION_ID

/**
 * 開始追蹤離線時長。
 *
 * 為什麼要記這個：Firebase Auth 在離線期間不會登出（它會保留憑證），所以「離線很久
 * 之後發現被登出」若真的成立，代表問題不在網路而在儲存——這個欄位就是用來證偽
 * 「大概是網路不好斷線了吧」這個最容易被隨口接受的猜測。
 */
export function startOfflineTracking(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onOffline = () => { offlineSince = Date.now() }
  const onOnline = () => {
    if (offlineSince !== null) {
      offlineAccumMs += Date.now() - offlineSince
      offlineSince = null
    }
  }
  // 掛載時就已離線的情況要補記
  if (typeof navigator !== 'undefined' && navigator.onLine === false) offlineSince = Date.now()
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)
  return () => {
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
  }
}

const currentOfflineMs = (): number =>
  offlineAccumMs + (offlineSince !== null ? Date.now() - offlineSince : 0)

// ── 採集 ──────────────────────────────────────────────────────────────────────

/**
 * 採集環境快照。
 *
 * 全程 try/catch 且逐欄位選填：診斷設施在採集失敗時應該退化成「證據少一點」，
 * 而不是讓整筆事件寫不進去。少一個欄位仍可判讀，少一筆事件就什麼都沒有了。
 */
export async function collectEnvironment(): Promise<DiagEnvironment> {
  const env: DiagEnvironment = {}
  if (typeof navigator === 'undefined') return env

  try {
    env.ua = navigator.userAgent
    // navigator.platform 已標記為棄用，可能不存在
    const plat = (navigator as Navigator & { platform?: string }).platform
    if (plat) env.platform = plat
    env.language = navigator.language
  } catch { /* 讀不到就算了 */ }

  try {
    if (typeof window !== 'undefined') {
      if (window.screen) env.screen = `${window.screen.width}x${window.screen.height}`
      // Safari 用 navigator.standalone，其餘用 display-mode media query
      const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
      env.standalone =
        iosStandalone === true ||
        (typeof window.matchMedia === 'function' &&
          window.matchMedia('(display-mode: standalone)').matches)
    }
  } catch { /* 讀不到就算了 */ }

  try {
    if (navigator.storage) {
      if (typeof navigator.storage.persisted === 'function') {
        env.persisted = await navigator.storage.persisted()
      }
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate()
        if (typeof est.usage === 'number') env.storageUsage = est.usage
        if (typeof est.quota === 'number') env.storageQuota = est.quota
      }
    }
  } catch { /* Storage API 不可用 */ }

  return env
}

/** 採集 session 上下文。`hadDraft` 由呼叫端提供（只有它知道草稿狀態）。 */
export function collectSession(opts: { route?: string; hadDraft?: boolean } = {}): DiagSession {
  const s: DiagSession = {
    sessionId: SESSION_ID,
    sessionAgeSec: Math.round((Date.now() - SESSION_START) / 1000),
    offlineSec: Math.round(currentOfflineMs() / 1000),
  }
  if (lastTokenRefreshAt !== null) {
    s.sinceTokenRefreshSec = Math.round((Date.now() - lastTokenRefreshAt) / 1000)
  }
  if (opts.route !== undefined) s.route = opts.route
  if (opts.hadDraft !== undefined) s.hadDraft = opts.hadDraft
  return s
}

/** 目前路由（含 hash router 的情況）。事件發生點通常在 React 樹外，拿不到 useLocation。 */
export function currentRoute(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.location.pathname + window.location.search
  } catch {
    return ''
  }
}
