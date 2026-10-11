// ─── 台版公告放行規則（PLAN-048 Phase 2 → 2026-10-11 自動放行）──────────────
//
// 「待審活動 → 可寫進 patchVersions 的 TimedActivity」這件事有三個執行者：
//   · 後台逐筆放行（AnnouncementReviewPanel → api/announcementStaging.mergeIntoVersion）
//   · 後台「全部放行」（AdminAnnouncementsPage → mergeManyIntoVersion）
//   · 每週排程的自動放行（scripts/scrape-tw-announcements.mjs，firebase-admin）
//
// 三者必須寫出**一模一樣**的資料，所以規則集中在這一檔、而且刻意保持純函式：
// 不 import 任何執行期模組（只有 `import type`，會被型別剝除整行拿掉），
// Node 直接 import 這支 .ts 就能用（排程跑 Node 22，型別剝除已是預設）。
// 這個專案被「兩份同樣的規則遲早會漂開」咬過不只一次，而這裡漂開的症狀特別難查：
// 同一筆資料，人工放行與排程放行寫進去的內容不一樣。
//
// ⚠ 不要在這裡加任何會讀 import.meta.env、firebase、React 的 import ——
//   排程在 Vite 以外的環境執行，那會讓它在 GitHub Actions 上直接崩潰。

import type { TimedActivity } from '../data/patchVersions/types'

// ── 寫入前正規化 ────────────────────────────────────────────────────────────

/** 缺長度時填進 note 的預設待辦。單筆審核、批次放行、排程共用同一句。 */
export const DEFAULT_MISSING_WEEKS_NOTE = '官方公告只寫「起」、未寫結束時刻，待確認檔期長度'

/**
 * 解析結果／表單 → 可寫入的 `TimedActivity`。回傳 `null` ＝ 必要欄位不齊，不該寫入。
 */
export function toMergeableActivity(src: Partial<TimedActivity>): TimedActivity | null {
  const name = src.name?.trim()
  if (!name || !src.startDate || !src.type) return null

  const a: TimedActivity = { ...src, name, startDate: src.startDate, type: src.type }

  // 不變式：沒有長度就畫不出甘特長條 → 一律隱藏，並且要留下「為什麼藏起來」
  const willHide = a.weeks === undefined || src.hidden === true
  if (a.weeks === undefined) delete a.weeks
  if (willHide) {
    a.hidden = true
    a.note = (src.note ?? '').trim() || DEFAULT_MISSING_WEEKS_NOTE
  } else {
    delete a.hidden
  }

  // 空字串不要寫進去，免得前台把 '' 當成「有值但空」
  for (const k of ['description', 'sourceUrl', 'typeLabel', 'note', 'editorNote'] as const) {
    if (!a[k]?.trim()) delete a[k]
  }
  if (!a.pilots?.length) delete a.pilots
  if (!a.mechs?.length) delete a.mechs
  if (!a.selection?.length) delete a.selection
  if (!a.rewards?.length) delete a.rewards
  return a
}

// ── 合併進半期陣列 ──────────────────────────────────────────────────────────

/** anchor 比對：名稱 + 起始日。陣列會重排，index 不是穩定識別子。 */
export function sameAnchor(a: TimedActivity, anchor: { name: string; startDate: string }): boolean {
  return a.name === anchor.name && a.startDate === anchor.startDate
}

/**
 * 穩定識別子。與 AdminTimedActivityEditor 的產生規則一致 ——
 * 甘特↔卡片連動與 React key 都靠它，純 index 在陣列重排後會讓選取狀態跳到別的活動身上。
 */
export function makeActivityId(): string {
  return `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export type ApplyResult =
  | { ok: true; list: TimedActivity[]; written: TimedActivity }
  | { ok: false; existing: TimedActivity }

/**
 * 把一筆活動放進某半期的 `twActivities`（純函式，不碰 Firestore）。
 *
 * 呼叫端各自包在交易裡：前台是 client SDK 的 runTransaction、排程是 firebase-admin 的。
 * 兩邊都必須是交易 —— 版本編輯頁存檔是整份 setDoc，讀改寫之間被它插隊，
 * 合併的內容就會被較舊的表單狀態整份蓋掉（見 mergeIntoVersion 的註解）。
 */
export function applyActivityToList(
  current: TimedActivity[] | undefined,
  activity: TimedActivity,
  opts: { overwrite?: boolean } = {},
): ApplyResult {
  const list = Array.isArray(current) ? [...current] : []
  const anchor = { name: activity.name, startDate: activity.startDate }
  const dupIdx = list.findIndex(a => sameAnchor(a, anchor))
  if (dupIdx >= 0 && !opts.overwrite) return { ok: false, existing: list[dupIdx] }

  // 不變式：沒有長度就畫不出甘特長條 → 一律隱藏。
  // 在寫入端強制，而不是信任呼叫端有記得帶 hidden —— 漏帶的後果是首頁多一條
  // 長度是猜的長條，看起來完全正常卻是假資料。前台讀取口（activitiesOfHalf）
  // 另有一道獨立防線，兩道都在。
  const written: TimedActivity = {
    ...activity,
    id: activity.id ?? makeActivityId(),
    ...(activity.weeks === undefined ? { hidden: true } : {}),
  }
  if (dupIdx >= 0) list[dupIdx] = { ...written, id: list[dupIdx].id ?? written.id }
  else list.push(written)
  return { ok: true, list, written }
}

// ── 無結束時刻的檔期推估（2026-10-11 站長拍板）────────────────────────────────
//
// 台版卡池公告幾乎只寫「10:00 起」（實測 175 個【特選】池只有 2 個寫了結束時刻），
// 原本的處理是「不猜、留給人工填」。結果是：2026-05 起累積 44 筆躺在待確認、沒有人填，
// 每週還會再多 2～4 筆。站長在 2026-10-11 改為：**依慣例推估、標成「推估」、自動放行**。
//
// 規則與證據：
//   · 角雕特遣／跨域海運 —— 跑滿整個版本（到下個版本開服）。
//     2026/07/08 公告（tw_1751）「以下活動即將結束」列出 05/28 開的特遣與海運，正好 6 週。
//   · 版本新池（UP 的實體在該半版本的新增名單裡）—— 開到版本結束。
//     同一份公告列出 05/28 的「星途無終」（海莉絲，v3.0 上半新機師），同樣 6 週。
//   · 其餘【特選】池（復刻）—— 2 週。站長的遊戲知識；與先前手動填的 08/06 疾影成鋒相符，
//     遊戲內畫面也顯示該池「結束於 2026/8/20」。
//
// 推估出來的值一律 confidence: 'predicted'（前台虛線＋「推估」標籤），讀者分得出
// 「官方寫的」與「照慣例推的」—— 這正是當初不肯猜的理由，現在用顯示層兌現它。
// 已知例外：06/18 開的「久夢初醒之際」（限定復刻）實際開了 3 週，照規則會推成 2 週。
// 推估錯了的，在版本編輯頁改正週數並取消「推估」即可。

/** 復刻【特選】池的慣例長度（2026-10-11 站長拍板） */
export const RERUN_BANNER_WEEKS = 2

export type DurationRule = 'selectionPool' | 'versionBanner' | 'rerunBanner'

export interface InferredDuration {
  weeks: number
  rule: DurationRule
  /** 推估的結束日 YYYY/MM/DD（exclusive，與 weeks 一致） */
  until: string
}

/** 推估所需的最小版本資訊（前台的 PatchVersion 與排程讀到的原始文件都相容） */
interface HalfLike {
  twDate?: string
  pilots?: string[]
  mechs?: string[]
}
export interface VersionLike {
  id?: string
  version?: string
  upper?: HalfLike
  lower?: HalfLike
}

const DAY_MS = 86_400_000

/** 'YYYY/MM/DD'（可能帶「預計」之類的前綴）→ 當地午夜；解析不了回 null */
function parseYmd(s: string | undefined): Date | null {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(String(s ?? ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function fmtYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`
}

/** 官方中點的寫法不一（「淬鋒·凱登」「洛莎．審判」），比對前統一 */
function normName(s: string): string {
  return s.replace(/[·．・•]/g, '·').replace(/\s+/g, '')
}

function versionKey(v: VersionLike): string {
  return v.id ?? (v.version ? `v${v.version}` : '')
}

/** 起始日之後的第一個版本開服日（＝某個版本的上半台版日期） */
function nextVersionStart(start: Date, versions: VersionLike[]): Date | null {
  let best: Date | null = null
  for (const v of versions) {
    const d = parseYmd(v.upper?.twDate)
    if (!d || d <= start) continue
    if (!best || d < best) best = d
  }
  return best
}

function weeksBetween(start: Date, end: Date): number | null {
  const days = (end.getTime() - start.getTime()) / DAY_MS
  if (days <= 0) return null
  return Math.max(1, Math.round(days / 7))
}

/**
 * 「只寫了起」的活動 → 依慣例推估的檔期。回傳 null ＝ 不適用或推不出來（維持人工確認）。
 *
 * 只處理卡池三類（特遣／海運、特選機師池、特選機甲池）；其他型別的開放式檔期
 * 沒有足夠穩定的慣例，一律交給人。
 */
export function inferOpenEndedDuration(
  a: Partial<TimedActivity>,
  target: { versionId: string; half: 'upper' | 'lower' } | null | undefined,
  versions: VersionLike[],
): InferredDuration | null {
  if (a.weeks !== undefined || !a.startDate || !a.type || !target?.versionId) return null
  const start = parseYmd(a.startDate)
  if (!start) return null

  const untilVersionEnd = (rule: DurationRule): InferredDuration | null => {
    const end = nextVersionStart(start, versions)
    if (!end) return null
    const weeks = weeksBetween(start, end)
    return weeks ? { weeks, rule, until: fmtYmd(end) } : null
  }

  if (a.type === 'pilotMission' || a.type === 'crossShipping') return untilVersionEnd('selectionPool')

  if (a.type === 'specificPilotBanner' || a.type === 'specificMechBanner') {
    const entities = (a.type === 'specificPilotBanner' ? a.pilots : a.mechs) ?? []
    // 不知道 UP 的是誰，就分不出新池還是復刻 —— 寧可交給人
    if (entities.length === 0) return null
    const half = versions.find(v => versionKey(v) === target.versionId)?.[target.half]
    const fresh = new Set(
      ((a.type === 'specificPilotBanner' ? half?.pilots : half?.mechs) ?? []).map(normName),
    )
    if (entities.some(e => fresh.has(normName(e)))) return untilVersionEnd('versionBanner')
    const end = new Date(start.getTime() + RERUN_BANNER_WEEKS * 7 * DAY_MS)
    return { weeks: RERUN_BANNER_WEEKS, rule: 'rerunBanner', until: fmtYmd(end) }
  }
  return null
}

const RULE_LABEL: Record<DurationRule, string> = {
  selectionPool: '角雕特遣／跨域海運跑滿整個版本',
  versionBanner: '版本新池開到版本結束',
  rerunBanner: `復刻特選池慣例 ${RERUN_BANNER_WEEKS} 週`,
}

/** 後台顯示用的一句話，如「推估 2 週（復刻特選池慣例 2 週）」 */
export function describeInferred(inf: InferredDuration): string {
  return `推估 ${inf.weeks} 週（${RULE_LABEL[inf.rule]}，至 ${inf.until}）`
}

/**
 * 把推估結果疊到解析結果上：補 weeks、標 predicted、在 note 留下推估依據。
 *
 * note 是給維護者的（前台不顯示）—— 推錯時要知道「這個數字是哪條規則算的」，
 * 才知道該改資料還是該改規則。已有 weeks（官方寫明）時原樣返回，絕不覆蓋官方值。
 */
export function withInferred(
  a: Partial<TimedActivity>,
  inf: InferredDuration | null | undefined,
): Partial<TimedActivity> {
  if (!inf || a.weeks !== undefined) return a
  return {
    ...a,
    weeks: inf.weeks,
    confidence: 'predicted',
    note: `週數為推估（${RULE_LABEL[inf.rule]}，至 ${inf.until}）：官方公告只寫「起」。查到實際結束日請改正並取消「推估」。`,
  }
}
