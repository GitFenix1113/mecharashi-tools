import { Fragment, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { PatchVersion } from '../../data/patchVersions'
import type { EntityRef, RefType } from '../../types'
import { useReference } from '../../contexts/ReferenceContext'
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

const LOOKUP_KEYS = ['pilots', 'mechs', 'weapons', 'backpacks'] as const
type LookupKey = typeof LOOKUP_KEYS[number]

const REF_TYPE_OF: Record<LookupKey, RefType> = {
  pilots: 'pilot', mechs: 'mech', weapons: 'weapon', backpacks: 'backpack',
}

/**
 * 一個類別的查表資料。圖與 ID **刻意分成兩張表**：資料常是先建檔、圖片素材晚幾天才處理好，
 * 兩者必須能各自缺席（見 patchVersions/types.ts 的 VersionEntityIds）。
 */
interface EntityLookup {
  refType: RefType
  icons: Map<string, string>
  ids: Map<string, string>
}

// ── RefThumbnail ──────────────────────────────────────────────────────────────

/**
 * 版本表格內的單一實體。**可不可點與顯不顯示圖是兩條獨立的軸**：
 *
 *   有 ID + 有圖 → 圖，可點            有 ID + 無圖 → 文字，仍可點（素材還沒處理好）
 *   無 ID + 有圖 → 圖，不可點（名稱與資料庫漂移）   無 ID + 無圖 → 純文字（尚未建檔，前瞻版本常態）
 *
 * 若把互動綁在 <img> 上，「武器先建檔、素材後到」就會整段點不了——那是最需要導流的時候。
 * 圖片 404（路徑寫了但檔案沒進版控）走同一條退路，退成可點的文字而不是失去互動。
 *
 * 詳情本身不自己畫：交給 PLAN-019 的引用浮窗（EntityRefView），它已能解析
 * pilot / mech / weapon / backpack，有詳情頁的給「查看完整詳情」按鈕、沒有的就展開卡片，
 * 且資料是點開才 ensureLoaded——首頁掛載時不會多讀任何集合。
 */
function RefThumbnail({ name, lookup, isPredicted }: {
  name: string; lookup?: EntityLookup; isPredicted: boolean
}) {
  const [broken, setBroken] = useState(false)
  const { hoverRef, leaveRef, pinRef } = useReference()

  const imageUrl = lookup?.icons.get(name)
  const refId    = lookup?.ids.get(name)
  const showImage = !!imageUrl && !broken

  const inner = showImage ? (
    <img
      src={resolveIconSrc(imageUrl)}
      alt={name}
      className="w-9 h-9 object-cover object-top rounded border border-border/50 group-hover:border-accent-orange transition-colors"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className={`text-[13px] leading-tight whitespace-nowrap ${isPredicted ? 'text-accent-cyan' : 'text-text-secondary'}`}>
      {name}
    </span>
  )

  if (!refId || !lookup) {
    return showImage
      ? <span className="inline-flex shrink-0" title={name}>{inner}</span>
      : inner
  }

  const entity: EntityRef = { refType: lookup.refType, refId }
  return (
    <button
      type="button"
      title={`查看「${name}」`}
      onMouseEnter={e => hoverRef(entity, e.currentTarget)}
      onMouseLeave={leaveRef}
      onClick={e => { e.stopPropagation(); pinRef(entity, e.currentTarget) }}
      // bg/border/p 明寫歸零：輸出 PNG 走 html-to-image，它讀的是 computed style，
      // 預設按鈕外觀若殘留會直接烙進圖裡。
      className={
        'bg-transparent border-0 p-0 cursor-pointer '
        + (showImage
          ? 'group inline-flex shrink-0 align-middle'
          : 'inline underline underline-offset-2 decoration-dotted hover:brightness-125 transition-[filter]')
      }
    >
      {inner}
    </button>
  )
}

// ── Item lists ────────────────────────────────────────────────────────────────

function ThumbnailList({ items, isPredicted, lookup }: {
  items: string[]; isPredicted: boolean; lookup?: EntityLookup
}) {
  if (!items.length) return <span className="text-text-dim/30 text-xs">—</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((name, i) => (
        <RefThumbnail key={i} name={name} lookup={lookup} isPredicted={isPredicted} />
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
  lookupLeft?: EntityLookup; lookupRight?: EntityLookup;
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
  items: string[]; isPredicted: boolean; isCurrent: boolean; lookup?: EntityLookup
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
  weaponLookup?: EntityLookup
  pilotLookup?: EntityLookup
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
              <RefThumbnail name={pair.weapon} lookup={weaponLookup} isPredicted={isPredicted} />
            </div>
            {pair.pilot && (
              <>
                <div className="border-t border-border/25" />
                <div className="px-1.5 py-1 flex items-center justify-center">
                  <RefThumbnail name={pair.pilot} lookup={pilotLookup} isPredicted={isPredicted} />
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

  const lookups = useMemo<Record<LookupKey, EntityLookup>>(() => {
    const icons: Record<LookupKey, Record<string, string>> = { pilots: {}, mechs: {}, weapons: {}, backpacks: {} }
    const ids:   Record<LookupKey, Record<string, string>> = { pilots: {}, mechs: {}, weapons: {}, backpacks: {} }
    for (const v of displayVersions) {
      for (const key of LOOKUP_KEYS) {
        const u = v.iconUrls?.[key]
        if (u) Object.assign(icons[key], u)
        const e = v.entityIds?.[key]
        if (e) Object.assign(ids[key], e)
      }
    }
    return Object.fromEntries(
      LOOKUP_KEYS.map(key => [key, {
        refType: REF_TYPE_OF[key],
        icons: new Map(Object.entries(icons[key])),
        ids:   new Map(Object.entries(ids[key])),
      }]),
    ) as Record<LookupKey, EntityLookup>
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
