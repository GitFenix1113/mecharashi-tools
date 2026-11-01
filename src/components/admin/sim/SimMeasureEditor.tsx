import { useMemo } from 'react'
import { parseHitLog, summarizeHits, type JobMeasure, type PreviewMeasure } from '../../../lib/sim/verifyCase'

// ─── 實測輸入（PLAN-065-C C-3）─────────────────────────────────────────────────
// 預覽畫面的四個數字＋實際逐擊跳字。數字由站長照截圖輸入（不做自動辨識）。

interface Props {
  value: JobMeasure
  onChange: (next: JobMeasure) => void
}

const PREVIEW_FIELDS: { key: keyof PreviewMeasure; label: string; unit?: string }[] = [
  { key: 'perHit', label: '單擊' },
  { key: 'hits', label: '擊數' },
  { key: 'hitPct', label: '命中率', unit: '%' },
  { key: 'critPct', label: '暴擊率', unit: '%' },
]

const PART_LABEL = { body: '機體', larm: '左臂', rarm: '右臂', leg: '腿部' } as const

const fmt = (n: number | null, digits = 0) => (n === null ? '—' : n.toLocaleString('zh-TW', { maximumFractionDigits: digits }))

export function SimMeasureEditor({ value, onChange }: Props) {
  const parsed = useMemo(() => parseHitLog(value.hitLog), [value.hitLog])
  const sum = useMemo(() => summarizeHits(parsed.hits), [parsed.hits])

  const setPreview = (key: keyof PreviewMeasure, raw: string) => {
    const preview = { ...value.preview }
    const n = raw.trim() === '' ? undefined : Number(raw)
    if (n === undefined || !Number.isFinite(n)) delete preview[key]
    else preview[key] = n
    onChange({ ...value, preview })
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="text-[11px] text-text-dim mb-1">確認攻擊預覽</div>
        <div className="flex flex-wrap gap-2">
          {PREVIEW_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-1 text-[12px] text-text-secondary">
              {f.label}
              <input
                type="number"
                inputMode="decimal"
                value={value.preview[f.key] ?? ''}
                onChange={(e) => setPreview(f.key, e.target.value)}
                className="w-20 px-1.5 py-0.5 rounded border border-border bg-bg-dark text-text-primary text-[12px]"
              />
              {f.unit && <span className="text-text-dim">{f.unit}</span>}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] text-text-dim mb-1">
          實際跳字（空白或換行分隔）：<code>1234</code> 命中、<code>1234!</code> 暴擊、<code>x</code> 未命中；
          可加部位 <code>體:</code> <code>左:</code> <code>右:</code> <code>腿:</code>。數字不加千分位。
        </div>
        <textarea
          value={value.hitLog}
          onChange={(e) => onChange({ ...value, hitLog: e.target.value })}
          rows={2}
          className="w-full px-2 py-1 rounded border border-border bg-bg-dark text-text-primary text-[12px] font-mono"
          placeholder="體:1520 體:1544! 左:x 右:1498"
        />
        {parsed.errors.length > 0 && (
          <div className="text-[11px] text-accent-red">認不得：{parsed.errors.join('　')}</div>
        )}
        {sum.attempts > 0 && (
          <div className="text-[11px] text-text-secondary flex flex-wrap gap-x-3">
            <span>出手 {sum.attempts}・命中 {sum.landed}・暴擊 {sum.crits}</span>
            <span>平均 {fmt(sum.meanLanded, 1)}（一般 {fmt(sum.meanNonCrit, 1)}／暴擊 {fmt(sum.meanCrit, 1)}）</span>
            {Object.keys(sum.byPart).length > 0 && (
              <span>
                {(Object.keys(PART_LABEL) as (keyof typeof PART_LABEL)[])
                  .filter((p) => sum.byPart[p])
                  .map((p) => `${PART_LABEL[p]} ${sum.byPart[p]}`)
                  .join('・')}
              </span>
            )}
          </div>
        )}
      </div>

      <input
        value={value.note ?? ''}
        onChange={(e) => onChange({ ...value, note: e.target.value || undefined })}
        placeholder="備註（截圖檔名、出手條件…）"
        className="w-full px-2 py-1 rounded border border-border bg-bg-dark text-text-primary text-[12px]"
      />
    </div>
  )
}
