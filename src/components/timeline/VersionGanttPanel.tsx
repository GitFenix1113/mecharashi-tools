import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useRaidSeasons } from '../../hooks/useFirestore'
import type { PatchVersion, PatchHalf, VisibleActivity } from '../../data/patchVersions/types'
import { activitiesOfHalf } from '../../data/patchVersions/legacyActivities'
import { halvesOf, type HalfKey } from '../../data/patchVersions/halves'
import { normalizeNotes } from '../../data/patchVersions/notes'
import PatchInfoRow from './PatchInfoRow'
import ActivityBar from './ActivityBar'
import ActivityCardFlow, { type KeyedActivity } from './ActivityCardFlow'
import GanttAxisOverlay from './GanttAxisOverlay'
import { activityTone, bannerIsRerun } from './activityTypeRegistry'
// 日期工具與長條幾何集中在 ganttGeometry，避免與長條計算各有一份 parseDate 而漂移
import { parseDate, addDays, activityGeometry, generateWeeks } from './ganttGeometry'

// ── Date utils ─────────────────────────────────────────────────────────────────

function fmtShort(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// ── C-1: 週軸計算 ──────────────────────────────────────────────────────────────

/** 一段半版本的近似跨度，供 legacy shim 把舊欄位翻譯成 TimedActivity */
function halfSpan(startStr: string, endStr: string | null): { startDate: string; weeks: number } | null {
  if (!startStr) return null
  const start = parseDate(startStr)
  const end = endStr ? parseDate(endStr) : addDays(start, 21)
  const weeks = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 86400000)))
  return { startDate: startStr, weeks }
}

// ── 版本資訊摺疊偏好 ───────────────────────────────────────────────────────────
//
// 純本機 UI 偏好，不同步到帳戶（那要動 ViewPrefsKey 與 userApi，代價不成比例）。
// 比照 useViewMode 的 loadLocal 寫法：lazy initializer + try/catch，避免
// 隱私模式或 storage 被鎖時整個面板炸掉。

const LS_INFO_COLLAPSED = 'mecharashi_timeline_infoCollapsed'

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(LS_INFO_COLLAPSED) === '1'
  } catch {
    return false
  }
}

function saveCollapsed(v: boolean) {
  try {
    localStorage.setItem(LS_INFO_COLLAPSED, v ? '1' : '0')
  } catch {
    // ignore
  }
}

// ── 主從分割比例（PLAN-050 C-1）───────────────────────────────────────────────
//
// 甘特與活動卡片的長寬比需求正交：甘特是**寬而扁**（寬度＝週數，離散且上限 6–8；
// 高度＝活動數 × 38px），卡片流是**窄而長**（內容無高度上限）。
// 兩者共用同一條垂直軸時，甘特的列數必然把卡片推到摺線以下 ——
// 2026-08-19 實測首頁的卡片流可見高度是 **0px**，而「展開版面」把寬度加倍也多露出 0 張，
// 因為那顆按鈕把預算花在只有 6 個刻度的軸上。拆成左右兩條獨立捲動軸才是解。
//
// 55% 的依據：甘特在 ~800px 就飽和（每週欄超過約 150px 之後，長條那一行截斷文字
// 再寬也買不到資訊）；1920 下左側 55% ＝ 1000px → 每週欄 148px（下限 80px），
// 右側 820px 剛好跨過 ActivityCardFlow 的 @2xl（672px）雙欄門檻。

const LS_SPLIT_PCT = 'mecharashi_timeline_splitPct'
const SPLIT_DEFAULT = 55
const SPLIT_MIN = 35
const SPLIT_MAX = 75

function loadSplitPct(): number {
  try {
    const v = Number(localStorage.getItem(LS_SPLIT_PCT))
    return Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT
  } catch {
    return SPLIT_DEFAULT
  }
}

function saveSplitPct(v: number) {
  try {
    localStorage.setItem(LS_SPLIT_PCT, String(Math.round(v)))
  } catch {
    // ignore
  }
}

// ── CSS 常數 ──────────────────────────────────────────────────────────────────

const LABEL_COL_PX = 110

/**
 * 內容容器的底色。
 *
 * PLAN-050 C-3 之前這裡是 `bg-bg-dark/75`，而且是「橫幅要多明顯」這組耦合旋鈕的
 * 第三顆（另外兩顆是 VersionExpandedPanel 的 BANNER_OPACITY / BANNER_SCRIM）。
 * 三顆旋鈕的歷史調整方向一致：都在把圖蓋掉 —— 因為橫幅鋪在資料底下時，
 * 11–13px 的細字與一張張亮度不同的畫作之間是零和，沒有任何一組固定數值能
 * 讓所有版本都達到 WCAG AA。
 *
 * 現在橫幅搬到頂部的信箱式色帶（見 VersionDetailView），資料區底下不再有圖，
 * 這裡就可以是**不透明實色** —— 對比度變成可驗證的常數，三顆旋鈕一起退場。
 * 連帶把 backdrop-blur 拿掉：14 列 × 6 格的表格上那是白付的繪製成本。
 */
const SURFACE = 'bg-bg-dark'

// 列密度：Phase 1 從 py-1.5 / 15px（實測每列 42px）壓到 py-1 / 14px（約 32px）。
// 原本的預算估固定資訊表 234px，實測是 383px —— 佔掉可用高度的 62%，
// 導致下方的甘特與卡片流只剩 121px。不壓這裡，Phase 1 的卡片流等於看不到。
const TD = 'border border-[#2a3040] px-2 py-1 text-[14px] text-center align-middle text-text-secondary'
const TH = 'border border-[#2a3040] px-2 py-1 text-center align-middle'
const LABEL = 'border border-[#2a3040] px-3 py-1 text-left text-[13px] text-text-dim bg-[#0e1119] whitespace-nowrap'

// ── 分段（上半／中半／下半）────────────────────────────────────────────────────
//
// 一般版本兩段、週年版本三段（halves.ts）。甘特把每一段當成週軸上連續的一截，
// 顏色依段別固定：上半橘、中半粉、下半青 —— 中半不用紫，紫色是整版戰令列的顏色。

interface SegmentTone {
  /** 表頭（「上半版本 11/12～」） */
  th: string
  /** 資訊表的半期欄位底色 */
  cell: string
  /** 週欄表頭底色 */
  weekBg: string
  /** 週欄日期字色 */
  weekText: string
}

/** 活動沒有 id 時的 key 字首（沿用舊的 u／l，既有 key 不變） */
const KEY_PREFIX: Record<HalfKey, string> = { upper: 'u', middle: 'm', lower: 'l' }

const SEGMENT_TONE: Record<HalfKey, SegmentTone> = {
  upper:  { th: 'bg-[rgba(255,107,43,0.08)] text-accent-orange', cell: 'bg-[rgba(255,107,43,0.05)]', weekBg: 'bg-[#151a24]', weekText: 'text-accent-orange/70' },
  middle: { th: 'bg-[rgba(236,72,153,0.08)] text-accent-pink',   cell: 'bg-[rgba(236,72,153,0.05)]', weekBg: 'bg-[#1a1522]', weekText: 'text-accent-pink/70' },
  lower:  { th: 'bg-[rgba(6,182,212,0.08)] text-accent-cyan',    cell: 'bg-[rgba(6,182,212,0.05)]',  weekBg: 'bg-[#0e1820]', weekText: 'text-accent-cyan/70' },
}

/** 甘特上的一段半版本：在週軸上佔幾欄、從哪天開始、甘特已顯示了哪些自選池 */
interface GanttSegment {
  key: HalfKey
  label: string
  half: PatchHalf
  startStr: string
  /** 這一段在週軸上佔幾欄 */
  count: number
  /**
   * 甘特上已經有自選池活動在顯示同一份名單 —— 資訊表就不再重複列出。
   * 名單掛在活動上才對得起檔期；資訊表那兩列是**沒有活動時的退路**
   * （實測 8 個半版本填了名單，其中 7 個的自選池活動還沒合併）。
   */
  covered: { pilot: boolean; mech: boolean }
}

// ── C-4: VersionInfoRows ───────────────────────────────────────────────────────

function VersionInfoRows({
  segments,
  totalWeeks,
}: {
  segments: GanttSegment[]
  totalWeeks: number
}) {
  // 武裝關卡的名字連到 /raids/:seasonId（PLAN-064 E-7）：以台版期名對上已公開的 raidSeasons；對不到就照舊純文字
  const { data: raidSeasons } = useRaidSeasons()
  const norm = (x: string) => x.replace(/s+/g, '')
  const raidNames = (h: PatchHalf): ReactNode => {
    const list = h.armamentRaids ?? []
    if (!list.length) return ''
    return list.map((r, i) => {
      const season = raidSeasons.find((x) => norm(x.name) === norm(r.name))
      return (
        <Fragment key={i}>
          {i > 0 && '、'}
          {season ? <Link to={`/raids/${season.id}`} className="text-accent-orange hover:underline">{r.name}</Link> : r.name}
        </Fragment>
      )
    })
  }
  const raidList = (h: PatchHalf, pick: (r: NonNullable<PatchHalf['armamentRaids']>[number]) => string[] | undefined) =>
    (h.armamentRaids ?? [])
      .filter(r => pick(r)?.length)
      .map(r => pick(r)!.join('/'))
      .join('　')

  // 戰令橫跨整版：取第一個有填的段（與舊版「上半 ?? 下半」同語意，空陣列也算有填）
  const bpPilots = (segments.map(s => s.half.battlePass?.pilots).find(x => x !== undefined) ?? []).join('、')
  const bpMechs  = (segments.map(s => s.half.battlePass?.mechs).find(x => x !== undefined) ?? []).join('、')

  // 自選池的可選名單。與上面的「機師／機甲」（本期新登場）是兩回事：
  // 這裡是角雕特遣／跨域海運「這一期可以換誰」，多半是舊角色。
  // 走 halfRows 而不是像戰令那樣橫跨整版 —— 名單是每半期各自不同的。
  const halfRowDefs: { label: string; small?: boolean; of: (h: PatchHalf, seg: GanttSegment) => ReactNode }[] = [
    { label: '機師',     of: h => (h.pilots ?? []).join('、') },
    { label: '機甲',     of: h => (h.mechs ?? []).join('、') },
    { label: '角色自選', of: (h, seg) => seg.covered.pilot ? '' : (h.pilotSelection ?? []).join('、'), small: true },
    { label: '機甲自選', of: (h, seg) => seg.covered.mech ? '' : (h.mechSelection ?? []).join('、'), small: true },
    { label: '武裝關卡', of: h => raidNames(h) },
    { label: '討伐專武', of: h => raidList(h, r => r.weapons) },
    { label: '討伐背包', of: h => raidList(h, r => r.backpacks) },
  ]
  const halfRows = halfRowDefs
    .map(def => ({ ...def, values: segments.map(seg => def.of(seg.half, seg)) }))
    .filter(r => r.values.some(Boolean))

  const dash = <span className="opacity-30">—</span>

  return (
    <>
      {halfRows.map(row => (
        <tr key={row.label}>
          <td className={LABEL}>{row.label}</td>
          {/* small：自選名單動輒十幾個名字，用小一級字避免把整張表撐高 */}
          {segments.map((seg, i) => (
            <td
              key={seg.key}
              colSpan={seg.count}
              className={`${TD} ${row.small ? 'text-[12px] leading-[1.6]' : ''} ${SEGMENT_TONE[seg.key].cell}`}
            >
              {row.values[i] || dash}
            </td>
          ))}
        </tr>
      ))}
      {bpPilots && (
        <tr>
          <td className={LABEL}>角色戰令</td>
          <td colSpan={totalWeeks} className={`${TD} bg-[rgba(168,85,247,0.05)] text-accent-purple`}>
            {bpPilots}
          </td>
        </tr>
      )}
      {bpMechs && (
        <tr>
          <td className={LABEL}>機甲戰令</td>
          <td colSpan={totalWeeks} className={`${TD} bg-[rgba(168,85,247,0.05)] text-accent-purple`}>
            {bpMechs}
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * 摺疊時的濃縮列：只留機師與機甲（實測最常被查的兩項），仍沿用各段的
 * colSpan 切分，所以「哪一半有誰」的對照關係不會因為摺疊而消失。
 *
 * 為什麼不連週軸表頭一起收：那條軸是甘特長條的定位基準，也是使用者當初把甘特
 * 放在這裡的理由（對照版本週次）。收掉它，剩下的甘特就失去意義。
 */
function CollapsedSummaryRow({ segments }: { segments: GanttSegment[] }) {
  const summarize = (h: PatchHalf) =>
    [(h.pilots ?? []).join('、'), (h.mechs ?? []).join('、')].filter(Boolean).join('　·　')

  const values = segments.map(seg => summarize(seg.half))
  if (!values.some(Boolean)) return null

  const dash = <span className="opacity-30">—</span>

  return (
    <tr>
      <td className={`${LABEL} text-[12px]`}>機師 · 機甲</td>
      {segments.map((seg, i) => (
        <td key={seg.key} colSpan={seg.count} className={`${TD} text-[13px] ${SEGMENT_TONE[seg.key].cell}`}>
          {values[i] || dash}
        </td>
      ))}
    </tr>
  )
}

// ── C-5: ActivityGanttRow ─────────────────────────────────────────────────────
//
// 為什麼不改成 CSS grid：長條層住在**單一** colSpan={totalWeeks} 的 td 裡，
// 該 td 的寬度天生就等於整條週軸（tableLayout:fixed + 同一份 Colgroup），
// 所以百分比定位與上方固定資訊表的欄界自動對齊，Colgroup 一行都不用動。

function ActivityGanttRow({
  item,
  allWeeks,
  totalWeeks,
  selectedKey,
  onSelect,
  onHover,
}: {
  item: KeyedActivity
  allWeeks: Date[]
  totalWeeks: number
  selectedKey: string | null
  onSelect: (key: string | null) => void
  onHover: (key: string | null) => void
}) {
  const { key, act, carriedFrom, rerun, selection } = item
  const geom = activityGeometry(act, allWeeks)
  const tone = activityTone(act.type, act.typeLabel, { rerun })
  const selected = selectedKey === key

  return (
    <tr>
      <td className="border-r border-[#2a3040] px-3 py-0 text-left text-[13px] text-text-dim bg-[#0e1119] whitespace-nowrap">
        <span className={tone.text}>{tone.label}</span>
        {/* 跨版來源：不標的話讀者會以為這是本版新增的活動 */}
        {carriedFrom && (
          <span className="ml-1 text-[10px] text-text-dim" title={`延續自 ${carriedFrom}`}>
            ↩{carriedFrom}
          </span>
        )}
      </td>
      <td colSpan={Math.max(totalWeeks, 1)} className="p-0 align-middle">
        {/* h-8：Phase 1 從 py-3.5（50px）壓到 32px，1366×768 可見列 1 → 4 */}
        <div className="relative h-8">
          {geom && (
            <ActivityBar
              act={act}
              actKey={key}
              geom={geom}
              selected={selected}
              dimmed={selectedKey !== null && !selected}
              rerun={rerun}
              selection={selection}
              onSelect={onSelect}
              onHover={onHover}
            />
          )}
        </div>
      </td>
    </tr>
  )
}

// ── 版本層級補充資訊：商店 / 危境重構 / 記憶風暴 / 備註 ─────────────────────────
//
// Phase 1 把原本分成兩塊（ShopRow 52px + VersionLevelInfo 40px）的資訊併成單列
// chips，回收約 64px 的垂直空間給甘特與卡片流。備註通常很長，仍獨立成一行。

function VersionExtras({ version }: { version: PatchVersion }) {
  const chips: { icon: string; label: string; items: string[]; cls: string }[] = []
  if (version.borderShop) chips.push({ icon: '🛒', label: '邊境商店', items: [version.borderShop], cls: 'text-accent-yellow' })
  if (version.arenaShop) chips.push({ icon: '🏆', label: '鬥技場', items: [version.arenaShop], cls: 'text-accent-orange' })
  if (version.crisisShop?.length) chips.push({ icon: '🏪', label: '危境重構', items: version.crisisShop, cls: 'text-accent-purple' })
  if (version.memoryStorm) chips.push({ icon: '🌀', label: '記憶風暴', items: [version.memoryStorm], cls: 'text-accent-cyan' })

  const notes = normalizeNotes(version.notes)

  if (chips.length === 0 && notes.length === 0) return null

  return (
    <div className="mt-1.5 shrink-0 space-y-1">
      {chips.length > 0 && (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border ${SURFACE} px-3 py-1`}>
          {chips.map(c => (
            <span key={c.label} className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap">
              <span className="opacity-80">{c.icon}</span>
              <span className="text-text-dim">{c.label}</span>
              <span className={c.cls}>{c.items.join('、')}</span>
            </span>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div className={`rounded-lg border border-border ${SURFACE} px-3 py-1`}>
          <PatchInfoRow icon="📝" label="備註" items={notes} color="blue" size="sm" />
        </div>
      )}
    </div>
  )
}

// ── C-2: Main — VersionGanttPanel ─────────────────────────────────────────────

export default function VersionGanttPanel({
  version,
  prevVersion,
  side = 'tw',
}: {
  version: PatchVersion
  prevVersion?: PatchVersion
  side?: 'tw' | 'cn'
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [infoCollapsed, setInfoCollapsed] = useState(loadCollapsed)
  const [splitPct, setSplitPct] = useState(loadSplitPct)
  const [dragging, setDragging] = useState(false)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const splitRef = useRef<HTMLDivElement>(null)
  // 拖曳中與最新比例都另存一份 ref。原因是事件處理器讀的是**該次 render 的閉包**：
  // pointerdown 觸發 setState 之後，緊接著抵達的 pointermove 仍然是舊的處理器，
  // 讀到 dragging === false 而整段失效（實測第一次拖曳沒反應）。
  // 狀態值留著只為了樣式（拖曳中變色 / select-none）。
  const draggingRef = useRef(false)
  const splitPctRef = useRef(splitPct)

  // 用 pointer capture 而不是掛 window 監聽：指標跑出分隔線（拖太快、或滑到 iframe 上）
  // 事件仍然回到這顆元素，不會留下「放開了還在拖」的狀態。
  const applyDrag = useCallback((clientX: number) => {
    const el = splitRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return
    const pct = ((clientX - rect.left) / rect.width) * 100
    const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct))
    splitPctRef.current = next
    setSplitPct(next)
  }, [])

  const toggleInfo = useCallback(() => {
    setInfoCollapsed(v => {
      saveCollapsed(!v)
      return !v
    })
  }, [])

  const registerRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(key, el)
    else cardRefs.current.delete(key)
  }, [])

  const { allWeeks, segments, items } =
    useMemo(() => {
      const startOf = (h: PatchHalf) => (side === 'tw' ? (h.twDate ?? '') : h.cnDate)

      // 每一段的邊界是**下一段**的開始日（實際日期，最可靠）；缺下一段日期時退回 weeks／慣例。
      // 最後一段沒有「下一段」可用（下個版本不在這個元件的視野內），故走 weeks／慣例。
      // 都不再被活動撐長 —— 跨版本的長條在軸尾切平，見 generateWeeks 的說明。
      // 三段版本（週年）只是多一段，規則完全相同：上半止於中半、中半止於下半。
      const halves = halvesOf<PatchHalf>(version)
      const segs = halves.map((h, i) => {
        const startStr = startOf(h.half)
        const nextStr = i + 1 < halves.length ? startOf(halves[i + 1].half) : ''
        return {
          ...h,
          startStr,
          // legacy shim：新欄位缺席時，把 deprecated 欄位翻譯成 TimedActivity，
          // 否則靜態 fallback 資料（v2.8–v3.3）在 Worker 掛掉時會顯示成空甘特
          acts: activitiesOfHalf(h.half, side, halfSpan(startStr, nextStr || null)),
          weeks: startStr ? generateWeeks(startStr, nextStr || null, h.half.weeks) : [],
        }
      })
      const allWeeks = segs.flatMap(s => s.weeks)

      // 復刻判定要拿**該活動所屬那一半**的新增名單去比 —— 用錯半期就會把
      // 上半的新機師當成下半的，分類整個反過來。
      const rerunOf = (act: VisibleActivity, half: PatchHalf) =>
        bannerIsRerun(act, half) || undefined

      // 自選池名單：活動自己的優先，其次退回半期層級的舊欄位。
      // 半期層級只有一份，同半版本開兩個自選池時會共用而顯示錯誤 ——
      // 所以它只是 fallback（給這個欄位存在之前手填的資料），新資料請填在活動上。
      const selectionOf = (act: VisibleActivity, half: PatchHalf) => {
        if (act.selection?.length) return act.selection
        if (act.type === 'pilotMission') return half.pilotSelection?.length ? half.pilotSelection : undefined
        if (act.type === 'crossShipping') return half.mechSelection?.length ? half.mechSelection : undefined
        return undefined
      }

      // 穩定 key：優先用 act.id（Phase 1 新欄位），未填時退回「段別字首+序號+名稱」。
      // 純 index 會在陣列重排時讓選取狀態跳到別的活動身上。
      // 字首沿用舊的 u／l（中半是 m），既有的 key 不會因為這次改版而變動。
      const items: KeyedActivity[] = segs.flatMap(seg =>
        seg.acts.map((act, i) => ({
          key: act.id ?? `${KEY_PREFIX[seg.key]}${i}:${act.name}:${act.startDate}`,
          act,
          rerun: rerunOf(act, seg.half),
          selection: selectionOf(act, seg.half),
        })),
      )

      // ── 上一版跨進來的活動 ────────────────────────────────────────────────
      //
      // 戰令這類活動常常跨版：它只被登錄在開跑的那一版（當期主打，同時也是給
      // 玩家準備時間的預告），但下一版期間仍在進行中。不撈進來的話，v3.2 的甘特
      // 會是一片空白，而實際上那段時間有一個六週戰令正在跑。
      //
      // 判準是「結束時間晚於本版軸起點」——用實際日期算，不靠人工標記跨版。
      // 幾何層會把它們的左緣切平（clipStart），所以視覺上就是「從更早以前延續過來」。
      const axisStart = allWeeks[0]
      const carried: KeyedActivity[] = []
      if (prevVersion && axisStart) {
        const prevLabel = `v${prevVersion.version}`
        const prevHalves = halvesOf<PatchHalf>(prevVersion)
        const thisStart = segs[0]?.startStr ?? ''
        // 保留「來自哪一半」—— 復刻判定要用該活動**原本那一版那一半**的新增名單，
        // 拿當前版本的名單去比會全部誤判成復刻（本版的新機師當然不在上一版名單裡）
        const prevActs: { act: VisibleActivity; half: PatchHalf }[] = prevHalves.flatMap((h, i) => {
          const s = startOf(h.half)
          // 上一版的最後一段止於本版的開始日
          const next = i + 1 < prevHalves.length ? startOf(prevHalves[i + 1].half) : thisStart
          return activitiesOfHalf(h.half, side, halfSpan(s, next || null)).map(act => ({ act, half: h.half }))
        })
        // 本版已經有的同名同起始日不再重複帶入（維護者可能兩版都登錄了一次）
        const own = new Set(items.map(it => `${it.act.name}@${it.act.startDate}`))
        for (const [i, { act, half }] of prevActs.entries()) {
          const end = addDays(parseDate(act.startDate), Math.max(act.weeks, 1) * 7)
          if (end <= axisStart) continue                       // 上一版就結束了
          if (own.has(`${act.name}@${act.startDate}`)) continue
          carried.push({
            key: act.id ? `carry:${act.id}` : `carry${i}:${act.name}:${act.startDate}`,
            act,
            carriedFrom: prevLabel,
            rerun: rerunOf(act, half),
            selection: selectionOf(act, half),
          })
        }
      }
      items.unshift(...carried)   // 排在最前面 —— 它們是「已經在跑」的，優先級高於本版即將開始的

      // 哪些自選池已經由甘特上的活動顯示了 —— 資訊表那兩列就不重複列出。
      // 只看本半期自己的活動（carried 的屬於上一版，不算）。
      // 有該型別的活動就算涵蓋 —— 活動即使沒填自己的 selection，也會 fallback
      // 讀半期層級那份，所以資訊表再列一次必然重複。
      const covers = (acts: VisibleActivity[], type: string) =>
        acts.some(a => a.type === type)
      const segments: GanttSegment[] = segs.map(seg => ({
        key: seg.key,
        label: seg.label,
        half: seg.half,
        startStr: seg.startStr,
        count: seg.weeks.length,
        covered: { pilot: covers(seg.acts, 'pilotMission'), mech: covers(seg.acts, 'crossShipping') },
      }))

      return { allWeeks, segments, items }
    }, [side, version, prevVersion])

  const totalWeeks = allWeeks.length

  // 三向連動的核心：被強調的活動（點選優先於 hover）決定要打亮哪幾個週欄。
  const activeKey = selectedKey ?? hoveredKey
  const activeCols = useMemo(() => {
    if (!activeKey || totalWeeks === 0) return null
    const found = items.find(i => i.key === activeKey)
    if (!found) return null
    const geom = activityGeometry(found.act, allWeeks)
    if (!geom) return null
    // 百分比 → 週欄索引；末欄用 ceil 前減一個 epsilon，避免剛好貼齊欄界時多亮一欄
    const start = Math.floor((geom.leftPct / 100) * totalWeeks + 1e-6)
    const end = Math.ceil(((geom.leftPct + geom.widthPct) / 100) * totalWeeks - 1e-6) - 1
    return { start: Math.max(0, start), end: Math.min(totalWeeks - 1, Math.max(start, end)) }
  }, [activeKey, items, allWeeks, totalWeeks])

  const isColActive = (i: number) =>
    activeCols !== null && i >= activeCols.start && i <= activeCols.end

  // 點長條 → 對應卡片捲入視野
  const handleSelect = useCallback((key: string | null) => {
    setSelectedKey(key)
    if (key) {
      requestAnimationFrame(() => {
        cardRefs.current.get(key)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }
  }, [])

  // 每一週欄屬於哪一段（決定週欄表頭的底色與字色）
  const weekSegKeys = useMemo(() => segments.flatMap(seg => Array<HalfKey>(seg.count).fill(seg.key)), [segments])
  // 分段分界落在第幾欄之前（給軸線層畫分界線）
  const boundaries = useMemo(() => {
    const out: number[] = []
    let acc = 0
    for (const seg of segments.slice(0, -1)) out.push((acc += seg.count))
    return out
  }, [segments])

  // 兩個表格共用相同欄寬定義，確保固定內容與活動甘特的欄位對齊
  const Colgroup = () => (
    <colgroup>
      <col style={{ width: `${LABEL_COL_PX}px`, minWidth: `${LABEL_COL_PX}px` }} />
      {allWeeks.map((_, i) => (
        <col key={i} style={{ minWidth: '80px' }} />
      ))}
      {/* Placeholder cols when no dates */}
      {totalWeeks === 0 &&
        Array.from({ length: 6 }).map((_, i) => (
          <col key={i} style={{ minWidth: '80px' }} />
        ))}
    </colgroup>
  )

  return (
    /*
      主從分割（PLAN-050 C-1）。左：索引（版本資訊表 ＋ 甘特長條），右：內容（活動卡片）。
      兩欄各有自己的 overflow-y-auto ＋ overscroll-contain。

      **行動版刻意不套用分割**（<lg）：這裡退回單欄，由本容器自己捲。
      左右分割在窄螢幕等於原病復發 —— 甘特 6 週的最低寬度是 110 + 6×80 ＝ 590px，
      在 390px 的螢幕上左欄只會變成一個橫捲的小窗，而卡片又被擠到 45% 的高度。
      行動版的正解是「一次只給一條軸」的分段切換器，那是 Phase D 的範圍。
    */
    <div
      ref={splitRef}
      className={`flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto overscroll-contain
                  lg:flex-row lg:overflow-hidden ${dragging ? 'select-none' : ''}`}
      style={{ '--split': `${splitPct}%` } as CSSProperties}
    >
      {/* ── 左欄：索引 ── 共用橫向捲動容器，讓資訊表與甘特的週欄對齊、同步橫捲
          `lg:min-w-[600px]` 是甘特的實際下限（標籤欄 110 ＋ 6 週 × 80 ＝ 590px）：
          1024 寬時 55% 只有 536px，週欄會被壓到 80px 以下而長出橫向捲軸（實測差 54px）。
          比例是給大螢幕分配空間用的，不該把索引欄壓到它連自己都裝不下。
          1280 以上 55% 本來就超過 600px，這條下限是 inert 的。 */}
      <div className="shrink-0 min-w-0 flex flex-col lg:min-h-0 lg:overflow-hidden lg:[flex-basis:var(--split)] lg:min-w-[600px]">
      <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
        <div
          className="flex-1 min-h-0 flex flex-col"
          style={{ minWidth: `${LABEL_COL_PX + Math.max(totalWeeks, 6) * 80}px` }}
        >
          {/* ── 容器 1：固定版本內容（機師 / 機甲 / 武裝關卡 / 討伐專武 / 討伐背包 / 角色戰令 / 機甲戰令）── */}
          <div className={`shrink-0 rounded-lg border border-border ${SURFACE} overflow-hidden`}>
            <table className="border-collapse text-[13px] w-full" style={{ tableLayout: 'fixed' }}>
              <Colgroup />
              <thead>
                <tr>
                  <th rowSpan={2} className={`${LABEL} p-0`}>
                    {/* 摺疊觸發點做成明確的按鈕：先前只有一個 10px 的 chevron 跟在
                        文字後面，使用者反映看不出可以點。現在給它獨立的膠囊、邊框、
                        動詞文字與 hover 底色 —— 可點性靠形狀與動詞，不能只靠一個符號。 */}
                    <button
                      type="button"
                      onClick={toggleInfo}
                      aria-expanded={!infoCollapsed}
                      title={infoCollapsed ? '展開版本內容（機師 / 機甲 / 武裝關卡…）' : '收合版本內容，把空間讓給活動甘特與卡片'}
                      className="group w-full h-full px-2 py-1.5 flex flex-col items-center justify-center gap-1
                                 cursor-pointer transition-colors hover:bg-accent-orange/8"
                    >
                      <span className="text-[13px] tracking-[2px] uppercase text-text-dim
                                       group-hover:text-text-secondary transition-colors">
                        {side === 'tw' ? '台版' : '陸版'}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5
                                   text-[11px] leading-none whitespace-nowrap transition-colors
                                   border-accent-orange/40 bg-accent-orange/10 text-accent-orange/90
                                   group-hover:border-accent-orange/80 group-hover:bg-accent-orange/20
                                   group-hover:text-accent-orange"
                      >
                        <span className={`text-[9px] transition-transform duration-200 ${infoCollapsed ? '-rotate-90' : ''}`}>
                          ▼
                        </span>
                        {infoCollapsed ? '展開' : '收合'}
                      </span>
                    </button>
                  </th>
                  {segments.map(seg => seg.count > 0 && (
                    <th
                      key={seg.key}
                      colSpan={seg.count}
                      className={`${TH} ${SEGMENT_TONE[seg.key].th} text-[14px] font-[Orbitron,sans-serif] tracking-wide py-2`}
                    >
                      {seg.label}版本
                      <span className="ml-1.5 text-[12px] opacity-70">
                        {seg.startStr ? fmtShort(parseDate(seg.startStr)) : '—'}～
                      </span>
                    </th>
                  ))}
                  {totalWeeks === 0 && (
                    <th colSpan={6} className={`${TH} text-text-dim text-[14px]`}>
                      （{side === 'tw' ? '台版' : '陸版'}日期未定）
                    </th>
                  )}
                </tr>
                <tr>
                  {allWeeks.map((week, i) => (
                    <th
                      key={i}
                      className={`${TH} text-[13px] py-1.5 transition-colors ${
                        isColActive(i)
                          ? 'bg-accent-cyan/20 shadow-[inset_0_0_0_1px_rgba(6,182,212,0.45)]'
                          : SEGMENT_TONE[weekSegKeys[i] ?? 'upper'].weekBg
                      }`}
                    >
                      <div className={SEGMENT_TONE[weekSegKeys[i] ?? 'upper'].weekText}>
                        {fmtShort(week)}
                      </div>
                    </th>
                  ))}
                  {totalWeeks === 0 &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <th key={i} className={`${TH} bg-[#151a24]`} />
                    ))}
                </tr>
              </thead>
              <tbody>
                {totalWeeks > 0 && (
                  infoCollapsed ? (
                    <CollapsedSummaryRow segments={segments} />
                  ) : (
                    <VersionInfoRows segments={segments} totalWeeks={totalWeeks} />
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* ── 版本層級補充資訊（商店 / 危境重構 / 記憶風暴 / 備註）── */}
          {!infoCollapsed && <VersionExtras version={version} />}

          {/* ── 容器 2：甘特索引層 ──
              桌機：自己的垂直捲動軸（左欄的那一條）。
              行動版：不自成捲動軸 —— 單欄版面只該有一條軸，巢狀捲動在窄螢幕上
              就是「捲了半天發現捲錯層」的來源。 */}
          <div className={`mt-2 rounded-lg border border-border ${SURFACE} overflow-x-hidden
                           lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain`}>
            <div className="relative">
              {/* 共用軸線層：週格線 / 上下半分界 / 今日線 */}
              <GanttAxisOverlay
                allWeeks={allWeeks}
                boundaries={boundaries}
                labelColPx={LABEL_COL_PX}
              />

              <table className="relative z-10 border-collapse text-[13px] w-full" style={{ tableLayout: 'fixed' }}>
                <Colgroup />
                <tbody>
                  {items.map(item => (
                    <ActivityGanttRow
                      key={item.key}
                      item={item}
                      allWeeks={allWeeks}
                      totalWeeks={totalWeeks}
                      selectedKey={activeKey}
                      onSelect={handleSelect}
                      onHover={setHoveredKey}
                    />
                  ))}

                  {/* 無資料時的提示列 */}
                  {items.length === 0 && (
                    <tr>
                      <td className={LABEL} />
                      <td
                        colSpan={Math.max(totalWeeks, 6)}
                        className={`${TD} text-text-dim text-[10px] py-2`}
                      >
                        （本半版本尚無登錄活動{side === 'cn' && ' — 陸版官網公告常有漏收'}）
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </div>
      </div>

      {/* ── 分隔線（可拖曳）── 只在桌機存在；行動版是單欄 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="調整甘特與活動卡片的寬度比例"
        aria-valuenow={Math.round(splitPct)}
        aria-valuemin={SPLIT_MIN}
        aria-valuemax={SPLIT_MAX}
        tabIndex={0}
        title="拖曳調整寬度比例（雙擊還原）"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          draggingRef.current = true
          setDragging(true)
        }}
        onPointerMove={(e) => { if (draggingRef.current) applyDrag(e.clientX) }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          draggingRef.current = false
          setDragging(false)
          saveSplitPct(splitPctRef.current)
        }}
        onDoubleClick={() => {
          splitPctRef.current = SPLIT_DEFAULT
          setSplitPct(SPLIT_DEFAULT)
          saveSplitPct(SPLIT_DEFAULT)
        }}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowLeft' ? -2 : e.key === 'ArrowRight' ? 2 : 0
          if (step === 0) return
          e.preventDefault()
          const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, splitPctRef.current + step))
          splitPctRef.current = next
          setSplitPct(next)
          saveSplitPct(next)
        }}
        className={`hidden lg:block shrink-0 w-1.5 self-stretch rounded-full cursor-col-resize
                    transition-colors outline-none
                    focus-visible:ring-1 focus-visible:ring-accent-orange/60
                    ${dragging ? 'bg-accent-orange/70' : 'bg-border hover:bg-accent-orange/50'}`}
      />

      {/* ── 右欄：內容 ── 活動卡片，自己的垂直捲動軸 */}
      <div className={`min-w-0 rounded-lg border border-border ${SURFACE}
                       lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain`}>
        <ActivityCardFlow
          items={items}
          selectedKey={activeKey}
          onSelect={handleSelect}
          onHover={setHoveredKey}
          registerRef={registerRef}
        />
        {/* 空欄位要說得出「為什麼空」：只留一個有邊框的空白框，讀者無從分辨
            是沒有資料、還是載入壞了。 */}
        {items.length === 0 && (
          <p className="text-text-dim text-[12px] text-center py-6">
            本版本沒有登錄任何活動
          </p>
        )}
      </div>
    </div>
  )
}
