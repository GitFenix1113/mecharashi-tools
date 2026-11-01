import { useMemo } from 'react'
import type { Boss } from '../../../types/boss'
import { RAID_DIFFICULTY_ORDER, type RaidDifficulty } from '../../../types/enums'
import type { AimPart } from '../../../lib/sim/contract'
import { highestRaidDifficulty } from '../../../lib/sim/requestBuilder'
import { resolveTarget, type RaidCatalogSeason, type TargetSelection } from './simTarget'

// ─── 目標：武裝討伐首領（PLAN-065-C C-2）───────────────────────────────────────
//
// 期 → 關卡組 → 難度 → 首領。資料來源是前台已發布的三個集合；還沒發布的期改用匯入草稿（標「草稿」）。
// 換算成請求用的遊戲 ID 一律走 buildRaidTarget()（simTarget.ts）；另有「手動」模式，直接填目標的遊戲 ID（除錯用）。

interface Props {
  catalog: readonly RaidCatalogSeason[]
  value: TargetSelection
  onChange: (next: TargetSelection) => void
}

const SELECT = 'px-1.5 py-1 rounded border border-border bg-bg-dark text-text-primary text-[12px] max-w-full'
const AIM: { v: AimPart; label: string }[] = [
  { v: 'auto', label: '自動' }, { v: 'body', label: '機體' }, { v: 'larm', label: '左臂' }, { v: 'rarm', label: '右臂' }, { v: 'leg', label: '腿部' },
]
const MANUAL_FIELDS: { key: keyof NonNullable<TargetSelection['manual']>; label: string }[] = [
  { key: 'seasonNo', label: '期數' }, { key: 'stageNo', label: '關卡序' }, { key: 'difficulty', label: '難度編號' },
  { key: 'battleMapId', label: 'battleMapId' }, { key: 'templateId', label: 'templateId' }, { key: 'bossIndex', label: '首領序號' },
]

export function SimTargetPicker({ catalog, value, onChange }: Props) {
  const season = catalog.find((x) => x.season.id === value.seasonId)
  const stages = useMemo(
    () => [...(season?.stages ?? [])].filter((s) => s.raid).sort((a, b) => (a.raid!.group - b.raid!.group) || (a.raid!.order - b.raid!.order)),
    [season],
  )
  const stage = stages.find((s) => s.id === value.stageId)
  const difficulty = value.difficulty ?? (season ? highestRaidDifficulty(season.season) ?? undefined : undefined)
  const variant = difficulty ? stage?.raid?.variants[difficulty] : undefined
  const bosses = (variant?.bossIds ?? []).map((id) => season?.bosses.find((b) => b.id === id) ?? ({ id, name: id } as Boss))
  const resolved = resolveTarget(catalog, value)

  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[12px]">
        {(['raid', 'manual'] as const).map((m) => (
          <label key={m} className="flex items-center gap-1 text-text-secondary">
            <input type="radio" checked={value.mode === m} onChange={() => onChange({ ...value, mode: m })} />
            {m === 'raid' ? '武裝討伐' : '手動填遊戲 ID'}
          </label>
        ))}
      </div>

      {value.mode === 'raid' ? (
        <div className="flex flex-wrap gap-2 items-center">
          <select className={SELECT} value={value.seasonId ?? ''} onChange={(e) => onChange({ ...value, seasonId: e.target.value || undefined, stageId: undefined, difficulty: undefined, bossId: undefined })}>
            <option value="">— 期 —</option>
            {catalog.map((s) => (
              <option key={s.season.id} value={s.season.id}>#{s.season.seq} {s.season.name}{s.source === 'draft' ? '（草稿）' : ''}</option>
            ))}
          </select>
          <select className={SELECT} value={value.stageId ?? ''} disabled={!season} onChange={(e) => onChange({ ...value, stageId: e.target.value || undefined, bossId: undefined })}>
            <option value="">— 關卡 —</option>
            {stages.map((s) => {
              const v = difficulty ? s.raid!.variants[difficulty] : undefined
              return <option key={s.id} value={s.id}>{s.raid!.group}-{s.raid!.order} {v?.name ?? s.name}</option>
            })}
          </select>
          <select className={SELECT} value={difficulty ?? ''} disabled={!season} onChange={(e) => onChange({ ...value, difficulty: (e.target.value || undefined) as RaidDifficulty | undefined, bossId: undefined })}>
            {RAID_DIFFICULTY_ORDER.filter((d) => season?.season.difficulties.includes(d)).map((d) => (
              <option key={d} value={d}>{season?.season.difficultyNames[d] || d}</option>
            ))}
          </select>
          <select className={SELECT} value={value.bossId ?? ''} disabled={bosses.length === 0} onChange={(e) => onChange({ ...value, bossId: e.target.value || undefined })}>
            {bosses.map((b, i) => <option key={b.id} value={i === 0 && !value.bossId ? '' : b.id}>{b.name}</option>)}
          </select>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {MANUAL_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-1 text-[12px] text-text-secondary">
              {f.label}
              <input
                type="number"
                value={value.manual?.[f.key] ?? ''}
                onChange={(e) => {
                  const manual = { ...value.manual }
                  const n = e.target.value === '' ? undefined : Number(e.target.value)
                  if (n === undefined || !Number.isFinite(n)) delete manual[f.key]
                  else manual[f.key] = n
                  onChange({ ...value, manual })
                }}
                className="w-24 px-1.5 py-0.5 rounded border border-border bg-bg-dark text-text-primary text-[12px]"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-text-secondary">瞄準</span>
        <select className={SELECT} value={value.part ?? 'auto'} onChange={(e) => onChange({ ...value, part: e.target.value as AimPart })}>
          {AIM.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
        </select>
        {resolved.target ? (
          <span className="text-text-dim font-mono text-[11px]">
            {resolved.target.seasonNo}-{resolved.target.stageNo}・難度 {resolved.target.difficulty}・{resolved.target.battleMapId}:{resolved.target.templateId}
            {resolved.target.bossIndex !== undefined && `・#${resolved.target.bossIndex}`}
          </span>
        ) : (
          resolved.reason && <span className="text-accent-yellow text-[11px]">{resolved.reason}</span>
        )}
      </div>
    </div>
  )
}
