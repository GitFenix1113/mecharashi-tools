// 劇情故事館的選章舞台（PLAN-042-K）：焦點、滾輪與偏好的純函式。元件在 StorySelectStage.tsx（檔名避開 Windows 不分大小寫的撞名）。
//
// 這裡不 import storyData（它用 import.meta.glob），node:test 才能直接跑。
//
// ── 為什麼滾輪規則這麼囉嗦 ──
// 舞台在館首頁中段，一路往下捲頁面的人一定會經過它。只要經過時被攔下來換章，就是 PLAN-050 捨棄焦點輪播的同一個前置關卡，
// 只是換成滾輪版。所以接管滾輪有三道關：舞台整塊都在畫面裡、這一下不是頁面捲動的延續（半秒內頁面還在動就放行）、
// 不在頭尾（第一章往上、最後一章往下照常捲頁面）。

import type { StoryCatalogEntry, StoryOutlineRow, StoryStage } from './storyTypes'

/** ?focus=main-4 → 第幾本；沒給或不認得就用 fallback（網址是焦點的唯一真相，元件不另外存 state） */
export function focusIndex(ids: readonly string[], param: string | null, fallback: number): number {
  const i = param ? ids.indexOf(param) : -1
  if (i >= 0) return i
  return Math.min(Math.max(fallback, 0), Math.max(ids.length - 1, 0))
}

/**
 * 沒指定焦點時停在「讀到哪」：最後一本有進度的書；那本已經讀完而且有下一本，就停下一本。一本都沒讀過停第一本。
 * readCount 由呼叫端給（storyProgress.readCount），純函式不碰 localStorage。
 */
export function defaultFocus(books: readonly Pick<StoryCatalogEntry, 'id' | 'stages'>[], readCount: (id: string) => number): number {
  let last = -1
  books.forEach((b, i) => { if (readCount(b.id) > 0) last = i })
  if (last < 0) return 0
  const done = readCount(books[last].id) >= books[last].stages
  return done && last + 1 < books.length ? last + 1 : last
}

/** outline.json 的一本 → storyNav 的函式吃的最小 StoryStage（parts 留空；stagePath／stageOutline 只看 key、code、name、branch、group） */
export function outlineStages(rows: readonly StoryOutlineRow[]): StoryStage[] {
  return rows.map(([key, code, name, branch, group]) => ({
    key, code, name,
    ...(branch ? { branch: true as const } : {}),
    ...(group ? { group } : {}),
    parts: [],
  }))
}

// ─── 滾輪 ────────────────────────────────────────────────────────────────────

/** 累積到這麼多 px 才換一章（舊焦點輪播用 36）。deltaMode 為「行」的滾輪（Firefox）由呼叫端先乘 16 */
export const WHEEL_THRESHOLD = 36
/** 換一章後至少鎖這麼久：這段時間內的滾動只吞掉、不累積 */
export const WHEEL_COOLDOWN_MS = 260
/**
 * 鎖住期間只要滾動還連續湧入（間隔小於這個值）就繼續鎖，等手勢停下才放下一章。
 * 觸控板一次滑動的慣性會連續送一秒左右的小量事件，固定冷卻擋不住（實測一次滑過 4 章）；
 * 滑鼠一格一格滾的間隔通常大於這個值，照樣一格換一章。
 */
export const WHEEL_QUIET_MS = 160
/** 頁面在這段時間內還在捲動，就把這一下當成頁面捲動的延續、不接管 */
export const PAGE_SCROLL_GRACE_MS = 500

export interface WheelCaptureInput {
  /** 這一下的方向：1 往下（下一章）、-1 往上 */
  dir: 1 | -1
  index: number
  count: number
  /** 舞台整塊都在捲動區的可視範圍內 */
  fullyVisible: boolean
  /** 距離頁面（.lore-scroll）上一次捲動過了多久 */
  msSincePageScroll: number
}

/** 這一下滾輪要不要由舞台接管（接管＝preventDefault，頁面不動） */
export function wheelCapture({ dir, index, count, fullyVisible, msSincePageScroll }: WheelCaptureInput): boolean {
  if (!fullyVisible) return false
  if (msSincePageScroll < PAGE_SCROLL_GRACE_MS) return false
  if (dir < 0 && index <= 0) return false
  if (dir > 0 && index >= count - 1) return false
  return true
}

export interface WheelState {
  acc: number
  /** 鎖到什麼時候（ms）：換章後設為 now＋冷卻，鎖住期間每來一下就再延到 now＋WHEEL_QUIET_MS */
  lockUntil: number
}

export const WHEEL_IDLE: WheelState = { acc: 0, lockUntil: -Infinity }

/** 累積一下滾動量，回傳新狀態與這一下要不要換章（-1／0／1）。鎖住期間的滾動直接吞掉、不累積，並把鎖往後延 */
export function wheelStep(state: WheelState, deltaY: number, now: number): { state: WheelState; step: -1 | 0 | 1 } {
  if (now < state.lockUntil) return { state: { acc: 0, lockUntil: Math.max(state.lockUntil, now + WHEEL_QUIET_MS) }, step: 0 }
  // 換方向時重新累積：往下滾了一點又往上，不該被前面的量抵銷
  const acc = Math.sign(deltaY) !== Math.sign(state.acc) ? deltaY : state.acc + deltaY
  if (acc >= WHEEL_THRESHOLD) return { state: { acc: 0, lockUntil: now + WHEEL_COOLDOWN_MS }, step: 1 }
  if (acc <= -WHEEL_THRESHOLD) return { state: { acc: 0, lockUntil: now + WHEEL_COOLDOWN_MS }, step: -1 }
  return { state: { acc, lockUntil: state.lockUntil }, step: 0 }
}

// ─── 館首頁顯示方式 ──────────────────────────────────────────────────────────

/** 主線區顯示「舞台」或「清單」：個人偏好、只存本機。預設舞台（PLAN-042-K D2） */
export const HOME_VIEW_KEY = 'mecharashi_story_home_view'
export type StoryHomeView = 'stage' | 'list'

export function readHomeView(): StoryHomeView {
  try {
    return globalThis.localStorage?.getItem(HOME_VIEW_KEY) === 'list' ? 'list' : 'stage'
  } catch {
    return 'stage'
  }
}

export function writeHomeView(view: StoryHomeView): void {
  try {
    globalThis.localStorage?.setItem(HOME_VIEW_KEY, view)
  } catch {
    /* 存不了也沒關係：這次瀏覽照樣切換 */
  }
}
