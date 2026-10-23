import { useMemo, useState } from 'react'
import type { RaidPendingTerm } from '../../../types/boss'

// ─── 武裝討伐譯名校對（PLAN-064 D-2）─────────────────────────────────────────
//
// 列出這一期還待校的條目（依種類分組）。填台版譯名→寫進 raidTerms（已校），預覽與發布立刻套用；
// 「照原樣確認」＝目前的暫譯就是對的。審核佇列是站長的：這裡不會自動把任何一筆標成已校。
// 長文（技能說明、線索詳情、逸聞）裡夾帶的名詞，要重跑匯入（--write）才會換成新譯名。

const TERM_KIND_LABEL: Record<string, string> = {
  season: '期名', faction: '勢力', level: '關卡名', battle: '戰場名', unit: '單位／人名', mech: '機體', weapon: '武器',
  backpack: '背包', skill: '技能名', buff: '效果名', terrain: '地形', bounty: '懸賞', clue: '線索名', quote: '台詞',
  ui: '介面用語', text: '說明文字', anecdote: '逸聞',
}
const LONG_KINDS = new Set(['text', 'anecdote', 'quote'])
const KIND_ORDER = Object.keys(TERM_KIND_LABEL)

function TermRow({ term, busy, onSave }: { term: RaidPendingTerm; busy: boolean; onSave: (tw: string) => void }) {
  const [value, setValue] = useState(term.tw)
  const long = LONG_KINDS.has(term.kind)
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-start px-2.5 py-2 border-b border-border/60">
      <div className="text-[12.5px] text-text-secondary break-words whitespace-pre-line">
        {term.cn}
        <div className="text-[10.5px] text-text-dim mt-0.5">{term.source === 'machine' ? '機轉' : term.source}・出現 {term.count} 次</div>
      </div>
      {long ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={Math.min(8, Math.max(2, Math.ceil(value.length / 40)))}
          className="w-full px-2 py-1 text-[12.5px] rounded border border-border bg-bg-dark text-text-primary"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full px-2 py-1 text-[13px] rounded border border-border bg-bg-dark text-text-primary"
        />
      )}
      <button
        type="button"
        disabled={busy || !value.trim()}
        onClick={() => onSave(value.trim())}
        className="px-2.5 py-1 text-[12px] rounded border border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/20 disabled:opacity-40 whitespace-nowrap"
      >
        {value.trim() === term.tw ? '照原樣確認' : '儲存譯名'}
      </button>
    </div>
  )
}

export function RaidTermsPanel({ pending, busy, onSave, onConfirmMany }: {
  pending: RaidPendingTerm[]
  busy: boolean
  onSave: (term: RaidPendingTerm, tw: string) => void
  /** 一次確認多筆（照目前暫譯） */
  onConfirmMany: (terms: RaidPendingTerm[]) => void
}) {
  const [kind, setKind] = useState<string>('')
  const [q, setQ] = useState('')
  const kinds = useMemo(() => {
    const c = new Map<string, number>()
    for (const p of pending) c.set(p.kind, (c.get(p.kind) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]))
  }, [pending])
  const active = kind || kinds[0]?.[0] || ''
  const rows = pending
    .filter((p) => p.kind === active && (!q || p.cn.includes(q) || p.tw.includes(q)))
    .sort((a, b) => b.count - a.count)
  const shown = rows.slice(0, 200)

  if (!pending.length) return <div className="text-[13px] text-text-dim py-6 text-center">這一期沒有待校的譯名。</div>

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {kinds.map(([k, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`px-2 py-0.5 text-[12px] rounded border ${k === active ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/50' : 'bg-bg-card text-text-secondary border-border'}`}
          >
            {TERM_KIND_LABEL[k] ?? k} {n}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋原文或譯文"
          className="px-2 py-1 text-[12.5px] rounded border border-border bg-bg-dark text-text-primary w-56"
        />
        <span className="text-[11.5px] text-text-dim">{rows.length} 筆{rows.length > shown.length ? `（先列前 ${shown.length} 筆）` : ''}</span>
        {!LONG_KINDS.has(active) && shown.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`把目前列出的 ${shown.length} 筆「${TERM_KIND_LABEL[active] ?? active}」照暫譯確認為已校？`)) onConfirmMany(shown)
            }}
            className="ml-auto px-2.5 py-1 text-[12px] rounded border border-border text-text-secondary hover:text-text-primary disabled:opacity-40"
          >
            列出的全部照暫譯確認
          </button>
        )}
      </div>
      <div className="rounded border border-border bg-bg-card max-h-[560px] overflow-auto">
        {shown.map((t) => <TermRow key={`${t.kind}:${t.cn}`} term={t} busy={busy} onSave={(tw) => onSave(t, tw)} />)}
      </div>
      <p className="text-[11px] text-text-dim">
        存檔寫進譯名對照表（raidTerms），預覽與發布立刻套用。說明文字裡夾帶的名詞要重跑 <code>node scripts/import-raid-dungeons.mjs --write</code> 才會更新。
      </p>
    </div>
  )
}
