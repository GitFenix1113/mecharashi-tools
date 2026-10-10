import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { assetUrl } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import {
  BACKPACK_ICON_CATEGORIES, ICON_COLOR_FAMILIES, ICON_KIND_LABELS, WEAPON_ICON_CATEGORIES,
  equipGameIdOf, equipIconKey, featureDistance, gameIconCandidates, gameIconPath, iconFeature, parseIconKey,
  type EquipIconFamily, type IconFamily, type IconKind, type ParsedIconKey,
} from '../../utils/gameIcons'
import { buildIconUsage, usageKey, usageSearchText, type IconUser } from '../../utils/iconUsage'
import { useIconUsageData } from '../../hooks/useFirestore'

/**
 * 後台圖示選圖器（PLAN-055 B-1）—— 技能類、BUFF，以及 PLAN-056 起的武器、背包圖示；立繪仍用舊的 IconPicker。
 *
 * 武器／背包分頁（PLAN-056 B-1）：篩選換成「種類前綴（102＝打樁機）× 群組（主序列／變體／機甲綁定／敵方）」，
 * 預設只開主序列——新專武落在既有系列的新變體，挑「未使用＋同種類」就只剩幾張。
 * ⚠ 種類前綴只拿來縮小範圍、不擋選擇：碎狼牙、罪棘律典的官方檔名本身就是交叉的。
 *
 * 官方把分類寫在檔名裡（Icon_skill_<種類>_<色系><批次><流水>），所以這裡用**官方文法**篩：
 *   · 種類＝外框形狀（主動▲／指令■／被動●／天賦◆…）× 色系（首位數）× 使用狀態
 *   · 搜尋同時比對編號、技能名、持有者名稱（「艾達」「崩山」「5227」都可以）
 *   · 預設依流水號倒序：新角色的圖一定落在序列尾端 → 新版本建檔時，「未使用＋最新」就是那十幾張
 *   · 滑過顯示「被誰用」（從已載入的遊戲資料即時算，不另外讀 Firestore）
 * 寫回的值是**裸 key**（官方檔名），不是路徑——路徑由 gameIconPath() 推導。
 *
 * 索引 images/game/icons/index.json 由 scripts/generate-icon-index.mjs 在 build／predev 產生，開啟時才 lazy fetch。
 */

interface IconIndex {
  skill: string[]
  buff: string[]
  /** PLAN-056；舊版索引沒有這兩欄 */
  weapon?: string[]
  backpack?: string[]
  legacy: string[]
  /** 站長確認過的圖示註記（scripts/lib/equipIconNotes.json） */
  notes?: Record<string, string>
  /** 以圖搜圖特徵（features.bin）：每張 dim×dim×3 bytes，順序＝[...skill, ...buff, ...weapon, ...backpack] */
  features?: { dim: number; hash: string }
}

const listOf = (index: IconIndex | null, family: IconFamily): string[] => index?.[family] ?? []

// ── 以圖搜圖（PLAN-055 B-4）────────────────────────────────────────────────────
// 新角色上線、手上只有遊戲截圖時用：貼上截圖 → 跟圖庫每張圖的 12×12 特徵比距離 → 列出最像的幾張。
// 特徵檔只在第一次使用時下載（約 580 KB）；截圖從頭到尾不離開瀏覽器。
// 驗證：站上 40 張中文佔位圖（當初就是截圖裁切）40／40 第一名命中（_local-notes 2026-10-05 B-4）。
let featureCache: Uint8Array | null = null
async function loadIconFeatures(): Promise<Uint8Array> {
  if (featureCache) return featureCache
  const r = await fetch(`${import.meta.env.BASE_URL}images/game/icons/features.bin?v=${__BUILD_ID__}`)
  if (!r.ok) throw new Error(`以圖搜圖特徵載入失敗（${r.status}）`)
  featureCache = new Uint8Array(await r.arrayBuffer())
  return featureCache
}

/** 截圖 → 特徵。超過 256px 的先等比縮小（只影響速度，特徵本來就只有 12×12） */
async function featureOfImage(blob: Blob): Promise<Uint8Array> {
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s))
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('瀏覽器不支援 canvas')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return iconFeature(ctx.getImageData(0, 0, w, h).data, w, h)
}

function ImageSearch({ onResult }: { onResult: (feature: Uint8Array | null, error?: string) => void }) {
  const [over, setOver] = useState(false)
  const take = (blob: Blob | null | undefined) => {
    if (!blob || !blob.type.startsWith('image/')) { onResult(null, '請貼上或選擇圖片'); return }
    featureOfImage(blob).then((f) => onResult(f)).catch((e) => onResult(null, e instanceof Error ? e.message : String(e)))
  }
  // 選圖器開著且在以圖搜圖模式時，Ctrl+V 直接吃剪貼簿裡的圖
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      if (item) { e.preventDefault(); take(item.getAsFile()) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]) }}
      className={`block rounded-lg border border-dashed px-3 py-2.5 text-xs cursor-pointer transition-colors ${
        over ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan' : 'border-border text-text-secondary hover:border-border-accent'
      }`}
    >
      <input type="file" accept="image/*" className="hidden" onChange={(e) => take(e.target.files?.[0])} />
      📷 <b>Ctrl+V 貼上</b>遊戲截圖、拖放或點這裡選檔——請裁到只剩一顆圖示（去背最準）。會在目前的分頁與種類篩選範圍內找最像的 12 張。
    </label>
  )
}

let indexCache: IconIndex | null = null
let indexPromise: Promise<IconIndex> | null = null

function loadIconIndex(): Promise<IconIndex> {
  if (indexCache) return Promise.resolve(indexCache)
  if (!indexPromise) {
    // ?v=__BUILD_ID__：同 manifest.json——網址不變、內容每次匯圖都會變，換 query 才換得掉 CDN 快取
    const url = `${import.meta.env.BASE_URL}images/game/icons/index.json?v=${__BUILD_ID__}`
    indexPromise = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`圖示索引載入失敗（${r.status}）`); return r.json() })
      .then((m: IconIndex) => { indexCache = m; return m })
      .catch((err) => { indexPromise = null; throw err })
  }
  return indexPromise
}

const SKILL_KINDS: IconKind[] = ['main', 'order', 'passive', 'talent', 'pp', 'entry', 'rnd']
const SKILL_OTHER_KINDS = new Set<IconKind>(['command', 'refactoring', 'other'])
const BUFF_KINDS: IconKind[] = ['generic', 'debuff', 'stat', 'status', 'repair', 'unique', 'stack', 'misc']
const WEAPON_KINDS: IconKind[] = ['series', 'variant', 'linked', 'enemy', 'other']
const KINDS_OF: Partial<Record<IconFamily, IconKind[]>> = { skill: [...SKILL_KINDS, 'other'], buff: BUFF_KINDS, weapon: WEAPON_KINDS }
const CATEGORIES_OF: Partial<Record<IconFamily, Record<string, string>>> = { weapon: WEAPON_ICON_CATEGORIES, backpack: BACKPACK_ICON_CATEGORIES }
/** 武器分頁預設只開主序列（敵方 BOSS 裝備、塗裝版、機甲綁定肩部平常用不到） */
const defaultKinds = (family: IconFamily): IconKind[] => (family === 'weapon' ? ['series'] : [])
/** 格子上的短標籤 */
const shortKey = (key: string) => key.replace(/^Icon_(?:skill_|weapon_|backpack_)?/i, '')
type UseFilter = 'all' | 'unused' | 'used'
const MAX_RESULTS = 900

const iconSrc = (key: string) => assetUrl(gameIconPath(key) ?? '')

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full border text-xs whitespace-nowrap transition-colors ${
        on ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/10' : 'border-border text-text-secondary hover:border-border-accent'
      }`}
    >
      {children}
    </button>
  )
}

function UsageList({ users }: { users: IconUser[] | undefined }) {
  if (!users?.length) return <p className="text-xs text-text-dim">尚未被任何資料使用</p>
  return (
    <ul className="space-y-1 text-xs">
      {users.slice(0, 12).map((u) => (
        <li key={`${u.kind}-${u.id}-${u.name}`} className="leading-snug">
          <span className="text-text-dim">{u.kind}・</span>
          <span className="text-text-primary">{u.name}</span>
          {u.owner && <span className="text-text-dim">（{u.owner}）</span>}
        </li>
      ))}
      {users.length > 12 && <li className="text-text-dim">…另 {users.length - 12} 處</li>}
    </ul>
  )
}

function describe(p: ParsedIconKey | null): string {
  if (!p) return ''
  if (p.family === 'weapon' || p.family === 'backpack') {
    const cat = p.category ? CATEGORIES_OF[p.family]?.[p.category] : undefined
    return p.family === 'backpack' ? (cat ? `背包・${cat}` : '背包') : [cat, ICON_KIND_LABELS[p.kind]].filter(Boolean).join('・')
  }
  const kind = ICON_KIND_LABELS[p.kind]
  const color = p.color != null ? ICON_COLOR_FAMILIES.find((c) => c.color === p.color) : undefined
  return color ? `${kind}・${color.label}（${color.hint}）` : kind
}

// ── 挑選器彈窗 ─────────────────────────────────────────────────────────────────
export function GameIconPicker({
  value, library = 'skill', presetKinds, presetCategories, onPick, onClose,
}: {
  value?: string
  /** 開哪個圖庫：技能類（含模組詞條、研發）、BUFF 字形、武器、背包 */
  library?: IconFamily
  /** 開啟時預選的種類（例：編輯被動技能 → ['passive']）；不給＝該圖庫的預設（武器＝主序列，其餘全部） */
  presetKinds?: IconKind[]
  /** 武器／背包：開啟時預選的種類前綴（例：編輯打樁機 → ['102']） */
  presetCategories?: string[]
  onPick: (key: string) => void
  onClose: () => void
}) {
  const [index, setIndex] = useState<IconIndex | null>(indexCache)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<IconFamily>(library)
  const [kinds, setKinds] = useState<Set<IconKind>>(() => {
    if (presetKinds) return new Set(presetKinds)
    // 目前的值不在預設群組裡（例：固定武裝用的是機甲綁定肩部）→ 一併打開，免得一開就看不到自己
    const cur = parseIconKey(usageKey(value))
    const base = defaultKinds(library)
    return new Set(base.length && cur && cur.family === library && !base.includes(cur.kind) ? [...base, cur.kind] : base)
  })
  const [cats, setCats] = useState<Set<string>>(() => new Set(presetCategories ?? []))
  const [colors, setColors] = useState<Set<number>>(new Set())
  const [use, setUse] = useState<UseFilter>('all')
  const [showLegacy, setShowLegacy] = useState(false)
  const [newestFirst, setNewestFirst] = useState(true)
  const [search, setSearch] = useState('')
  const [imageMode, setImageMode] = useState(false)
  const [probe, setProbe] = useState<Uint8Array | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [features, setFeatures] = useState<Uint8Array | null>(featureCache)
  const current = usageKey(value)
  const [focus, setFocus] = useState<string | null>(current ?? null)

  const { data: usageData, loading: usageLoading } = useIconUsageData()
  const usage = useMemo(() => (usageData ? buildIconUsage(usageData) : new Map<string, IconUser[]>()), [usageData])

  useEffect(() => {
    let alive = true
    loadIconIndex()
      .then((m) => { if (alive) setIndex(m) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  const legacy = useMemo(() => new Set(index?.legacy ?? []), [index])
  const parsed = useMemo(() => {
    const m = new Map<string, ParsedIconKey>()
    for (const k of [...listOf(index, 'skill'), ...listOf(index, 'buff'), ...listOf(index, 'weapon'), ...listOf(index, 'backpack')]) {
      const p = parseIconKey(k); if (p) m.set(k, p)
    }
    return m
  }, [index])
  const notes = useMemo(() => index?.notes ?? {}, [index])

  const switchTab = (t: IconFamily) => { setTab(t); setKinds(new Set(defaultKinds(t))); setCats(new Set()); setColors(new Set()) }
  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); apply(n)
  }

  const results = useMemo(() => {
    if (!index) return [] as string[]
    const q = search.trim().toLowerCase()
    const out: string[] = []
    for (const key of listOf(index, tab)) {
      const p = parsed.get(key)
      if (!p) continue
      if (!showLegacy && legacy.has(key) && key !== current) continue
      if (kinds.size) {
        const k = SKILL_OTHER_KINDS.has(p.kind) ? 'other' : p.kind
        if (!kinds.has(k as IconKind)) continue
      }
      if (cats.size && !(p.category && cats.has(p.category))) continue
      if (colors.size && (p.color == null || !colors.has(p.color))) continue
      const used = usage.has(key)
      if (use === 'unused' && used) continue
      if (use === 'used' && !used) continue
      if (q && !key.toLowerCase().includes(q) && !usageSearchText(usage.get(key)).includes(q) && !(notes[key] ?? '').toLowerCase().includes(q)) continue
      out.push(key)
    }
    const num = (k: string) => parsed.get(k)?.num ?? -1
    out.sort((a, b) => (newestFirst ? num(b) - num(a) : num(a) - num(b)) || a.localeCompare(b))
    return out
  }, [index, tab, parsed, legacy, showLegacy, current, kinds, cats, colors, use, usage, search, newestFirst, notes])

  const shown = results.slice(0, MAX_RESULTS)

  // 以圖搜圖：在目前分頁＋種類篩選（＋舊版開關）的範圍內，依特徵距離取前 12 張
  const featureOffset = useMemo(() => {
    const m = new Map<string, number>()
    if (!index?.features) return m
    const per = index.features.dim * index.features.dim * 3
    // 順序與 scripts/generate-icon-index.mjs 的 order 相同
    ;[...listOf(index, 'skill'), ...listOf(index, 'buff'), ...listOf(index, 'weapon'), ...listOf(index, 'backpack')].forEach((k, i) => m.set(k, i * per))
    return m
  }, [index])
  const matches = useMemo(() => {
    if (!probe || !features || !index) return null
    const out: { key: string; d: number }[] = []
    for (const key of listOf(index, tab)) {
      const p = parsed.get(key)
      if (!p || (!showLegacy && legacy.has(key))) continue
      if (kinds.size && !kinds.has((SKILL_OTHER_KINDS.has(p.kind) ? 'other' : p.kind) as IconKind)) continue
      if (cats.size && !(p.category && cats.has(p.category))) continue
      const off = featureOffset.get(key)
      if (off != null && off + probe.length <= features.length) out.push({ key, d: featureDistance(probe, features, off) })
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 12)
  }, [probe, features, index, tab, parsed, showLegacy, legacy, kinds, cats, featureOffset])
  const toggleImageMode = () => {
    setImageMode((v) => !v)
    if (!features) loadIconFeatures().then(setFeatures).catch((e) => setProbeError(e instanceof Error ? e.message : String(e)))
  }
  const focusKey = focus && parsed.has(focus) ? focus : null
  const colorFilterUseful = tab === 'skill' && (!kinds.size || [...kinds].some((k) => ['main', 'order', 'passive', 'talent'].includes(k)))

  // ⚠ 與 IconPicker 同理，必須 portal 到 body（祖先的 transform／filter 會讓 fixed 失準）
  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-bg-card border border-border rounded-xl p-5 w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 shrink-0 gap-3">
          <h3 className="text-base font-bold flex items-center gap-2 flex-wrap">
            <span className="text-accent-orange">🖼️</span> 選取圖示
            <span className="text-text-dim text-xs font-normal">官方圖庫 game/icons · 寫回官方檔名</span>
          </h3>
          <button onClick={onClose} className="text-text-dim hover:text-text-primary text-lg leading-none">✕</button>
        </div>

        {error ? (
          <div className="py-10 text-center text-sm text-accent-red">
            {error}
            <p className="text-text-dim text-xs mt-2">請先執行 <code>npm run index:icons</code> 產生圖示索引。</p>
          </div>
        ) : !index ? (
          <p className="py-10 text-center text-sm text-text-dim">載入圖示索引中…</p>
        ) : (
          <>
            {/* ── 篩選 ── */}
            <div className="space-y-2 mb-3 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                <Chip on={tab === 'skill'} onClick={() => switchTab('skill')}>技能類（{index.skill.length - index.legacy.length}）</Chip>
                <Chip on={tab === 'buff'} onClick={() => switchTab('buff')}>BUFF 字形（{index.buff.length}）</Chip>
                {!!index.weapon?.length && <Chip on={tab === 'weapon'} onClick={() => switchTab('weapon')}>武器（{index.weapon.length}）</Chip>}
                {!!index.backpack?.length && <Chip on={tab === 'backpack'} onClick={() => switchTab('backpack')}>背包（{index.backpack.length}）</Chip>}
                <Chip on={imageMode} onClick={toggleImageMode} title="貼上遊戲截圖，找出最像的官方圖示">📷 以圖搜圖</Chip>
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜尋編號、技能名、機師／武器名、註記…"
                  className="input-field text-sm flex-1 min-w-[200px]"
                />
              </div>
              {KINDS_OF[tab] && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-text-dim w-10 shrink-0">{tab === 'weapon' ? '群組' : '種類'}</span>
                  {KINDS_OF[tab]!.map((k) => (
                    <Chip key={k} on={kinds.has(k)} onClick={() => toggle(kinds, k, setKinds)}>{ICON_KIND_LABELS[k]}</Chip>
                  ))}
                </div>
              )}
              {CATEGORIES_OF[tab] && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-text-dim w-10 shrink-0">種類</span>
                  {Object.entries(CATEGORIES_OF[tab]!).map(([c, label]) => (
                    <Chip key={c} on={cats.has(c)} onClick={() => toggle(cats, c, setCats)} title={`編號前綴 ${c}（只是線索，不擋選擇）`}>{label}</Chip>
                  ))}
                </div>
              )}
              {colorFilterUseful && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-text-dim w-10 shrink-0">色系</span>
                  {ICON_COLOR_FAMILIES.map((c) => (
                    <Chip key={c.color} on={colors.has(c.color)} onClick={() => toggle(colors, c.color, setColors)} title={`${c.color}xxx：${c.hint}（歸納，非官方定義）`}>
                      <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: c.hex }} />
                      {c.label}
                    </Chip>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-text-dim w-10 shrink-0">狀態</span>
                <Chip on={use === 'all'} onClick={() => setUse('all')}>全部</Chip>
                <Chip on={use === 'unused'} onClick={() => setUse('unused')}>未使用</Chip>
                <Chip on={use === 'used'} onClick={() => setUse('used')}>已使用</Chip>
                <Chip on={newestFirst} onClick={() => setNewestFirst((v) => !v)} title="新角色的圖在序列尾端">
                  {newestFirst ? '最新在前' : '最舊在前'}
                </Chip>
                {tab === 'skill' && (
                  <Chip on={showLegacy} onClick={() => setShowLegacy((v) => !v)} title="現行客戶端已沒有的舊版官方圖">
                    顯示舊版（{index.legacy.length}）
                  </Chip>
                )}
                {usageLoading && <span className="text-[11px] text-text-dim">（使用狀況載入中…）</span>}
              </div>
            </div>

            {imageMode && (
              <div className="space-y-2 mb-3 shrink-0">
                <ImageSearch onResult={(f, err) => { setProbe(f); setProbeError(err ?? null) }} />
                {probeError && <p className="text-xs text-accent-red">{probeError}</p>}
                {probe && !features && !probeError && <p className="text-xs text-text-dim">載入比對資料中…</p>}
                {matches && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {matches.map(({ key, d }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { onPick(key); onClose() }}
                        onMouseEnter={() => setFocus(key)}
                        onFocus={() => setFocus(key)}
                        className="shrink-0 flex flex-col items-center gap-0.5 p-1.5 rounded-lg border border-accent-cyan/40 hover:bg-bg-dark"
                      >
                        <img src={iconSrc(key)} alt="" className={`w-14 h-14 object-contain ${tab === 'buff' ? 'p-1.5 bg-bg-dark rounded' : ''}`} />
                        <span className="text-[10px] text-text-dim">{shortKey(key)}</span>
                        <span className="text-[10px] text-text-dim">差 {d.toFixed(1)}{usage.has(key) ? '・已用' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── 網格＋預覽 ── */}
            <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
              <div className="overflow-y-auto flex-1 min-h-[200px] -mx-1 px-1">
                {shown.length === 0 ? (
                  <p className="py-10 text-center text-sm text-text-dim">找不到符合的圖示</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
                    {shown.map((key) => {
                      const n = usage.get(key)?.length ?? 0
                      const active = key === current
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { onPick(key); onClose() }}
                          onMouseEnter={() => setFocus(key)}
                          onFocus={() => setFocus(key)}
                          className={`relative flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors ${
                            active ? 'border-accent-orange bg-accent-orange/10' : 'border-border/50 hover:border-border-accent hover:bg-bg-dark'
                          }`}
                        >
                          <img src={iconSrc(key)} alt="" loading="lazy" className={`w-16 h-16 object-contain ${tab === 'buff' ? 'p-2 bg-bg-dark rounded' : ''}`} />
                          <span className="text-[10px] text-text-dim truncate max-w-full leading-tight">{shortKey(key)}</span>
                          {n > 0 && (
                            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-bg-dark/90 border border-border text-[10px] leading-4 text-text-secondary">{n}</span>
                          )}
                          {legacy.has(key) && (
                            <span className="absolute top-1 left-1 px-1 rounded bg-bg-dark/90 border border-border text-[9px] leading-4 text-text-dim">舊</span>
                          )}
                          {notes[key] && (
                            <span title={notes[key]} className="absolute top-1 left-1 px-1 rounded bg-bg-dark/90 border border-accent-yellow/40 text-[9px] leading-4 text-accent-yellow">註</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <aside className="md:w-64 shrink-0 border-t md:border-t-0 md:border-l border-border pt-3 md:pt-0 md:pl-4 overflow-y-auto">
                {focusKey ? (
                  <>
                    <img src={iconSrc(focusKey)} alt="" className={`w-32 h-32 object-contain mx-auto ${tab === 'buff' ? 'p-4 bg-bg-dark rounded-lg' : ''}`} />
                    <p className="mt-2 text-xs font-mono text-text-primary break-all text-center select-all">{focusKey}</p>
                    <p className="text-[11px] text-text-dim text-center mb-3">
                      {describe(parsed.get(focusKey) ?? null)}{legacy.has(focusKey) ? '・舊版' : ''}
                    </p>
                    {notes[focusKey] && (
                      <p className="text-[11px] text-accent-yellow leading-snug mb-3 border-l-2 border-accent-yellow/50 pl-2">{notes[focusKey]}</p>
                    )}
                    <UsageList users={usage.get(focusKey)} />
                  </>
                ) : (
                  <p className="text-xs text-text-dim">滑過圖示可放大，並顯示被哪些資料使用。</p>
                )}
              </aside>
            </div>

            <p className="text-[11px] text-text-dim mt-2 shrink-0">
              符合 {results.length} 張{results.length > MAX_RESULTS ? `（顯示前 ${MAX_RESULTS} 張，請用篩選縮小範圍）` : ''} · 右上角數字＝使用處數 · 點擊即套用
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── 後台列表縮圖 ─────────────────────────────────────────────────────────────────
/**
 * 後台列表的小縮圖：icon（官方 key）／iconLocal（舊路徑）任一個能解析就畫，都沒有就不佔位
 * （與原本 `onError → display:none` 的行為相同）。取代散在各後台的 `<img src={x.iconLocal}>`——
 * 那種寫法在 C 階段清掉 iconLocal 之後會整排消失。
 */
export function IconThumb({ icon, iconLocal, className = 'w-8 h-8 rounded shrink-0' }: {
  icon?: string | null
  iconLocal?: string | null
  className?: string
}) {
  const candidates = gameIconCandidates(icon, iconLocal)
  if (!candidates.length) return null
  return <FallbackImage candidates={candidates} alt="" className={`object-contain ${className}`} />
}

// ── 表單欄位版（預覽＋文字輸入＋選取＋清除）──────────────────────────────────────
export function GameIconField({
  label, value, onChange, library = 'skill', presetKinds, placeholder = 'Icon_skill_passive_5227',
}: {
  label: string
  value?: string
  /** 寫回裸 key（官方檔名）；清除時給空字串 */
  onChange: (key: string) => void
  library?: IconFamily
  presetKinds?: IconKind[]
  placeholder?: string
}) {
  const [picking, setPicking] = useState(false)
  const val = value ?? ''
  const candidates = gameIconCandidates(val)
  const parsedKey = parseIconKey(usageKey(val))

  return (
    <div>
      <label className="text-xs text-text-dim mb-1 block">{label}</label>
      <div className="flex items-center gap-2">
        <FallbackImage
          candidates={candidates}
          alt=""
          className={`w-10 h-10 rounded object-contain border border-border/50 bg-bg-dark shrink-0 ${library === 'buff' ? 'p-1' : ''}`}
          fallback={
            <div className="w-10 h-10 rounded border border-dashed border-border/60 bg-bg-dark/50 shrink-0 flex items-center justify-center text-text-dim text-[10px]">
              {val ? '?' : '無'}
            </div>
          }
        />
        <input
          type="text"
          value={val}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={placeholder}
          className="input-field flex-1 text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="shrink-0 px-3 py-2 text-sm text-accent-cyan border border-accent-cyan/40 rounded-lg hover:bg-accent-cyan/10 transition-colors whitespace-nowrap"
        >
          選取圖示
        </button>
        {val && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="shrink-0 px-2 py-2 text-sm text-accent-red border border-accent-red/30 rounded-lg hover:bg-accent-red/10 transition-colors"
          >
            清除
          </button>
        )}
      </div>
      {val && (
        <p className="text-[11px] text-text-dim mt-1">
          {parsedKey ? describe(parsedKey) : '⚠ 不是圖庫裡的官方檔名（舊路徑或佔位名），建議重新選取'}
        </p>
      )}

      {picking && (
        <GameIconPicker
          value={val}
          library={library}
          presetKinds={presetKinds}
          onPick={(key) => onChange(key)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

// ── 武器／背包的官方編號欄位（PLAN-056 B-3）─────────────────────────────────────
/**
 * 寫回的是 **gameId**（'20300501'），不是檔名——檔名由 equipIconKey() 推（含 Icon_BackPack_ 大小寫例外）。
 * 文字框直接打編號；按「選取圖示」開武器／背包分頁（預選同種類前綴、主序列）。
 */
export function EquipGameIdField({
  label, family, gameId, onChange, presetCategories, hint, placeholder,
}: {
  label: string
  family: EquipIconFamily
  gameId?: string
  /** 清除時給空字串 */
  onChange: (gameId: string) => void
  presetCategories?: string[]
  hint?: string
  /** 輸入框的範例文字。⚠ 要寫成「例：…」——光寫一個編號，空欄位看起來就像已經填了值 */
  placeholder?: string
}) {
  const [picking, setPicking] = useState(false)
  const id = gameId ?? ''
  const key = equipIconKey(family, id)
  const parsedKey = parseIconKey(key)
  const candidates = gameIconCandidates(key)

  return (
    <div>
      <label className="text-xs text-text-dim mb-1 block">{label}</label>
      <div className="flex items-center gap-2">
        <FallbackImage
          candidates={candidates}
          alt=""
          className="w-10 h-10 rounded object-contain border border-border/50 bg-bg-dark shrink-0"
          fallback={
            <div className="w-10 h-10 rounded border border-dashed border-border/60 bg-bg-dark/50 shrink-0 flex items-center justify-center text-text-dim text-[10px]">
              {id ? '?' : '無'}
            </div>
          }
        />
        <input
          type="text"
          value={id}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={placeholder ?? (family === 'weapon' ? '例：20300501' : '例：60100101')}
          className="input-field flex-1 text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="shrink-0 px-3 py-2 text-sm text-accent-cyan border border-accent-cyan/40 rounded-lg hover:bg-accent-cyan/10 transition-colors whitespace-nowrap"
        >
          選取圖示
        </button>
        {id && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="shrink-0 px-2 py-2 text-sm text-accent-red border border-accent-red/30 rounded-lg hover:bg-accent-red/10 transition-colors"
          >
            清除
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-dim mt-1">
        {id ? (parsedKey ? `${key}・${describe(parsedKey)}` : '⚠ 不是官方編號格式') : (hint ?? '官方圖示編號；留空＝沒有官方圖（可改填下方自訂圖）')}
      </p>

      {picking && (
        <GameIconPicker
          value={key}
          library={family}
          presetCategories={presetCategories}
          onPick={(k) => onChange(equipGameIdOf(k) ?? '')}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
