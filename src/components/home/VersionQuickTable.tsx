import { Fragment, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { PatchVersion } from '../../data/patchVersions'
import { resolveIconSrc } from '../../utils/assets'

// ── Data helpers ──────────────────────────────────────────────────────────────


interface WeaponPilotPair {
  weapon: string
  pilot?: string
}

function getArmamentWeaponPairs(v: PatchVersion): WeaponPilotPair[] {
  const results: WeaponPilotPair[] = []
  for (const half of [v.upper, v.lower]) {
    for (const r of half.armamentRaids ?? []) {
      for (let i = 0; i < (r.weapons?.length ?? 0); i++) {
        results.push({ weapon: r.weapons![i], pilot: r.weaponPilots?.[i] || undefined })
      }
    }
  }
  return results
}

function getArmamentBackpacks(v: PatchVersion) {
  const results: string[] = []
  for (const half of [v.upper, v.lower]) {
    for (const r of half.armamentRaids ?? []) {
      if (r.backpacks?.length) results.push(...r.backpacks)
    }
  }
  return results
}

function getBattlePassPilots(v: PatchVersion) {
  const results: string[] = []
  for (const half of [v.upper, v.lower]) {
    if (half.battlePass?.pilots?.length) results.push(...half.battlePass.pilots)
  }
  return results
}

function getBattlePassMechs(v: PatchVersion) {
  const results: string[] = []
  for (const half of [v.upper, v.lower]) {
    if (half.battlePass?.mechs?.length) results.push(...half.battlePass.mechs)
  }
  return results
}

// ── Thumbnail types ───────────────────────────────────────────────────────────

type LookupMap = Map<string, string | undefined>
type LookupKey = 'pilots' | 'mechs' | 'weapons' | 'backpacks'

// ── ThumbnailItem ─────────────────────────────────────────────────────────────

function ThumbnailItem({ name, imageUrl, isPredicted }: {
  name: string; imageUrl?: string; isPredicted: boolean
}) {
  const [broken, setBroken] = useState(false)
  const textEl = (
    <span className={`text-[13px] leading-tight whitespace-nowrap ${isPredicted ? 'text-accent-cyan' : 'text-text-secondary'}`}>
      {name}
    </span>
  )
  if (!imageUrl || broken) return textEl
  return (
    <div className="relative group inline-flex shrink-0">
      <img
        src={resolveIconSrc(imageUrl)}
        alt={name}
        className="w-9 h-9 object-cover object-top rounded border border-border/50 group-hover:border-accent-orange transition-colors cursor-default"
        onError={() => setBroken(true)}
      />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-bg-dark border border-border rounded text-[11px] text-text-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-md">
        {name}
      </div>
    </div>
  )
}

// ── Item lists ────────────────────────────────────────────────────────────────

function ThumbnailList({ items, isPredicted, lookup }: {
  items: string[]; isPredicted: boolean; lookup?: LookupMap
}) {
  if (!items.length) return <span className="text-text-dim/30 text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((name, i) => (
        <ThumbnailItem key={i} name={name} imageUrl={lookup?.get(name)} isPredicted={isPredicted} />
      ))}
    </div>
  )
}

function TextList({ items, isPredicted }: { items: string[]; isPredicted: boolean }) {
  if (!items.length) return <span className="text-text-dim/30 text-xs">—</span>
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => (
        <span key={i} className={`text-[13px] leading-tight whitespace-nowrap ${isPredicted ? 'text-accent-cyan' : 'text-text-secondary'}`}>
          {item}
        </span>
      ))}
    </div>
  )
}

// ── Split cell (機師 | 機甲) ──────────────────────────────────────────────────

function SplitCell({ left, right, isPredicted, isCurrent, lookupLeft, lookupRight }: {
  left: string[]; right: string[]; isPredicted: boolean; isCurrent: boolean;
  lookupLeft?: LookupMap; lookupRight?: LookupMap;
}) {
  const bg = isCurrent ? 'bg-accent-green/5' : ''
  return (
    <>
      <td className={`px-2 py-2 border-r border-b border-border/40 align-middle ${bg}`}>
        <ThumbnailList items={left} isPredicted={isPredicted} lookup={lookupLeft} />
      </td>
      <td className={`px-2 py-2 border-r border-b border-border align-middle ${bg}`}>
        <ThumbnailList items={right} isPredicted={isPredicted} lookup={lookupRight} />
      </td>
    </>
  )
}

// ── Normal cell (colSpan=2) ───────────────────────────────────────────────────

function Cell({ items, isPredicted, isCurrent, lookup }: {
  items: string[]; isPredicted: boolean; isCurrent: boolean; lookup?: LookupMap
}) {
  const base = `px-3 py-2 border-r border-b border-border align-middle ${isCurrent ? 'bg-accent-green/5' : ''}`
  if (!items.length) return <td colSpan={2} className={`${base} text-center text-text-dim/30 text-xs`}>—</td>
  return (
    <td colSpan={2} className={base}>
      {lookup
        ? <ThumbnailList items={items} isPredicted={isPredicted} lookup={lookup} />
        : <TextList items={items} isPredicted={isPredicted} />
      }
    </td>
  )
}

// ── WeaponPilot card cell ─────────────────────────────────────────────────────

function WeaponPilotCell({ pairs, isPredicted, isCurrent, weaponLookup, pilotLookup }: {
  pairs: WeaponPilotPair[]
  isPredicted: boolean
  isCurrent: boolean
  weaponLookup?: LookupMap
  pilotLookup?: LookupMap
}) {
  const bg = isCurrent ? 'bg-accent-green/5' : ''
  if (!pairs.length) {
    return <td colSpan={2} className={`px-3 py-2 border-r border-b border-border align-middle text-center text-text-dim/30 text-xs ${bg}`}>—</td>
  }
  return (
    <td colSpan={2} className={`px-2 py-2 border-r border-b border-border align-top ${bg}`}>
      <div className="flex flex-wrap gap-1.5">
        {pairs.map((pair, i) => (
          <div key={i} className="border border-border/30 rounded-lg shrink-0">
            <div className="px-1.5 py-1 flex items-center justify-center">
              <ThumbnailItem name={pair.weapon} imageUrl={weaponLookup?.get(pair.weapon)} isPredicted={isPredicted} />
            </div>
            {pair.pilot && (
              <>
                <div className="border-t border-border/25" />
                <div className="px-1.5 py-1 flex items-center justify-center">
                  <ThumbnailItem name={pair.pilot} imageUrl={pilotLookup?.get(pair.pilot)} isPredicted={isPredicted} />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </td>
  )
}

// ── Row definitions ───────────────────────────────────────────────────────────

type SplitRow = {
  key: string; label: string; split: true; raid?: never;
  fnLeft: (v: PatchVersion) => string[];
  fnRight: (v: PatchVersion) => string[];
  lookupLeft?: LookupKey;
  lookupRight?: LookupKey;
}
type NormalRow = {
  key: string; label: string; split?: never; raid?: never;
  fn: (v: PatchVersion) => string[];
  lookup?: LookupKey;
}
type RaidRow = {
  key: string; label: string; raid: true; split?: never;
  fn: (v: PatchVersion) => WeaponPilotPair[];
}
type RowDef = SplitRow | NormalRow | RaidRow

const ROW_DEFS: RowDef[] = [
  { key: 'upper',    label: '上半更新', split: true, fnLeft: v => v.upper.pilots ?? [], fnRight: v => v.upper.mechs ?? [], lookupLeft: 'pilots', lookupRight: 'mechs' },
  { key: 'lower',    label: '下半更新', split: true, fnLeft: v => v.lower.pilots ?? [], fnRight: v => v.lower.mechs ?? [], lookupLeft: 'pilots', lookupRight: 'mechs' },
  { key: 'weapons',  label: '武裝生產', raid: true,  fn: getArmamentWeaponPairs },
  { key: 'backpack', label: '背包製作', fn: getArmamentBackpacks, lookup: 'backpacks' },
  { key: 'bpPilot',  label: '角色戰令', fn: getBattlePassPilots,  lookup: 'pilots' },
  { key: 'bpMech',   label: '機甲戰令', fn: getBattlePassMechs,   lookup: 'mechs' },
  { key: 'crisis',   label: '危境商店', fn: v => v.crisisShop ?? [], lookup: 'pilots' },
  { key: 'border',   label: '邊境商店', fn: v => v.borderShop ? [v.borderShop] : [] },
  { key: 'arena',    label: '鬥技場',   fn: v => v.arenaShop  ? [v.arenaShop]  : [] },
]

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  versions: PatchVersion[]
  loading: boolean
  error: Error | null
}

export default function VersionQuickTable({ versions, loading, error }: Props) {
  const currentIdx = versions.findIndex(v => v.isTwCurrent)
  const displayVersions = currentIdx >= 0 ? versions.slice(currentIdx, currentIdx + 5) : versions.slice(0, 5)

  const containerRef  = useRef<HTMLDivElement>(null)
  const scrollWrapRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    if (!containerRef.current || !scrollWrapRef.current) return
    setExporting(true)
    const wrap = scrollWrapRef.current
    const savedOverflow = wrap.style.overflow
    const savedWidth    = wrap.style.width
    try {
      // Expand scroll wrapper so html2canvas sees full table width
      wrap.style.overflow = 'visible'
      wrap.style.width    = `${wrap.scrollWidth}px`
      // Double rAF — wait for browser to reflow after style change
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

      const dataUrl = await toPng(containerRef.current, {
        backgroundColor: '#0a0c10',
        pixelRatio: 2,
        skipFonts: false,
      })

      // Restore scroll wrapper immediately after capture
      wrap.style.overflow = savedOverflow
      wrap.style.width    = savedWidth

      const a = document.createElement('a')
      a.download = 'mecharashi-versions.png'
      a.href = dataUrl
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      console.error('[QuickTable] export error:', err)
      wrap.style.overflow = savedOverflow
      wrap.style.width    = savedWidth
    } finally {
      setExporting(false)
    }
  }

  const lookups = useMemo<Record<LookupKey, LookupMap>>(() => {
    const merged: Record<LookupKey, Record<string, string>> = {
      pilots: {}, mechs: {}, weapons: {}, backpacks: {},
    }
    for (const v of displayVersions) {
      const u = v.iconUrls
      if (!u) continue
      if (u.pilots)    Object.assign(merged.pilots,    u.pilots)
      if (u.mechs)     Object.assign(merged.mechs,     u.mechs)
      if (u.weapons)   Object.assign(merged.weapons,   u.weapons)
      if (u.backpacks) Object.assign(merged.backpacks, u.backpacks)
    }
    return {
      pilots:    new Map(Object.entries(merged.pilots)),
      mechs:     new Map(Object.entries(merged.mechs)),
      weapons:   new Map(Object.entries(merged.weapons)),
      backpacks: new Map(Object.entries(merged.backpacks)),
    }
  }, [displayVersions])

  return (
    <div ref={containerRef} className="bg-bg-dark/10 rounded-2xl p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold tracking-[3px] text-accent-orange uppercase font-[Orbitron,sans-serif]">
          版本濃縮資訊
        </span>
        <span className="text-[10px] text-text-dim shrink-0">
          <span className="text-accent-cyan">■</span> 預測值
          <span className="ml-1.5 text-accent-green">■</span> 台服當前
        </span>
        {loading && <span className="text-[9px] text-text-dim animate-pulse">同步中…</span>}
        <div className="h-px flex-1 bg-border" />
        <button
          onClick={handleExport}
          disabled={exporting}
          title="輸出圖片"
          className="text-[10px] font-[Orbitron,sans-serif] tracking-wider text-text-dim hover:text-accent-orange transition-colors disabled:opacity-40 cursor-pointer select-none shrink-0"
        >
          {exporting ? '輸出中…' : '↓ 輸出圖片'}
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-accent-yellow mb-2">⚠ 無法連線 Firestore，顯示本地資料</p>
      )}

      <div ref={scrollWrapRef} className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm" style={{ minWidth: '720px' }}>
          <thead>
            {/* Row 1: 類別 (rowSpan=2) + version headers (colSpan=2 each) */}
            <tr className="border-b border-border">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-bg-dark px-3 py-2.5 text-left text-[10px] font-bold tracking-[2px] text-accent-orange uppercase font-[Orbitron,sans-serif] border-r border-border whitespace-nowrap w-20 align-middle"
              >
                類別
              </th>
              {displayVersions.map(v => {
                const isCurrent = v.isTwCurrent
                const isPredicted = v.upper.twIsPredicted && !isCurrent
                const twDate = v.upper.twDate?.replace('約 ', '') ?? '—'
                return (
                  <th
                    key={v.version}
                    colSpan={2}
                    className={`px-3 py-2.5 text-center border-r border-border whitespace-nowrap ${
                      isCurrent ? 'bg-accent-green/8 text-accent-green' : isPredicted ? 'text-accent-cyan' : 'text-text-secondary'
                    }`}
                  >
                    <div className="text-[13px] font-bold font-[Orbitron,sans-serif] tracking-wide">
                      v{v.version}{isCurrent ? ' ★' : ''}
                    </div>
                    <div className="text-[11px] font-normal mt-0.5 opacity-70">{twDate}</div>
                  </th>
                )
              })}
            </tr>
            {/* Row 2: 機師 / 機甲 sub-headers */}
            <tr className="border-b border-border">
              {displayVersions.map(v => {
                const isCurrent = v.isTwCurrent
                const bg = isCurrent ? 'bg-accent-green/5' : ''
                return (
                  <Fragment key={v.version}>
                    <th className={`px-2 py-1 text-center text-[10px] text-text-dim font-normal border-r border-border/40 ${bg}`}>
                      機師
                    </th>
                    <th className={`px-2 py-1 text-center text-[10px] text-text-dim font-normal border-r border-border ${bg}`}>
                      機甲
                    </th>
                  </Fragment>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {ROW_DEFS.map((row, rowIdx) => (
              <tr key={row.key} className={rowIdx % 2 === 1 ? 'bg-bg-card/30' : ''}>
                <td className="sticky left-0 z-10 bg-bg-dark px-3 py-2 text-[13px] text-text-dim font-medium border-r border-b border-border whitespace-nowrap align-middle">
                  {row.label}
                </td>
                {displayVersions.map(v => {
                  const isCurrent = v.isTwCurrent ?? false
                  const isPredicted = !isCurrent && !!(v.upper.twIsPredicted || v.lower.twIsPredicted)
                  if (row.split) {
                    return (
                      <SplitCell
                        key={v.version}
                        left={row.fnLeft(v)}
                        right={row.fnRight(v)}
                        isPredicted={isPredicted}
                        isCurrent={isCurrent}
                        lookupLeft={row.lookupLeft ? lookups[row.lookupLeft] : undefined}
                        lookupRight={row.lookupRight ? lookups[row.lookupRight] : undefined}
                      />
                    )
                  }
                  if (row.raid) {
                    return (
                      <WeaponPilotCell
                        key={v.version}
                        pairs={row.fn(v)}
                        isPredicted={isPredicted}
                        isCurrent={isCurrent}
                        weaponLookup={lookups.weapons}
                        pilotLookup={lookups.pilots}
                      />
                    )
                  }
                  return (
                    <Cell
                      key={v.version}
                      items={row.fn(v)}
                      isPredicted={isPredicted}
                      isCurrent={isCurrent}
                      lookup={row.lookup ? lookups[row.lookup] : undefined}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}
