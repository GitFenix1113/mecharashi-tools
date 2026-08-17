import { useCallback, useMemo, useRef, useState } from 'react'
import type { PatchVersion, PatchHalf, VisibleActivity } from '../../data/patchVersions/types'
import { activitiesOfHalf } from '../../data/patchVersions/legacyActivities'
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

// ── CSS 常數 ──────────────────────────────────────────────────────────────────

const LABEL_COL_PX = 110

/**
 * 內容容器的底色 —— 想調整就改這一行。
 *
 * 這是「橫幅要多明顯」的第二個調整鈕（第一個在 VersionExpandedPanel 的
 * BANNER_OPACITY / BANNER_SCRIM）。原本是 bg-bg-dark/40，太透，
 * 11–13px 的活動條文字下方直接是機甲立繪，讀不到。
 *
 *   想讓橫幅透出來更多 → 調低（如 bg-bg-dark/50）
 *   想讓文字更清楚     → 調高（如 bg-bg-dark/85，接近不透明）
 */
const SURFACE = 'bg-bg-dark/75'

// 列密度：Phase 1 從 py-1.5 / 15px（實測每列 42px）壓到 py-1 / 14px（約 32px）。
// 原本的預算估固定資訊表 234px，實測是 383px —— 佔掉可用高度的 62%，
// 導致下方的甘特與卡片流只剩 121px。不壓這裡，Phase 1 的卡片流等於看不到。
const TD = 'border border-[#2a3040] px-2 py-1 text-[14px] text-center align-middle text-text-secondary'
const TH = 'border border-[#2a3040] px-2 py-1 text-center align-middle'
const LABEL = 'border border-[#2a3040] px-3 py-1 text-left text-[13px] text-text-dim bg-[#0e1119] whitespace-nowrap'

// ── C-4: VersionInfoRows ───────────────────────────────────────────────────────

function VersionInfoRows({
  upper,
  lower,
  upperCount,
  lowerCount,
  totalWeeks,
  coveredByActivity,
}: {
  upper: PatchHalf
  lower: PatchHalf
  upperCount: number
  lowerCount: number
  totalWeeks: number
  /**
   * 甘特上已經有自選池活動在顯示同一份名單的欄位 —— 這裡就不再重複列出。
   * 名單掛在活動上才對得起檔期；資訊表這兩列是**沒有活動時的退路**
   * （實測 8 個半版本填了名單，其中 7 個的自選池活動還沒合併）。
   */
  coveredByActivity: { pilotU: boolean; pilotL: boolean; mechU: boolean; mechL: boolean }
}) {
  const pilotsU = (upper.pilots ?? []).join('、')
  const pilotsL = (lower.pilots ?? []).join('、')
  const mechsU = (upper.mechs ?? []).join('、')
  const mechsL = (lower.mechs ?? []).join('、')

  const raidNamesU = (upper.armamentRaids ?? []).map(r => r.name).join('、')
  const raidNamesL = (lower.armamentRaids ?? []).map(r => r.name).join('、')
  const weaponsU = (upper.armamentRaids ?? [])
    .filter(r => r.weapons?.length)
    .map(r => r.weapons!.join('/'))
    .join('　')
  const weaponsL = (lower.armamentRaids ?? [])
    .filter(r => r.weapons?.length)
    .map(r => r.weapons!.join('/'))
    .join('　')
  const backpacksU = (upper.armamentRaids ?? [])
    .filter(r => r.backpacks?.length)
    .map(r => `${r.backpacks!.join('/')}`)
    .join('　')
  const backpacksL = (lower.armamentRaids ?? [])
    .filter(r => r.backpacks?.length)
    .map(r => `${r.backpacks!.join('/')}`)
    .join('　')

  const bpPilots = (upper.battlePass?.pilots ?? lower.battlePass?.pilots ?? []).join('、')
  const bpMechs  = (upper.battlePass?.mechs  ?? lower.battlePass?.mechs  ?? []).join('、')

  // 自選池的可選名單。與上面的「機師／機甲」（本期新登場）是兩回事：
  // 這裡是角雕特遣／跨域海運「這一期可以換誰」，多半是舊角色。
  // 走 halfRows 而不是像戰令那樣橫跨整版 —— 名單是每半期各自不同的。
  const pilotSelU = coveredByActivity.pilotU ? '' : (upper.pilotSelection ?? []).join('、')
  const pilotSelL = coveredByActivity.pilotL ? '' : (lower.pilotSelection ?? []).join('、')
  const mechSelU  = coveredByActivity.mechU  ? '' : (upper.mechSelection  ?? []).join('、')
  const mechSelL  = coveredByActivity.mechL  ? '' : (lower.mechSelection  ?? []).join('、')

  const halfRows = [
    { label: '機師',    u: pilotsU,    l: pilotsL    },
    { label: '機甲',    u: mechsU,     l: mechsL     },
    { label: '角色自選', u: pilotSelU,  l: pilotSelL,  small: true },
    { label: '機甲自選', u: mechSelU,   l: mechSelL,   small: true },
    { label: '武裝關卡', u: raidNamesU, l: raidNamesL },
    { label: '討伐專武', u: weaponsU,   l: weaponsL   },
    { label: '討伐背包', u: backpacksU, l: backpacksL },
  ].filter(r => r.u || r.l)

  const dash = <span className="opacity-30">—</span>

  return (
    <>
      {halfRows.map(row => (
        <tr key={row.label}>
          <td className={LABEL}>{row.label}</td>
          {/* small：自選名單動輒十幾個名字，用小一級字避免把整張表撐高 */}
          <td colSpan={upperCount} className={`${TD} ${row.small ? 'text-[12px] leading-[1.6]' : ''} bg-[rgba(255,107,43,0.05)]`}>
            {row.u || dash}
          </td>
          <td colSpan={lowerCount} className={`${TD} ${row.small ? 'text-[12px] leading-[1.6]' : ''} bg-[rgba(6,182,212,0.05)]`}>
            {row.l || dash}
          </td>
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
 * 摺疊時的濃縮列：只留機師與機甲（實測最常被查的兩項），仍沿用 upper/lower 的
 * colSpan 切分，所以「哪一半有誰」的對照關係不會因為摺疊而消失。
 *
 * 為什麼不連週軸表頭一起收：那條軸是甘特長條的定位基準，也是使用者當初把甘特
 * 放在這裡的理由（對照版本週次）。收掉它，剩下的甘特就失去意義。
 */
function CollapsedSummaryRow({
  upper,
  lower,
  upperCount,
  lowerCount,
}: {
  upper: PatchHalf
  lower: PatchHalf
  upperCount: number
  lowerCount: number
}) {
  const summarize = (h: PatchHalf) =>
    [(h.pilots ?? []).join('、'), (h.mechs ?? []).join('、')].filter(Boolean).join('　·　')

  const u = summarize(upper)
  const l = summarize(lower)
  if (!u && !l) return null

  const dash = <span className="opacity-30">—</span>

  return (
    <tr>
      <td className={`${LABEL} text-[12px]`}>機師 · 機甲</td>
      <td colSpan={upperCount} className={`${TD} text-[13px] bg-[rgba(255,107,43,0.05)]`}>
        {u || dash}
      </td>
      <td colSpan={lowerCount} className={`${TD} text-[13px] bg-[rgba(6,182,212,0.05)]`}>
        {l || dash}
      </td>
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

  if (chips.length === 0 && !version.notes) return null

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
      {version.notes && (
        <div className={`rounded-lg border border-border ${SURFACE} px-3 py-1`}>
          <PatchInfoRow icon="📝" label="備註" items={[version.notes]} color="blue" size="sm" />
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
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

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

  const { allWeeks, upperCount, lowerCount, items, upperStartStr, lowerStartStr, coveredByActivity } =
    useMemo(() => {
      const upperStartStr =
        side === 'tw' ? (version.upper.twDate ?? '') : version.upper.cnDate
      const lowerStartStr =
        side === 'tw' ? (version.lower.twDate ?? '') : version.lower.cnDate

      // legacy shim：新欄位缺席時，把 deprecated 欄位翻譯成 TimedActivity，
      // 否則靜態 fallback 資料（v2.8–v3.3）在 Worker 掛掉時會顯示成空甘特
      const upperActs = activitiesOfHalf(version.upper, side, halfSpan(upperStartStr, lowerStartStr))
      const lowerActs = activitiesOfHalf(version.lower, side, halfSpan(lowerStartStr, null))

      // 上半的邊界是下半的開始日（實際日期，最可靠）；缺下半日期時退回 weeks／慣例。
      // 下半沒有「下一段」可用（下個版本不在這個元件的視野內），故走 weeks／慣例。
      // 兩者都不再被活動撐長 —— 跨版本的長條在軸尾切平，見 generateWeeks 的說明。
      const upperWeeks = upperStartStr
        ? generateWeeks(upperStartStr, lowerStartStr || null, version.upper.weeks)
        : []
      const lowerWeeks = lowerStartStr
        ? generateWeeks(lowerStartStr, null, version.lower.weeks)
        : []
      const allWeeks = [...upperWeeks, ...lowerWeeks]

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

      // 穩定 key：優先用 act.id（Phase 1 新欄位），未填時退回「半段+序號+名稱」。
      // 純 index 會在陣列重排時讓選取狀態跳到別的活動身上。
      const items: KeyedActivity[] = [
        ...upperActs.map((act, i) => ({
          key: act.id ?? `u${i}:${act.name}:${act.startDate}`,
          act,
          rerun: rerunOf(act, version.upper),
          selection: selectionOf(act, version.upper),
        })),
        ...lowerActs.map((act, i) => ({
          key: act.id ?? `l${i}:${act.name}:${act.startDate}`,
          act,
          rerun: rerunOf(act, version.lower),
          selection: selectionOf(act, version.lower),
        })),
      ]

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
        const prevUpperStart = side === 'tw' ? (prevVersion.upper.twDate ?? '') : prevVersion.upper.cnDate
        const prevLowerStart = side === 'tw' ? (prevVersion.lower.twDate ?? '') : prevVersion.lower.cnDate
        // 保留「來自哪一半」—— 復刻判定要用該活動**原本那一版那一半**的新增名單，
        // 拿當前版本的名單去比會全部誤判成復刻（本版的新機師當然不在上一版名單裡）
        const prevActs: { act: VisibleActivity; half: PatchHalf }[] = [
          ...activitiesOfHalf(prevVersion.upper, side, halfSpan(prevUpperStart, prevLowerStart))
            .map(act => ({ act, half: prevVersion.upper })),
          ...activitiesOfHalf(prevVersion.lower, side, halfSpan(prevLowerStart, upperStartStr || null))
            .map(act => ({ act, half: prevVersion.lower })),
        ]
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
      const coveredByActivity = {
        pilotU: covers(upperActs, 'pilotMission'),
        pilotL: covers(lowerActs, 'pilotMission'),
        mechU: covers(upperActs, 'crossShipping'),
        mechL: covers(lowerActs, 'crossShipping'),
      }

      return {
        allWeeks,
        upperCount: upperWeeks.length,
        lowerCount: lowerWeeks.length,
        items,
        upperStartStr,
        lowerStartStr,
        coveredByActivity,
      }
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

  const upperLabel = upperStartStr ? fmtShort(parseDate(upperStartStr)) : '—'
  const lowerLabel = lowerStartStr ? fmtShort(parseDate(lowerStartStr)) : '—'

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
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 共用橫向捲動容器：讓兩個表格欄位寬度對齊、同步橫向捲動 */}
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
                  {upperCount > 0 && (
                    <th
                      colSpan={upperCount}
                      className={`${TH} bg-[rgba(255,107,43,0.08)] text-accent-orange text-[14px] font-[Orbitron,sans-serif] tracking-wide py-2`}
                    >
                      上半版本
                      <span className="ml-1.5 text-[12px] opacity-70">{upperLabel}～</span>
                    </th>
                  )}
                  {lowerCount > 0 && (
                    <th
                      colSpan={lowerCount}
                      className={`${TH} bg-[rgba(6,182,212,0.08)] text-accent-cyan text-[14px] font-[Orbitron,sans-serif] tracking-wide py-2`}
                    >
                      下半版本
                      <span className="ml-1.5 text-[12px] opacity-70">{lowerLabel}～</span>
                    </th>
                  )}
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
                          : i < upperCount ? 'bg-[#151a24]' : 'bg-[#0e1820]'
                      }`}
                    >
                      <div className={i < upperCount ? 'text-accent-orange/70' : 'text-accent-cyan/70'}>
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
                    <CollapsedSummaryRow
                      upper={version.upper}
                      lower={version.lower}
                      upperCount={upperCount}
                      lowerCount={lowerCount}
                    />
                  ) : (
                    <VersionInfoRows
                      upper={version.upper}
                      lower={version.lower}
                      upperCount={upperCount}
                      lowerCount={lowerCount}
                      totalWeeks={totalWeeks}
                      coveredByActivity={coveredByActivity}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* ── 版本層級補充資訊（商店 / 危境重構 / 記憶風暴 / 備註）── */}
          {!infoCollapsed && <VersionExtras version={version} />}

          {/* ── 容器 2：甘特索引層 + 卡片內容層（同一個捲動容器，往下捲即銜接）── */}
          <div className={`mt-2 flex-1 min-h-0 rounded-lg border border-border ${SURFACE} overflow-y-auto overflow-x-hidden overscroll-contain`}>
            <div className="relative">
              {/* 共用軸線層：週格線 / 上下半分界 / 今日線 */}
              <GanttAxisOverlay
                allWeeks={allWeeks}
                upperCount={upperCount}
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

            <ActivityCardFlow
              items={items}
              selectedKey={activeKey}
              onSelect={handleSelect}
              onHover={setHoveredKey}
              registerRef={registerRef}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
