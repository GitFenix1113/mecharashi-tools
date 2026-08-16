import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchPendingActivities,
  fetchAllDrafts,
  fetchDraft,
  mergeIntoVersion,
  rejectPending,
  type MergeTarget,
} from '../../lib/api/announcementStaging'
import type { AnnouncementDraft, PendingActivity, PendingStatus } from '../../types/announcementStaging'
import { PENDING_FLAG_LABEL, PARSE_WARNING_LABEL } from '../../types/announcementStaging'
import type { TimedActivity } from '../../data/patchVersions/types'
import { usePatchVersions, invalidatePatchVersionsCache } from '../../hooks/usePatchVersions'
import AnnouncementReviewPanel from '../../components/admin/AnnouncementReviewPanel'
import AnnouncementInsightsPanel from '../../components/admin/AnnouncementInsightsPanel'

// ─── 台版公告審核工作檯（PLAN-048 任務 2-3）──────────────────────────────────
//
// announcementDrafts / pendingActivities 不進 GameDataContext 快取（同 changeHistory
// 的理由：持續成長、只查最近幾頁）。本頁直接以 client SDK 查詢，規則層是 isAdmin()。
//
// 預設只顯示 needsReview，且把「解析器沒把握」的排最前面 ——
// 零 flag 的那 66% 本來就不需要人看，混在一起只會稀釋注意力。

const FILTERS: { key: PendingStatus[]; label: string }[] = [
  { key: ['needsReview'], label: '待確認' },
  { key: ['parsed'], label: '可直接放行' },
  { key: ['needsReview', 'parsed'], label: '全部未處理' },
  { key: ['merged'], label: '已合併' },
  { key: ['rejected'], label: '已忽略' },
]

/** 彙總檢視不是狀態篩選，獨立成一個分頁 */
const INSIGHTS_TAB = FILTERS.length

/** 置頂權重：新玩法與看不懂的原文最需要人腦，排最前面 */
function priority(item: PendingActivity): number {
  const f = item.flags ?? []
  if (f.includes('unknownActivityType')) return 0
  if (f.includes('unmatchedText')) return 1
  if (f.includes('missingName') || f.includes('missingDate')) return 2
  if (f.length > 0) return 3
  return 4
}

export default function AdminAnnouncementsPage() {
  const [filterIdx, setFilterIdx] = useState(0)
  const [items, setItems] = useState<PendingActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, AnnouncementDraft>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [allDrafts, setAllDrafts] = useState<AnnouncementDraft[]>([])
  const [allPending, setAllPending] = useState<PendingActivity[]>([])
  const showInsights = filterIdx === INSIGHTS_TAB

  const { data: versions } = usePatchVersions()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (filterIdx === INSIGHTS_TAB) {
        // 彙總要看全部，不是只看目前篩選；句型統計只取一頁的話排序就沒有意義
        const [drafts, pendingAll] = await Promise.all([
          fetchAllDrafts(),
          fetchPendingActivities(['needsReview', 'parsed', 'merged', 'rejected', 'superseded', 'conflict']),
        ])
        setAllDrafts(drafts)
        setAllPending(pendingAll)
        setItems([])
        return
      }
      const rows = await fetchPendingActivities(FILTERS[filterIdx].key)
      rows.sort((a, b) => priority(a) - priority(b))
      setItems(rows)
      setSelectedId(prev => (prev && rows.some(r => r.id === prev) ? prev : rows[0]?.id ?? null))
    } catch (err) {
      console.error('[AdminAnnouncementsPage] load error:', err)
      setError('讀取失敗，請確認管理員權限與 Firebase 連線。')
    } finally {
      setLoading(false)
    }
  }, [filterIdx])

  useEffect(() => { void load() }, [load])

  const selected = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId])

  // 原文的 unmatched 存在 draft 上（excerpt 存在 pending 上），選到才載、載過就留著
  useEffect(() => {
    const draftId = selected?.draftId
    if (!draftId || drafts[draftId]) return
    let cancelled = false
    fetchDraft(draftId)
      .then(d => { if (d && !cancelled) setDrafts(prev => ({ ...prev, [draftId]: d })) })
      .catch(err => console.error('[AdminAnnouncementsPage] draft load error:', err))
    return () => { cancelled = true }
  }, [selected?.draftId, drafts])

  const draft = selected ? drafts[selected.draftId] : undefined

  // 目標版本由抓取腳本在寫入時就推好存在文件上（scrape-tw-announcements.mjs 的
  // guessTarget）。這裡刻意**不**再實作一份前端推測 —— 兩份同樣的規則遲早會漂開，
  // 而推不出來時本來就一律標 needsReview、由維護者從下拉選單指定。
  const defaultTarget: MergeTarget | null = useMemo(() => {
    if (!selected?.targetVersion) return null
    return { versionId: selected.targetVersion, half: selected.targetHalf ?? 'upper' }
  }, [selected])

  async function handleMerge(activity: TimedActivity, target: MergeTarget) {
    if (!selected) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await mergeIntoVersion(selected.id, activity, target)
      if (!res.ok) {
        const ow = window.confirm(
          `${target.versionId} 的${target.half === 'upper' ? '上' : '下'}半已經有一筆「${activity.name}」`
          + `（${activity.startDate}）。要以這次的內容覆蓋它嗎？`,
        )
        if (!ow) { setMsg('已取消，該筆仍留在待審清單。'); return }
        const forced = await mergeIntoVersion(selected.id, activity, target, { overwrite: true })
        if (!forced.ok) { setMsg('覆寫失敗，請重試。'); return }
      }
      // api 層已 bumpDataVersion（邊緣快取）；本地那層 module 快取由呼叫端清，
      // 否則後台自己重整也還看得到舊的（同 AdminVersionEditorPage.handleSave）
      invalidatePatchVersionsCache()
      setMsg(`已合併進 ${target.versionId} ${target.half === 'upper' ? '上' : '下'}半，並已更新資料版本。`)
      await load()
    } catch (err) {
      console.error('[AdminAnnouncementsPage] merge error:', err)
      setMsg(err instanceof Error ? `合併失敗：${err.message}` : '合併失敗，請重試。')
    } finally {
      setBusy(false)
    }
  }

  async function handleReject() {
    if (!selected) return
    const reason = window.prompt('忽略原因（可留空）：') ?? ''
    setBusy(true)
    setMsg(null)
    try {
      await rejectPending(selected.id, reason)
      setMsg('已忽略。')
      await load()
    } catch (err) {
      console.error('[AdminAnnouncementsPage] reject error:', err)
      setMsg('忽略失敗，請重試。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-[20px] font-bold text-text-primary">台版公告審核</h1>
          <p className="text-[12px] text-text-secondary mt-1">
            由 <code>scripts/scrape-tw-announcements.mjs</code> 抓取解析，人工確認後合併進版本時間線。
          </p>
        </div>
        <Link to="/admin" className="text-[12px] text-accent-cyan hover:underline">← 返回後台</Link>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-4">
        {[...FILTERS, { label: '規則待擴充' }].map((f, i) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFilterIdx(i)}
            className={`px-2.5 py-1 text-[12px] rounded border transition-colors ${
              i === filterIdx
                ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50'
                : 'bg-bg-card text-text-secondary border-border hover:text-text-primary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {msg && (
        <div className="mb-3 px-3 py-2 text-[12px] rounded border bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30">
          {msg}
        </div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 text-[12px] rounded border bg-accent-red/10 text-accent-red border-accent-red/30">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-[13px] text-text-dim py-10 text-center">載入中…</div>
      ) : showInsights ? (
        <AnnouncementInsightsPanel versions={versions} drafts={allDrafts} pending={allPending} />
      ) : items.length === 0 ? (
        <div className="text-[13px] text-text-dim py-10 text-center border border-border rounded bg-bg-card">
          這個分類目前沒有項目。
          <div className="text-[11px] mt-1.5">
            公告是每週更新的；要抓新的請執行 <code>node scripts/scrape-tw-announcements.mjs</code>。
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
          {/* ── 待審清單 ─────────────────────────────────────────── */}
          <div className="border border-border rounded bg-bg-card overflow-hidden">
            <div className="px-2.5 py-1.5 text-[11px] font-bold text-text-secondary tracking-[1px] uppercase border-b border-border">
              {items.length} 筆
            </div>
            <div className="max-h-[600px] overflow-auto overscroll-contain">
              {items.map(it => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSelectedId(it.id)}
                  className={`w-full text-left px-2.5 py-2 border-b border-border/60 transition-colors ${
                    it.id === selectedId ? 'bg-accent-cyan/10' : 'hover:bg-bg-card'
                  }`}
                >
                  <div className="text-[12.5px] text-text-primary truncate">
                    {it.extracted?.name ?? <span className="text-accent-red">（無名稱）</span>}
                  </div>
                  <div className="text-[10.5px] text-text-dim mt-0.5">
                    {it.extracted?.startDate ?? '（無日期）'}
                    {it.targetVersion ? ` · ${it.targetVersion} ${it.targetHalf === 'lower' ? '下' : '上'}半` : ' · 版本未定'}
                  </div>
                  {(it.flags?.length ?? 0) > 0 && (
                    <div className="flex gap-1 flex-wrap mt-1">
                      {it.flags.map(f => (
                        <span key={f} className="px-1 py-px text-[9.5px] rounded bg-accent-yellow/15 text-accent-yellow border border-accent-yellow/30">
                          {PENDING_FLAG_LABEL[f] ?? f}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── 審核面板 ─────────────────────────────────────────── */}
          <div className="min-w-0">
            {selected && (
              <>
                {draft && (
                  <div className="mb-3 px-3 py-2 border border-border rounded bg-bg-card">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={draft.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12.5px] text-accent-cyan hover:underline"
                      >
                        {draft.title} ↗
                      </a>
                      <span className="text-[11px] text-text-dim">{draft.publishedAt}</span>
                      <span className="text-[11px] text-text-dim">· 本篇 {draft.activityCount} 筆</span>
                    </div>
                    {(draft.warnings?.length ?? 0) > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1.5">
                        {draft.warnings.map(w => (
                          <span key={w} className="px-1.5 py-0.5 text-[10px] rounded bg-accent-red/15 text-accent-red border border-accent-red/30">
                            ⚠ {PARSE_WARNING_LABEL[w] ?? w}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <AnnouncementReviewPanel
                  key={selected.id}
                  item={selected}
                  unmatched={draft?.unmatched ?? []}
                  versions={versions}
                  defaultTarget={defaultTarget}
                  busy={busy}
                  onMerge={handleMerge}
                  onReject={handleReject}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
