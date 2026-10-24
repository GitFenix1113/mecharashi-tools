import { useMemo, useState } from 'react'
import type { Boss, RaidDraft, RaidOverride, RaidWhen, Stage } from '../../../types/boss'
import { RAID_DIFFICULTY_ORDER, type RaidDifficulty } from '../../../types/enums'
import type { RaidBuildResult, RaidTermView } from '../../../utils/raidDraft'
import { FIELD_LABEL, fieldLabel, getAt, overrideId, type RaidDocKind } from '../../../utils/raidOverride'
import { whenLabel } from '../../../utils/raidView'
import { termKindLabel } from './raidTermLabels'

// ─── 武裝討伐欄位修正（PLAN-064 H-4）──────────────────────────────────────────
//
// 審核後發現的非文字錯誤（回合、陣容、數值…）在這裡逐欄改，存成 raidOverrides 的覆寫；
// 發布時疊在草稿上，重跑匯入不會洗掉。每筆記著建立當下的草稿值：草稿之後變了 → 暫停套用、列在最上面等確認。
// 文字欄位若是譯名，預設改譯名（所有出現的地方一起換）；也可以「只改這裡」存成覆寫。
// 物件／陣列可整段用 JSON 改（加減增援、陣容這種結構性修正）。

type OverrideRow = { key: string; o: RaidOverride }
type Draft = Omit<RaidOverride, 'updatedAt' | 'updatedBy'>

/** 結構欄位與內部鍵：不給改（改了會讓資料對不起來） */
const HIDDEN = new Set([
  'id', 'levelId', 'battleId', 'bossIds', 'templateId', 'unit', 'merged', 'pending', 'i18nPending', 'published',
  'parserVersion', 'sourceBuild', 'seasonId', 'stageId', 'atlasId', 'kind', 'group', 'order', 'isFinal', 'nameCn',
  'updatedAt', 'updatedBy', 'manualPaths', 'estimated', 'groups', 'difficulties', 'icon', 'seq', 'anecdoteCount',
  'emblemKey', 'variants', 'category', 'name_cn',
])
const ENUM_OPTIONS: Record<string, [string, string][]> = {
  timing: [['start', '回合開始'], ['end', '回合結束']],
  twStatus: [['open', '台版已開放'], ['planned', '台版預計開放']],
}

const isPlain = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

interface DocOption { kind: RaidDocKind; id: string; label: string }

export function RaidFieldEditor({ draft, built, overrides, termByDraftTw, busy, onSaveOverride, onDeleteOverride, onSaveTerm }: {
  draft: RaidDraft
  built: RaidBuildResult
  overrides: OverrideRow[]
  /** 草稿原文字串 → 譯名（判斷文字欄位是不是譯名） */
  termByDraftTw: Map<string, RaidTermView>
  busy: boolean
  onSaveOverride: (o: Draft) => void
  onDeleteOverride: (key: string) => void
  onSaveTerm: (term: RaidTermView, tw: string) => void
}) {
  const stages = useMemo(() => [...draft.stages].sort((a, b) => (a.raid?.group ?? 0) - (b.raid?.group ?? 0)), [draft.stages])
  const options: DocOption[] = useMemo(() => [
    { kind: 'season', id: draft.season.id, label: '期資訊（每週規則、支援協議、台版日期…）' },
    ...stages.map((s): DocOption => ({ kind: 'stage', id: s.id, label: `關卡組 ${s.raid?.group}：${built.stages.find((x) => x.id === s.id)?.name ?? s.name}` })),
    ...stages.flatMap((s) => draft.bosses.filter((b) => b.stageId === s.id).map((b): DocOption => ({
      kind: 'boss', id: b.id, label: `首領：${built.bosses.find((x) => x.id === b.id)?.name ?? b.name}（關卡組 ${s.raid?.group}）`,
    }))),
  ], [draft, stages, built])
  const [sel, setSel] = useState(0)
  const opt = options[Math.min(sel, options.length - 1)]
  const diffs = RAID_DIFFICULTY_ORDER.filter((d) => draft.season.difficulties.includes(d))
  const [difficulty, setDifficulty] = useState<RaidDifficulty>(diffs[0] ?? 'normal')

  const rawDoc = docOf(draft, opt.kind, opt.id)
  const shownDoc = docOf(built, opt.kind, opt.id)
  const byPath = new Map(overrides.filter(({ o }) => o.doc === opt.kind && o.docId === opt.id).map((r) => [r.o.path, r]))
  const suspendedIds = new Set(built.suspended.map((s) => overrideId(s.o)))
  const docLabel = (kind: RaidDocKind, id: string) => options.find((x) => x.kind === kind && x.id === id)?.label.replace(/（.*$/, '') ?? id
  const label = (o: RaidOverride) => `${docLabel(o.doc, o.docId)}・${fieldLabel(o.path, { difficultyNames: draft.season.difficultyNames })}`
  const keyOf = (o: RaidOverride) => overrides.find((r) => overrideId(r.o) === overrideId(o))?.key

  const roots: { path: string; label: string }[] = opt.kind === 'season'
    ? Object.keys(draft.season).filter((k) => !HIDDEN.has(k)).map((k) => ({ path: k, label: FIELD_LABEL[k] ?? k }))
    : opt.kind === 'stage'
      ? [
        { path: `raid.variants.${difficulty}`, label: `這一關（${draft.season.difficultyNames[difficulty] ?? difficulty}）` },
        { path: 'raid.unitDict', label: '單位字典（名稱、機體、等級；各難度共用）' },
        { path: 'raid.refDict', label: '引用說明（Buff／技能／地形；各難度共用）' },
      ]
      : [
        { path: 'name', label: '名稱' },
        { path: 'quote', label: '台詞' },
        { path: `variants.${difficulty}`, label: `面板與技能（${draft.season.difficultyNames[difficulty] ?? difficulty}）` },
        { path: 'refDict', label: '引用說明（各難度共用）' },
      ]

  const unitDict = opt.kind === 'stage' ? (rawDoc as Stage | undefined)?.raid?.unitDict : undefined
  const ctx: NodeCtx = {
    doc: opt.kind, docId: opt.id, rawDoc, byPath, suspendedIds, termByDraftTw, busy, unitDict,
    onSaveOverride, onDeleteOverride, onSaveTerm,
  }

  return (
    <div className="space-y-3">
      {built.suspended.length > 0 && (
        <div className="rounded border border-accent-yellow/40 bg-accent-yellow/5 px-3 py-2 space-y-1.5">
          <div className="text-[12.5px] font-bold text-accent-yellow">⚠ 暫停套用 {built.suspended.length} 筆：草稿的值和建立修正時不同（資料包更新或解析修正）</div>
          {built.suspended.map(({ o, current }) => {
            const key = keyOf(o)
            return (
              <div key={overrideId(o)} className="text-[12px] text-text-secondary flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-text-primary">{label(o)}</span>
                <span className="text-text-dim">建立時 {show(o.base)} → 草稿現在 {current === undefined ? '（欄位不見了）' : show(current)}；你的修正 {show(o.value)}</span>
                <span className="ml-auto flex gap-1">
                  {current !== undefined && (
                    <button type="button" disabled={busy} onClick={() => onSaveOverride({ ...strip(o), base: current })}
                      className="px-2 py-0.5 rounded border border-accent-green/40 text-accent-green disabled:opacity-40">仍要覆寫</button>
                  )}
                  {key && (
                    <button type="button" disabled={busy} onClick={() => onDeleteOverride(key)}
                      className="px-2 py-0.5 rounded border border-border text-text-secondary disabled:opacity-40">刪除這筆修正</button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {built.overrides.length > 0 && (
        <details className="rounded border border-border bg-bg-card px-3 py-2">
          <summary className="cursor-pointer text-[12.5px] text-text-primary">這一期已套用的修正 {built.overrides.length} 筆</summary>
          <ul className="mt-1.5 space-y-1">
            {built.overrides.map((o) => {
              const key = keyOf(o)
              return (
                <li key={overrideId(o)} className="text-[12px] text-text-secondary flex flex-wrap gap-2 items-center">
                  <span className="text-text-primary">{label(o)}</span>
                  <span className="text-text-dim">{show(o.base)} → {show(o.value)}</span>
                  <span className="text-text-dim">（{o.updatedBy}）</span>
                  {key && <button type="button" disabled={busy} onClick={() => onDeleteOverride(key)} className="ml-auto px-2 py-0.5 rounded border border-border disabled:opacity-40">還原</button>}
                </li>
              )
            })}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <select value={sel} onChange={(e) => setSel(Number(e.target.value))}
          className="px-2 py-1 text-[12.5px] rounded border border-border bg-bg-dark text-text-primary max-w-full">
          {options.map((o, i) => <option key={`${o.kind}:${o.id}`} value={i}>{o.label}</option>)}
        </select>
        {opt.kind !== 'season' && (
          <div className="flex gap-1">
            {diffs.map((d) => (
              <button key={d} type="button" onClick={() => setDifficulty(d)}
                className={`px-2 py-0.5 text-[12px] rounded border ${d === difficulty ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50' : 'bg-bg-card text-text-secondary border-border'}`}>
                {draft.season.difficultyNames[d] ?? d}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded border border-border bg-bg-card divide-y divide-border/50">
        {roots.map((r) => {
          const shown = getAt(shownDoc, r.path)
          if (shown === undefined) return null
          return <FieldNode key={`${opt.id}:${r.path}`} ctx={ctx} path={r.path} label={r.label} shown={shown} depth={0} />
        })}
      </div>
      <p className="text-[11px] text-text-dim">
        修正存在 raidOverrides，發布時疊在草稿上，重跑匯入不會洗掉；前台會在該關／該首領下方註明「人工修正」。
        文字若是譯名，建議用「改譯名」（所有出現的地方一起換）；「只改這裡」只影響這一欄。
      </p>
    </div>
  )
}

// ── 欄位樹 ─────────────────────────────────────────────────────────────────────

interface NodeCtx {
  doc: RaidDocKind
  docId: string
  rawDoc: unknown
  byPath: Map<string, OverrideRow>
  suspendedIds: Set<string>
  termByDraftTw: Map<string, RaidTermView>
  busy: boolean
  unitDict?: Record<string, { name: string }>
  onSaveOverride: (o: Draft) => void
  onDeleteOverride: (key: string) => void
  onSaveTerm: (term: RaidTermView, tw: string) => void
}

function docOf(src: { season: { id: string }; stages: Stage[]; bosses: Boss[] }, kind: RaidDocKind, id: string): unknown {
  if (kind === 'season') return src.season
  return (kind === 'stage' ? src.stages : src.bosses).find((d) => d.id === id)
}

const show = (v: unknown) => (v === null || v === undefined ? '（空）' : typeof v === 'object' ? 'JSON…' : String(v))
const strip = (o: RaidOverride): Draft => ({ doc: o.doc, docId: o.docId, path: o.path, base: o.base, value: o.value, note: o.note })

/** 陣列項目的提示（讓「增援 #3」看得出是哪一筆） */
function itemHint(item: unknown, unitDict?: Record<string, { name: string }>): string {
  if (!item || typeof item !== 'object') return ''
  const it = item as Record<string, unknown>
  if (typeof it.name === 'string') return it.name
  if (typeof it.unit === 'string') return unitDict?.[it.unit]?.name ?? it.unit
  if (it.when && typeof it.when === 'object') return whenLabel(it.when as RaidWhen).replace(/⟦[^⟧]*⟧/g, '…')
  if (typeof it.text === 'string') return it.text.slice(0, 24)
  return ''
}

function FieldNode({ ctx, path, label, shown, depth }: { ctx: NodeCtx; path: string; label: string; shown: unknown; depth: number }) {
  const row = ctx.byPath.get(path)
  if (isPlain(shown)) return <LeafRow key={JSON.stringify(shown)} ctx={ctx} path={path} label={label} shown={shown} row={row} />
  const entries: [string, unknown, string][] = Array.isArray(shown)
    ? shown.map((v, i) => [String(i), v, `#${i + 1}${itemHint(v, ctx.unitDict) ? ` ${itemHint(v, ctx.unitDict)}` : ''}`])
    : Object.entries(shown as Record<string, unknown>)
      .filter(([k, v]) => !HIDDEN.has(k) && v !== undefined)
      .map(([k, v]) => [k, v, path.endsWith('unitDict') || path.endsWith('refDict') ? `${(v as { name?: string })?.name ?? k}（${k}）` : FIELD_LABEL[k] ?? k])
  const nested = [...ctx.byPath.keys()].filter((p) => p.startsWith(`${path}.`)).length
  return (
    <details open={depth === 0} className={depth === 0 ? 'px-3 py-2' : 'pl-3 border-l border-border/60 ml-1 my-1'}>
      <summary className="cursor-pointer text-[12.5px] text-text-primary py-0.5">
        {label}
        {Array.isArray(shown) && <span className="text-text-dim ml-1">（{shown.length}）</span>}
        {(row || nested > 0) && <span className="ml-2 text-[10.5px] text-accent-cyan">✎ 人工修正 {row ? '整段' : nested}</span>}
      </summary>
      <div className="mt-1 space-y-0.5">
        {entries.length === 0 && <div className="text-[11.5px] text-text-dim pl-1">（空）</div>}
        {entries.map(([k, v, l]) => <FieldNode key={k} ctx={ctx} path={`${path}.${k}`} label={l} shown={v} depth={depth + 1} />)}
        <JsonEditor ctx={ctx} path={path} shown={shown} row={row} />
      </div>
    </details>
  )
}

function LeafRow({ ctx, path, label, shown, row }: { ctx: NodeCtx; path: string; label: string; shown: unknown; row?: OverrideRow }) {
  const raw = getAt(ctx.rawDoc, path)
  const key = path.split('.').pop()!
  const enumOpts = ENUM_OPTIONS[key]
  const [value, setValue] = useState<string>(shown === null || shown === undefined ? '' : String(shown))
  const term = typeof raw === 'string' ? ctx.termByDraftTw.get(raw) : undefined
  const suspended = row && ctx.suspendedIds.has(overrideId(row.o))
  const parsed: unknown = typeof shown === 'number' || typeof raw === 'number' ? Number(value)
    : typeof shown === 'boolean' ? value === 'true' : value
  const invalid = typeof parsed === 'number' && !Number.isFinite(parsed)
  const changed = String(shown ?? '') !== value
  const long = typeof shown === 'string' && shown.length > 40
  const save = () => ctx.onSaveOverride({ doc: ctx.doc, docId: ctx.docId, path, base: raw === undefined ? null : raw, value: parsed })

  return (
    <div className={`grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)_auto] items-start py-1 ${row ? 'bg-accent-cyan/5 rounded' : ''}`}>
      <div className="text-[11.5px] text-text-dim pt-1 break-words">
        {label}
        {term && <span className="block text-[10px] text-accent-purple">譯名・{termKindLabel(term.kind)}</span>}
        {row && <span className={`block text-[10px] ${suspended ? 'text-accent-yellow' : 'text-accent-cyan'}`}>{suspended ? '⚠ 修正暫停' : '✎ 人工修正'}（原值 {show(row.o.base)}）</span>}
      </div>
      {typeof shown === 'boolean' ? (
        <label className="flex items-center gap-1.5 text-[12.5px] pt-1">
          <input type="checkbox" checked={value === 'true'} onChange={(e) => setValue(String(e.target.checked))} />是
        </label>
      ) : enumOpts ? (
        <select value={value} onChange={(e) => setValue(e.target.value)} className="px-2 py-1 text-[12.5px] rounded border border-border bg-bg-dark text-text-primary">
          {enumOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : long ? (
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(6, Math.ceil(value.length / 50))}
          className="w-full px-2 py-1 text-[12.5px] rounded border border-border bg-bg-dark text-text-primary" />
      ) : (
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode={typeof shown === 'number' ? 'decimal' : undefined}
          className={`w-full px-2 py-1 text-[12.5px] rounded border bg-bg-dark text-text-primary ${invalid ? 'border-accent-red' : 'border-border'}`} />
      )}
      <div className="flex gap-1 flex-wrap justify-end">
        {changed && !invalid && term && (
          <button type="button" disabled={ctx.busy} onClick={() => ctx.onSaveTerm(term, value.trim())}
            className="px-2 py-0.5 text-[11.5px] rounded border border-accent-green/40 bg-accent-green/10 text-accent-green disabled:opacity-40 whitespace-nowrap"
            title="寫進譯名對照表：所有出現這個名稱的地方一起換">改譯名</button>
        )}
        {changed && !invalid && (
          <button type="button" disabled={ctx.busy} onClick={save}
            className="px-2 py-0.5 text-[11.5px] rounded border border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan disabled:opacity-40 whitespace-nowrap">
            {term ? '只改這裡' : '存成修正'}
          </button>
        )}
        {row && (
          <button type="button" disabled={ctx.busy} onClick={() => ctx.onDeleteOverride(row.key)}
            className="px-2 py-0.5 text-[11.5px] rounded border border-border text-text-secondary disabled:opacity-40 whitespace-nowrap">還原</button>
        )}
      </div>
    </div>
  )
}

function JsonEditor({ ctx, path, shown, row }: { ctx: NodeCtx; path: string; shown: unknown; row?: OverrideRow }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(() => JSON.stringify(shown, null, 2))
  const [err, setErr] = useState<string | null>(null)
  if (!open) {
    return (
      <button type="button" onClick={() => { setText(JSON.stringify(shown, null, 2)); setErr(null); setOpen(true) }} className="text-[10.5px] text-text-dim hover:text-accent-cyan pl-1">
        以 JSON 整段修改（加減項目用）
      </button>
    )
  }
  const save = () => {
    try {
      const value = JSON.parse(text)
      const raw = getAt(ctx.rawDoc, path)
      setErr(null)
      ctx.onSaveOverride({ doc: ctx.doc, docId: ctx.docId, path, base: raw === undefined ? null : raw, value })
      setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="pl-1 space-y-1">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(18, text.split('\n').length + 1)}
        className="w-full px-2 py-1 text-[11.5px] font-[JetBrains_Mono,monospace] rounded border border-border bg-bg-dark text-text-primary" />
      {err && <div className="text-[11px] text-accent-red">JSON 格式錯誤：{err}</div>}
      <div className="flex gap-1">
        <button type="button" disabled={ctx.busy} onClick={save} className="px-2 py-0.5 text-[11.5px] rounded border border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan disabled:opacity-40">整段存成修正</button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-0.5 text-[11.5px] rounded border border-border text-text-secondary">取消</button>
        {row && <button type="button" disabled={ctx.busy} onClick={() => ctx.onDeleteOverride(row.key)} className="px-2 py-0.5 text-[11.5px] rounded border border-border text-text-secondary disabled:opacity-40">還原整段</button>}
      </div>
    </div>
  )
}
