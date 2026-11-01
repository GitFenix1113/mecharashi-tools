import type { SimResultV1 } from '../../../lib/sim/contract'
import { compareJob, hasMismatch, type CompareRow, type JobMeasure } from '../../../lib/sim/verifyCase'
import { REASON_LABEL, sourceLabel, type SourceNameIndex } from '../../../lib/sim/sourceNames'
import { SimMeasureEditor } from './SimMeasureEditor'
import { SimJsonTree } from './SimJsonTree'

// ─── 一個動作的預測、實測與誤差（PLAN-065-C C-3／C-4）───────────────────────────
//
// 預測的數字全部來自 Worker 的回應；這裡只負責排版與「同欄位相減」（verifyCase.compareJob）。
// 超出容許範圍時，把未計入清單、附註與面板覆寫的狀態列成「可能的來源」，由站長判斷。

interface Props {
  index: number
  title: string
  result: SimResultV1 | undefined
  measure: JobMeasure
  onMeasure: (next: JobMeasure) => void
  names: SourceNameIndex
  /** 這次請求有沒有帶面板覆寫 */
  panelOverridden: boolean
}

const STATUS: Record<SimResultV1['status'], { text: string; cls: string }> = {
  ok: { text: '全部計入', cls: 'text-accent-green border-accent-green/40' },
  partial: { text: '部分未計入', cls: 'text-accent-yellow border-accent-yellow/40' },
  unsupported: { text: '不支援', cls: 'text-accent-red border-accent-red/40' },
  error: { text: '錯誤', cls: 'text-accent-red border-accent-red/40' },
}

const num = (n: number, digits = 1) => n.toLocaleString('zh-TW', { maximumFractionDigits: digits })
const pct = (r: number) => `${num(r * 100, 2)}%`

function cell(row: CompareRow, v: number) {
  return row.unit === 'pct' ? `${num(v, 2)}%` : num(v, row.unit === 'count' ? 0 : 2)
}

export function SimJobCard({ index, title, result, measure, onMeasure, names, panelOverridden }: Props) {
  const rows = result ? compareJob(result, measure) : []
  const mismatch = hasMismatch(rows)
  const l0 = result?.L0
  const l1 = result?.L1

  return (
    <div className="rounded border border-border bg-bg-card">
      <div className="px-3 py-2 border-b border-border/60 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-dim">#{index + 1}</span>
        <span className="text-[13px] font-bold text-text-primary">{title}</span>
        {result && (
          <span className={`text-[10.5px] px-1.5 rounded border ${STATUS[result.status].cls}`}>{STATUS[result.status].text}</span>
        )}
        {l0 && (
          <span className="ml-auto text-[12px] text-text-secondary">
            一次行動 <b className="text-text-primary">{num(l0.perAction.mean, 0)}</b>
            {l0.approx && <span className="text-text-dim">（約）</span>}
          </span>
        )}
      </div>

      <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── 預測 ── */}
        <div className="min-w-0 space-y-2">
          {!result && <div className="text-[12px] text-text-dim">尚未計算</div>}
          {result && result.warnings.length > 0 && (
            <div className="text-[11px] text-accent-yellow space-y-0.5">
              {result.warnings.map((w, i) => <div key={i}>⚠ {w.code}{w.detail ? `：${w.detail}` : ''}</div>)}
            </div>
          )}
          {l0 && (
            <table className="w-full text-[11.5px]">
              <thead className="text-text-dim">
                <tr><th className="text-left font-normal">攻擊段</th><th className="text-right font-normal">發生</th><th className="text-right font-normal">擊數</th><th className="text-right font-normal">期望單擊</th><th className="text-right font-normal">命中</th><th className="text-right font-normal">暴擊</th><th className="text-right font-normal">期望</th></tr>
              </thead>
              <tbody className="text-text-primary">
                {l0.segments.map((s, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td>{s.stage}</td><td className="text-right">{pct(s.occurProb)}</td><td className="text-right">{s.hits}</td>
                    <td className="text-right">{num(s.perHitMean, 2)}</td><td className="text-right">{pct(s.hitRate)}</td>
                    <td className="text-right">{pct(s.critRate)}</td><td className="text-right">{num(s.expected, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result && Object.keys(result.derived.panel).length > 0 && (
            <div className="text-[11px] text-text-secondary">
              引擎面板：{Object.entries(result.derived.panel).map(([k, v]) => `${k} ${num(v as number, 0)}`).join('・')}
            </div>
          )}
        </div>

        {/* ── 實測 ── */}
        <div className="min-w-0">
          <SimMeasureEditor value={measure} onChange={onMeasure} />
        </div>
      </div>

      {/* ── 誤差 ── */}
      {rows.length > 0 && (
        <div className="px-3 pb-3">
          <table className="w-full text-[11.5px]">
            <thead className="text-text-dim">
              <tr><th className="text-left font-normal">項目</th><th className="text-right font-normal">實測</th><th className="text-right font-normal">預測</th><th className="text-right font-normal">差</th><th className="text-right font-normal">判定</th><th className="text-left font-normal pl-3">附註</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border/40 text-text-primary">
                  <td>{r.label}</td><td className="text-right">{cell(r, r.measured)}</td><td className="text-right">{cell(r, r.predicted)}</td>
                  <td className={`text-right ${r.ok === false ? 'text-accent-red' : ''}`}>{r.diff > 0 ? '+' : ''}{cell(r, r.diff)}</td>
                  <td className="text-right">{r.ok === null ? <span className="text-text-dim">參考</span> : r.ok ? <span className="text-accent-green">✓</span> : <span className="text-accent-red">✗</span>}</td>
                  <td className="pl-3 text-text-dim font-mono">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mismatch && (
            <div className="mt-2 text-[11.5px] rounded border border-accent-red/30 bg-accent-red/5 px-2 py-1.5 text-text-secondary space-y-0.5">
              <div className="text-accent-red">有項目超出容許範圍，可能的來源：</div>
              {!panelOverridden && <div>・面板沒有覆寫：先在上方填入遊戲內面板再算一次，可以排除面板差異</div>}
              {(l1?.notCounted.length ?? 0) > 0 && <div>・未計入 {l1!.notCounted.length} 項（見下方清單）</div>}
              {(result?.warnings.length ?? 0) > 0 && <div>・回應附註 {result!.warnings.length} 則（見上方）</div>}
              {!l1 && <div>・沒有拿到未計入清單（結果層級低於 L1）</div>}
            </div>
          )}
        </div>
      )}

      {/* ── 已計入／未計入／分組小計 ── */}
      {l1 && (
        <details className="px-3 pb-2 text-[11.5px]" open={mismatch}>
          <summary className="cursor-pointer text-text-secondary">
            未計入 {l1.notCounted.length} 項・已計入 {l1.counted.length} 項・分組小計 {l1.zones.length} 組
          </summary>
          <div className="mt-1.5 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="min-w-0">
              <div className="text-text-dim mb-0.5">未計入</div>
              {l1.notCounted.length === 0 && <div className="text-text-dim">（無）</div>}
              {l1.notCounted.map((n, i) => (
                <div key={i} className="text-text-primary">
                  {sourceLabel(n.src, names)}{n.bufId !== undefined && <span className="text-text-dim"> #{n.bufId}</span>}
                  <span className="text-text-dim ml-2">{REASON_LABEL[n.reason] ?? n.reason}{n.forceable ? '・可強制計入' : ''}</span>
                </div>
              ))}
            </div>
            <div className="min-w-0">
              <div className="text-text-dim mb-0.5">已計入</div>
              {l1.counted.map((c, i) => (
                <div key={i} className="text-text-primary">
                  {sourceLabel(c.src, names)}{c.bufIds.length > 0 && <span className="text-text-dim"> ×{c.bufIds.length}</span>}
                </div>
              ))}
            </div>
            <div className="min-w-0">
              <div className="text-text-dim mb-0.5">分組小計</div>
              {l1.zones.map((z) => (
                <div key={z.key} className="flex justify-between gap-2 font-mono"><span className="text-text-secondary">{z.key}</span><span className="text-text-primary">{num(z.value, 4)}</span></div>
              ))}
            </div>
          </div>
        </details>
      )}

      {/* ── 完整拆解（管理者） ── */}
      {result?.L2 !== undefined && (
        <details className="px-3 pb-3">
          <summary className="cursor-pointer text-[11.5px] text-text-secondary">
            完整拆解（L2）{measure.perHitPointer && <span className="text-accent-yellow ml-2">單擊比對：<code>{measure.perHitPointer}</code></span>}
          </summary>
          <div className="mt-1.5 max-h-[480px] overflow-auto rounded border border-border/60 bg-bg-dark p-2">
            <SimJsonTree
              value={result.L2}
              picked={measure.perHitPointer}
              onPick={(pointer) => onMeasure({ ...measure, perHitPointer: measure.perHitPointer === pointer ? undefined : pointer })}
            />
          </div>
        </details>
      )}
    </div>
  )
}
