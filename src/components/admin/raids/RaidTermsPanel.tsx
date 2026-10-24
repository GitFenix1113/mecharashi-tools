import { useMemo, useState } from 'react'
import type { RaidTermView } from '../../../utils/raidDraft'
import { TERM_KIND_ORDER, isLongTerm, termKindLabel, termSourceLabel } from './raidTermLabels'

// ─── 武裝討伐譯名校對（PLAN-064 D-2／H-1）────────────────────────────────────
//
// 列出這一期用到的全部譯名（依種類分組），預設只看待校；切到「已校」「全部」可以改正確認過的條目。
// 填台版譯名 → 寫進 raidTerms（已校），預覽與發布立刻套用；「照原樣確認」＝目前的暫譯就是對的。
// 名詞改了，含這個名詞的說明文字在預覽與發布時自動跟著換（說明文字自己校過的不動）。
// 審核佇列是站長的：這裡不會自動把任何一筆標成已校。

type StatusFilter = 'pending' | 'verified' | 'all'

/** 一筆譯名的編輯列（譯名頁與預覽的點字修改共用） */
export function TermRow({ term, busy, onSave, autoFocus }: { term: RaidTermView; busy: boolean; onSave: (tw: string) => void; autoFocus?: boolean }) {
  const [value, setValue] = useState(term.tw)
  const long = isLongTerm(term.kind) || term.tw.length > 40
  const v = value.trim()
  const verified = term.status === 'verified' && !term.conflict
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-start px-2.5 py-2 border-b border-border/60">
      <div className="text-[12.5px] text-text-secondary break-words whitespace-pre-line">
        {term.cn}
        <div className="text-[10.5px] text-text-dim mt-0.5 flex flex-wrap gap-x-2">
          <span className={verified ? 'text-accent-green' : 'text-accent-yellow'}>{verified ? '已校' : '待校'}</span>
          <span>{termSourceLabel(term.source)}</span>
          <span>出現 {term.count} 次</span>
          {term.linked && <span className="text-accent-cyan" title="文中的名詞改過，已跟著換">名詞已連動</span>}
          {term.conflict && <span className="text-accent-red" title="同一個暫譯對到兩種新譯名，沒有套用">譯名衝突</span>}
        </div>
      </div>
      {long ? (
        <textarea
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          rows={Math.min(8, Math.max(2, Math.ceil(value.length / 40)))}
          className="w-full px-2 py-1 text-[12.5px] rounded border border-border bg-bg-dark text-text-primary"
        />
      ) : (
        <input
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          className="w-full px-2 py-1 text-[13px] rounded border border-border bg-bg-dark text-text-primary"
        />
      )}
      <button
        type="button"
        disabled={busy || !v || (verified && v === term.tw)}
        onClick={() => onSave(v)}
        className="px-2.5 py-1 text-[12px] rounded border border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/20 disabled:opacity-40 whitespace-nowrap"
      >
        {v === term.tw ? (verified ? '已校' : '照原樣確認') : verified ? '更新譯名' : '儲存譯名'}
      </button>
    </div>
  )
}

export function RaidTermsPanel({ entries, busy, onSave, onConfirmMany }: {
  entries: RaidTermView[]
  busy: boolean
  onSave: (term: RaidTermView, tw: string) => void
  /** 一次確認多筆（照目前暫譯） */
  onConfirmMany: (terms: RaidTermView[]) => void
}) {
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [kind, setKind] = useState<string>('')
  const [q, setQ] = useState('')
  const isPending = (t: RaidTermView) => t.status !== 'verified' || !!t.conflict
  const byStatus = useMemo(
    () => entries.filter((t) => status === 'all' || (status === 'pending' ? isPending(t) : !isPending(t))),
    [entries, status],
  )
  const kinds = useMemo(() => {
    const c = new Map<string, number>()
    for (const p of byStatus) c.set(p.kind, (c.get(p.kind) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => TERM_KIND_ORDER.indexOf(a[0]) - TERM_KIND_ORDER.indexOf(b[0]))
  }, [byStatus])
  // 有搜尋字時跨種類找（看到錯字不必先猜它屬於哪一類）
  const active = q ? '' : (kinds.some(([k]) => k === kind) ? kind : kinds[0]?.[0] || '')
  const rows = byStatus
    .filter((p) => (!active || p.kind === active) && (!q || p.cn.includes(q) || p.tw.includes(q)))
    .sort((a, b) => b.count - a.count)
  const shown = rows.slice(0, 200)
  const pendingCount = entries.filter(isPending).length

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap items-center">
        {([['pending', `待校 ${pendingCount}`], ['verified', `已校 ${entries.length - pendingCount}`], ['all', `全部 ${entries.length}`]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setStatus(k)}
            className={`px-2.5 py-0.5 text-[12px] rounded-full border ${k === status ? 'bg-accent-green/15 text-accent-green border-accent-green/40' : 'bg-bg-card text-text-secondary border-border'}`}
          >
            {label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋原文或譯文（跨種類）"
          className="ml-auto px-2 py-1 text-[12.5px] rounded border border-border bg-bg-dark text-text-primary w-60"
        />
      </div>
      {!q && (
        <div className="flex gap-1 flex-wrap">
          {kinds.map(([k, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-2 py-0.5 text-[12px] rounded border ${k === active ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50' : 'bg-bg-card text-text-secondary border-border'}`}
            >
              {termKindLabel(k)} {n}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-[11.5px] text-text-dim">{rows.length} 筆{rows.length > shown.length ? `（先列前 ${shown.length} 筆）` : ''}</span>
        {status === 'pending' && active && !isLongTerm(active) && shown.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`把目前列出的 ${shown.length} 筆「${termKindLabel(active)}」照暫譯確認為已校？`)) onConfirmMany(shown)
            }}
            className="ml-auto px-2.5 py-1 text-[12px] rounded border border-border text-text-secondary hover:text-text-primary disabled:opacity-40"
          >
            列出的全部照暫譯確認
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-[13px] text-text-dim py-6 text-center rounded border border-border bg-bg-card">
          {q ? '找不到符合的譯名。數字、回合這類不是譯名的內容，到「修正」分頁改。' : status === 'pending' ? '這一期沒有待校的譯名。' : '沒有條目。'}
        </div>
      ) : (
        <div className="rounded border border-border bg-bg-card max-h-[560px] overflow-auto">
          {shown.map((t) => (
            <div key={`${t.kind}:${t.cn}`}>
              {q && <div className="px-2.5 pt-1.5 text-[10.5px] text-accent-cyan">{termKindLabel(t.kind)}</div>}
              <TermRow key={`${t.kind}:${t.cn}:${t.tw}`} term={t} busy={busy} onSave={(tw) => onSave(t, tw)} />
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-text-dim">
        存檔寫進譯名對照表（raidTerms），預覽與發布立刻套用，重跑匯入也不會洗掉。名詞改了，含這個名詞的說明文字會自動跟著換；說明文字自己校過的不動。
        預覽分頁打開「點字修改」可以直接點畫面上的字改。
      </p>
    </div>
  )
}
