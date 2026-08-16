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
 * 週數留空時的預設備註。
 *
 * 先前這裡預填「建議 2 週」，已經拿掉 —— 預填值會在維護者沒細看時直接變成資料，
 * 而那正是「填了就再也分不出官方寫的與系統猜的」要防的事。
 * 現在的做法是：留空即可合併，但該筆自動隱藏、並要求寫下一句備註說明缺什麼。
 * 半成品因此進得了正式資料（不會卡在待審清單被遺忘），卻上不了首頁。
 */
const DEFAULT_NOTE = '官方公告只寫「起」、未寫結束時刻，待確認檔期長度'

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

const INPUT = 'w-full px-2 py-1 text-[12px] bg-bg-card border border-border rounded text-text-primary focus:border-accent-cyan outline-none'

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
  // null ＝ 使用者沒手動改過，跟著推算值走。
  // 覆寫的是「版本 + 半期」整組，不是只有版本 —— 半期同樣是推算出來的，
  // 要改就兩個一起改，否則會出現「版本改了、半期還停在舊版本推算值」的錯配。
  const [override, setOverride] = useState<MergeTarget | null>(null)
  const target = override ?? defaultTarget
  const versionId = target?.versionId ?? ''

  /**
   * 什麼時候才需要人動手指定寫入目標。
   *
   * 推得出來就只顯示、不給選 —— 那是系統算得出來的事，讓人再決定一次只會製造錯誤。
   * 但有兩種情況推算不能算數：
   *   · 本來就推不出（起始日早於所有已知台版半期）
   *   · **起始日被改過**：targetVersion 是爬取當下依原始 startDate 算好存起來的，
   *     改了日期它就可能過期。若此時仍是唯讀，就會靜默寫到錯的半期去 ——
   *     而且是「畫面顯示 A、實際寫入 A，但 A 已經不對」這種最難發現的錯。
   */
  const dateEdited = Boolean(form.startDate) && form.startDate !== item.extracted?.startDate
  const needsTargetInput = !defaultTarget || dateEdited

  const patch = (p: Partial<TimedActivity>) => setForm(prev => ({ ...prev, ...p }))

  const weeks = form.weeks
  // 缺長度 → 這筆只能以隱藏狀態進去（甘特沒有長度就畫不出長條）
  const willHide = weeks === undefined || form.hidden === true
  const needsNote = weeks === undefined

  const typeValue = form.type && isKnownActivityType(form.type) ? form.type : (form.type ? CUSTOM : '')
  const wd = form.startDate ? weekdayInfo(form.startDate) : null

  // 週數不再是合併的必要條件 —— 缺它就隱藏著進去，等之後補。
  // 起始日仍然必要：實測 625 筆公告從沒缺過，且缺了連「什麼時候」都答不出來。
  const canMerge = Boolean(
    form.name?.trim() && form.startDate && form.type && target?.versionId
    && (!needsNote || (form.note ?? DEFAULT_NOTE).trim()),
  )

  function submit() {
    if (!canMerge || !target?.versionId) return
    const activity: TimedActivity = {
      ...form,
      name: form.name!.trim(),
      startDate: form.startDate!,
      type: form.type!,
    }
    if (weeks === undefined) delete activity.weeks
    if (willHide) {
      activity.hidden = true
      activity.note = (form.note ?? '').trim() || DEFAULT_NOTE
    } else {
      delete activity.hidden
    }
    // 空字串欄位不要寫進去，免得前台把 '' 當成「有值但空」
    for (const k of ['description', 'sourceUrl', 'typeLabel', 'note'] as const) {
      if (!activity[k]?.trim()) delete activity[k]
    }
    if (!activity.pilots?.length) delete activity.pilots
    if (!activity.mechs?.length) delete activity.mechs
    if (!activity.rewards?.length) delete activity.rewards
    onMerge(activity, target)
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
              placeholder="（公告未寫）"
              className={`${INPUT} ${needsNote ? 'border-accent-yellow/60' : ''}`}
              value={weeks ?? ''}
              onChange={e => patch({ weeks: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
            {form.startDate && weeks
              ? <span className="text-[10px] text-text-dim">至 {computeEndDate(form.startDate, weeks)}</span>
              : null}
          </Field>

          {/* 隱藏 + 備註：資料不齊也進得去，只是先不上首頁 */}
          <div className="col-span-2 space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              <input
                type="checkbox"
                checked={willHide}
                disabled={needsNote}
                onChange={e => patch({ hidden: e.target.checked ? true : undefined })}
                className="accent-accent-yellow"
              />
              <span className={willHide ? 'text-accent-yellow' : undefined}>
                先隱藏，不出現在首頁（之後在版本編輯頁補齊再上線）
              </span>
            </label>

            {needsNote && (
              <div className="text-[11px] text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30 rounded px-2 py-1.5">
                ⚠ 這篇公告只寫「起」、沒有結束時刻，所以<strong>週數留空</strong>。
                這筆會以隱藏狀態併入版本 —— 事實先留住，等查到實際檔期再補上長度並取消隱藏。
                <strong>不會替你猜一個週數</strong>，猜了就再也分不出哪些是官方寫的。
              </div>
            )}

            {willHide && (
              <input
                className={`${INPUT} border-accent-yellow/40`}
                value={form.note ?? ''}
                placeholder={DEFAULT_NOTE}
                onChange={e => patch({ note: e.target.value })}
              />
            )}
          </div>

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
            <span className="block text-[10px] font-bold text-text-secondary tracking-[1px] uppercase mb-1">
              寫入目標
            </span>
            {!needsTargetInput && target && (
              <div className="text-[12.5px]">
                <span className="px-2 py-1 rounded border bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30">
                  {target.half === 'lower' ? '下半' : '上半'}
                </span>
                <span className="text-text-dim ml-2 text-[11px]">
                  {target.versionId}（台版 {halfTwDate(versions, target) ?? '日期未填'} 起）· 由起始日推算
                </span>
              </div>
            )}

            {needsTargetInput && (
              <div className="text-[11px] text-accent-yellow mb-1">
                {dateEdited
                  ? '起始日已修改，原本推算的寫入目標可能不再適用，請確認。'
                  : '推不出目標版本（起始日落在所有已知台服版本之外），請手動指定。'}
              </div>
            )}

            {needsTargetInput && (
              <div className="flex gap-2 mt-1.5">
                <select
                  className={INPUT}
                  value={versionId}
                  onChange={e => setOverride({ versionId: e.target.value, half: target?.half ?? 'upper' })}
                >
                  <option value="">（選版本）</option>
                  {versions.map(v => (
                    <option key={v.id ?? v.version} value={v.id ?? `v${v.version}`}>
                      v{v.version}{v.name ? ` ${v.name}` : ''}
                    </option>
                  ))}
                </select>
                <select
                  className={INPUT}
                  value={target?.half ?? 'upper'}
                  onChange={e => setOverride({
                    // 版本還沒選就維持空字串：擅自套 versions[0] 會靜默寫到錯的版本去，
                    // 而 canMerge 檢查 versionId，空的話「放行」仍是停用狀態
                    versionId,
                    half: e.target.value as 'upper' | 'lower',
                  })}
                >
                  <option value="upper">上半</option>
                  <option value="lower">下半</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* ── 兩個決定：放行 / 忽略 ──────────────────────────────
            上半／下半原本要人選，但它跟版本一樣是**從 startDate 推算得出**的
            （實測 67 筆有 64 筆連半期都算得出來，抽樣核對全對）。
            讓維護者重複做一次系統已經知道的判斷，只會製造出錯的機會。 */}
        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            type="button"
            disabled={!canMerge || busy}
            onClick={submit}
            className="px-4 py-1.5 text-[12px] font-bold rounded border bg-accent-green/15 text-accent-green border-accent-green/40 hover:bg-accent-green/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            放行{willHide ? '（隱藏）' : ''}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="px-3 py-1.5 text-[12px] rounded border bg-bg-card text-text-secondary border-border hover:text-text-primary disabled:opacity-40 transition-colors"
          >
            忽略
          </button>
          {!canMerge && (
            <span className="self-center text-[11px] text-text-dim">
              名稱／起始日／型別／寫入目標都要有（週數可留空，該筆會隱藏）
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** 顯示用：查出該版本半期的台版開服日，讓維護者一眼核對推算對不對 */
function halfTwDate(versions: (PatchVersion & { id?: string })[], t: MergeTarget): string | undefined {
  const v = versions.find(x => (x.id ?? `v${x.version}`) === t.versionId)
  return v?.[t.half]?.twDate
}

function splitList(v: string): string[] {
  return v.split(/[,，]/).map(s => s.trim()).filter(Boolean)
}
