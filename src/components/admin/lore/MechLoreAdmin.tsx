import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Mech, MechLoreDoc } from '../../../types'
import { DraftRestoreBar, LoadMoreButton, useClientPaged } from '../../../pages/user/admin/shared'
import { useDraftRestore } from '../../../hooks/useDraftAutosave'
import { updateMechLore } from '../../../lib/firestoreApi'
import { useGameData } from '../../../contexts/GameDataContext'
import { mechSkinCatalog } from '../../../utils/gameArt'
import {
  MECH_LORE_GAP_LABEL, hasMechLoreGap, mechLoreProgressOf, summarizeMechLoreProgress, type MechLoreGap, type MechLoreProgress,
} from '../../../utils/mechLoreProgress'
import { MechLoreEditPanel, MECH_LORE_DRAFT_KIND } from './MechLoreEditPanel'

// ─── 故事館編輯台「機甲」分頁（PLAN-042-B G-1）──────────────────────────────────
//
// 結構照「機師」分頁（AdminLorePage）：進度總覽＋缺什麼篩選＋列表，點一台開編輯面板。
// 網址 `?view=mechs&mech=<文件 ID>` 直接打開那一台（機甲管理的捷徑連到這裡）。
//
// 列表來源是 **mechs** 不是 mechLore：每台機甲都要能點進去建檔（沒有文件的現場造空殼，存檔才建）。
// ⚠ 載入失敗時不開放編輯：存檔是整份覆寫，不知道既有內容就存，會把介紹、系譜、章節洗掉。
// ⚠ 沒有刪除路徑（理由同機師版：lib/api/mechLore.ts 檔尾）。

interface Filters { gap: 'all' | MechLoreGap }

const GAP_OPTIONS: { value: Filters['gap']; label: string }[] = [
  { value: 'all', label: '全部' },
  ...(Object.keys(MECH_LORE_GAP_LABEL) as MechLoreGap[]).map((g) => ({ value: g, label: MECH_LORE_GAP_LABEL[g] })),
]

export function MechLoreAdmin() {
  const gd = useGameData()
  const { ensureLoaded } = gd
  useEffect(() => { void ensureLoaded(['mechLore', 'mechs', 'mechMakers', 'pilots']) }, [ensureLoaded])

  // error 必須判斷在 loading 之前（同 AdminLorePage：抓取失敗時 loading 永遠是 true）
  const error = gd.errorMap['mechLore'] ?? gd.errorMap['mechs'] ?? gd.errorMap['mechMakers'] ?? null
  const loading = !gd.loadedKeys.has('mechLore') || !gd.loadedKeys.has('mechs') || !gd.loadedKeys.has('mechMakers')

  const draft = useDraftRestore<MechLoreDoc>(MECH_LORE_DRAFT_KIND)
  const [restored, setRestored] = useState<MechLoreDoc | null>(null)

  const [params, setParams] = useSearchParams()
  const editingId = params.get('mech')
  const openEditor = (id: string) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    next.set('mech', id)
    return next
  }, { replace: true })
  const closeEditor = () => {
    setRestored(null)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('mech')
      return next
    }, { replace: true })
  }

  const loreById = useMemo(() => new Map(gd.mechLore.map((d) => [d.id, d])), [gd.mechLore])
  const mechById = useMemo(() => new Map(gd.mechs.map((m) => [m.id, m])), [gd.mechs])
  const makerById = useMemo(() => new Map(gd.mechMakers.map((m) => [m.id, m])), [gd.mechMakers])

  // 進度總覽：全部從資料推導。塗裝總數取 build 時的清單（mechSkinCatalog），不是 DB
  const progress = useMemo(() => {
    const makerIds = new Set(makerById.keys())
    return new Map<string, MechLoreProgress>(gd.mechs.map((m) => [
      m.id, mechLoreProgressOf(loreById.get(m.id), mechSkinCatalog(m).map((s) => s.key), makerIds),
    ]))
  }, [gd.mechs, loreById, makerById])
  const summary = useMemo(() => summarizeMechLoreProgress([...progress.values()]), [progress])

  const {
    items, hasMore, search, setSearch, filters, setFilter, submitSearch, loadMore,
  } = useClientPaged<Mech, Filters>({
    source: gd.mechs,
    initialFilters: { gap: 'all' },
    matchFilters: (m, f) => {
      if (f.gap === 'all') return true
      const pr = progress.get(m.id)
      return !!pr && hasMechLoreGap(pr, f.gap)
    },
    // 名字、ID 之外也搜型號與英文名（站長查資料時常拿型號找）
    matchText: (m, q) => {
      const lore = loreById.get(m.id)
      return [m.name, m.id, lore?.modelNo, lore?.nameEn].some((s) => s?.toLowerCase().includes(q))
    },
  })

  async function handleSave(next: MechLoreDoc) {
    // 衝突（SaveConflictError）原樣拋回面板；快取放 saved（帶新的 rev），理由見 AdminLorePage 的 handleSave
    const { version, saved } = await updateMechLore(next)
    // version === '' 時 patchCollectionItem 內部改走 removeCache，是安全降級
    gd.patchCollectionItem('mechLore', saved, version)
    draft.commit()
    closeEditor()
  }

  const editingMech = editingId ? mechById.get(editingId) : undefined
  const editingDoc: MechLoreDoc | null = !editingId || loading || error ? null
    : restored?.id === editingId ? restored
    : (() => {
        const existing = loreById.get(editingId)
        const name = editingMech?.name ?? existing?.name ?? editingId
        return existing ? { ...existing, name } : { id: editingId, name, chapters: [] }
      })()

  if (error) {
    return (
      <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-3">
        <p className="text-accent-red text-sm font-bold">⚠ 資料載入失敗</p>
        <p className="text-text-secondary text-xs mt-1 break-all">{error.message}</p>
        <p className="text-text-dim text-xs mt-2">編輯台需要完整的既有資料才能安全覆寫，故載入失敗時不開放編輯。</p>
      </div>
    )
  }
  if (loading) return <p className="text-text-dim text-sm text-center py-10">載入中...</p>

  return (
    <>
      <DraftRestoreBar draft={draft} onRestore={(d) => { setRestored(d); openEditor(d.id) }} />

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-4">
        <Stat label="介紹" value={summary.intro} total={summary.mechs} />
        <Stat label="型號" value={summary.model} total={summary.mechs} />
        <Stat label="廠商" value={summary.maker} total={summary.mechs} />
        <Stat label="有系譜" value={summary.withRelations} total={summary.mechs} note="只算自己連出去的" />
        <Stat label="有逸聞" value={summary.withChapters} total={summary.mechs} note={`共 ${summary.chapters} 章${summary.drafts ? `，草稿 ${summary.drafts}` : ''}`} />
        <Stat label="塗裝已命名" value={summary.skinsDone} total={summary.skinsTotal} note="以「套」計；隱藏的算處理過" />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
          placeholder="搜尋機甲名稱、型號、英文名、ID 片段..."
          className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-orange"
        />
        <div className="flex gap-1 flex-wrap">
          {GAP_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setFilter('gap', o.value)}
              className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                filters.gap === o.value
                  ? 'bg-accent-cyan/15 border-accent-cyan/40 text-accent-cyan'
                  : 'bg-bg-dark border-border text-text-secondary hover:border-border-accent hover:text-text-primary'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-text-dim text-xs mb-3">顯示 {items.length} 台機甲{hasMore ? '（可載入更多）' : ''}</p>

      <div className="space-y-1.5">
        {items.map((m) => {
          const pr = progress.get(m.id)
          const lore = loreById.get(m.id)
          const maker = lore?.maker ? makerById.get(lore.maker) : undefined
          return (
            <button
              key={m.id}
              type="button"
              className="w-full text-left bg-bg-card border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-border-accent transition-colors"
              onClick={() => { setRestored(null); openEditor(m.id) }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-text-primary truncate">{m.name}</span>
                  {lore?.modelNo && <span className="text-[11px] font-mono text-text-secondary">{lore.modelNo}</span>}
                  <span className="text-[11px] font-mono text-text-dim truncate">{m.id}</span>
                </div>
                {pr && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Chip ok={pr.hasModel}>{pr.hasModel ? '型號' : '缺型號'}</Chip>
                    <Chip ok={pr.hasMaker}>{pr.hasMaker ? (maker?.name?.trim() || maker?.id) : '缺廠商'}</Chip>
                    <Chip ok={pr.hasIntro}>{pr.hasIntro ? '介紹' : '缺介紹'}</Chip>
                    <Chip ok={pr.relations > 0} muted={pr.relations === 0}>系譜 {pr.relations}</Chip>
                    <Chip ok={pr.chapters - pr.drafts > 0} muted={pr.chapters === 0}>
                      {pr.chapters} 章{pr.drafts ? `（草稿 ${pr.drafts}）` : ''}
                    </Chip>
                    {pr.skinsTotal > 0 && <Chip ok={pr.skinsDone === pr.skinsTotal}>塗裝 {pr.skinsDone}/{pr.skinsTotal}</Chip>}
                  </div>
                )}
              </div>
              <span className="text-text-dim text-sm shrink-0" aria-hidden>›</span>
            </button>
          )
        })}
        {items.length === 0 && <p className="text-text-dim text-sm text-center py-8">找不到符合條件的機甲</p>}
      </div>

      <LoadMoreButton hasMore={hasMore} loading={false} onClick={loadMore} />

      {editingDoc && (
        <MechLoreEditPanel
          // 換台、或在同一台身上改成還原草稿 → 整個 remount，useState 的 initializer 自然重跑
          key={`${editingDoc.id}:${restored?.id === editingDoc.id ? 'draft' : 'db'}`}
          doc={editingDoc}
          mech={editingMech}
          onSave={handleSave}
          onCancel={() => { draft.discard(); closeEditor() }}
        />
      )}
    </>
  )
}

export function Stat({ label, value, total, note }: { label: string; value: number; total: number; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2" title={note}>
      <div className="text-[11px] text-text-dim">{label}</div>
      <div className="text-sm font-bold text-text-primary">
        {value}<span className="text-text-dim font-normal"> / {total}</span>
      </div>
      {note && <div className="text-[10px] text-text-dim truncate">{note}</div>}
    </div>
  )
}

function Chip({ ok, muted, children }: { ok: boolean; muted?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`text-[11px] px-1.5 py-0.5 rounded border ${
        ok
          ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
          : muted
            ? 'bg-bg-dark border-border text-text-dim'
            : 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow'
      }`}
    >
      {children}
    </span>
  )
}
