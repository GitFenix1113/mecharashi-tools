import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getChangeHistoryPage,
  planRestore,
  commitRestore,
  type RestorePlanResult,
  type RestoreResult,
} from '../../lib/firestoreApi'
import type { ChangeHistoryEntry } from '../../types/changeHistory'
import {
  ACTION_LABEL,
  TARGET_LABEL,
  type ChangeAction,
  type ChangeTargetKind,
} from '../../types/changeHistory'
import type { PageCursor } from '../../lib/api/firestoreCore'
import { LoadMoreButton } from '../user/admin/shared'

// ─── 變更歷史檢視頁（PLAN-030 Phase E）───────────────────────────────────────
// changeHistory 不進 GameDataContext 快取（決策一），本頁直接走 getChangeHistoryPage
// 伺服器分頁。也不可用 useClientPaged / useServerPaged——兩者綁定 name 排序模型，
// 與本頁的 at 時間排序不相容。

const PAGE_SIZE = 30

const TARGET_OPTIONS: (ChangeTargetKind | '')[] = ['', 'buff', 'pilotSkill', 'glossaryTerm']
const ACTION_OPTIONS: (ChangeAction | '')[] = ['', 'create', 'update', 'delete', 'restore']

/** 操作類型色票：create 綠 / update 黃 / delete 紅 / restore 青 */
const ACTION_CHIP: Record<ChangeAction, string> = {
  create:  'bg-accent-green/15 text-accent-green border-accent-green/30',
  update:  'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30',
  delete:  'bg-accent-red/15 text-accent-red border-accent-red/30',
  restore: 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30',
}

/** at 是 Firestore Timestamp（剛寫入、伺服器時間未回傳時短暫為 null） */
function formatAt(at: ChangeHistoryEntry['at']): string {
  if (!at) return '（時間同步中）'
  const d = at.toDate()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function FilterGroup<T extends string>({
  label,
  options,
  labelOf,
  value,
  onChange,
}: {
  label: string
  options: (T | '')[]
  labelOf: (v: T) => string
  value: T | ''
  onChange: (v: T | '') => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-text-dim shrink-0">{label}</span>
      {options.map((opt) => (
        <button
          key={opt || '__all'}
          onClick={() => onChange(opt)}
          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
            value === opt
              ? 'bg-accent-green/15 text-accent-green border-accent-green/40'
              : 'bg-bg-dark text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          {opt === '' ? '全部' : labelOf(opt)}
        </button>
      ))}
    </div>
  )
}

/** delete 記錄的快照展開區：文件本體 + 反向修補單（格式化 JSON）＋ 一鍵還原入口 */
function SnapshotView({ entry, onRestore }: { entry: ChangeHistoryEntry; onRestore: () => void }) {
  const snap = entry.snapshot
  if (!snap) return <div className="text-xs text-text-dim">此記錄沒有快照。</div>
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[2px] text-text-dim uppercase mb-1">
          Snapshot · 被刪文件（{entry.targetId}）
        </div>
        <pre className="text-[11px] leading-relaxed bg-bg-dark border border-border rounded-lg p-3 overflow-auto max-h-72 text-text-secondary">
          {JSON.stringify(snap.doc, null, 2)}
        </pre>
      </div>
      <div>
        <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[2px] text-text-dim uppercase mb-1">
          Patches · 被移除的引用（{snap.patches?.length ?? 0} 處）
        </div>
        {snap.patches?.length ? (
          <div className="space-y-1.5">
            {snap.patches.map((p, i) => (
              <div key={i} className="bg-bg-dark border border-border rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-accent-purple/15 text-accent-purple border border-accent-purple/30 text-[10px]">
                    {p.op}
                  </span>
                  <span className="font-mono text-text-primary">{p.coll}/{p.docId}</span>
                  <span className="font-mono text-text-dim">{p.path}</span>
                </div>
                <pre className="text-[11px] leading-relaxed mt-1.5 overflow-auto max-h-40 text-text-secondary whitespace-pre-wrap break-all">
                  {JSON.stringify(p.value, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-text-dim">無引用被清除（目標未被任何地方引用）。</div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => { e.stopPropagation(); onRestore() }}
          className="px-4 py-1.5 rounded-lg text-xs font-bold bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/40 hover:bg-accent-cyan/25 transition-colors"
        >
          ↺ 還原此刪除
        </button>
        <span className="text-[11px] text-text-dim">
          文件本體 setDoc 重建；引用冪等重加（缺就補、已有就跳過），期間被編輯的位置會跳過並報告。
        </span>
      </div>
    </div>
  )
}

// ─── 還原對話框（F-3）────────────────────────────────────────────────────────
// 沿用 ConfirmDeleteDialog 的遮罩＋卡片外殼；主鍵為青色（restore 色票），
// blockers 非空（目標已被重建 / batch 超限）時禁用確認並列出原因。

type RestoreFlow =
  | { phase: 'loading' }
  | { phase: 'preview'; plan: RestorePlanResult; error: string | null; busy: boolean }
  | { phase: 'done'; result: RestoreResult }

const SKIP_REASON_LABEL: Record<string, string> = {
  docMissing:    '來源文件已不存在',
  pathMissing:   '欄位路徑已不存在',
  shapeMismatch: '欄位形狀不符',
  anchorMismatch: '定位不到原本的陣列元素',
  conflict:      '位置已有不同的值（期間被編輯）',
  badPatch:      '修補單格式不完整',
}

function RestoreDialog({
  flow,
  onConfirm,
  onClose,
}: {
  flow: RestoreFlow
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-accent-cyan/40 rounded-xl p-6 w-full max-w-lg max-h-[90vh] flex flex-col">
        {flow.phase === 'loading' && (
          <p className="text-sm text-text-secondary py-6 text-center">讀取快照與現況中…</p>
        )}

        {flow.phase === 'preview' && (() => {
          const { plan } = flow
          const blocked = plan.blockers.length > 0
          return (
            <>
              <div className="shrink-0">
                <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
                  <span className="text-accent-cyan">↺</span>
                  還原「{plan.targetName || plan.targetId}」？
                </h3>
                <p className="text-xs text-text-dim mt-1 font-mono break-all">{plan.coll}/{plan.targetId}</p>
              </div>

              <div className="overflow-y-auto flex-1 mt-4 space-y-3 text-sm">
                {blocked && (
                  <div className="rounded-lg border border-accent-red/40 bg-accent-red/10 p-3">
                    <p className="text-accent-red font-bold text-xs mb-1">⚠ 無法還原：</p>
                    <ul className="list-disc pl-5 space-y-1 text-[13px] text-text-secondary">
                      {plan.blockers.map((b, i) => <li key={i}>{b.detail}</li>)}
                    </ul>
                  </div>
                )}

                {!blocked && (
                  <p className="text-text-secondary">
                    將重建文件本體，並重加 <span className="text-accent-cyan font-bold">{plan.plan.applied.length}</span> 處引用
                    {plan.plan.alreadyPresent.length > 0 && <>；<span className="text-text-dim">{plan.plan.alreadyPresent.length} 處已在原位，無需重加</span></>}。
                  </p>
                )}

                {plan.plan.skipped.length > 0 && (
                  <div className="rounded-lg border border-accent-yellow/30 bg-accent-yellow/5 p-3">
                    <p className="text-accent-yellow font-bold text-xs mb-1.5">
                      以下 {plan.plan.skipped.length} 處無法自動還原，將跳過（不影響其餘還原）：
                    </p>
                    <ul className="space-y-1 text-[12px] text-text-secondary">
                      {plan.plan.skipped.map((s, i) => (
                        <li key={i}>
                          <span className="font-mono text-[11px] text-text-dim">{s.patch.coll}/{s.patch.docId}</span>
                          {' '}<span className="font-mono text-[11px]">{s.patch.path}</span>
                          {' — '}{SKIP_REASON_LABEL[s.reason] ?? s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {flow.error && <p className="text-xs text-accent-red">⚠ {flow.error}</p>}
              </div>

              <div className="flex gap-3 mt-4 shrink-0">
                <button
                  onClick={onConfirm}
                  disabled={blocked || flow.busy}
                  className="flex-1 px-4 py-2 bg-accent-cyan text-black font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {flow.busy ? '還原中…' : '確認還原'}
                </button>
                <button
                  onClick={onClose}
                  disabled={flow.busy}
                  className="px-4 py-2 border border-border text-text-secondary rounded-lg hover:bg-bg-dark transition-colors disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </>
          )
        })()}

        {flow.phase === 'done' && (
          <>
            <h3 className="text-lg font-bold text-accent-cyan shrink-0">✓ 還原完成</h3>
            <div className="overflow-y-auto flex-1 mt-3 space-y-2 text-sm text-text-secondary">
              <p>
                「{flow.result.targetName}」已重建；重加引用 <span className="text-accent-cyan font-bold">{flow.result.restoredRefs}</span> 處
                {flow.result.alreadyPresent > 0 && <>、{flow.result.alreadyPresent} 處原本就在</>}
                {flow.result.skipped.length > 0 && <>、<span className="text-accent-yellow font-bold">{flow.result.skipped.length}</span> 處跳過</>}。
              </p>
              {flow.result.skipped.length > 0 && (
                <ul className="space-y-1 text-[12px] rounded-lg border border-accent-yellow/30 bg-accent-yellow/5 p-3">
                  {flow.result.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="font-mono text-[11px] text-text-dim">{s.patch.coll}/{s.patch.docId}</span>
                      {' '}<span className="font-mono text-[11px]">{s.patch.path}</span>
                      {' — '}{SKIP_REASON_LABEL[s.reason] ?? s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-accent-cyan text-black font-bold rounded-lg hover:opacity-90 transition-opacity shrink-0"
            >
              關閉
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function AdminHistoryPage() {
  const [target, setTarget] = useState<ChangeTargetKind | ''>('')
  const [action, setAction] = useState<ChangeAction | ''>('')

  const [items, setItems] = useState<ChangeHistoryEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [restoreFlow, setRestoreFlow] = useState<RestoreFlow | null>(null)

  // 游標與請求序號放 ref：切換篩選要重置游標重新查詢（進度表 E-2），
  // 序號用來丟棄慢速回應——快速連點篩選時，舊請求的結果不可覆蓋新篩選的列表。
  const cursorRef = useRef<PageCursor>(null)
  const reqSeqRef = useRef(0)

  const fetchPage = useCallback(async (reset: boolean) => {
    const seq = ++reqSeqRef.current
    setLoading(true)
    setError(null)
    if (reset) cursorRef.current = null
    try {
      const page = await getChangeHistoryPage({
        target: target || undefined,
        action: action || undefined,
        cursor: cursorRef.current,
        pageSize: PAGE_SIZE,
      })
      if (seq !== reqSeqRef.current) return
      cursorRef.current = page.cursor
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]))
      setHasMore(page.hasMore)
    } catch (err) {
      if (seq !== reqSeqRef.current) return
      console.error('[AdminHistoryPage] 查詢失敗:', err)
      setError(err instanceof Error ? err.message : '查詢變更歷史失敗')
    } finally {
      if (seq === reqSeqRef.current) setLoading(false)
    }
  }, [target, action])

  useEffect(() => {
    void fetchPage(true)
  }, [fetchPage])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── 還原流程（F-3）：plan → 預覽確認 → commit → 結果報告 → 重新整理列表 ──
  const startRestore = async (logId: string) => {
    setRestoreFlow({ phase: 'loading' })
    try {
      const plan = await planRestore(logId)
      setRestoreFlow({ phase: 'preview', plan, error: null, busy: false })
    } catch (err) {
      console.error('[AdminHistoryPage] 還原預檢失敗:', err)
      setError(err instanceof Error ? err.message : '還原預檢失敗')
      setRestoreFlow(null)
    }
  }

  const confirmRestore = async () => {
    if (restoreFlow?.phase !== 'preview') return
    setRestoreFlow({ ...restoreFlow, busy: true, error: null })
    try {
      const result = await commitRestore(restoreFlow.plan)
      setRestoreFlow({ phase: 'done', result })
    } catch (err) {
      console.error('[AdminHistoryPage] 還原失敗:', err)
      setRestoreFlow({
        ...restoreFlow,
        busy: false,
        error: err instanceof Error ? err.message : '還原失敗',
      })
    }
  }

  const closeRestore = () => {
    // 還原成功會新增一筆 restore log —— 關閉時重新整理列表讓它浮上來
    const shouldRefresh = restoreFlow?.phase === 'done'
    setRestoreFlow(null)
    if (shouldRefresh) void fetchPage(true)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-xs text-text-dim mb-4">
        <Link to="/admin" className="hover:text-text-secondary transition-colors no-underline">後台管理</Link>
        <span>›</span>
        <span className="text-accent-green">變更歷史</span>
      </div>

      {/* 頁首 */}
      <div className="mb-6">
        <div className="text-[10px] font-[Orbitron,sans-serif] tracking-[3px] text-accent-green uppercase mb-1">
          Admin · Change History
        </div>
        <h1 className="text-2xl font-bold text-text-primary">變更歷史</h1>
        <p className="text-text-dim text-sm mt-1">
          後台資料異動的稽核記錄（僅可新增、不可竄改），保留兩年後自動清除。
        </p>
      </div>

      {/* 雙軸篩選 */}
      <div className="bg-bg-card border border-border rounded-xl px-4 py-3 mb-5 space-y-2">
        <FilterGroup
          label="集合"
          options={TARGET_OPTIONS}
          labelOf={(v) => TARGET_LABEL[v]}
          value={target}
          onChange={setTarget}
        />
        <FilterGroup
          label="操作"
          options={ACTION_OPTIONS}
          labelOf={(v) => ACTION_LABEL[v]}
          value={action}
          onChange={setAction}
        />
      </div>

      {/* 錯誤 */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-accent-red/10 border border-accent-red/30 text-accent-red text-sm">
          {error}
        </div>
      )}

      {/* 首次載入骨架 */}
      {loading && items.length === 0 && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl h-14 animate-pulse" />
          ))}
        </div>
      )}

      {/* 記錄列表 */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((e) => {
            const isOpen = expanded.has(e.id)
            const expandable = e.action === 'delete'
            return (
              <div key={e.id} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                <div
                  className={`px-4 py-3 flex items-center gap-3 flex-wrap ${expandable ? 'cursor-pointer hover:bg-bg-card-hover transition-colors' : ''}`}
                  onClick={expandable ? () => toggleExpand(e.id) : undefined}
                >
                  <span className="text-xs text-text-dim font-mono shrink-0 w-36">{formatAt(e.at)}</span>
                  <span className={`px-2 py-0.5 text-xs font-bold rounded border shrink-0 ${ACTION_CHIP[e.action]}`}>
                    {ACTION_LABEL[e.action]}
                  </span>
                  <span className="px-2 py-0.5 text-xs rounded border border-border text-text-secondary shrink-0">
                    {TARGET_LABEL[e.target]}
                  </span>
                  <span className="text-sm text-text-primary font-medium">{e.targetName}</span>
                  <span className="text-xs text-text-dim font-mono">{e.targetId}</span>
                  <span className="text-xs text-text-dim ml-auto shrink-0">{e.actorName}</span>
                  {expandable && (
                    <span className={`text-text-dim text-xs shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  )}
                </div>

                {/* update：變動欄位 */}
                {e.action === 'update' && !!e.changedFields?.length && (
                  <div className="px-4 pb-3 -mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-text-dim">變動欄位：</span>
                    {e.changedFields.map((f) => (
                      <span key={f} className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-bg-dark border border-border text-text-secondary">
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {/* restore：來源 log */}
                {e.action === 'restore' && e.restoredFrom && (
                  <div className="px-4 pb-3 -mt-1 text-[11px] text-text-dim">
                    還原自記錄 <span className="font-mono">{e.restoredFrom}</span>
                  </div>
                )}

                {/* delete：快照展開 */}
                {expandable && isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-border">
                    <SnapshotView entry={e} onRestore={() => void startRestore(e.id)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 空狀態 */}
      {!loading && !error && items.length === 0 && (
        <div className="text-center py-16 text-text-dim">
          <div className="text-4xl mb-3">📜</div>
          <p className="text-sm">沒有符合條件的變更記錄</p>
        </div>
      )}

      <LoadMoreButton hasMore={hasMore} loading={loading} onClick={() => void fetchPage(false)} />

      {restoreFlow && (
        <RestoreDialog flow={restoreFlow} onConfirm={() => void confirmRestore()} onClose={closeRestore} />
      )}
    </div>
  )
}
