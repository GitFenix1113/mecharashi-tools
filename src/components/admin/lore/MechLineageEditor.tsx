import { useMemo } from 'react'
import type { Mech, MechLoreDoc, MechRelation, MechRelationKind } from '../../../types'
import { incomingRelations } from '../../lore/mechLineage'
import { moveItem } from './loreEditText'
import { ICON_BTN } from './LoreDossierEditor'

/**
 * 故事館編輯台「機甲 › 系譜」分頁（PLAN-042-B G-1）。**一律人工連**（決策 B-10）：這裡不做任何文字比對。
 *
 * 關係一律「從這台的角度」讀：選的那台是這台的 ___。單向存，A 寫了不會自動在 B 寫反方向那條；
 * 前台會自己反查（B 的卷宗也看得到 A），所以**同一對機甲只要在一邊寫一次**。
 *
 * ⚠ 種類的字要寫到不會讀反（10-16 B-2 複核時站長把「改型」讀成「這台是它的改型」，三條全部標反）：
 *   選項把方向整句寫出來，不只寫「原型／改型」兩個字。
 */
const RELATION_KIND_OPTIONS: { value: MechRelationKind | ''; label: string }[] = [
  { value: 'base', label: '原型——這台是由它衍生出來的' },
  { value: 'variant', label: '改型——它是由這台衍生出來的' },
  { value: 'rival', label: '競品' },
  { value: 'series', label: '同系列' },
  { value: '', label: '僅提及（還沒判斷關係）' },
]

/** 別台連到這台時，從這台的角度怎麼讀 */
const INCOMING_TEXT: Record<MechRelationKind | 'mention', (other: string) => string> = {
  base: (o) => `${o} 是由這台衍生出來的（它把這台標成原型）`,
  variant: (o) => `這台是由 ${o} 衍生出來的（它把這台標成改型）`,
  rival: (o) => `${o} 把這台標成競品`,
  series: (o) => `${o} 把這台標成同系列`,
  mention: (o) => `${o} 提及這台（還沒判斷關係）`,
}

export function MechLineageEditor({
  mechId, value, onChange, mechs, loreDocs,
}: {
  mechId: string
  value: MechRelation[] | undefined
  onChange: (next: MechRelation[] | undefined) => void
  mechs: Mech[]
  /** 全部的 mechLore（反查、選單上的型號） */
  loreDocs: MechLoreDoc[]
}) {
  const rows = value ?? []
  const set = (next: MechRelation[]) => onChange(next.length ? next : undefined)
  const patchRow = (i: number, p: Partial<MechRelation>) => set(rows.map((r, n) => (n === i ? { ...r, ...p } : r)))

  const modelNo = useMemo(() => new Map(loreDocs.map((d) => [d.id, d.modelNo?.trim()])), [loreDocs])
  const nameOf = useMemo(() => new Map(mechs.map((m) => [m.id, m.name])), [mechs])
  const options = useMemo(
    () => mechs.filter((m) => m.id !== mechId).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    [mechs, mechId],
  )
  const incoming = useMemo(() => incomingRelations(mechId, loreDocs), [mechId, loreDocs])
  const counts = new Map<string, number>()
  for (const r of rows) if (r.mechId) counts.set(r.mechId, (counts.get(r.mechId) ?? 0) + 1)
  const outgoing = new Set(rows.map((r) => r.mechId))
  const label = (id: string) => `${nameOf.get(id) ?? id}${modelNo.get(id) ? `（${modelNo.get(id)}）` : ''}`

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-dim leading-relaxed">
        每一條都從<b className="text-text-secondary">這台的角度</b>讀：「選的那台」是這台的原型、改型、競品或同系列。
        同一對機甲只要在一邊寫一次——前台會自己反查，另一台的卷宗也看得到。順序＝卷宗的顯示順序。
      </p>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[13px] text-text-dim font-medium">這台的系譜（{rows.length} 條）</span>
          <button type="button" onClick={() => set([...rows, { mechId: '' }])} className="text-[13px] text-accent-cyan hover:text-accent-cyan/80 transition-colors">
            ＋ 新增一條
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-text-dim py-1">還沒有系譜。</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => {
              const missing = !!r.mechId && !nameOf.has(r.mechId)
              const dup = (counts.get(r.mechId) ?? 0) > 1
              const empty = !r.mechId
              return (
                // 以索引當 key：選到同一台的列可以暫時重複（存檔前擋），沒有其他穩定識別子
                <div key={i} className={`rounded-lg border p-2 space-y-1.5 ${missing || dup || empty ? 'border-accent-red/50' : 'border-border'} bg-bg-dark`}>
                  <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto] gap-2 items-center">
                    <select
                      value={r.mechId}
                      onChange={(e) => patchRow(i, { mechId: e.target.value })}
                      className="input-field text-xs"
                      aria-label="哪一台"
                    >
                      <option value="">— 選一台機甲 —</option>
                      {missing && <option value={r.mechId}>⚠ 找不到：{r.mechId}</option>}
                      {options.map((m) => <option key={m.id} value={m.id}>{label(m.id)}</option>)}
                    </select>
                    <select
                      value={r.kind ?? ''}
                      onChange={(e) => patchRow(i, { kind: (e.target.value || undefined) as MechRelationKind | undefined })}
                      className="input-field text-xs"
                      aria-label="它是這台的什麼"
                    >
                      {RELATION_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <div className="flex gap-1 shrink-0">
                      <button type="button" onClick={() => set(moveItem(rows, i, -1))} disabled={i === 0} className={ICON_BTN} title="上移">▲</button>
                      <button type="button" onClick={() => set(moveItem(rows, i, 1))} disabled={i === rows.length - 1} className={ICON_BTN} title="下移">▼</button>
                      <button type="button" onClick={() => set(rows.filter((_, n) => n !== i))} className={`${ICON_BTN} hover:!text-accent-red hover:!border-accent-red/40`} title="移除這一條">✕</button>
                    </div>
                  </div>
                  <input
                    value={r.note ?? ''}
                    onChange={(e) => patchRow(i, { note: e.target.value || undefined })}
                    className="input-field text-xs"
                    placeholder="補充說明（選填），例：同一套骨架、換裝重型裝甲"
                  />
                  {(missing || dup || empty) && (
                    <p className="text-[11px] text-accent-red">
                      {empty ? '還沒選機甲。' : missing ? '這台已經不在機甲資料裡（被刪或改了 ID），前台會略過這一條。' : '同一台選了兩次，存檔前留一條就好。'}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-border/60">
        <div className="text-[13px] text-text-dim font-medium mb-1.5">別台連到這台的（唯讀，要改請到那一台的編輯台）</div>
        {incoming.length === 0 ? (
          <p className="text-xs text-text-dim">沒有。</p>
        ) : (
          <ul className="space-y-1">
            {incoming.map(({ from, relation }, n) => (
              <li key={n} className="text-xs text-text-secondary">
                · {INCOMING_TEXT[relation.kind ?? 'mention'](label(from))}
                {relation.note && <span className="text-text-dim ml-2">「{relation.note}」</span>}
                {outgoing.has(from) && <span className="text-accent-yellow ml-2">⚠ 這台也寫了一條連到它：前台只顯示這台這邊的</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
