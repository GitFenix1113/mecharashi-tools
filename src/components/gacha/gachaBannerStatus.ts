// 圖鑑卡池橫條的狀態（PLAN-063 決策 4／12）：「這台／這位現在抽得到嗎、抽到哪天、上次什麼時候」。機甲與機師共用。
//
// 資料一律取自站內的活動時間線（patchVersions，站長 10-18：「卡池資料參考站內的活動時間線即可」），
// 全部從既有欄位推導，**不新增任何狀態欄位**（同 activityStatus 的原則：凡是能算的，就不要問維護者）：
//   · 開放中／即將開放／已結束 ← 台服活動的 startDate＋weeks，兩種卡池（依此順序取一個）：
//       專屬卡池（機甲池 specificMechBanner／角色池 specificPilotBanner）
//       ＞ 自選池（跨域海運 crossShipping／角雕特遣 pilotMission，看 selection 自選名單）
//     **戰令不算**（站長 10-18：「他是當前的戰令（環島密令），這不算卡池」）——戰令獎勵是取得途徑、不是卡池，橫條只講卡池。
//   · 新機甲／新機師預計台版登場 ← 半版本新增名單（half.mechs／half.pilots）＋ twDate／twIsPredicted
// 只看台服：站上的檔期以台版為主，陸版卡池目前一筆都沒記（決策 10：也不拿陸版推復刻）。
//
// 純函式（不碰 React／Firestore），node --test 直接載入，所以 import 都帶 .ts。
// ⚠ 比對用中文名、trim 後**精確比對**（決策 9）：用字差異要在寫入端正規化，這裡不做模糊比對——比錯比沒比到更糟。
// ⚠ 「實體 → 卡池活動」的比對與 lore/mechGachaTitle.ts 相近但沒有共用：那支檔案同時有別的計畫在改，
//   這裡先獨立一份，兩邊穩定後再合併（PLAN-063 進度表 A-2 註記）。

import type { PatchHalf, PatchVersion, TimedActivity, VisibleActivity } from '../../data/patchVersions/types.ts'
import { isVisibleActivity } from '../../data/patchVersions/legacyActivities.ts'
import { activityStatus } from '../timeline/activityStatus.ts'
import { bannerIsRerun } from '../timeline/activityTypeRegistry.ts'
import { DAY_MS, parseDate } from '../timeline/ganttGeometry.ts'

export type GachaSubjectKind = 'mech' | 'pilot'
export type GachaBannerKind = 'ongoing' | 'upcoming' | 'debut' | 'past' | 'none'
/** 卡池種類：專屬卡池＞自選池（戰令不算卡池，見檔頭） */
export type GachaBannerSource = 'banner' | 'select'

/** 兩種實體各自看哪些欄位、怎麼稱呼。名單欄位依種類挑（同 bannerIsRerun 的教訓：不讓呼叫端傳，免得比錯欄位） */
const SUBJECT = {
  mech: {
    banner: 'specificMechBanner', select: 'crossShipping',
    names: (a: TimedActivity) => a.mechs, halfNew: (h: PatchHalf) => h.mechs, halfSelect: (h: PatchHalf) => h.mechSelection,
    sourceName: { banner: '機甲池', select: '跨域海運' }, newLabel: '新機甲',
  },
  pilot: {
    banner: 'specificPilotBanner', select: 'pilotMission',
    names: (a: TimedActivity) => a.pilots, halfNew: (h: PatchHalf) => h.pilots, halfSelect: (h: PatchHalf) => h.pilotSelection,
    sourceName: { banner: '角色池', select: '角雕特遣' }, newLabel: '新機師',
  },
} as const

/** 這台／這位的一期（台服） */
export interface GachaBannerRun {
  source: GachaBannerSource
  name: string
  /** 活動登錄在哪個版本（時間線深連結 /versions/timeline/:version 用） */
  version: string
  start: Date
  /** 最後一天（含）——activityStatus 的 endExclusive 往前一天 */
  last: Date
  weeks: number
  /** 結束日是推估（公告沒寫結束時刻，PLAN-048 依慣例補的週數） */
  predicted: boolean
  /** 復刻池（這期的 UP 不在該半版本的新增名單裡）；只有專屬卡池判斷 */
  rerun: boolean
  phase: 'upcoming' | 'ongoing' | 'ended'
  daysLeft: number
}

export interface GachaBannerStatus {
  kind: GachaBannerKind
  /**
   * 池名：插畫屬於那期**專屬卡池**，所以只取專屬卡池的活動名（開放中那期 ＞ 最近開過的 ＞ 即將開放的）；
   * 自選池不當標題（它的種類寫在狀態列）。沒有任何專屬卡池紀錄就 undefined，畫面退回「招募插畫」。
   */
  title?: string
  /** 開放中、即將開放的那一期 */
  current?: GachaBannerRun
  /** 新機甲／新機師：台版預計登場 */
  debut?: { twDate: Date; cnDate?: Date; version: string; half: 'upper' | 'lower'; predicted: boolean; daysUntil: number }
  /** 已結束的各期，新到舊 */
  past: GachaBannerRun[]
  /** 時間線上該看哪個版本：當期 ＞ 登場的版本 ＞ 最近一期；都沒有就 undefined */
  timelineVersion?: string
}

const SOURCE_RANK: Record<GachaBannerSource, number> = { banner: 0, select: 1 }

const sameName = (names: readonly string[] | undefined, name: string) => !!names?.some((n) => n.trim() === name)

function today(now: Date): Date {
  const t = new Date(now)
  t.setHours(0, 0, 0, 0)
  return t
}

/** 這個活動是不是這台／這位的卡池、算哪一種。自選池沒填 selection 時退回半版本舊欄位（與時間線 VersionGanttPanel 的 selectionOf 一致） */
function sourceOf(kind: GachaSubjectKind, act: TimedActivity, half: PatchHalf, name: string): GachaBannerSource | null {
  const s = SUBJECT[kind]
  if (act.type === s.banner) return sameName(s.names(act), name) ? 'banner' : null
  if (act.type === s.select) {
    const list = act.selection?.length ? act.selection : s.halfSelect(half)
    return sameName(list, name) ? 'select' : null
  }
  return null
}

/** 這台／這位在台服的所有卡池（只取通過顯示閘門的，時間線看不到的這裡也不算），舊到新 */
export function gachaBannerRuns(kind: GachaSubjectKind, subjectName: string | undefined, versions: readonly PatchVersion[], now: Date = new Date()): GachaBannerRun[] {
  const name = subjectName?.trim()
  if (!name) return []
  const runs: GachaBannerRun[] = []
  for (const v of versions) {
    for (const half of [v.upper, v.lower] as (PatchHalf | undefined)[]) {
      if (!half) continue
      for (const act of half.twActivities ?? []) {
        if (!act.name?.trim() || !isVisibleActivity(act)) continue
        const source = sourceOf(kind, act, half, name)
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

/** 台版登場：出現在某個半版本的新增名單裡、且那個半版本的台版日期還沒到 */
function upcomingDebut(kind: GachaSubjectKind, name: string, versions: readonly PatchVersion[], now: Date): GachaBannerStatus['debut'] {
  const t = today(now).getTime()
  for (const v of versions) {
    for (const [key, half] of [['upper', v.upper], ['lower', v.lower]] as const) {
      if (!half?.twDate || !sameName(SUBJECT[kind].halfNew(half), name)) continue
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

/** 池名：開放中那期 ＞ 最近開過的 ＞ 即將開放的（只看專屬卡池；runs 已是舊到新） */
function poolTitle(runs: readonly GachaBannerRun[]): string | undefined {
  const pools = runs.filter((r) => r.source === 'banner')
  return (pools.find((r) => r.phase === 'ongoing') ?? pools.filter((r) => r.phase === 'ended').at(-1) ?? pools.find((r) => r.phase === 'upcoming'))?.name
}

/**
 * 狀態優先序：開放中 ＞ 即將開放 ＞ 台版預計登場 ＞ 已結束 ＞ 無紀錄。
 * 同時有好幾期開放中（例：卡池與自選池重疊）取專屬卡池，同種取較晚開的；即將開放取最早的那期。
 */
export function gachaBannerStatus(kind: GachaSubjectKind, subjectName: string | undefined, versions: readonly PatchVersion[], now: Date = new Date()): GachaBannerStatus {
  const name = subjectName?.trim() ?? ''
  const runs = gachaBannerRuns(kind, name, versions, now)
  const past = runs.filter((r) => r.phase === 'ended').reverse()
  const ongoing = runs.filter((r) => r.phase === 'ongoing')
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || b.start.getTime() - a.start.getTime())[0]
  const title = poolTitle(runs)
  if (ongoing) return { kind: 'ongoing', title, current: ongoing, past, timelineVersion: ongoing.version }
  const upcoming = runs.find((r) => r.phase === 'upcoming')
  if (upcoming) return { kind: 'upcoming', title, current: upcoming, past, timelineVersion: upcoming.version }
  const debut = name ? upcomingDebut(kind, name, versions, now) : undefined
  if (debut) return { kind: 'debut', title, debut, past, timelineVersion: debut.version }
  if (past.length) return { kind: 'past', title, past, timelineVersion: past[0].version }
  return { kind: 'none', past }
}

// ── 顯示文案（純函式，跟狀態放一起測） ──────────────────────────────────────

export interface GachaBannerText {
  kind: GachaBannerKind
  /** 狀態標籤：開放中／可自選／即將開放／新機甲（新機師）／已結束；無紀錄為空字串 */
  label: string
  text: string
  /** 第二行的補充（活動種類、推估說明、陸版登場日）；沒有就不帶這個鍵 */
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
/** 開放中的標籤依種類（顏色同為開放中的綠） */
const ONGOING_LABEL: Record<GachaBannerSource, string> = { banner: '開放中', select: '可自選' }

/** 自選池那期要說是哪一種（標題是池名，不會寫出來）：「跨域海運・自選」「角雕特遣・自選」 */
function sourceNote(kind: GachaSubjectKind, r: GachaBannerRun): string | undefined {
  return r.source === 'select' ? `${SUBJECT[kind].sourceName.select}・自選` : undefined
}

/** 已結束各種類的次數：「機甲池 2 次・跨域海運 1 次」（照種類順序） */
function pastBreakdown(kind: GachaSubjectKind, past: readonly GachaBannerRun[]): string {
  const n = new Map<GachaBannerSource, number>()
  for (const r of past) n.set(r.source, (n.get(r.source) ?? 0) + 1)
  return (Object.keys(SOURCE_RANK) as GachaBannerSource[]).filter((k) => n.has(k)).map((k) => `${SUBJECT[kind].sourceName[k]} ${n.get(k)} 次`).join('・')
}

export function gachaBannerText(kind: GachaSubjectKind, s: GachaBannerStatus, now: Date = new Date()): GachaBannerText {
  const rerun = !!s.current?.rerun
  switch (s.kind) {
    case 'ongoing': {
      const r = s.current!
      const sub = [sourceNote(kind, r), r.predicted && '結束日是推估（公告沒寫）'].filter(Boolean).join('・')
      return {
        kind: 'ongoing', label: ONGOING_LABEL[r.source],
        text: r.predicted ? `預計至 ${shortDate(r.last, now)}` : `剩 ${r.daysLeft} 天（至 ${shortDate(r.last, now)}）`,
        ...(sub ? { sub } : {}), predicted: r.predicted, rerun,
      }
    }
    case 'upcoming': {
      const r = s.current!
      const sub = sourceNote(kind, r)
      return { kind: 'upcoming', label: '即將開放', text: `${shortDate(r.start, now)} 開放・${Math.round(r.weeks * 10) / 10} 週`, ...(sub ? { sub } : {}), predicted: r.predicted, rerun }
    }
    case 'debut': {
      const d = s.debut!
      const when = d.daysUntil <= 14
        ? `預計 ${shortDate(d.twDate, now)} 台版登場（${d.daysUntil} 天後${d.predicted ? '・推估' : ''}）`
        : `預計 ${ymd(d.twDate)} 台版登場${d.predicted ? '（推估）' : ''}`
      const where = `v${d.version} ${HALF_LABEL[d.half]}`
      return { kind: 'debut', label: SUBJECT[kind].newLabel, text: when, sub: d.cnDate ? `陸版 ${ymd(d.cnDate)} 已登場・${where}` : where, predicted: d.predicted, rerun: false }
    }
    case 'past':
      return {
        kind: 'past', label: '已結束', text: `最近一次 ${ymd(s.past[0].start)}・${SUBJECT[kind].sourceName[s.past[0].source]}`,
        sub: `時間線紀錄：${pastBreakdown(kind, s.past)}`, predicted: false, rerun: false,
      }
    default:
      return { kind: 'none', label: '', text: '尚無卡池紀錄', predicted: false, rerun: false }
  }
}
