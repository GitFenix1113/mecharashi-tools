import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { uploadImage } from '../../lib/imageUpload'
import { bumpDataVersion } from '../../lib/firestoreApi'
import type { PatchVersion, PatchHalf, VersionIconUrls, VersionEntityIds } from '../../data/patchVersions/types'
import type { Pilot, Mech, Weapon, Backpack } from '../../types'
import { resolveIconSrc } from '../../utils/assets'
import { invalidatePatchVersionsCache } from '../../hooks/usePatchVersions'
import AdminHalfEditorPanel from '../../components/admin/AdminHalfEditorPanel'

const CDN_BASE = 'https://media.zlongame.com/media/pictures/cn/community/img/gl/gameInfo'

// ── 常數 / 工具 ────────────────────────────────────────────────────────────────

type Tab = 'core' | 'upper' | 'lower' | 'icons'
type SaveStatus = null | 'saving' | 'success' | 'error'

type IconCategory = keyof VersionIconUrls
type IconMap = Record<string, string>

const ICON_CATEGORIES: { key: IconCategory; label: string }[] = [
  { key: 'pilots',    label: '機師' },
  { key: 'mechs',     label: '機甲' },
  { key: 'weapons',   label: '武器' },
  { key: 'backpacks', label: '背包' },
]

/**
 * 把同步取得的值（icon 路徑或文件 ID）併回既有設定。
 *
 * 刻意「只填空缺、不刪既有」：原本是整包取代，凡是 Firestore 這輪查不到的名稱都會在
 * 同步後靜默消失——暫譯名與 DB 名稱對不上、實體尚未建檔（前瞻版本的常態）、手動貼的
 * 官方 CDN 路徑，全都算在內。維護者按下同步只是想補齊空缺，不該賠掉手動修過的值。
 *
 * force = true 才允許以 Firestore 值覆寫既有值。即使如此也只覆寫「這輪有查到」的名稱，
 * 查不到的一律原封不動。icon 的 force 綁在「強制覆寫」勾選框（官方換圖時整批刷新用）；
 * entityIds 則永遠 force——ID 是機器推導、不開放手動編輯，沒有「使用者的值」需要保護，
 * 資料庫重建導致流水號變動時反而必須跟上，否則連結會靜靜指向舊文件。
 */
function mergeNameMap(prev: IconMap | undefined, fetched: IconMap, force: boolean) {
  const map: IconMap = { ...prev }
  let added = 0
  let updated = 0
  let kept = 0
  for (const [name, url] of Object.entries(fetched)) {
    const existing = map[name]
    if (!existing) {
      map[name] = url
      added++
    } else if (force && existing !== url) {
      map[name] = url
      updated++
    } else {
      kept++
    }
  }
  return { map, added, updated, kept }
}

/** Collect all names per icon category that appear in this version's data. */
function collectVersionNames(fd: PatchVersion): Record<IconCategory, string[]> {
  const pilots    = new Set<string>()
  const mechs     = new Set<string>()
  const weapons   = new Set<string>()
  const backpacks = new Set<string>()

  for (const half of [fd.upper, fd.lower]) {
    for (const n of half.pilots    ?? []) pilots.add(n)
    for (const n of half.mechs     ?? []) mechs.add(n)
    for (const n of half.battlePass?.pilots ?? []) pilots.add(n)
    for (const n of half.battlePass?.mechs  ?? []) mechs.add(n)
    for (const raid of half.armamentRaids ?? []) {
      for (const n of raid.weapons      ?? []) weapons.add(n)
      for (const n of raid.weaponPilots ?? []) if (n) pilots.add(n)
      for (const n of raid.backpacks    ?? []) backpacks.add(n)
    }
  }
  for (const n of fd.crisisShop ?? []) pilots.add(n)

  return {
    pilots:    [...pilots].sort(),
    mechs:     [...mechs].sort(),
    weapons:   [...weapons].sort(),
    backpacks: [...backpacks].sort(),
  }
}

const EMPTY_HALF: PatchHalf = { cnDate: '' }

const EMPTY_VERSION: PatchVersion = {
  version: '',
  upper: { ...EMPTY_HALF },
  lower: { ...EMPTY_HALF },
}

/** Firestore 不接受 undefined — 用 JSON round-trip 移除 */
function stripUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ── 動態字串列表（用於 crisisShop） ───────────────────────────────────────────

function StringListEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      {values.map((v, idx) => (
        <div key={idx} className="flex gap-2">
          <input
            type="text"
            value={v}
            onChange={e => onChange(values.map((x, i) => (i === idx ? e.target.value : x)))}
            placeholder={placeholder}
            className="flex-1 bg-bg-card border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50 min-w-0"
          />
          <button
            type="button"
            onClick={() => onChange(values.filter((_, i) => i !== idx))}
            className="px-2 text-text-dim hover:text-accent-red transition-colors"
            title="刪除"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="text-[11px] text-accent-purple hover:text-accent-purple/80 transition-colors"
      >
        + 新增
      </button>
    </div>
  )
}

// ── 欄位標籤 ──────────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs text-text-dim block mb-1.5">{children}</label>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold text-text-dim tracking-[3px] uppercase mb-3 mt-6 pt-4 border-t border-border first:mt-0 first:pt-0 first:border-t-0">
      {children}
    </div>
  )
}

const INPUT_CLS =
  'w-full bg-bg-card border border-border rounded px-3 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-accent-purple/50'

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function AdminVersionEditorPage() {
  const { versionId } = useParams<{ versionId: string }>()
  const navigate = useNavigate()
  const isNew = versionId === 'new'

  const [formData, setFormData]   = useState<PatchVersion>({ ...EMPTY_VERSION })
  const [loading, setLoading]     = useState(!isNew)
  const [notFound, setNotFound]   = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('core')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null)
  const [saveMsg, setSaveMsg]     = useState('')
  const [uploading, setUploading] = useState(false)
  const [syncing, setSyncing]     = useState(false)
  const [syncMsg, setSyncMsg]     = useState('')
  const [forceOverwrite, setForceOverwrite] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 載入現有版本 ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isNew) return
    setLoading(true)
    getDoc(doc(db, 'patchVersions', `v${versionId}`))
      .then(snap => {
        if (snap.exists()) {
          setFormData(snap.data() as PatchVersion)
        } else {
          setNotFound(true)
        }
      })
      .catch(err => {
        console.error('[AdminVersionEditorPage] load error:', err)
        setNotFound(true)
      })
      .finally(() => setLoading(false))
  }, [versionId, isNew])

  // ── 儲存 ────────────────────────────────────────────────────────────────────

  // ── Icon URL 同步 ──────────────────────────────────────────────────────────

  async function handleSyncIcons() {
    setSyncing(true)
    setSyncMsg('從 Firestore 讀取資料中…')
    try {
      const names = collectVersionNames(formData)
      const pSet = new Set(names.pilots)
      const mSet = new Set(names.mechs)
      const wSet = new Set(names.weapons)
      const bSet = new Set(names.backpacks)

      const [pilotSnap, mechSnap, weaponSnap, backpackSnap] = await Promise.all([
        getDocs(collection(db, 'pilots')),
        getDocs(collection(db, 'mechs')),
        getDocs(collection(db, 'weapons')),
        getDocs(collection(db, 'backpacks')),
      ])

      // ID 一律取 d.id（Firestore 文件 ID）而非文件內的 id 欄位：fetchCollection 是
      // `{ ...d.data(), id: d.id }`，路由與 EntityRefView 認的都是文件 ID，兩者若漂移
      // 以文件 ID 為準。名稱查得到就記 ID，圖檔路徑另外算——素材沒好也要能連結。
      const pilots: IconMap = {}
      const pilotIds: IconMap = {}
      for (const d of pilotSnap.docs) {
        const p = d.data() as Pilot
        if (!pSet.has(p.name)) continue
        pilotIds[p.name] = d.id
        // 一律優先採用本地圖檔路徑（/images/...），無本地圖時才退回遠端 CDN
        const url = p.portrait || p.portraitUrl
        if (url) pilots[p.name] = url
      }

      const mechs: IconMap = {}
      const mechIds: IconMap = {}
      for (const d of mechSnap.docs) {
        const m = d.data() as Mech
        if (!mSet.has(m.name)) continue
        mechIds[m.name] = d.id
        const url = m.portrait
          ? m.portrait
          : m.parts.torso.mechaIcon
            ? `${CDN_BASE}/waparts/${m.parts.torso.mechaIcon}.png`
            : undefined
        if (url) mechs[m.name] = url
      }

      const weapons: IconMap = {}
      const weaponIds: IconMap = {}
      for (const d of weaponSnap.docs) {
        const w = d.data() as Weapon
        if (!wSet.has(w.name)) continue
        weaponIds[w.name] = d.id
        const filename = w.icon?.split('/').pop()
        if (filename) weapons[w.name] = `/images/weapons/${filename}`
      }

      const backpacks: IconMap = {}
      const backpackIds: IconMap = {}
      for (const d of backpackSnap.docs) {
        const b = d.data() as Backpack
        if (!bSet.has(b.name)) continue
        backpackIds[b.name] = d.id
        const filename = b.icon?.split('/').pop()
        if (filename) backpacks[b.name] = `/images/backpacks/${filename}`
      }

      const fetchedIcons: Record<IconCategory, IconMap> = { pilots, mechs, weapons, backpacks }
      const fetchedIds:   Record<IconCategory, IconMap> =
        { pilots: pilotIds, mechs: mechIds, weapons: weaponIds, backpacks: backpackIds }

      // 統計數字（僅供訊息顯示）依「發起同步當下」的快照計算；實際合併走 functional
      // updater，這樣抓取那 4 個集合的期間若維護者手動改了欄位也不會被整包蓋掉。
      const stats = { added: 0, updated: 0, kept: 0, stale: 0, idAdded: 0, idTotal: 0 }
      for (const { key } of ICON_CATEGORIES) {
        const r = mergeNameMap(formData.iconUrls?.[key], fetchedIcons[key], forceOverwrite)
        stats.added   += r.added
        stats.updated += r.updated
        stats.kept    += r.kept
        const ids = mergeNameMap(formData.entityIds?.[key], fetchedIds[key], true)
        stats.idAdded += ids.added
        stats.idTotal += Object.keys(ids.map).length
        // 殘留 = 此版本資料已不含該名稱（改名／移除後留下的舊 key）。不刪，但要讓維護者
        // 看得到——UI 只列得出當前版本的名稱，這些 key 否則永遠沉在文件裡沒人知道。
        const known = new Set(names[key])
        stats.stale += Object.keys(formData.iconUrls?.[key] ?? {}).filter(n => !known.has(n)).length
      }

      setFormData(prev => {
        const mergedIcons: VersionIconUrls = { ...prev.iconUrls }
        const mergedIds:   VersionEntityIds = { ...prev.entityIds }
        for (const { key } of ICON_CATEGORIES) {
          const icons = mergeNameMap(prev.iconUrls?.[key], fetchedIcons[key], forceOverwrite)
          if (Object.keys(icons.map).length) mergedIcons[key] = icons.map
          const ids = mergeNameMap(prev.entityIds?.[key], fetchedIds[key], true)
          if (Object.keys(ids.map).length) mergedIds[key] = ids.map
        }
        return {
          ...prev,
          iconUrls:  Object.keys(mergedIcons).length ? mergedIcons : undefined,
          entityIds: Object.keys(mergedIds).length   ? mergedIds   : undefined,
        }
      })

      setSyncMsg(
        `同步完成：Icon 新增 ${stats.added}`
        + (forceOverwrite ? `，覆寫 ${stats.updated}` : '')
        + `，保留既有 ${stats.kept}`
        + `；連結 ID 共 ${stats.idTotal} 筆（新增 ${stats.idAdded}）`
        + (stats.stale ? `；另有 ${stats.stale} 筆非本版本殘留（未更動）` : ''),
      )
    } catch (err) {
      console.error('[AdminVersionEditorPage] sync icons error:', err)
      setSyncMsg('同步失敗，請確認 Firebase 連線。')
    } finally {
      setSyncing(false)
    }
  }

  function updateIconUrl(category: IconCategory, name: string, url: string) {
    setFormData(prev => {
      const existing = prev.iconUrls?.[category] ?? {}
      const updated = { ...existing }
      if (url.trim()) {
        updated[name] = url.trim()
      } else {
        delete updated[name]
      }
      const newCat = Object.keys(updated).length ? updated : undefined
      const newUrls = { ...prev.iconUrls, [category]: newCat }
      const hasAny = Object.values(newUrls).some(v => v !== undefined)
      return { ...prev, iconUrls: hasAny ? newUrls : undefined }
    })
  }

  // ── 儲存 ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!formData.version.trim()) {
      setSaveStatus('error')
      setSaveMsg('版本號不可為空')
      return
    }
    setSaveStatus('saving')
    setSaveMsg('儲存中...')
    try {
      const clean = stripUndefined(formData)
      await setDoc(doc(db, 'patchVersions', `v${formData.version}`), clean)
      // Worker 的邊緣快取以「集合版本號」當 cache key（workers/src/index.ts），不 bump 就換不掉
      // key，前台會一路吃到 max-age=86400 的舊 JSON——banner/iconUrls 改了最長 24 小時才可見，
      // 且硬重整無效（快取在邊緣不在瀏覽器）。失敗不擋存檔，沿用各 api 模組的 .catch(() => '')。
      await bumpDataVersion('patchVersions').catch(() => '')
      invalidatePatchVersionsCache()
      setSaveStatus('success')
      setSaveMsg('儲存成功！Firestore 已更新。')
      if (isNew) {
        // 建立後跳轉至編輯頁
        navigate(`/admin/versions/${formData.version}`, { replace: true })
      }
    } catch (err) {
      console.error('[AdminVersionEditorPage] save error:', err)
      setSaveStatus('error')
      setSaveMsg('儲存失敗，請確認 Firebase 連線與管理員權限。')
    }
  }

  // ── Banner 圖片上傳 ─────────────────────────────────────────────────────────

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadImage(file, 'banners')
      setFormData(prev => ({ ...prev, bannerImage: url }))
    } catch (err) {
      console.error('[AdminVersionEditorPage] upload error:', err)
      alert(err instanceof Error ? err.message : '圖片上傳失敗，請重試。')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── 局部 update helpers ─────────────────────────────────────────────────────

  function updateCore(patch: Partial<PatchVersion>) {
    setFormData(prev => ({ ...prev, ...patch }))
  }

  function updateHalf(half: 'upper' | 'lower', newHalf: PatchHalf) {
    setFormData(prev => ({ ...prev, [half]: newHalf }))
  }

  // ── 渲染條件 ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-text-dim text-sm">載入中...</p>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <p className="text-text-dim mb-4">找不到版本「{versionId}」</p>
        <Link to="/admin/versions" className="text-accent-purple text-sm hover:underline">
          ← 返回版本列表
        </Link>
      </div>
    )
  }

  const crisisShop = formData.crisisShop ?? []

  const TABS: { key: Tab; label: string }[] = [
    { key: 'core',  label: '核心資訊' },
    { key: 'upper', label: '上半' },
    { key: 'lower', label: '下半' },
    { key: 'icons', label: 'Icon URLs' },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-24 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-xs text-text-dim mb-4">
        <Link to="/admin" className="hover:text-text-secondary transition-colors no-underline">後台管理</Link>
        <span>›</span>
        <Link to="/admin/versions" className="hover:text-text-secondary transition-colors no-underline">版本列表</Link>
        <span>›</span>
        <span className="text-accent-purple">{isNew ? '建立新版本' : `v${versionId}`}</span>
      </div>

      {/* 頁首 */}
      <div className="mb-6">
        <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[3px] text-accent-purple uppercase mb-1">
          Admin · Version Editor
        </div>
        <h1 className="text-2xl font-bold text-text-primary">
          {isNew ? '建立新版本' : `v${versionId} 版本編輯`}
        </h1>
      </div>

      {/* Tab 切換列 */}
      <div className="flex border-b border-border mb-6">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === key
                ? 'text-accent-purple border-accent-purple'
                : 'text-text-dim border-transparent hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab 1：核心資訊 ── */}
      {activeTab === 'core' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* 版本號 */}
            <div>
              <FieldLabel>版本號（如：2.8）</FieldLabel>
              {isNew ? (
                <input
                  type="text"
                  value={formData.version}
                  onChange={e => updateCore({ version: e.target.value })}
                  placeholder="2.8"
                  className={INPUT_CLS}
                />
              ) : (
                <div className="px-3 py-2 bg-bg-card border border-border rounded text-sm text-accent-orange font-bold">
                  v{formData.version}
                  <span className="text-text-dim text-xs font-normal ml-2">（建立後不可更改）</span>
                </div>
              )}
            </div>

            {/* 版本名稱 */}
            <div>
              <FieldLabel>版本名稱（選填）</FieldLabel>
              <input
                type="text"
                value={formData.name ?? ''}
                onChange={e => updateCore({ name: e.target.value || undefined })}
                placeholder="（選填）"
                className={INPUT_CLS}
              />
            </div>
          </div>

          <SectionLabel>版本前瞻圖</SectionLabel>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={formData.bannerImage ?? ''}
                onChange={e => updateCore({ bannerImage: e.target.value || undefined })}
                placeholder="圖片 URL（上傳後自動填入，或手動貼上）"
                className={`${INPUT_CLS} flex-1`}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex-shrink-0 px-3 py-2 text-sm bg-bg-card border border-border rounded hover:border-accent-purple/50 text-text-secondary transition-colors disabled:opacity-50"
              >
                {uploading ? '上傳中...' : '📤 上傳圖片'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
            {formData.bannerImage && (
              <div className="text-[11px] text-text-dim truncate">
                目前：{formData.bannerImage}
              </div>
            )}
          </div>

          <SectionLabel>台服設定</SectionLabel>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.isTwCurrent ?? false}
              onChange={e => updateCore({ isTwCurrent: e.target.checked || undefined })}
              className="accent-accent-green w-4 h-4"
            />
            <div>
              <span className="text-sm text-text-primary font-medium">★ 台服當前版本</span>
              <p className="text-xs text-text-dim mt-0.5">勾選此版本為台服目前進行中的版本（同時請取消其他版本的同一勾選）</p>
            </div>
          </label>

          <SectionLabel>危境重構機師</SectionLabel>
          <StringListEditor
            values={crisisShop}
            onChange={v => updateCore({ crisisShop: v.length ? v : undefined })}
            placeholder="機師名稱（如：亞瑟）"
          />

          <SectionLabel>其他版本資訊</SectionLabel>
          <div className="space-y-4">
            <div>
              <FieldLabel>記憶風暴說明（memoryStorm）</FieldLabel>
              <input
                type="text"
                value={formData.memoryStorm ?? ''}
                onChange={e => updateCore({ memoryStorm: e.target.value || undefined })}
                placeholder="（選填）"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>邊境商店更新（borderShop）</FieldLabel>
              <input
                type="text"
                value={formData.borderShop ?? ''}
                onChange={e => updateCore({ borderShop: e.target.value || undefined })}
                placeholder="（選填）"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>鬥技場更新（arenaShop）</FieldLabel>
              <input
                type="text"
                value={formData.arenaShop ?? ''}
                onChange={e => updateCore({ arenaShop: e.target.value || undefined })}
                placeholder="（選填）"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <FieldLabel>備註（notes）</FieldLabel>
              <textarea
                value={formData.notes ?? ''}
                onChange={e => updateCore({ notes: e.target.value || undefined })}
                placeholder="（選填）"
                rows={3}
                className={`${INPUT_CLS} resize-none`}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 2：上半 ── */}
      {activeTab === 'upper' && (
        <AdminHalfEditorPanel
          value={formData.upper}
          onChange={half => updateHalf('upper', half)}
        />
      )}

      {/* ── Tab 3：下半 ── */}
      {activeTab === 'lower' && (
        <AdminHalfEditorPanel
          value={formData.lower}
          onChange={half => updateHalf('lower', half)}
        />
      )}

      {/* ── Tab 4：Icon URLs ── */}
      {activeTab === 'icons' && (() => {
        const names = collectVersionNames(formData)
        return (
          <div>
            {/* Sync button */}
            <div className="flex items-center gap-3 mb-5">
              <button
                type="button"
                onClick={handleSyncIcons}
                disabled={syncing}
                className="px-4 py-2 text-sm font-medium bg-bg-card border border-border rounded-lg hover:border-accent-cyan/50 text-accent-cyan transition-colors disabled:opacity-50"
              >
                {syncing ? '同步中…' : '從 Firestore 自動同步 Icon'}
              </button>
              <label className="flex items-center gap-2 cursor-pointer shrink-0" title="勾選後，Firestore 查得到的名稱會以資料庫路徑覆寫既有 URL（官方換圖時整批刷新用）">
                <input
                  type="checkbox"
                  checked={forceOverwrite}
                  onChange={e => setForceOverwrite(e.target.checked)}
                  className="accent-accent-yellow w-4 h-4"
                />
                <span className="text-xs text-text-dim">強制覆寫既有 URL</span>
              </label>
              {syncMsg && (
                <span className="text-xs text-text-dim">{syncMsg}</span>
              )}
            </div>

            <p className="text-xs text-text-dim mb-5 leading-relaxed">
              點擊上方按鈕可自動從 Firestore 資料庫查詢此版本所有角色／機甲／武器／背包的 Icon URL 與文件 ID，並填入下方欄位。<br />
              同步<span className="text-text-secondary">只補空缺</span>，已填的 URL 一律保留；要以資料庫路徑刷新既有值請勾選「強制覆寫」。<br />
              亦可手動貼上或修改任意 URL，留空代表顯示文字。
            </p>

            {/* 兩軸狀態說明：能不能點（有無 ID）與顯不顯示圖（有無素材）是獨立的 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-5 text-[11px] text-text-dim">
              <span>狀態圖例：</span>
              <span><span className="text-accent-green">● 已連結</span> 首頁圖示可點開詳情</span>
              <span><span className="text-accent-yellow">● 待素材</span> 已連結、圖還沒好，前台顯示可點的文字</span>
              <span><span className="text-accent-orange">● 未連結</span> 名稱對不上資料庫，請確認用字</span>
              <span><span className="text-text-dim/60">● 未建檔</span> 實體尚未進資料庫（前瞻版本的常態）</span>
            </div>

            {ICON_CATEGORIES.map(({ key, label }) => {
              const nameList = names[key]
              return (
                <div key={key} className="mb-6">
                  <div className="text-[10px] font-bold text-text-dim tracking-[3px] uppercase mb-3 pt-4 border-t border-border">
                    {label}
                  </div>
                  {nameList.length === 0 ? (
                    <p className="text-xs text-text-dim/50">此版本無此類型資料</p>
                  ) : (
                    <div className="space-y-2">
                      {nameList.map(name => {
                        const url = formData.iconUrls?.[key]?.[name] ?? ''
                        const entityId = formData.entityIds?.[key]?.[name] ?? ''
                        const status = entityId
                          ? (url ? { cls: 'text-accent-green',  text: '已連結' }
                                 : { cls: 'text-accent-yellow', text: '待素材' })
                          : (url ? { cls: 'text-accent-orange', text: '未連結' }
                                 : { cls: 'text-text-dim/60',   text: '未建檔' })
                        return (
                          <div key={name} className="flex items-center gap-3">
                            {url ? (
                              <img
                                src={resolveIconSrc(url)}
                                alt={name}
                                className="w-8 h-8 rounded border border-border object-cover object-top shrink-0"
                                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                              />
                            ) : (
                              <div className="w-8 h-8 rounded border border-border/40 bg-bg-card shrink-0" />
                            )}
                            <span className="text-sm text-text-secondary w-28 shrink-0 truncate">{name}</span>
                            <span
                              className={`text-[11px] w-14 shrink-0 ${status.cls}`}
                              title={entityId ? `文件 ID：${entityId}` : '此名稱在資料庫查無對應文件，按下同步後仍為此狀態代表用字與資料庫不一致'}
                            >
                              ● {status.text}
                            </span>
                            <input
                              type="text"
                              value={url}
                              onChange={e => updateIconUrl(key, name, e.target.value)}
                              placeholder="Icon URL（留空顯示文字）"
                              className={`${INPUT_CLS} flex-1 text-xs`}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* ── 固定底部儲存列 ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-bg-dark border-t border-border px-4 py-3 flex items-center justify-between z-50">
        <div className="text-sm">
          {saveStatus === 'saving' && (
            <span className="text-text-dim">{saveMsg}</span>
          )}
          {saveStatus === 'success' && (
            <span className="text-accent-green">{saveMsg}</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-accent-red">{saveMsg}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/versions"
            className="px-4 py-2 text-sm text-text-dim border border-border rounded-lg hover:border-text-dim/50 transition-colors no-underline"
          >
            取消
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="px-6 py-2 text-sm font-bold bg-accent-purple text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saveStatus === 'saving' ? '儲存中...' : '儲存至 Firestore'}
          </button>
        </div>
      </div>
    </div>
  )
}
