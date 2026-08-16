import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { PatchVersion } from '../../data/patchVersions/types'
import type { AnnouncementDraft, PendingActivity } from '../../types/announcementStaging'
import { isKnownActivityType } from '../timeline/activityTypeRegistry'
import {
  aggregateUnknownTypes,
  aggregateUnmatched,
  collectPendingFixes,
} from './announcementInsights'

// PLAN-048 Phase 2：「規則待擴充」彙總檢視
//
// 兩件事各佔一半：
//   上半 —— **待補資料**：藏起來還沒上線的活動，缺什麼一目了然。
//   下半 —— **待擴充規則**：解析器沒看懂的東西依出現次數排序。
// 後者是給「之後再根據備註擴充腳本」用的：排最上面的那幾條就是下一版最該處理的。

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-[13px] font-bold text-text-primary">{children}</h2>
      {hint && <p className="text-[11px] text-text-dim mt-0.5">{hint}</p>}
    </div>
  )
}

interface Props {
  versions: (PatchVersion & { id?: string })[]
  drafts: AnnouncementDraft[]
  pending: PendingActivity[]
}

export default function AnnouncementInsightsPanel({ versions, drafts, pending }: Props) {
  const fixes = useMemo(() => collectPendingFixes(versions), [versions])
  const unmatched = useMemo(() => aggregateUnmatched(drafts), [drafts])
  const typeGaps = useMemo(() => aggregateUnknownTypes(pending, isKnownActivityType), [pending])

  return (
    <div className="space-y-6">
      {/* ── 待補資料 ─────────────────────────────────────────────── */}
      <section>
        <SectionTitle hint="這些活動已經併進版本，但還藏著不出現在首頁。補齊後在版本編輯頁取消「隱藏」即上線。">
          待補資料（{fixes.length}）
        </SectionTitle>
        {fixes.length === 0 ? (
          <div className="text-[12px] text-text-dim border border-border rounded bg-bg-card px-3 py-4 text-center">
            沒有待補的活動。
          </div>
        ) : (
          <div className="border border-border rounded bg-bg-card overflow-hidden">
            {fixes.map((f, i) => (
              <div key={`${f.versionId}-${f.half}-${f.act.id ?? i}`} className="px-3 py-2 border-b border-border/60 last:border-b-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/admin/versions/${f.versionId.replace(/^v/, '')}`}
                    className="text-[12.5px] text-accent-cyan hover:underline"
                  >
                    {f.versionId} {f.half === 'upper' ? '上半' : '下半'}
                  </Link>
                  <span className="text-[12.5px] text-text-primary">{f.act.name || '（無名稱）'}</span>
                  <span className="text-[11px] text-text-dim">{f.act.startDate}</span>
                  {f.missing.length > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-accent-yellow/15 text-accent-yellow border border-accent-yellow/30">
                      缺 {f.missing.join('、')}
                    </span>
                  )}
                </div>
                {f.act.note && (
                  <div className="mt-1 text-[11px] text-text-secondary">📝 {f.act.note}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 待擴充規則 ───────────────────────────────────────────── */}
      <section>
        <SectionTitle hint="解析器沒認領的原文，依出現次數由多到少。碰過很多次的才值得加規則；只出現一兩次的手動處理更划算，所以預設不列出來。">
          待擴充規則 · 未認領原文（{unmatched.length} 種句型）
        </SectionTitle>
        {unmatched.length === 0 ? (
          <div className="text-[12px] text-text-dim border border-border rounded bg-bg-card px-3 py-4 text-center">
            沒有重複出現的未認領句型。
          </div>
        ) : (
          <div className="border border-border rounded bg-bg-card overflow-hidden">
            {unmatched.slice(0, 30).map(g => (
              <div key={g.pattern} className="px-3 py-2 border-b border-border/60 last:border-b-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-bold text-accent-orange tabular-nums shrink-0">{g.count}×</span>
                  <code className="text-[11.5px] text-text-secondary break-all">{g.pattern}</code>
                </div>
                <div className="mt-1 ml-7 space-y-0.5">
                  {g.samples.map((s, i) => (
                    <div key={i} className="text-[11px] text-text-dim break-all">· {s}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 未登錄型別 ───────────────────────────────────────────── */}
      <section>
        <SectionTitle hint="未登錄的型別會以中性紫色虛線顯示，功能完全正常。穩定超過 20 種時才值得把 activityTypes 開成獨立集合（計畫書的升級觸發點）；在那之前補一列 activityTypeRegistry 就夠了。">
          未登錄型別（{typeGaps.length} / 20）
        </SectionTitle>
        {typeGaps.length === 0 ? (
          <div className="text-[12px] text-text-dim border border-border rounded bg-bg-card px-3 py-4 text-center">
            所有型別都已登錄。
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {typeGaps.map(g => (
              <span
                key={g.label}
                className="px-2 py-1 text-[11.5px] rounded border bg-accent-purple/10 text-accent-purple border-accent-purple/30"
              >
                {g.label} <span className="text-text-dim">×{g.count}</span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
