import { Fragment, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { PatchVersion } from '../../data/patchVersions'
import { parseEntityIdValue } from '../../data/patchVersions/entityRef'
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

// ── Thumbnail shapes ──────────────────────────────────────────────────────────

type ThumbVariant = 'default' | 'wide' | 'badge'

/**
 * 縮圖的形狀**依素材比例而定**，不是全部塞進同一個方框。
 *
 * 機師 / 武器 / 背包的素材都是 340×340（1:1），機甲的 `portrait.webp` 是 560×340
 * （1.65:1）—— 過去四類共用 `w-12 h-12 object-cover`，機甲等於左右各被裁掉 33%，
 * 只剩機體中段。同一列裡機師是一張完整的臉、機甲卻認不出是哪台，那就是使用者說的
 * 「圖片排版不一致，看著有點辛苦」。
 *
 *   default … 1:1 素材。`object-top` 是為了人臉（臉在圖的上半）。
 *   wide …… 機甲專用，94×57 貼合 1.65:1 原比例；用 contain 而非 cover，
 *            日後若混進非 1.65 的機甲素材也不會被裁。
 *   badge … 武裝生產格裡「這把武器屬於誰」的角標，疊在武器縮圖右下角。
 *            邊框用底色而非邊框色：它要從下面那張圖上「浮起來」。
 */
/**
 * 沒有圖時的文字樣式。**裸文字不行**：同一格裡兩個項目（「修補者背包 迷蹤者背包」）
 * 只靠一個空白分隔，讀起來是一串字而不是兩個東西；而它旁邊的格子全是有邊界的縮圖，
 * 文字格因此看起來像資料缺失，而不是「已建檔、素材還沒到」。
 *
 * 晶片給它三件事：邊界（這是一個項目）、內距（與相鄰項目分得開）、底色（有實體感）。
 * 預測值沿用 cyan，連邊框一起換 —— 顏色是這張表既有的語彙，不另外發明。
 */
const textChipClass = (isPredicted: boolean) =>
  `inline-flex items-center rounded-md border px-2 py-1 text-[13px] leading-tight whitespace-nowrap ${
    isPredicted
      ? 'border-accent-cyan/30 bg-accent-cyan/5 text-accent-cyan'
      : 'border-border bg-bg-card/40 text-text-secondary'
  }`

const THUMB_CLASS: Record<ThumbVariant, string> = {
  default: 'w-12 h-12 object-cover object-top rounded-md border border-border',
  wide:    'w-20 h-12 object-contain rounded-md border border-border',
  badge:   'w-6 h-6 object-cover object-top rounded-full border-2 border-bg-dark',
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
function RefThumbnail({ name, lookup, isPredicted, variant = 'default', chip = true }: {
  name: string; lookup?: EntityLookup; isPredicted: boolean; variant?: ThumbVariant
  /** false：不套晶片外殼，由呼叫端自己包（武器＋機師要包成同一個晶片） */
  chip?: boolean
}) {
  const [broken, setBroken] = useState(false)
  const { hoverRef, leaveRef, pinRef } = useReference()

  const imageUrl = lookup?.icons.get(name)
  const rawId    = lookup?.ids.get(name)
  const showImage = !!imageUrl && !broken

  const inner = showImage ? (
    <img
      src={resolveIconSrc(imageUrl)}
      alt={name}
      className={`${THUMB_CLASS[variant]} group-hover:border-accent-orange transition-colors`}
      onError={() => setBroken(true)}
    />
  ) : (
    <span className={chip
      ? textChipClass(isPredicted)
      : `text-[13px] leading-tight whitespace-nowrap ${isPredicted ? 'text-accent-cyan' : 'text-text-secondary'}`}>
      {name}
    </span>
  )

  if (!rawId || !lookup) {
    return showImage
      ? <span className="inline-flex shrink-0" title={name}>{inner}</span>
      : inner
  }

  // 值可能帶 refType 前綴：背包列的複合武器實體在 weapons 集合（見 entityRef.ts）
  const entity: EntityRef = parseEntityIdValue(rawId, lookup.refType)
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
  if (!items.length) return <span className="text-text-dim/30 text-sm">—</span>
  // 機甲一律走寬幅：這裡判斷 refType 而不是由呼叫端各自傳，否則「機甲戰令」那種
  // 走 Cell 的列遲早會漏掉一處，變成同一張表裡機甲有兩種形狀
  const variant: ThumbVariant = lookup?.refType === 'mech' ? 'wide' : 'default'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((name, i) => (
        <RefThumbnail key={i} name={name} lookup={lookup} isPredicted={isPredicted} variant={variant} />
      ))}
    </div>
  )
}

function TextList({ items, isPredicted }: { items: string[]; isPredicted: boolean }) {
  if (!items.length) return <span className="text-text-dim/30 text-sm">—</span>
  // 與 RefThumbnail 的無圖分支用同一個晶片：同一張表裡不該有兩種「文字項目」的長相。
  // 這裡的項目沒有實體引用（邊境商店／鬥技場只是名稱＋日期），所以不可點，但外觀一致。
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item, i) => (
        <span key={i} className={textChipClass(isPredicted)}>{item}</span>
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
      <td className={`px-2.5 py-1.5 border-r border-r-border-subtle border-b border-b-border align-middle ${bg}`}>
        <ThumbnailList items={left} isPredicted={isPredicted} lookup={lookupLeft} />
      </td>
      <td className={`px-2.5 py-1.5 border-r border-r-border-accent border-b border-b-border align-middle ${bg}`}>
        <ThumbnailList items={right} isPredicted={isPredicted} lookup={lookupRight} />
      </td>
    </>
  )
}

// ── Normal cell (colSpan=2) ───────────────────────────────────────────────────

function Cell({ items, isPredicted, isCurrent, lookup }: {
  items: string[]; isPredicted: boolean; isCurrent: boolean; lookup?: EntityLookup
}) {
  const base = `px-3 py-1.5 border-r border-r-border-accent border-b border-b-border align-middle ${isCurrent ? 'bg-accent-green/5' : ''}`
  if (!items.length) return <td colSpan={2} className={`${base} text-center text-text-dim/30 text-sm`}>—</td>
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
    return <td colSpan={2} className={`px-3 py-1.5 border-r border-r-border-accent border-b border-b-border align-middle text-center text-text-dim/30 text-sm ${bg}`}>—</td>
  }
  return (
    <td colSpan={2} className={`px-2.5 py-2 border-r border-r-border-accent border-b border-b-border align-middle ${bg}`}>
      {/* gap 從 1.5(6px) 拉到 3(12px)：角標本身向外突出 4px，組間距若不拉開，
          相鄰兩組會黏成一片，鄰近律就白費了 */}
      <div className="flex flex-wrap items-center gap-3">
        {pairs.map((pair, i) => (
          <WeaponPilotBadge
            key={i}
            pair={pair}
            isPredicted={isPredicted}
            weaponLookup={weaponLookup}
            pilotLookup={pilotLookup}
          />
        ))}
      </div>
    </td>
  )
}

/**
 * 一把武器與它的持有機師。
 *
 * 從屬關係用**大小差**表達：大的是主體（武器），小的掛在右下角是註記（誰用的）——
 * 這是遊戲 UI 表達「持有者」的通用語彙。舊版把兩張 57px 的圖上下堆疊、外面套一個
 * `border/30` 的框，讀起來是「兩個並列的東西」而不是一組，而且讓武裝生產列高達 151px
 * （其他列多是 72px），整張表因此多出一條只能捲 29px 的捲軸。
 *
 * 三種情況分開處理，因為**縮圖與文字不能混著疊**：
 *
 *   武器有圖 ＋ 機師有圖 → 角標式
 *   武器有圖 ＋ 機師無圖 → 武器縮圖下掛機師名（資訊不能因為沒素材就消失）
 *   武器無圖（不分機師）  → 整組退回文字並排；沒有主體可以掛，角標會變成浮在半空的頭像
 */
function WeaponPilotBadge({ pair, isPredicted, weaponLookup, pilotLookup }: {
  pair: WeaponPilotPair
  isPredicted: boolean
  weaponLookup?: EntityLookup
  pilotLookup?: EntityLookup
}) {
  const hasWeaponIcon = !!weaponLookup?.icons.get(pair.weapon)
  const hasPilotIcon  = !!pair.pilot && !!pilotLookup?.icons.get(pair.pilot)

  if (!hasWeaponIcon) {
    // 兩者包在**同一個**晶片裡：拆成兩個晶片的話，「征伐」與「奧德利」看起來就是
    // 兩個並列的項目，而不是一把武器和它的持有者 —— 與角標式要表達的是同一件事
    return (
      <span className={`${textChipClass(isPredicted)} gap-1.5 shrink-0`}>
        <RefThumbnail name={pair.weapon} lookup={weaponLookup} isPredicted={isPredicted} chip={false} />
        {pair.pilot && (
          <>
            <span className="text-text-dim/50 text-[11px]">▸</span>
            <span className="text-[12px] text-text-dim">
              <RefThumbnail name={pair.pilot} lookup={pilotLookup} isPredicted={isPredicted} chip={false} />
            </span>
          </>
        )}
      </span>
    )
  }

  const weapon = (
    <span className="relative inline-flex shrink-0">
      <RefThumbnail name={pair.weapon} lookup={weaponLookup} isPredicted={isPredicted} />
      {hasPilotIcon && (
        <span className="absolute -right-1 -bottom-1 inline-flex leading-none">
          <RefThumbnail name={pair.pilot!} lookup={pilotLookup} isPredicted={isPredicted} variant="badge" />
        </span>
      )}
    </span>
  )

  if (pair.pilot && !hasPilotIcon) {
    return (
      <span className="inline-flex flex-col items-center gap-0.5 shrink-0">
        {weapon}
        <RefThumbnail name={pair.pilot} lookup={pilotLookup} isPredicted={isPredicted} />
      </span>
    )
  }
  return weapon
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

  // 底色從 bg-bg-dark/10 提到 /90：這張表過去只是首頁面板裡的一個分頁，背景立繪被
  // 面板寬度擋掉大半；獨立成頁滿寬之後，整片高彩度的立繪就直接透到 11–13px 的欄位
  // 文字下方（實測 v3.4 那一欄整片泛紅）。與 PLAN-050 C-3 拿掉甘特三顆透明度旋鈕
  // 是同一個判斷：資料的底不該是一張亮度不受控的圖。
  return (
    <div ref={containerRef} className="bg-bg-dark/90 rounded-2xl px-4 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2">
        {/*
          區塊標題的字級：原本是 11px 的「眉標」（eyebrow）樣式 —— 那是它還只是首頁面板裡
          一個分頁時的定位。獨立成頁之後它就是**頁面標題**，用 18px。
          `uppercase` 一併拿掉：中文沒有大小寫，那個 class 在這裡從來沒有作用。
        */}
        <span className="text-[18px] font-bold tracking-[2px] text-accent-orange font-[Orbitron,sans-serif]">
          版本速覽
        </span>
        <span className="text-[11px] text-text-dim shrink-0">
          <span className="text-accent-cyan">■</span> 預測值
          <span className="ml-1.5 text-accent-green">■</span> 台服當前
        </span>
        {loading && <span className="text-[9px] text-text-dim animate-pulse">同步中…</span>}
        <div className="h-px flex-1 bg-border" />
        <button
          onClick={handleExport}
          disabled={exporting}
          title="輸出圖片"
          className="text-[11px] font-[Orbitron,sans-serif] tracking-wider text-text-dim hover:text-accent-orange transition-colors disabled:opacity-40 cursor-pointer select-none shrink-0"
        >
          {exporting ? '輸出中…' : '↓ 輸出圖片'}
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-accent-yellow mb-2">⚠ 無法連線 Firestore，顯示本地資料</p>
      )}

      <div ref={scrollWrapRef} className="overflow-x-auto rounded-xl border border-border-accent">
        <table className="w-full border-collapse text-sm" style={{ minWidth: '880px' }}>
          <thead>
            {/* Row 1: 類別 (rowSpan=2) + version headers (colSpan=2 each) */}
            <tr className="border-b border-border-accent">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-bg-dark px-3 py-2.5 text-left text-[11px] font-bold tracking-[2px] text-accent-orange uppercase font-[Orbitron,sans-serif] border-r border-border-accent whitespace-nowrap w-24 align-middle"
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
                    className={`px-3 py-2.5 text-center border-r border-border-accent whitespace-nowrap ${
                      isCurrent ? 'bg-accent-green/8 text-accent-green' : isPredicted ? 'text-accent-cyan' : 'text-text-secondary'
                    }`}
                  >
                    {/* 版本號與日期同一行：分兩行會讓表頭多吃 22px，而這張表要在 1080p
                        不捲動就得把每一列的垂直預算都算到底（見下方 py-1.5 的說明）。 */}
                    <div className="flex items-baseline justify-center gap-1.5 whitespace-nowrap">
                      <span className="text-[15px] font-bold font-[Orbitron,sans-serif] tracking-wide">
                        v{v.version}{isCurrent ? ' ★' : ''}
                      </span>
                      <span className="text-[11px] font-normal opacity-70">{twDate}</span>
                    </div>
                  </th>
                )
              })}
            </tr>
            {/* Row 2: 機師 / 機甲 sub-headers */}
            <tr className="border-b border-border-accent">
              {displayVersions.map(v => {
                const isCurrent = v.isTwCurrent
                const bg = isCurrent ? 'bg-accent-green/5' : ''
                return (
                  <Fragment key={v.version}>
                    <th className={`px-2 py-1 text-center text-[11px] text-text-dim font-normal border-r border-border-subtle ${bg}`}>
                      機師
                    </th>
                    <th className={`px-2 py-1 text-center text-[11px] text-text-dim font-normal border-r border-border-accent ${bg}`}>
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
                <td className="sticky left-0 z-10 bg-bg-dark px-3 py-1.5 text-[14px] text-text-dim font-medium border-r border-r-border-accent border-b border-b-border whitespace-nowrap align-middle">
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
