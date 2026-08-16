import { useMemo, useState } from 'react'
import type { PendingActivity, PendingFlag } from '../../types/announcementStaging'
import { PENDING_FLAG_LABEL } from '../../types/announcementStaging'
import type { PatchVersion, TimedActivity } from '../../data/patchVersions/types'
import { ACTIVITY_TYPE_OPTIONS, isKnownActivityType } from '../timeline/activityTypeRegistry'
import {
  computeEndDate,
  fromInputDate,
  toInputDate,
  weekdayInfo,
} from './AdminTimedActivityEditor'
import type { MergeTarget } from '../../lib/api/announcementStaging'

// PLAN-048 任務 2-3：左原文右表單的審核工作檯
//
// 維護者實際要打的字是三顆按鈕：→ 上半 / → 下半 / 忽略。
// 表單只在解析器沒把握時才需要動 —— 實測 66% 的活動零 flag，可以直接放行。

/** 未登錄型別的哨兵值；與 AdminTimedActivityEditor 一致 */
const CUSTOM = '__custom__'

/**
 * 開放式檔期的建議週數。
 *
 * ⚠ 這是**表單的預填值，不是資料的預設值**。解析器對「10:00 起」這種沒有結束
 * 時刻的公告一律留 weeks 空白（填了就再也分不出「官方真的是這樣」與「我沒抽到」），
 * 由這裡預填並**同時把不確定性顯示在維護者眼前**，讓它在按下合併之前被看見。
 */
const OPEN_ENDED_SUGGESTION = 2

function FlagChip({ flag }: { flag: PendingFlag | string }) {
  const label = PENDING_FLAG_LABEL[flag as PendingFlag] ?? flag
  return (
    <span className="px-1.5 py-0.5 text-[10px] rounded border bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30">
      {label}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-text-secondary tracking-[1px] uppercase mb-1">{label}</span>
      {children}
    </label>
  )
}

const INPUT = 'w-full px-2 py-1 text-[12px] bg-bg-input border border-border rounded text-text-primary focus:border-accent-cyan outline-none'

/**
 * 原文片段：把公告裡沒被任何規則認領的行標紅。
 * 「這段我沒看懂」因此會自動浮出來，不必維護者自己逐篇比對原文。
 */
function Excerpt({ excerpt, unmatched }: { excerpt: string; unmatched: string[] }) {
  const unmatchedSet = useMemo(
    () => new Set(unmatched.map(u => u.trim()).filter(Boolean)),
    [unmatched],
  )
  return (
    <pre className="whitespace-pre-wrap break-words text-[11.5px] leading-[1.75] text-text-secondary font-mono">
      {excerpt.split('\n').map((line, i) => {
        const t = line.trim()
        const isUnmatched = t.length > 0 && unmatchedSet.has(t)
        return (
          <div
            key={i}
            className={isUnmatched
              ? 'bg-accent-red/15 border-l-2 border-l-accent-red pl-1.5 -ml-1.5 text-accent-red'
              : undefined}
          >
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

interface Props {
  item: PendingActivity
  /** 來源公告的整篇 unmatched，用於標紅；尚未載入時傳空陣列 */
  unmatched: string[]
  versions: (PatchVersion & { id?: string })[]
  /** 預設目標版本半期（由 startDate 推測，可能為 null） */
  defaultTarget: MergeTarget | null
  busy: boolean
  onMerge: (activity: TimedActivity, target: MergeTarget) => void
  onReject: () => void
}

export default function AnnouncementReviewPanel({
  item, unmatched, versions, defaultTarget, busy, onMerge, onReject,
}: Props) {
  // extracted 永不被改動（保持原樣供 diff）；人工編修全部落在 form 上。
  // 換一筆待審時的重置由呼叫端的 key={selected.id} 重新掛載達成 ——
  // 用 effect 同步 props→state 會多一次 render，且 versionId 那條還會在
  // defaultTarget 稍後才算出來時把使用者剛選的值蓋掉。
  const [form, setForm] = useState<Partial<TimedActivity>>(
    () => ({ ...item.extracted, ...(item.reviewed ?? {}) }),
  )
  // null ＝ 使用者還沒手動選過，跟著推測值走
  const [versionOverride, setVersionOverride] = useState<string | null>(null)
  const versionId = versionOverride ?? defaultTarget?.versionId ?? ''

  const patch = (p: Partial<TimedActivity>) => setForm(prev => ({ ...prev, ...p }))

  const isOpenEnded = item.flags?.includes('openEnded') && item.extracted.weeks === undefined
  const weeks = form.weeks ?? (isOpenEnded ? OPEN_ENDED_SUGGESTION : undefined)
  const weeksIsSuggested = isOpenEnded && form.weeks === undefined

  const typeValue = form.type && isKnownActivityType(form.type) ? form.type : (form.type ? CUSTOM : '')
  const wd = form.startDate ? weekdayInfo(form.startDate) : null

  const canMerge = Boolean(form.name?.trim() && form.startDate && weeks && form.type && versionId)

  function submit(half: 'upper' | 'lower') {
    if (!canMerge) return
    const activity: TimedActivity = {
      ...form,
      name: form.name!.trim(),
      startDate: form.startDate!,
      weeks: weeks!,
      type: form.type!,
    }
    // 空字串欄位不要寫進去，免得前台把 '' 當成「有值但空」
    for (const k of ['description', 'sourceUrl', 'typeLabel'] as const) {
      if (!activity[k]?.trim()) delete activity[k]
    }
    if (!activity.pilots?.length) delete activity.pilots
    if (!activity.mechs?.length) delete activity.mechs
    if (!activity.rewards?.length) delete activity.rewards
    onMerge(activity, { versionId, half })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* ── 左：原文 ─────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded p-3 min-w-0">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-text-secondary tracking-[2px] uppercase">公告原文</span>
          <div className="flex gap-1 flex-wrap">
            {(item.flags ?? []).map(f => <FlagChip key={f} flag={f} />)}
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto overscroll-contain">
          <Excerpt excerpt={item.excerpt ?? ''} unmatched={unmatched} />
        </div>
        {item.rawTypeLabel && (
          <div className="mt-2 text-[11px] text-text-dim">
            原始段落標題：<code className="text-accent-purple">{item.rawTypeLabel}</code>
          </div>
        )}
      </div>

      {/* ── 右：表單 ─────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded p-3 min-w-0">
        <div className="text-[11px] font-bold text-text-secondary tracking-[2px] uppercase mb-2">解析結果（可修改）</div>

        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Field label="活動名稱">
              <input className={INPUT} value={form.name ?? ''} onChange={e => patch({ name: e.target.value })} />
            </Field>
          </div>

          <Field label="起始日">
            <input
              type="date"
              className={INPUT}
              value={form.startDate ? toInputDate(form.startDate) : ''}
              onChange={e => patch({ startDate: e.target.value ? fromInputDate(e.target.value) : undefined })}
            />
            {wd && (
              <span className={`text-[10px] ${wd.isThur ? 'text-text-dim' : 'text-accent-yellow'}`}>
                {wd.label}{wd.isThur ? '' : '（非慣例的週四）'}
              </span>
            )}
          </Field>

          <Field label="週數">
            <input
              type="number"
              step="0.01"
              min="0.1"
              className={`${INPUT} ${weeksIsSuggested ? 'border-accent-yellow/60' : ''}`}
              value={weeks ?? ''}
              onChange={e => patch({ weeks: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
            {form.startDate && weeks
              ? <span className="text-[10px] text-text-dim">至 {computeEndDate(form.startDate, weeks)}</span>
              : null}
          </Field>

          {weeksIsSuggested && (
            <div className="col-span-2 text-[11px] text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30 rounded px-2 py-1.5">
              ⚠ 這篇公告只寫「起」、沒有結束時刻。<strong>{OPEN_ENDED_SUGGESTION} 週是建議值，不是官方資料</strong>——
              請對照實際檔期確認後再合併。
            </div>
          )}

          <Field label="型別">
            <select
              className={INPUT}
              value={typeValue}
              onChange={e => {
                const v = e.target.value
                if (v === CUSTOM) patch({ type: form.typeLabel || '自訂型別' })
                else patch({ type: v || undefined, typeLabel: undefined })
              }}
            >
              <option value="">（未判定）</option>
              {ACTIVITY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value={CUSTOM}>＋ 自訂（新玩法）</option>
            </select>
          </Field>

          {typeValue === CUSTOM && (
            <Field label="自訂型別顯示名">
              <input
                className={INPUT}
                value={form.typeLabel ?? ''}
                onChange={e => patch({ typeLabel: e.target.value, type: e.target.value || '自訂型別' })}
              />
            </Field>
          )}

          <Field label="機師（逗號分隔）">
            <input
              className={INPUT}
              value={(form.pilots ?? []).join(', ')}
              onChange={e => patch({ pilots: splitList(e.target.value) })}
            />
          </Field>

          <Field label="機甲（逗號分隔）">
            <input
              className={INPUT}
              value={(form.mechs ?? []).join(', ')}
              onChange={e => patch({ mechs: splitList(e.target.value) })}
            />
          </Field>

          <div className="col-span-2">
            <Field label="獎勵（逗號分隔）">
              <input
                className={INPUT}
                value={(form.rewards ?? []).join(', ')}
                onChange={e => patch({ rewards: splitList(e.target.value) })}
              />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="活動說明">
              <textarea
                rows={3}
                className={INPUT}
                value={form.description ?? ''}
                onChange={e => patch({ description: e.target.value })}
              />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="官方公告連結">
              <input className={INPUT} value={form.sourceUrl ?? ''} onChange={e => patch({ sourceUrl: e.target.value })} />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="目標版本">
              <select className={INPUT} value={versionId} onChange={e => setVersionOverride(e.target.value)}>
                <option value="">（請選擇）</option>
                {versions.map(v => (
                  <option key={v.id ?? v.version} value={v.id ?? `v${v.version}`}>
                    v{v.version}{v.name ? ` ${v.name}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            {!defaultTarget && (
              <div className="mt-1 text-[10px] text-accent-yellow">
                推不出目標版本（起始日落在所有已知台服版本之外），請手動選擇。
              </div>
            )}
          </div>
        </div>

        {/* ── 三顆按鈕 ───────────────────────────────────────────── */}
        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            type="button"
            disabled={!canMerge || busy}
            onClick={() => submit('upper')}
            className="px-3 py-1.5 text-[12px] rounded border bg-accent-green/15 text-accent-green border-accent-green/40 hover:bg-accent-green/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            → 上半
          </button>
          <button
            type="button"
            disabled={!canMerge || busy}
            onClick={() => submit('lower')}
            className="px-3 py-1.5 text-[12px] rounded border bg-accent-cyan/15 text-accent-cyan border-accent-cyan/40 hover:bg-accent-cyan/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            → 下半
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="px-3 py-1.5 text-[12px] rounded border bg-bg-input text-text-secondary border-border hover:text-text-primary disabled:opacity-40 transition-colors"
          >
            忽略
          </button>
          {!canMerge && (
            <span className="self-center text-[11px] text-text-dim">
              名稱／起始日／週數／型別／目標版本都填了才能合併
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function splitList(v: string): string[] {
  return v.split(/[,，]/).map(s => s.trim()).filter(Boolean)
}
