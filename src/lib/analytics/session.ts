// ── 三層識別碼與去重（PLAN-046 決策二）──────────────────────────────────────
//
// 「同一個使用者來回點擊不該重複計算」這件事拆成三層，各管各的重複：
//
//   ① visitorId      localStorage 永久   → 同一人今天已被算過一次 UV
//   ② sessionId      10 分鐘閒置換手      → 界定「一次造訪」＝去重的作用域
//   ③ reported Set   隨 session          → 同一 session 內同一頁只計一次 UPV
//
// ⚠ 三個關鍵設計，每一個都對應一種會讓數字失真的實際情境：
//
// · **sessionId 放 localStorage 而非 sessionStorage**：後者每個分頁各一份，使用者
//   開三個分頁比較機甲會被算成三次造訪。reported 一併持久化，順便解決「F5 重整後
//   同一頁又被計一次」。
//
// · **閒置由「任何互動」判定，不是只有換頁**（activity.ts 負責刷新 lastActiveAt）。
//   10 分鐘窗口下若只認換頁，認真讀一頁 12 分鐘的人會被判定閒置 → sessions 灌水、
//   該頁去重被重置，UPV 往 PV 漂回去，反而削弱原本要的去重效果。
//
// · **跨日強制斷 session**：否則 23:55 開始的 session 會把凌晨的瀏覽寫進前一天的
//   日文件。日界線用 UTC+8 而非 UTC —— 要與 Worker 端算出的文件日期一致，
//   且站長是在台灣時間讀報表的（見 dayKey 的說明）。
//
// 本檔上半部是**純函式**（可在 node --test 下直接驗證，不需要瀏覽器），
// 下半部才是碰 localStorage 的薄包裝。

export const IDLE_MS = 10 * 60 * 1000 // 10 分鐘（Q2 裁決；GA4 慣例是 30，本站取較短）

/** 單一 session 內最多記住幾個已回報頁面。有上限才不會無限成長吃掉配額。 */
export const REPORTED_MAX = 50

/** 日界線時區偏移（UTC+8）。固定值、無日光節約，故不需要 Intl。 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000

export interface AnalyticsState {
  visitorId: string
  sessionId: string
  /** 最後一次「有互動」的時間戳（換頁或使用者操作皆會刷新） */
  lastActiveAt: number
  /** 最後一次活動所屬的日期（UTC+8），用來判定跨日與當日 UV */
  lastSeenDate: string
  /** 本 session 內已回報過 UPV 的頁面 key */
  reported: string[]
}

export interface TouchResult {
  state: AnalyticsState
  /** 這次觸發開啟了一個新的 session（造訪 +1） */
  isNewSession: boolean
  /** 這個裝置今天第一次出現（不重複訪客 +1） */
  isNewVisitorToday: boolean
}

/**
 * 取得某時間戳所屬的日期字串（UTC+8）。
 *
 * 為什麼不是 UTC：Worker 端寫入的文件 ID 也用 UTC+8 算（見 workers/src/collect.ts）。
 * 兩邊若不一致，台灣時間早上 7 點（UTC 前一天 23 點）的瀏覽會被前端當成新的一天、
 * 卻被 Worker 寫進昨天的文件，UV 與 session 的日界線就此錯開。
 * 選 UTC+8 而非 UTC 的另一個理由：站長是照台灣時間在讀「今天有多少人」。
 */
export function dayKey(now: number): string {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/** 產生識別碼。crypto.randomUUID 在所有目標瀏覽器皆可用；退路只為極舊環境與測試。 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 依現有狀態與當下時間，算出新的狀態與兩個計數旗標。**純函式，本模組的核心。**
 *
 * @param prev 既有狀態（首次造訪傳 null）
 * @param now  現在時間戳
 * @param genId 識別碼產生器（測試可注入固定值）
 */
export function nextState(
  prev: AnalyticsState | null,
  now: number,
  genId: () => string = newId,
): TouchResult {
  const today = dayKey(now)
  const visitorId = prev?.visitorId || genId()

  // session 過期的三種情形，任一成立即開新 session：
  //   · 從來沒有 session（首次造訪）
  //   · 閒置超過 IDLE_MS
  //   · 跨過日界線（即使剛剛才有互動）
  const expired =
    !prev?.sessionId ||
    now - prev.lastActiveAt > IDLE_MS ||
    prev.lastSeenDate !== today

  // 今天第一次出現 → UV +1。注意這是**跨 session** 的判定：同一天回來三次只算一人。
  const isNewVisitorToday = prev?.lastSeenDate !== today

  return {
    state: {
      visitorId,
      sessionId: expired ? genId() : prev!.sessionId,
      lastActiveAt: now,
      lastSeenDate: today,
      // 換 session 時清空已回報清單 —— 這正是「離開 10 分鐘再回來，該頁可以再計一次」
      reported: expired ? [] : prev!.reported,
    },
    isNewSession: expired,
    isNewVisitorToday,
  }
}

/**
 * 把頁面 key 記入已回報清單，回傳「這次是否算 UPV」。純函式。
 *
 * 回 false 代表本 session 內已經看過這一頁 —— 站長要的去重就落在這一行。
 * 達到上限後不再新增（極端瀏覽行為不該把 localStorage 撐爆），
 * 代價是超過 50 頁之後的新頁面會被重複計 UPV；真實 session 遠達不到這個量級。
 */
export function markReported(state: AnalyticsState, pageKey: string): boolean {
  if (state.reported.includes(pageKey)) return false
  if (state.reported.length >= REPORTED_MAX) return false
  state.reported.push(pageKey)
  return true
}

// ── 以下為瀏覽器側的薄包裝 ──────────────────────────────────────────────────

const STATE_KEY = 'mecharashi_analytics'

const isBrowser = (): boolean => typeof window !== 'undefined'

/** 讀狀態。任何解析失敗一律視為「首次造訪」—— 壞掉的統計狀態不值得搶救。 */
export function readState(): AnalyticsState | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(STATE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<AnalyticsState>
    if (typeof p.visitorId !== 'string' || typeof p.sessionId !== 'string') return null
    return {
      visitorId: p.visitorId,
      sessionId: p.sessionId,
      lastActiveAt: typeof p.lastActiveAt === 'number' ? p.lastActiveAt : 0,
      lastSeenDate: typeof p.lastSeenDate === 'string' ? p.lastSeenDate : '',
      reported: Array.isArray(p.reported) ? p.reported.filter((x) => typeof x === 'string') : [],
    }
  } catch {
    return null
  }
}

/** 寫狀態。配額滿或隱私模式一律靜默 —— 統計絕不可影響使用者的操作。 */
export function writeState(state: AnalyticsState): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    /* 忽略 */
  }
}

/**
 * 刷新活動時間但**不**開啟新 session 的計數。
 *
 * 給 activity.ts 的節流事件用：使用者在同一頁捲動閱讀時，我們只想延後閒置判定，
 * 不想產生任何統計事件。若此刻已經跨日或已閒置逾時，就讓下一次 trackPageView
 * 去開新 session（這裡不主動開，避免在沒有瀏覽行為時憑空生出一次造訪）。
 */
export function touchActivity(now: number): void {
  const prev = readState()
  if (!prev) return
  if (now - prev.lastActiveAt > IDLE_MS || prev.lastSeenDate !== dayKey(now)) return
  writeState({ ...prev, lastActiveAt: now })
}
