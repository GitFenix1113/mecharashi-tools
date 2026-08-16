import { useCallback, useMemo, useRef, useState } from 'react'
import type { PatchVersion, PatchHalf, TimedActivity } from '../../data/patchVersions/types'
import { activitiesOfHalf } from '../../data/patchVersions/legacyActivities'
import PatchInfoRow from './PatchInfoRow'
import ActivityBar from './ActivityBar'
import ActivityCardFlow, { type KeyedActivity } from './ActivityCardFlow'
import GanttAxisOverlay from './GanttAxisOverlay'
import { activityTone } from './activityTypeRegistry'
// 日期工具與長條幾何集中在 ganttGeometry，避免與長條計算各有一份 parseDate 而漂移
import { parseDate, addDays, activityGeometry } from './ganttGeometry'

// ── Date utils ─────────────────────────────────────────────────────────────────

function fmtShort(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// ── C-1: 週軸計算 ──────────────────────────────────────────────────────────────

function generateWeeks(
  startStr: string,
  endStr: string | null,
  acts: TimedActivity[],
  minWeeks = 3,
): Date[] {
  if (!startStr) return []
  const start = parseDate(startStr)
  const minEnd = addDays(start, minWeeks * 7)
  let end = endStr ? parseDate(endStr) : minEnd
  if (end < minEnd) end = minEnd

  for (const act of acts) {
    const actEnd = addDays(parseDate(act.startDate), act.weeks * 7)
    if (actEnd > end) end = actEnd
  }

  const weeks: Date[] = []
  let cur = start
  while (cur < end) {
    weeks.push(cur)
    cur = addDays(cur, 7)
  }
  return weeks
}

/** 一段半版本的近似跨度，供 legacy shim 把舊欄位翻譯成 TimedActivity */
function halfSpan(startStr: string, endStr: string | null): { startDate: string; weeks: number } | null {
  if (!startStr) return null
  const start = parseDate(startStr)
  const end = endStr ? parseDate(endStr) : addDays(start, 21)
  const weeks = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 86400000)))
  return { startDate: startStr, weeks }
}

// ── CSS 常數 ──────────────────────────────────────────────────────────────────

const LABEL_COL_PX = 110

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
}: {
  upper: PatchHalf
  lower: PatchHalf
  upperCount: number
  lowerCount: number
  totalWeeks: number
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

  const halfRows = [
    { label: '機師',    u: pilotsU,    l: pilotsL    },
    { label: '機甲',    u: mechsU,     l: mechsL     },
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
          <td colSpan={upperCount} className={`${TD} bg-[rgba(255,107,43,0.05)]`}>
            {row.u || dash}
          </td>
          <td colSpan={lowerCount} className={`${TD} bg-[rgba(6,182,212,0.05)]`}>
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
  const { key, act } = item
  const geom = activityGeometry(act, allWeeks)
  const tone = activityTone(act.type, act.typeLabel)
  const selected = selectedKey === key

  return (
    <tr>
      <td className="border-r border-[#2a3040] px-3 py-0 text-left text-[13px] text-text-dim bg-[#0e1119] whitespace-nowrap">
        <span className={tone.text}>{tone.label}</span>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-bg-dark/40 px-3 py-1">
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
        <div className="rounded-lg border border-border bg-bg-dark/40 px-3 py-1">
          <PatchInfoRow icon="📝" label="備註" items={[version.notes]} color="blue" size="sm" />
        </div>
      )}
    </div>
  )
}

// ── C-2: Main — VersionGanttPanel ─────────────────────────────────────────────

export default function VersionGanttPanel({
  version,
  side = 'tw',
}: {
  version: PatchVersion
  side?: 'tw' | 'cn'
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  const registerRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(key, el)
    else cardRefs.current.delete(key)
  }, [])

  const { allWeeks, upperCount, lowerCount, items, upperStartStr, lowerStartStr } =
    useMemo(() => {
      const upperStartStr =
        side === 'tw' ? (version.upper.twDate ?? '') : version.upper.cnDate
      const lowerStartStr =
        side === 'tw' ? (version.lower.twDate ?? '') : version.lower.cnDate

      // legacy shim：新欄位缺席時，把 deprecated 欄位翻譯成 TimedActivity，
      // 否則靜態 fallback 資料（v2.8–v3.3）在 Worker 掛掉時會顯示成空甘特
      const upperActs = activitiesOfHalf(version.upper, side, halfSpan(upperStartStr, lowerStartStr))
      const lowerActs = activitiesOfHalf(version.lower, side, halfSpan(lowerStartStr, null))

      // Upper half ends at lowerStart (natural boundary — activities may span across)
      const upperWeeks =
        upperStartStr && lowerStartStr
          ? generateWeeks(upperStartStr, lowerStartStr, [])
          : []
      const lowerWeeks = lowerStartStr
        ? generateWeeks(lowerStartStr, null, lowerActs)
        : []
      const allWeeks = [...upperWeeks, ...lowerWeeks]

      // 穩定 key：優先用 act.id（Phase 1 新欄位），未填時退回「半段+序號+名稱」。
      // 純 index 會在陣列重排時讓選取狀態跳到別的活動身上。
      const items: KeyedActivity[] = [
        ...upperActs.map((act, i) => ({ key: act.id ?? `u${i}:${act.name}:${act.startDate}`, act })),
        ...lowerActs.map((act, i) => ({ key: act.id ?? `l${i}:${act.name}:${act.startDate}`, act })),
      ]

      return {
        allWeeks,
        upperCount: upperWeeks.length,
        lowerCount: lowerWeeks.length,
        items,
        upperStartStr,
        lowerStartStr,
      }
    }, [side, version])

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
          <div className="shrink-0 rounded-lg border border-border bg-bg-dark/40 overflow-hidden">
            <table className="border-collapse text-[13px] w-full" style={{ tableLayout: 'fixed' }}>
              <Colgroup />
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className={`${LABEL} text-[13px] text-center tracking-[2px] uppercase text-text-dim`}
                  >
                    {side === 'tw' ? '台版' : '陸版'}
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
                  <VersionInfoRows
                    upper={version.upper}
                    lower={version.lower}
                    upperCount={upperCount}
                    lowerCount={lowerCount}
                    totalWeeks={totalWeeks}
                  />
                )}
              </tbody>
            </table>
          </div>

          {/* ── 版本層級補充資訊（商店 / 危境重構 / 記憶風暴 / 備註）── */}
          <VersionExtras version={version} />

          {/* ── 容器 2：甘特索引層 + 卡片內容層（同一個捲動容器，往下捲即銜接）── */}
          <div className="mt-2 flex-1 min-h-0 rounded-lg border border-border bg-bg-dark/40 overflow-y-auto overflow-x-hidden overscroll-contain">
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
