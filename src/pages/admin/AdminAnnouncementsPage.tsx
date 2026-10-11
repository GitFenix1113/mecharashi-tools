import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchPendingActivities,
  fetchAllDrafts,
  fetchDraft,
  mergeIntoVersion,
  mergeManyIntoVersion,
  rejectPending,
  toMergeableActivity,
  type MergeTarget,
} from '../../lib/api/announcementStaging'
import type { AnnouncementDraft, PendingActivity, PendingStatus } from '../../types/announcementStaging'
import { PENDING_FLAG_LABEL, PARSE_WARNING_LABEL } from '../../types/announcementStaging'
import type { TimedActivity } from '../../data/patchVersions/types'
import { usePatchVersions, invalidatePatchVersionsCache } from '../../hooks/usePatchVersions'
import AnnouncementReviewPanel from '../../components/admin/AnnouncementReviewPanel'
import AnnouncementInsightsPanel from '../../components/admin/AnnouncementInsightsPanel'
import { describeInferred, withInferred } from '../../utils/announcementMerge'

// ─── 台版公告審核工作檯（PLAN-048 任務 2-3）──────────────────────────────────
//
// announcementDrafts / pendingActivities 不進 GameDataContext 快取（同 changeHistory
// 的理由：持續成長、只查最近幾頁）。本頁直接以 client SDK 查詢，規則層是 isAdmin()。
//
// 預設只顯示 needsReview，且把「解析器沒把握」的排最前面 ——
// 零 flag 的那 66% 本來就不需要人看，混在一起只會稀釋注意力。
//
// 2026-10-11 起「可直接放行」由每週排程自動寫進版本（scrape-tw-announcements.mjs 的 ⑥），
// 這一頁平常只剩「待確認」需要人。那個分頁與「全部放行」按鈕留著當備援：
// 排程跳過（選擇器失效、--no-auto-merge、交易失敗）的筆會停在那裡。

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

// ── 依月份分組（2026-10-11 站長要求）──────────────────────────────────────────
//
// 待確認一度累積 49 筆、橫跨五個月，混成一長串時看不出「這週新進來的是哪幾筆」。
// 依活動起始日的年月分組、新的月份在上；舊月份可收合（站長：舊版活動先暫停），
// 收合狀態記在本機 —— 純個人瀏覽偏好，不必進資料庫。

/** 分組鍵：起始日的年月（YYYY/MM）。抽不到日期的自成一組，排最後。 */
const NO_DATE = '（無日期）'
function monthOf(item: PendingActivity): string {
  return item.extracted?.startDate?.slice(0, 7) ?? NO_DATE
}
function compareMonthDesc(a: string, b: string): number {
  if (a === b) return 0
  if (a === NO_DATE) return 1
  if (b === NO_DATE) return -1
  return b.localeCompare(a)
}

const COLLAPSED_KEY = 'mecharashi_admin_announcements_collapsed'
function readCollapsed(): Set<string> | null {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}
function writeCollapsed(months: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...months]))
  } catch {
    // 無痕模式／停用儲存：收合照樣有效，只是重整後不記得
  }
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
      // 先分月（新的在上），月內再照「最需要人腦的置頂」；同權重維持 api 層的起始日新→舊
      rows.sort((a, b) => compareMonthDesc(monthOf(a), monthOf(b)) || priority(a) - priority(b))
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

  /** [月份, 該月的筆] —— items 已依月份排好，這裡只切段 */
  const groups = useMemo(() => {
    const byMonth = new Map<string, PendingActivity[]>()
    for (const it of items) {
      const k = monthOf(it)
      const g = byMonth.get(k)
      if (g) g.push(it)
      else byMonth.set(k, [it])
    }
    return [...byMonth.entries()]
  }, [items])

  // 收合的月份。null ＝ 從沒操作過 → 預設只展開最新的一個月。
  // 操作過之後才記住整組；之後新出現的月份不在集合裡，所以會自動展開。
  const [collapsed, setCollapsed] = useState<Set<string> | null>(readCollapsed)
  const isCollapsed = (month: string) => (collapsed ? collapsed.has(month) : month !== groups[0]?.[0])
  function toggleMonth(month: string) {
    setCollapsed(prev => {
      const next = new Set(prev ?? groups.slice(1).map(([m]) => m))
      if (next.has(month)) next.delete(month)
      else next.add(month)
      writeCollapsed(next)
      return next
    })
  }

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

  /**
   * 批次放行：把目前清單中「可直接放行、推得出目標版本、必要欄位齊全」的整批寫進去。
   *
   * 2026-10-11 起這件事由每週排程自動做（站長：「可放行的就不用等管理員」），
   * 這顆按鈕降為備援 —— 排程被跳過的筆（見檔頭）在這裡一次補上。
   * 疊合順序與排程相同：解析結果 → 規則推估 → 人工編修。
   */
  const bulkTargets = useMemo(
    () =>
      items
        .filter(it => it.status === 'parsed' && it.targetVersion)
        .map(it => {
          const activity = toMergeableActivity({ ...withInferred(it.extracted ?? {}, it.inferred), ...(it.reviewed ?? {}) })
          if (!activity) return null
          return {
            pendingId: it.id,
            activity,
            target: { versionId: it.targetVersion!, half: it.targetHalf ?? 'upper' } as MergeTarget,
            label: `${activity.name}（${activity.startDate}）`,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [items],
  )

  async function handleBulkMerge() {
    if (bulkTargets.length === 0) return
    const hidden = bulkTargets.filter(e => e.activity.hidden).length
    const ok = window.confirm(
      `將把 ${bulkTargets.length} 筆一次合併進各自推算出的版本半期。\n`
      + (hidden > 0 ? `其中 ${hidden} 筆缺檔期長度，會以隱藏狀態寫入（前台不顯示）。\n` : '')
      + '\n目標半期若已有同名同起始日的活動，該筆會被跳過而不是覆蓋。\n要繼續嗎？',
    )
    if (!ok) return

    setBusy(true)
    setMsg(null)
    try {
      const res = await mergeManyIntoVersion(bulkTargets, (done, total) =>
        setMsg(`批次放行中… ${done}/${total}`),
      )
      invalidatePatchVersionsCache()
      const parts = [`已合併 ${res.merged} 筆`]
      if (res.conflicts.length) parts.push(`跳過 ${res.conflicts.length} 筆（目標已有同名同日：${res.conflicts.join('、')}）`)
      if (res.failed.length) parts.push(`失敗 ${res.failed.length} 筆（${res.failed.map(f => f.label).join('、')}）`)
      setMsg(parts.join('；') + '。')
      await load()
    } catch (err) {
      console.error('[AdminAnnouncementsPage] bulk merge error:', err)
      setMsg(err instanceof Error ? `批次放行失敗：${err.message}` : '批次放行失敗，請重試。')
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
            由 <code>scripts/scrape-tw-announcements.mjs</code> 每週抓取解析；可直接放行的（含檔期可推估的卡池）由排程自動合併，
            這裡處理剩下需要人看的。
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
            <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-text-secondary tracking-[1px] uppercase">
                {items.length} 筆
              </span>
              {/* 只在「可直接放行」分頁出現 —— 其他分頁的筆是「需要人看」或已處理完 */}
              {FILTERS[filterIdx]?.label === '可直接放行' && bulkTargets.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleBulkMerge}
                  className="px-2 py-0.5 text-[11px] font-bold rounded border bg-accent-green/15 text-accent-green border-accent-green/40 hover:bg-accent-green/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  全部放行（{bulkTargets.length}）
                </button>
              )}
            </div>
            <div className="max-h-[600px] overflow-auto overscroll-contain">
              {groups.map(([month, monthItems]) => {
                const closed = isCollapsed(month)
                const halves = [...new Set(monthItems.map(it =>
                  it.targetVersion ? `${it.targetVersion} ${it.targetHalf === 'lower' ? '下' : '上'}半` : '版本未定'))]
                return (
                  <div key={month}>
                    <button
                      type="button"
                      onClick={() => toggleMonth(month)}
                      aria-expanded={!closed}
                      className="sticky top-0 z-10 w-full flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border bg-bg-tooltip text-left hover:text-text-primary transition-colors"
                    >
                      <span className="text-[10px] text-text-dim w-2.5">{closed ? '▶' : '▼'}</span>
                      <span className="text-[12px] font-bold text-text-primary">
                        {month === NO_DATE ? month : `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`}
                      </span>
                      <span className="text-[11px] text-accent-cyan">{monthItems.length} 筆</span>
                      <span className="ml-auto text-[10px] text-text-dim truncate">{halves.join('、')}</span>
                    </button>
                    {!closed && monthItems.map(it => (
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
                          {it.mergedInto?.actorUid === 'scheduler' && ' · 排程放行'}
                        </div>
                        {it.inferred && it.status !== 'merged' && (
                          <div className="text-[10px] text-accent-purple mt-0.5 truncate" title={describeInferred(it.inferred)}>
                            {describeInferred(it.inferred)}
                          </div>
                        )}
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
                )
              })}
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
