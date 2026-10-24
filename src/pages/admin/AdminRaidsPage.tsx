import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  getRaidDrafts, getRaidTerms, getRaidOverrides, getRaidSeasons, getStages, getBosses,
  saveRaidTerm, saveRaidOverride, deleteRaidOverride, publishRaidDraft, setRaidSeasonPublished,
} from '../../lib/api/raids'
import type { Boss, RaidDraft, RaidOverride, RaidOverrideDoc, RaidSeason, RaidTermDoc, RaidTermEntry, Stage } from '../../types/boss'
import { RAID_DIFFICULTY_ORDER, type RaidDifficulty } from '../../types/enums'
import { useAuth } from '../../contexts/AuthContext'
import { buildRaidDocs, diffDraft, indexTerms, type DocDiff, type RaidTermView } from '../../utils/raidDraft'
import { RaidSeasonView } from '../../components/raids/RaidSeasonView'
import { RaidEditContext, type RaidEditApi } from '../../components/raids/raidEdit'
import { RaidTermsPanel, TermRow } from '../../components/admin/raids/RaidTermsPanel'
import { RaidFieldEditor } from '../../components/admin/raids/RaidFieldEditor'
import { termKindLabel } from '../../components/admin/raids/raidTermLabels'

// ─── 武裝討伐草稿審核（PLAN-064 Phase D＋G-1）──────────────────────────────────
//
// 草稿由 node scripts/import-raid-dungeons.mjs --write 寫進 raidDrafts；這一頁：
//   差異（草稿 vs 前台）→ 譯名校對（寫 raidTerms）→ 預覽（與 /raids 同一個元件，可點字修改）
//   → 修正（非文字欄位的覆寫，寫 raidOverrides，PLAN-064 H）→ 發布（batch 寫三個集合＋bump）。
// raidDrafts／raidTerms／raidOverrides 不進 GameDataContext（只有這頁讀），本頁直接以 client SDK 讀寫；規則是 isAdmin()。
// 審核佇列是站長的：沒有任何一步會自動發布或自動把待校改成已校（PLAN-064 決策十二）。

type Tab = 'diff' | 'terms' | 'preview' | 'fix' | 'anecdotes' | 'anomalies'
const TABS: { key: Tab; label: string }[] = [
  { key: 'diff', label: '差異' }, { key: 'terms', label: '譯名校對' }, { key: 'preview', label: '預覽' },
  { key: 'fix', label: '修正' }, { key: 'anecdotes', label: '逸聞' }, { key: 'anomalies', label: '異常' },
]
const DIFF_LABEL: Record<DocDiff['status'], string> = { new: '新增', changed: '變動', removed: '將刪除' }
const DOC_LABEL: Record<DocDiff['kind'], string> = { season: '期', stage: '關卡組', boss: '首領' }

interface Published { seasons: RaidSeason[]; stages: Stage[]; bosses: Boss[] }

/** ISO（UTC）→ 本地時間「2026/10/24 02:34」 */
const localTime = (iso: string) => new Date(iso).toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

/** 草稿、對照表與前台三個集合（後台直讀 Firestore，不經 Worker 快取：要看的是此刻的真實狀態） */
async function fetchAdminData() {
  const [d, termDocs, overrideDocs, seasons, stages, bosses] = await Promise.all([
    getRaidDrafts(), getRaidTerms(), getRaidOverrides(), getRaidSeasons(), getStages(), getBosses(),
  ])
  return {
    drafts: [...d].sort((x, y) => y.seq - x.seq),
    termDocs,
    overrideDocs,
    published: { seasons, stages: stages.filter((x) => x.raid), bosses: bosses.filter((x) => x.seasonId) } as Published,
  }
}

export default function AdminRaidsPage() {
  const { userProfile } = useAuth()
  const actor = userProfile?.displayName || '管理員'
  const [drafts, setDrafts] = useState<RaidDraft[]>([])
  const [termDocs, setTermDocs] = useState<RaidTermDoc[]>([])
  const [overrideDocs, setOverrideDocs] = useState<RaidOverrideDoc[]>([])
  /** 預覽的點字修改 */
  const [editMode, setEditMode] = useState(false)
  const [editingTerm, setEditingTerm] = useState<RaidTermView | null>(null)
  const [published, setPublished] = useState<Published>({ seasons: [], stages: [], bosses: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('diff')
  const [difficulty, setDifficulty] = useState<RaidDifficulty>('normal')
  const [showCn, setShowCn] = useState(false)
  const [publishFlag, setPublishFlag] = useState<boolean | null>(null)

  const apply = useCallback((data: Awaited<ReturnType<typeof fetchAdminData>>) => {
    setDrafts(data.drafts)
    setTermDocs(data.termDocs)
    setOverrideDocs(data.overrideDocs)
    setPublished(data.published)
    setSelectedId((cur) => cur ?? data.drafts[0]?.id ?? null)
    setError(null)
    setLoading(false)
  }, [])
  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e))
    setLoading(false)
  }, [])
  useEffect(() => {
    let cancelled = false
    fetchAdminData().then((d) => { if (!cancelled) apply(d) }).catch((e) => { if (!cancelled) fail(e) })
    return () => { cancelled = true }
  }, [apply, fail])
  /** 發布、切換公開後重讀 */
  const load = async () => {
    setLoading(true)
    try { apply(await fetchAdminData()) } catch (e) { fail(e) }
  }

  const terms = useMemo(() => indexTerms(termDocs), [termDocs])
  /** 期 → 這一期的欄位覆寫（含 Firestore 鍵） */
  const overridesBySeason = useMemo(() => {
    const m = new Map<string, { key: string; o: RaidOverride }[]>()
    for (const d of overrideDocs) m.set(d.id, Object.entries(d.entries ?? {}).map(([key, o]) => ({ key, o })))
    return m
  }, [overrideDocs])
  /** 每期：草稿 → 已校譯名 → 欄位覆寫，以及與前台的差異 */
  const rows = useMemo(() => drafts.map((d) => {
    const ov = overridesBySeason.get(d.id) ?? []
    const applied = buildRaidDocs(d, terms, ov.map((r) => r.o))
    const diff = diffDraft(applied, published)
    const pub = published.seasons.find((s) => s.id === d.id)
    return { draft: d, applied, overrides: ov, diff, pub }
  }), [drafts, terms, overridesBySeason, published])
  const row = rows.find((r) => r.draft.id === selectedId) ?? null

  /** 預覽點字修改：畫面上的字（現在的譯文）→ 譯名 */
  const editApi: RaidEditApi | null = useMemo(() => {
    if (!editMode || !row) return null
    const byTw = new Map<string, RaidTermView>()
    for (const e of row.applied.entries) if (!byTw.has(e.tw)) byTw.set(e.tw, e)
    return { resolve: (t) => byTw.get(t), open: setEditingTerm }
  }, [editMode, row])
  /** 欄位修正：草稿原文 → 譯名（判斷某一欄是不是譯名） */
  const termByDraftTw = useMemo(() => new Map((row?.applied.entries ?? []).map((e) => [e.draftTw, e])), [row])

  /** 換期：公開開關回到「沿用前台現況」，預覽難度回到該期最低難度 */
  const selectSeason = (d: RaidDraft) => {
    setSelectedId(d.id)
    setPublishFlag(null)
    setDifficulty(RAID_DIFFICULTY_ORDER.find((x) => d.season.difficulties.includes(x)) ?? 'normal')
  }
  /** 公開開關：沒動過就沿用前台現況（新期預設列出） */
  const publishValue = publishFlag ?? (row?.pub ? row.pub.published : true)

  /** 對照表就地更新（不重讀整個集合） */
  const upsertLocalTerm = (kind: string, entry: RaidTermEntry) => {
    setTermDocs((docs) => {
      const hit = docs.find((d) => d.kind === kind)
      const key = `local-${entry.cn}`
      if (!hit) return [...docs, { id: kind, kind, entries: { [key]: entry } }]
      const others = Object.fromEntries(Object.entries(hit.entries).filter(([, e]) => e.cn !== entry.cn))
      return docs.map((d) => (d.kind === kind ? { ...d, entries: { ...others, [key]: entry } } : d))
    })
  }

  const handleSaveTerm = async (t: RaidTermView, tw: string) => {
    setBusy(true)
    try {
      const entry = await saveRaidTerm(t.kind, t.cn, tw, actor, { firstSeason: row?.draft.seq })
      upsertLocalTerm(t.kind, entry)
      setMsg(`已存譯名：${t.cn} → ${tw}`)
    } catch (e) {
      setError(`存檔失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmMany = async (list: RaidTermView[]) => {
    setBusy(true)
    try {
      for (const t of list) {
        const entry = await saveRaidTerm(t.kind, t.cn, t.tw, actor, { firstSeason: row?.draft.seq })
        upsertLocalTerm(t.kind, entry)
      }
      setMsg(`已確認 ${list.length} 筆`)
    } catch (e) {
      setError(`存檔失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 覆寫就地更新（不重讀整個集合） */
  const upsertLocalOverride = (seasonId: string, key: string, entry: RaidOverride | null) => {
    setOverrideDocs((docs) => {
      const hit = docs.find((d) => d.id === seasonId)
      const entries = { ...(hit?.entries ?? {}) }
      if (entry) entries[key] = entry
      else delete entries[key]
      const next = { id: seasonId, seasonId, entries }
      return hit ? docs.map((d) => (d.id === seasonId ? next : d)) : [...docs, next]
    })
  }

  const handleSaveOverride = async (o: Omit<RaidOverride, 'updatedAt' | 'updatedBy'>) => {
    if (!row) return
    setBusy(true)
    try {
      const { key, entry } = await saveRaidOverride(row.draft.id, o, actor)
      upsertLocalOverride(row.draft.id, key, entry)
      setMsg('已存修正（發布後生效）')
    } catch (e) {
      setError(`存檔失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteOverride = async (key: string) => {
    if (!row) return
    setBusy(true)
    try {
      await deleteRaidOverride(row.draft.id, key)
      upsertLocalOverride(row.draft.id, key, null)
      setMsg('已還原成草稿的值（發布後生效）')
    } catch (e) {
      setError(`還原失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handlePublish = async () => {
    if (!row) return
    const n = { new: 0, changed: 0, removed: 0 }
    for (const d of row.diff) n[d.status]++
    const ok = window.confirm(
      `發布第 ${row.draft.seq} 期「${row.applied.season.name}」到前台？\n` +
      `新增 ${n.new}、變動 ${n.changed}、刪除 ${n.removed} 份文件；前台公開：${publishValue ? '是' : '否（寫入但不列出）'}。\n` +
      `仍待校的譯名 ${row.applied.stillPending.length} 筆會以暫譯上線（前台標「待校」）。\n` +
      `人工修正 ${row.applied.overrides.length} 筆${row.applied.suspended.length ? `；⚠ 另有 ${row.applied.suspended.length} 筆因草稿已變而暫停套用（見「修正」分頁）` : ''}。`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const r = await publishRaidDraft(row.draft, terms, row.overrides.map((x) => x.o), actor, publishValue)
      setMsg(`已發布：寫入 ${r.written} 份、刪除 ${r.deleted.length} 份、套用譯名 ${r.applied.length} 筆、人工修正 ${r.overrides.length} 筆。前台在下次載入時讀到新版本。`)
      await load()
    } catch (e) {
      setError(`發布失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleTogglePublished = async () => {
    if (!row?.pub) return
    setBusy(true)
    try {
      await setRaidSeasonPublished(row.pub.id, !row.pub.published, actor)
      setMsg(row.pub.published ? '已從前台列表隱藏' : '已在前台列出')
      await load()
    } catch (e) {
      setError(`更新失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const statusOf = (r: (typeof rows)[number]) => {
    if (!r.pub) return { text: '新期', cls: 'text-accent-cyan' }
    if (r.diff.length) return { text: `有差異 ${r.diff.length}`, cls: 'text-accent-yellow' }
    return { text: '與前台相同', cls: 'text-text-dim' }
  }
  const bossMap = (bs: Boss[]) => Object.fromEntries(bs.map((b) => [b.id, b]))

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <Link to="/admin" className="text-accent-cyan hover:underline text-sm">← 管理後台</Link>
        <h1 className="text-2xl font-bold">武裝討伐審核</h1>
        <span className="text-[12px] text-text-dim">草稿來自 <code>node scripts/import-raid-dungeons.mjs --write</code></span>
      </div>

      {msg && <div className="mb-3 px-3 py-2 text-[12px] rounded border bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30">{msg}</div>}
      {error && <div className="mb-3 px-3 py-2 text-[12px] rounded border bg-accent-red/10 text-accent-red border-accent-red/30">{error}</div>}

      {loading ? (
        <div className="text-[13px] text-text-dim py-10 text-center">載入中…（草稿一期約 200 KB，第一次會稍慢）</div>
      ) : drafts.length === 0 ? (
        <div className="text-[13px] text-text-dim py-10 text-center border border-border rounded bg-bg-card">
          還沒有草稿。先跑 <code>node scripts/import-raid-dungeons.mjs</code>，照報告確認後加 <code>--write</code>。
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-4">
          {/* ── 期清單 ── */}
          <div className="border border-border rounded bg-bg-card overflow-hidden self-start">
            <div className="max-h-[720px] overflow-auto">
              {rows.map((r) => {
                const st = statusOf(r)
                return (
                  <button
                    key={r.draft.id}
                    type="button"
                    onClick={() => selectSeason(r.draft)}
                    className={`w-full text-left px-2.5 py-2 border-b border-border/60 transition-colors ${r.draft.id === selectedId ? 'bg-accent-cyan/10' : 'hover:bg-bg-card-hover'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-dim w-6">#{r.draft.seq}</span>
                      <span className="text-[13px] text-text-primary truncate">{r.applied.season.name}</span>
                      {r.pub && !r.pub.published && <span className="text-[10px] text-text-dim">（未公開）</span>}
                    </div>
                    <div className="text-[10.5px] mt-0.5 flex gap-2">
                      <span className={st.cls}>{st.text}</span>
                      <span className="text-text-dim">待校 {r.applied.stillPending.length}</span>
                      {r.draft.anomalies.length > 0 && <span className="text-accent-yellow">異常 {r.draft.anomalies.length}</span>}
                      {r.overrides.length > 0 && <span className="text-accent-cyan">修正 {r.applied.overrides.length}</span>}
                      {r.applied.suspended.length > 0 && <span className="text-accent-yellow">⚠ {r.applied.suspended.length}</span>}
                      <span className="text-text-dim">{r.draft.season.twStatus === 'planned' ? '台版預計' : '台版已開'}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── 審核面板 ── */}
          {row && (
            <div className="min-w-0 space-y-3">
              <div className="rounded border border-border bg-bg-card px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-bold text-text-primary">#{row.draft.seq} {row.applied.season.name}<span className="text-text-dim text-[12px] ml-2">{row.draft.season.nameCn}</span></div>
                  <div className="text-[11px] text-text-dim">
                    草稿 {localTime(row.draft.generatedAt)}・擷取規則 v{row.draft.parserVersion}・{row.draft.sourceBuild}
                    {row.draft.lastPublished && `・上次發布 ${localTime(row.draft.lastPublished.at)}（${row.draft.lastPublished.by}）`}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  {row.pub && (
                    <button type="button" disabled={busy} onClick={handleTogglePublished}
                      className="px-2.5 py-1 text-[12px] rounded border border-border text-text-secondary hover:text-text-primary disabled:opacity-40">
                      {row.pub.published ? '從前台隱藏' : '在前台列出'}
                    </button>
                  )}
                  <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                    <input type="checkbox" checked={publishValue} onChange={(e) => setPublishFlag(e.target.checked)} />
                    發布後在前台列出
                  </label>
                  <button type="button" disabled={busy || (!!row.pub && row.diff.length === 0)} onClick={handlePublish}
                    className="px-3 py-1 text-[12.5px] font-bold rounded border bg-accent-green/15 text-accent-green border-accent-green/40 hover:bg-accent-green/25 disabled:opacity-40">
                    {row.pub && row.diff.length === 0 ? '已是最新' : '發布'}
                  </button>
                </div>
              </div>

              <div className="flex gap-1 flex-wrap">
                {TABS.map((t) => (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)}
                    className={`px-2.5 py-1 text-[12px] rounded border transition-colors ${t.key === tab ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50' : 'bg-bg-card text-text-secondary border-border hover:text-text-primary'}`}>
                    {t.label}
                    {t.key === 'terms' && ` ${row.applied.stillPending.length}`}
                    {t.key === 'diff' && row.diff.length > 0 && ` ${row.diff.length}`}
                    {t.key === 'anecdotes' && ` ${row.draft.anecdotes.length}`}
                    {t.key === 'fix' && row.overrides.length > 0 && ` ${row.applied.overrides.length}${row.applied.suspended.length ? ` ⚠${row.applied.suspended.length}` : ''}`}
                    {t.key === 'anomalies' && row.draft.anomalies.length > 0 && ` ${row.draft.anomalies.length}`}
                  </button>
                ))}
              </div>

              {tab === 'diff' && (
                <div className="rounded border border-border bg-bg-card">
                  {row.diff.length === 0 ? (
                    <div className="text-[13px] text-text-dim py-6 text-center">{row.pub ? '草稿與前台相同，不需要發布。' : '尚未發布過。'}</div>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {row.diff.map((d) => (
                        <li key={d.id} className="px-3 py-1.5 text-[12.5px] flex gap-3">
                          <span className={`w-12 shrink-0 ${d.status === 'removed' ? 'text-accent-red' : d.status === 'new' ? 'text-accent-cyan' : 'text-accent-yellow'}`}>{DIFF_LABEL[d.status]}</span>
                          <span className="w-14 shrink-0 text-text-dim">{DOC_LABEL[d.kind]}</span>
                          <span className="text-text-primary font-[JetBrains_Mono,monospace] text-[12px]">{d.id}</span>
                          {d.fields.length > 0 && <span className="text-text-dim truncate">{d.fields.join('、')}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.applied.applied.length > 0 && (
                    <div className="px-3 py-2 border-t border-border/60 text-[11.5px] text-text-dim">
                      發布時會套用的已校譯名：{row.applied.applied.slice(0, 20).map((a) => `${a.from}→${a.to}`).join('、')}{row.applied.applied.length > 20 ? `…等 ${row.applied.applied.length} 筆` : ''}
                    </div>
                  )}
                </div>
              )}

              {tab === 'terms' && (
                <RaidTermsPanel entries={row.applied.entries} busy={busy} onSave={handleSaveTerm} onConfirmMany={handleConfirmMany} />
              )}

              {tab === 'preview' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 flex-wrap text-[12px]">
                    <label className="flex items-center gap-1.5 text-text-secondary">
                      <input type="checkbox" checked={editMode} onChange={(e) => setEditMode(e.target.checked)} />
                      點字修改：虛線框起來的字是譯名，點一下就能改
                    </label>
                    {editMode && <span className="text-text-dim">數字、回合、陣容這類不是譯名的內容，到「修正」分頁改。</span>}
                  </div>
                  <div className="rounded border border-border bg-bg-dark/30 p-4">
                    <RaidEditContext.Provider value={editApi}>
                      <RaidSeasonView
                        season={row.applied.season}
                        stages={[...row.applied.stages].sort((a, b) => a.raid!.group - b.raid!.group)}
                        bosses={bossMap(row.applied.bosses)}
                        difficulty={difficulty}
                        onDifficultyChange={setDifficulty}
                        preview
                      />
                    </RaidEditContext.Provider>
                  </div>
                </div>
              )}

              {tab === 'fix' && (
                <RaidFieldEditor
                  key={row.draft.id}
                  draft={row.draft}
                  built={row.applied}
                  overrides={row.overrides}
                  termByDraftTw={termByDraftTw}
                  busy={busy}
                  onSaveOverride={handleSaveOverride}
                  onDeleteOverride={handleDeleteOverride}
                  onSaveTerm={handleSaveTerm}
                />
              )}

              {tab === 'anecdotes' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-[12px] text-text-dim">
                    逸聞只在這裡預覽；前台呈現與協作校對交給故事館子計畫（PLAN-064 決策十四）。
                    <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={showCn} onChange={(e) => setShowCn(e.target.checked)} />對照原文</label>
                  </div>
                  {row.applied.bosses.map((b) => {
                    const list = row.draft.anecdotes.filter((a) => a.bossId === b.id)
                    if (!list.length) return null
                    return (
                      <details key={b.id} className="rounded border border-border bg-bg-card px-3 py-2">
                        <summary className="cursor-pointer text-[13px] text-text-primary">{b.name}<span className="text-text-dim ml-2">{list.length} 篇</span></summary>
                        <div className="mt-2 space-y-3">
                          {list.map((a) => (
                            <div key={a.anecdoteId} className="text-[12.5px]">
                              <div className="font-bold text-text-primary">{a.title}<span className="text-[10.5px] text-text-dim ml-2">解析等級 {a.unlockLevel}</span></div>
                              <p className="whitespace-pre-line leading-relaxed text-text-secondary">{a.body}</p>
                              {showCn && <p className="whitespace-pre-line leading-relaxed text-text-dim mt-1 border-l-2 border-border pl-2">{a.titleCn}｜{a.bodyCn}</p>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )
                  })}
                </div>
              )}

              {tab === 'anomalies' && (
                <div className="rounded border border-border bg-bg-card px-3 py-2 text-[12.5px] text-text-secondary space-y-1">
                  {row.draft.anomalies.length === 0 ? (
                    <div className="text-text-dim py-4 text-center">這一期沒有異常。</div>
                  ) : row.draft.anomalies.map((a) => (
                    <div key={`${a.levelId}-${a.code}`}>
                      關卡 {a.levelId}（{row.draft.season.difficultyNames[a.code as RaidDifficulty] ?? a.code}）：高難度實際用了初試的首領、且沒有強化來源
                      {a.registered ? '（已登記；前台顯示註記）' : <span className="text-accent-yellow">（未登記：確認後登記到 scripts/lib/raidAnomalies.json）</span>}
                    </div>
                  ))}
                  <p className="text-[11px] text-text-dim pt-1">遊戲內確認後，改 raidAnomalies.json 的 status 與 note，重跑匯入再發布，前台註記跟著變（F-5）。</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {editingTerm && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditingTerm(null)}>
          <div className="w-full max-w-3xl rounded-lg border border-border bg-bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <span className="text-[13px] font-bold text-text-primary">修改譯名・{termKindLabel(editingTerm.kind)}</span>
              <button type="button" onClick={() => setEditingTerm(null)} className="ml-auto px-2 py-0.5 text-[12px] rounded border border-border text-text-secondary">關閉</button>
            </div>
            <TermRow
              key={`${editingTerm.kind}:${editingTerm.cn}:${editingTerm.tw}`}
              term={editingTerm}
              busy={busy}
              autoFocus
              onSave={async (tw) => { await handleSaveTerm(editingTerm, tw); setEditingTerm(null) }}
            />
            <p className="px-3 py-2 text-[11px] text-text-dim">
              寫進譯名對照表：這一期與其他期出現同一個原文的地方都會換。名詞改了，含這個名詞的說明文字也會跟著換。
            </p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

