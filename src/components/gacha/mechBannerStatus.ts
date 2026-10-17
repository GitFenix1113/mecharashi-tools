// 機甲圖鑑卡池條的狀態（PLAN-063 決策 4）：「這台現在抽得到嗎、抽到哪天、上次什麼時候」。
//
// 資料一律取自站內的活動時間線（patchVersions，站長 10-18：「卡池資料參考站內的活動時間線即可」），
// 全部從既有欄位推導，**不新增任何狀態欄位**（同 activityStatus 的原則：凡是能算的，就不要問維護者）：
//   · 開放中／即將開放／已結束 ← 台服活動的 startDate＋weeks，三種「拿得到這台」的活動：
//       機甲池 specificMechBanner（mechs）＞ 跨域海運 crossShipping（selection 自選名單）＞ 戰令 battlePass（mechs）
//   · 新機甲預計台版登場     ← 半版本新增名單（half.mechs）＋ twDate／twIsPredicted
// 只看台服：站上的檔期以台版為主，陸版機甲池目前一筆都沒記（決策 10：也不拿陸版推復刻）。
//
// 純函式（不碰 React／Firestore），node --test 直接載入，所以 import 都帶 .ts。
// ⚠ 比對用中文名、trim 後**精確比對**（決策 9）：公告與資料庫的用字差異要在寫入端正規化，這裡不做模糊比對——比錯比沒比到更糟。
// ⚠ 機甲 → 卡池活動的比對與 lore/mechGachaTitle.ts 相近但沒有共用：那支檔案同時有別的計畫在改（機師卡池），
//   這裡先獨立一份，兩邊穩定後再合併（PLAN-063 進度表 A-2 註記）。

import type { PatchHalf, PatchVersion, TimedActivity, VisibleActivity } from '../../data/patchVersions/types.ts'
import { isVisibleActivity } from '../../data/patchVersions/legacyActivities.ts'
import { activityStatus } from '../timeline/activityStatus.ts'
import { bannerIsRerun } from '../timeline/activityTypeRegistry.ts'
import { DAY_MS, parseDate } from '../timeline/ganttGeometry.ts'

export type MechBannerKind = 'ongoing' | 'upcoming' | 'debut' | 'past' | 'none'

/** 拿得到這台的活動種類：機甲池＞跨域海運（自選）＞戰令（獎勵） */
export type MechBannerSource = 'banner' | 'shipping' | 'pass'

/** 這台的一期（台服） */
export interface MechBannerRun {
  source: MechBannerSource
  name: string
  /** 活動登錄在哪個版本（時間線深連結 /versions/timeline/:version 用） */
  version: string
  start: Date
  /** 最後一天（含）——activityStatus 的 endExclusive 往前一天 */
  last: Date
  weeks: number
  /** 結束日是推估（公告沒寫結束時刻，PLAN-048 依慣例補的週數） */
  predicted: boolean
  /** 復刻池（這期的機甲不在該半版本的新增名單裡） */
  rerun: boolean
  phase: 'upcoming' | 'ongoing' | 'ended'
  daysLeft: number
}

export interface MechBannerStatus {
  kind: MechBannerKind
  /**
   * 池名：插畫屬於那期**機甲池**，所以只取機甲池的活動名（開放中那期 ＞ 最近開過的 ＞ 即將開放的）；
   * 海運、戰令不當標題（它們的種類寫在狀態列）。沒有任何機甲池紀錄就 undefined，畫面退回「招募插畫」。
   */
  title?: string
  /** 開放中、即將開放的那一期 */
  current?: MechBannerRun
  /** 新機甲：台版預計登場 */
  debut?: { twDate: Date; cnDate?: Date; version: string; half: 'upper' | 'lower'; predicted: boolean; daysUntil: number }
  /** 已結束的各期，新到舊 */
  past: MechBannerRun[]
  /** 時間線上該看哪個版本：當期 ＞ 新機甲登場的版本 ＞ 最近一期；都沒有就 undefined */
  timelineVersion?: string
}

const sameName = (names: readonly string[] | undefined, name: string) => !!names?.some((n) => n.trim() === name)

function today(now: Date): Date {
  const t = new Date(now)
  t.setHours(0, 0, 0, 0)
  return t
}

const SOURCE_RANK: Record<MechBannerSource, number> = { banner: 0, shipping: 1, pass: 2 }

/**
 * 這個活動算不算「拿得到這台」、算哪一種。名單欄位依種類各自挑（同 bannerIsRerun 的教訓：不讓呼叫端傳，免得比錯欄位）：
 * 海運看 `selection`（這一期可選誰；未填時退回半版本舊欄位 `mechSelection`，與時間線 VersionGanttPanel 的 selectionOf 一致），
 * 機甲池與戰令看 `mechs`。
 */
function sourceOf(act: TimedActivity, half: PatchHalf, name: string): MechBannerSource | null {
  if (act.type === 'specificMechBanner') return sameName(act.mechs, name) ? 'banner' : null
  if (act.type === 'battlePass') return sameName(act.mechs, name) ? 'pass' : null
  if (act.type === 'crossShipping') {
    const list = act.selection?.length ? act.selection : half.mechSelection
    return sameName(list, name) ? 'shipping' : null
  }
  return null
}

/** 這台在台服、拿得到它的所有活動（只取通過顯示閘門的，時間線看不到的這裡也不算），舊到新 */
export function mechBannerRuns(mechName: string | undefined, versions: readonly PatchVersion[], now: Date = new Date()): MechBannerRun[] {
  const name = mechName?.trim()
  if (!name) return []
  const runs: MechBannerRun[] = []
  for (const v of versions) {
    for (const half of [v.upper, v.lower] as (PatchHalf | undefined)[]) {
      if (!half) continue
      for (const act of half.twActivities ?? []) {
        if (!act.name?.trim() || !isVisibleActivity(act)) continue
        const source = sourceOf(act, half, name)
        if (!source) continue
        const st = activityStatus(act as VisibleActivity, now)
        runs.push({
          source,
          name: act.name.trim(),
          version: v.version,
          start: st.start,
          last: new Date(st.endExclusive.getTime() - DAY_MS),
          weeks: act.weeks!,
          predicted: act.confidence === 'predicted',
          rerun: source === 'banner' && bannerIsRerun(act, half),
          phase: st.phase,
          daysLeft: st.daysLeft,
        })
      }
    }
  }
  return runs.sort((a, b) => a.start.getTime() - b.start.getTime() || SOURCE_RANK[a.source] - SOURCE_RANK[b.source])
}

/** 新機甲的台版登場：這台出現在某個半版本的新增名單裡、且那個半版本的台版日期還沒到 */
function upcomingDebut(name: string, versions: readonly PatchVersion[], now: Date): MechBannerStatus['debut'] {
  const t = today(now).getTime()
  for (const v of versions) {
    for (const [key, half] of [['upper', v.upper], ['lower', v.lower]] as const) {
      if (!half?.twDate || !sameName(half.mechs, name)) continue
      const tw = parseDate(half.twDate)
      if (tw.getTime() <= t) continue
      return {
        twDate: tw,
        cnDate: half.cnDate ? parseDate(half.cnDate) : undefined,
        version: v.version,
        half: key,
        // usePatchVersions 會把未來的台版日期標成推估；直接呼叫（測試、後台）時沒標也當推估——還沒到的日期本來就是預告
        predicted: half.twIsPredicted !== false,
        daysUntil: Math.round((tw.getTime() - t) / DAY_MS),
      }
    }
  }
  return undefined
}

/**
 * 狀態優先序：開放中 ＞ 即將開放 ＞ 新機甲（台版預計登場）＞ 已結束 ＞ 無紀錄。
 * 同時有好幾期開放中（例：機甲池與海運重疊）取種類較前的（機甲池＞海運＞戰令），同種取較晚開的；即將開放取最早的那期。
 */
export function mechBannerStatus(mechName: string | undefined, versions: readonly PatchVersion[], now: Date = new Date()): MechBannerStatus {
  const name = mechName?.trim() ?? ''
  const runs = mechBannerRuns(name, versions, now)
  const past = runs.filter((r) => r.phase === 'ended').reverse()
  const ongoing = runs.filter((r) => r.phase === 'ongoing')
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || b.start.getTime() - a.start.getTime())[0]
  const title = poolTitle(runs)
  if (ongoing) return { kind: 'ongoing', title, current: ongoing, past, timelineVersion: ongoing.version }
  const upcoming = runs.find((r) => r.phase === 'upcoming')
  if (upcoming) return { kind: 'upcoming', title, current: upcoming, past, timelineVersion: upcoming.version }
  const debut = name ? upcomingDebut(name, versions, now) : undefined
  if (debut) return { kind: 'debut', title, debut, past, timelineVersion: debut.version }
  if (past.length) return { kind: 'past', title, past, timelineVersion: past[0].version }
  return { kind: 'none', past }
}

/** 池名：開放中那期 ＞ 最近開過的 ＞ 即將開放的（只看機甲池；runs 已是舊到新） */
function poolTitle(runs: readonly MechBannerRun[]): string | undefined {
  const pools = runs.filter((r) => r.source === 'banner')
  return (pools.find((r) => r.phase === 'ongoing') ?? pools.filter((r) => r.phase === 'ended').at(-1) ?? pools.find((r) => r.phase === 'upcoming'))?.name
}

// ── 顯示文案（純函式，跟狀態放一起測） ──────────────────────────────────────

export interface MechBannerText {
  kind: MechBannerKind
  /** 狀態標籤：開放中／即將開放／新機甲／已結束；無紀錄為空字串 */
  label: string
  text: string
  /** 第二行的補充（推估說明、陸版登場日）；沒有就 undefined */
  sub?: string
  /** 這個狀態含推估（結束日或登場日）→ 標籤畫虛線框 */
  predicted: boolean
  rerun: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
export const ymd = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
/** 今年的日期只寫月／日，跨年才寫年 */
const shortDate = (d: Date, now: Date) => (d.getFullYear() === now.getFullYear() ? md(d) : ymd(d))
const HALF_LABEL = { upper: '上半', lower: '下半' } as const

/** 開放中的標籤依種類：機甲池「開放中」、海運「可自選」、戰令「戰令中」（顏色同為開放中的綠） */
const ONGOING_LABEL: Record<MechBannerSource, string> = { banner: '開放中', shipping: '可自選', pass: '戰令中' }
const SOURCE_NAME: Record<MechBannerSource, string> = { banner: '機甲池', shipping: '跨域海運', pass: '戰令' }

/** 不是機甲池的那期要說是什麼活動（標題是池名，不會寫出來）：「跨域海運・自選」「戰令「銳魄灼心」」 */
function sourceNote(r: MechBannerRun): string | undefined {
  if (r.source === 'shipping') return '跨域海運・自選'
  if (r.source === 'pass') return `戰令「${r.name}」`
  return undefined
}

/** 已結束各種類的次數：「機甲池 2 次・跨域海運 1 次」（照種類順序） */
function pastBreakdown(past: readonly MechBannerRun[]): string {
  const n = new Map<MechBannerSource, number>()
  for (const r of past) n.set(r.source, (n.get(r.source) ?? 0) + 1)
  return (Object.keys(SOURCE_RANK) as MechBannerSource[]).filter((k) => n.has(k)).map((k) => `${SOURCE_NAME[k]} ${n.get(k)} 次`).join('・')
}

export function mechBannerText(s: MechBannerStatus, now: Date = new Date()): MechBannerText {
  const rerun = !!s.current?.rerun
  switch (s.kind) {
    case 'ongoing': {
      const r = s.current!
      const sub = [sourceNote(r), r.predicted && '結束日是推估（公告沒寫）'].filter(Boolean).join('・')
      return {
        kind: 'ongoing', label: ONGOING_LABEL[r.source],
        text: r.predicted ? `預計至 ${shortDate(r.last, now)}` : `剩 ${r.daysLeft} 天（至 ${shortDate(r.last, now)}）`,
        ...(sub ? { sub } : {}), predicted: r.predicted, rerun,
      }
    }
    case 'upcoming': {
      const r = s.current!
      const sub = sourceNote(r)
      return { kind: 'upcoming', label: '即將開放', text: `${shortDate(r.start, now)} 開放・${Math.round(r.weeks * 10) / 10} 週`, ...(sub ? { sub } : {}), predicted: r.predicted, rerun }
    }
    case 'debut': {
      const d = s.debut!
      const when = d.daysUntil <= 14
        ? `預計 ${shortDate(d.twDate, now)} 台版登場（${d.daysUntil} 天後${d.predicted ? '・推估' : ''}）`
        : `預計 ${ymd(d.twDate)} 台版登場${d.predicted ? '（推估）' : ''}`
      const where = `v${d.version} ${HALF_LABEL[d.half]}`
      return { kind: 'debut', label: '新機甲', text: when, sub: d.cnDate ? `陸版 ${ymd(d.cnDate)} 已登場・${where}` : where, predicted: d.predicted, rerun: false }
    }
    case 'past':
      return { kind: 'past', label: '已結束', text: `最近一次 ${ymd(s.past[0].start)}・${SOURCE_NAME[s.past[0].source]}`, sub: `時間線紀錄：${pastBreakdown(s.past)}`, predicted: false, rerun: false }
    default:
      return { kind: 'none', label: '', text: '尚無卡池紀錄', predicted: false, rerun: false }
  }
}
