// ── 事件緩衝、批次送出與排除規則（PLAN-046 決策六）──────────────────────────
//
// 核心策略：**一個 session 離站時批次寫一次**，而不是每次換頁就送一次。
// 效果是寫入量與「逛幾頁」完全脫鉤 —— 使用者逛 5 頁還是 50 頁，都是同一次寫入。
//
// 送出用 navigator.sendBeacon：關閉分頁時 fetch 會被中斷，sendBeacon 不會。
// payload 包成 text/plain 的 Blob，屬 CORS「簡單請求」→ 不觸發 preflight
// （正式站 /api 是同源，本來就不涉及 CORS；這樣包只是讓跨源回退路徑也能用）。
//
// ⚠ 全檔通則：**任何失敗都靜默**。統計是輔助設施，絕不可因為自己出錯而讓使用者的
//   操作變形 —— 沿用 PLAN-045 logSystemEvent 的既有慣例。

import { WORKER_ENABLED, workerUrl } from '../api/workerData'
import {
  dayKey,
  markReported,
  nextState,
  readState,
  writeState,
  touchActivity,
  IDLE_MS,
} from './session'
import { ENTITY_ROUTES, isSafeEntityId, isTracked, toPageKey } from './routeKeys'

const COLLECT_PATH = '/api/collect'
const OPTOUT_KEY = 'analytics_optout'
const QUEUE_KEY = 'mecharashi_analytics_queue'
/** 佇列上限。統計不值得為了補送舊資料把 localStorage 佔滿。 */
const QUEUE_MAX = 5
/** 長時間停留時的保險 flush 間隔：防止當機／斷電讓整場 session 的資料全丟。 */
const PERIODIC_FLUSH_MS = 5 * 60 * 1000
/** 活動訊號的節流間隔：捲動時每 60 秒最多寫一次 localStorage。 */
const ACTIVITY_THROTTLE_MS = 60 * 1000

export interface CollectPayload {
  v: 1
  /** 本次 flush 帶的造訪數（0 或 1）。已計入的 session 不會再帶第二次。 */
  sessions: number
  /** 本次 flush 帶的不重複訪客數（0 或 1）。 */
  visitors: number
  lang: string
  auth: 'guest' | 'user'
  ref: string
  routes: Record<string, { pv: number; upv: number }>
  entities: Record<string, Record<string, number>>
}

type Buffer = Pick<CollectPayload, 'sessions' | 'visitors' | 'routes' | 'entities'>

const emptyBuffer = (): Buffer => ({ sessions: 0, visitors: 0, routes: {}, entities: {} })

let buffer: Buffer = emptyBuffer()
let installed = false
let lastActivityWrite = 0

/**
 * 目前登入者的角色。null 代表未登入或尚未載入完成。
 *
 * 由 usePageTracking 在角色變動時推進來 —— track.ts 刻意不依賴 React，
 * 這樣 flush 才能在 pagehide 這種 React 已經無法保證運作的時機安全執行。
 */
let currentRole: string | null = null
/**
 * 本次頁面載入是否已被永久排除。
 *
 * 為什麼需要這個旗標：角色是**非同步**載入的（userProfile 要等 Firestore 回來），
 * 管理員的第一次瀏覽極可能在角色確定前就進了 buffer。因此一旦得知角色是特權身分，
 * 就把已累積的 buffer 整個丟掉並永久排除 —— 事後補救比事前等待可靠，
 * 也不用為了等角色而延後所有一般使用者的統計。
 */
let excluded = false

/**
 * 具後台存取權的角色一律不計。
 *
 * 用「白名單以外全部排除」而非列舉黑名單：日後新增角色（如 PLAN-042 規劃中的
 * EDITOR）會自動被排除，不會因為忘了加進黑名單而悄悄污染資料。
 *
 * ⚠ 這在小流量站不是小事：日均僅約 93 次造訪，站長與維護夥伴巡站就足以構成
 *   10–20% 的噪音，而且是**有方向性**的噪音 —— 會把「編輯者常看的頁」系統性推上
 *   熱度排行，那正好是最不該影響改版決策的偏差來源。
 */
function isTrackableRole(role: string | null): boolean {
  return role === null || role === 'USER'
}

/** 本次頁面載入是否要送統計。任一條不通過就整場不送。 */
function isEnabled(): boolean {
  if (excluded) return false
  // 沒有 Worker 端點就沒有地方可送（本機 dev 預設沒開代理）
  if (!WORKER_ENABLED) return false
  // dev 一律不送：順帶解決 React StrictMode 的 effect 雙跑造成的 PV 灌水
  if (import.meta.env.DEV) return false
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  // 自動化瀏覽器與預先渲染不是真人瀏覽
  if (navigator.webdriver) return false
  if ((document as Document & { prerendering?: boolean }).prerendering) return false
  try {
    if (window.localStorage.getItem(OPTOUT_KEY) === '1') return false
  } catch {
    /* 讀不到就當沒設定 */
  }
  return isTrackableRole(currentRole)
}

// ── 維度分桶 ────────────────────────────────────────────────────────────────

/**
 * 瀏覽器語言分桶。
 *
 * 為什麼需要這個維度：本站主客群是**國際服（EN）與中國（CN）玩家**，而
 * request.cf.country 給的是網路位置 —— ①「EN 服玩家」不是一個國家，會被拆散成
 * 十幾個小數字；② CN 玩家常走 VPN，顯示為 US／JP／HK，系統性低估 CN。
 * 語言才對應站長心中的分群方式，且不受 VPN 影響。兩個維度並存互補。
 */
function langBucket(): string {
  const l = (navigator.language || '').toLowerCase()
  if (l.startsWith('zh')) {
    if (l.includes('cn') || l.includes('hans') || l.includes('sg')) return 'zh_cn'
    if (l.includes('tw') || l.includes('hant') || l.includes('hk') || l.includes('mo')) return 'zh_tw'
    return 'zh_other'
  }
  if (l.startsWith('en')) return 'en'
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('ko')) return 'ko'
  return 'other'
}

/** 來源網域分桶。同站內跳轉視同 direct（SPA 內部導航沒有外部來源可言）。 */
function refBucket(): string {
  try {
    const r = document.referrer
    if (!r) return 'direct'
    const host = new URL(r).hostname.replace(/^www\./, '')
    if (host === window.location.hostname) return 'direct'
    return host.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40) || 'other'
  } catch {
    return 'other'
  }
}

// ── 佇列（送不出去時暫存，下次進站補送）────────────────────────────────────
// 形狀與用意比照 PLAN-045 的 src/lib/diag/queue.ts：一個鍵、一個陣列、有上限、
// 任何失敗靜默吞掉。那套已經解決過「事件當下送不出去、下次再補送」這題，不重新設計。

function readQueue(): CollectPayload[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CollectPayload[]) : []
  } catch {
    return []
  }
}

function writeQueue(items: CollectPayload[]): void {
  try {
    if (items.length === 0) window.localStorage.removeItem(QUEUE_KEY)
    else window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-QUEUE_MAX)))
  } catch {
    /* 忽略 */
  }
}

/** 送一包出去。回傳是否成功交給瀏覽器排程。 */
function send(payload: CollectPayload): boolean {
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'text/plain' })
    return navigator.sendBeacon(workerUrl(COLLECT_PATH), blob)
  } catch {
    return false
  }
}

/** 補送佇列裡積欠的資料。任何一包失敗就把剩下的留著，下次再說。 */
function drainQueue(): void {
  const queued = readQueue()
  if (queued.length === 0) return
  const remaining: CollectPayload[] = []
  for (let i = 0; i < queued.length; i++) {
    if (remaining.length > 0 || !send(queued[i])) remaining.push(queued[i])
  }
  writeQueue(remaining)
}

// ── 對外 API ────────────────────────────────────────────────────────────────

/**
 * 更新目前角色。角色一旦確認為特權身分，立刻丟棄已累積的 buffer 並永久排除。
 */
export function setRole(role: string | null): void {
  currentRole = role
  if (!isTrackableRole(role)) {
    excluded = true
    buffer = emptyBuffer()
  }
}

/**
 * 記錄一次頁面瀏覽。
 *
 * @param pattern 命中的**路由樣板**（如 `/pilots/:id`），不是實際網址
 * @param params  路由參數，用來取出 entity id
 */
export function trackPageView(pattern: string, params: Record<string, string | undefined>): void {
  if (!isEnabled()) return
  if (!isTracked(pattern)) return

  const now = Date.now()
  const { state, isNewSession, isNewVisitorToday } = nextState(readState(), now)

  // 換 session 前先把上一個 session 的帳結掉，避免兩個 session 的資料混進同一包
  // （尤其是跨日的情形 —— 混在一起會被寫進錯誤那一天的文件）。
  if (isNewSession) flush()

  if (isNewSession) buffer.sessions += 1
  if (isNewVisitorToday) buffer.visitors += 1

  const key = toPageKey(pattern)
  const slot = (buffer.routes[key] ??= { pv: 0, upv: 0 })
  slot.pv += 1 // 原始次數：來回點擊就是會漲，這是刻意保留的第二軌
  const isFirstThisSession = markReported(state, key)
  if (isFirstThisSession) slot.upv += 1 // ← 站長要的去重就落在這一行

  // entity 熱度：同一 session 內同一個機師也只算一次，與 UPV 同一套去重語意。
  const entityType = ENTITY_ROUTES[pattern]
  const entityId = params.id
  if (entityType && entityId && isSafeEntityId(entityId)) {
    const entityKey = `${entityType}:${entityId}`
    if (markReported(state, entityKey)) {
      const bucket = (buffer.entities[entityType] ??= {})
      bucket[entityId] = (bucket[entityId] ?? 0) + 1
    }
  }

  writeState(state)
}

/** buffer 是否有東西可送。 */
function hasData(): boolean {
  return (
    buffer.sessions > 0 ||
    buffer.visitors > 0 ||
    Object.keys(buffer.routes).length > 0 ||
    Object.keys(buffer.entities).length > 0
  )
}

/**
 * 把 buffer 送出去。送不出去就進佇列，下次進站補送。
 *
 * 無論成功與否都清空 buffer：資料已經交給 sendBeacon 或佇列其中之一，
 * 留著只會在下一次 flush 重複計算。
 */
export function flush(): void {
  if (!isEnabled() || !hasData()) return
  const payload: CollectPayload = {
    v: 1,
    sessions: buffer.sessions,
    visitors: buffer.visitors,
    lang: langBucket(),
    auth: currentRole ? 'user' : 'guest',
    ref: refBucket(),
    routes: buffer.routes,
    entities: buffer.entities,
  }
  buffer = emptyBuffer()
  if (!send(payload)) writeQueue([...readQueue(), payload])
}

/**
 * 掛上 flush 觸發點與活動訊號監聽。只會安裝一次。
 *
 * flush 時機的取捨：
 * · visibilitychange → hidden 是**主力**。切分頁、鎖螢幕、關頁都會觸發，
 *   是行動裝置上唯一可靠的時機。
 * · pagehide 補桌機的導離。**刻意不用 beforeunload** —— 它在 iOS Safari 不可靠。
 * · 每 5 分鐘定時是保險，防長時間停留（例如一直開著模擬器）的資料因當機全丟。
 *
 * 活動訊號（click / keydown / scroll，節流 60 秒）只刷新閒置計時，不產生任何統計
 * 事件與網路請求。少了它，10 分鐘窗口會把慢讀者的 session 誤切（見 session.ts）。
 */
export function installTracking(): () => void {
  if (installed) return () => {}
  installed = true

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  const onActivity = () => {
    const now = Date.now()
    if (now - lastActivityWrite < ACTIVITY_THROTTLE_MS) return
    lastActivityWrite = now
    touchActivity(now)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') onActivity()
    else onHide()
  }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pagehide', flush)
  window.addEventListener('click', onActivity, { passive: true })
  window.addEventListener('keydown', onActivity, { passive: true })
  window.addEventListener('scroll', onActivity, { passive: true })
  const timer = window.setInterval(flush, PERIODIC_FLUSH_MS)

  // 進站先把上次沒送成功的補掉。放在安裝時而非模組載入時，確保排除規則已生效。
  if (isEnabled()) drainQueue()

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('click', onActivity)
    window.removeEventListener('keydown', onActivity)
    window.removeEventListener('scroll', onActivity)
    window.clearInterval(timer)
    installed = false
  }
}

/** 測試與診斷用：目前緩衝內容的快照。 */
export function __peekBuffer(): Buffer {
  return JSON.parse(JSON.stringify(buffer)) as Buffer
}

export { dayKey, IDLE_MS }
