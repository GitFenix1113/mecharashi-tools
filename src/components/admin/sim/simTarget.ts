import type { Boss, RaidSeason, Stage } from '../../../types/boss.ts'
import type { RaidDifficulty } from '../../../types/enums.ts'
import type { AimPart, SimRaidTargetV1 } from '../../../lib/sim/contract.ts'
import { buildRaidTarget, highestRaidDifficulty } from '../../../lib/sim/requestBuilder.ts'

// ─── 驗證台的目標選擇（PLAN-065-C C-2）：狀態與換算 ──────────────────────────────
// 畫面在 SimTargetPicker.tsx；這裡是純函式（換算一律走 buildRaidTarget）。

export interface RaidCatalogSeason {
  season: RaidSeason
  stages: Stage[]
  bosses: Boss[]
  source: 'published' | 'draft'
}

export interface TargetSelection {
  mode: 'raid' | 'manual'
  seasonId?: string
  stageId?: string
  difficulty?: RaidDifficulty
  bossId?: string
  part?: AimPart
  /** 手動模式的目標 */
  manual?: Partial<Omit<SimRaidTargetV1, 'kind' | 'part'>>
}

/** 選擇 → 請求目標與顯示名稱。對不上時 target 為 null、附原因。 */
export function resolveTarget(catalog: readonly RaidCatalogSeason[], sel: TargetSelection): { target: SimRaidTargetV1 | null; label: string; reason?: string } {
  if (sel.mode === 'manual') {
    const m = sel.manual ?? {}
    const need = ['seasonNo', 'stageNo', 'difficulty', 'battleMapId', 'templateId'] as const
    if (need.some((k) => m[k] === undefined)) return { target: null, label: '手動目標', reason: '手動目標的欄位還沒填完' }
    const target: SimRaidTargetV1 = {
      kind: 'raid', seasonNo: m.seasonNo!, stageNo: m.stageNo!, difficulty: m.difficulty!, battleMapId: m.battleMapId!, templateId: m.templateId!,
    }
    if (m.bossIndex !== undefined) target.bossIndex = m.bossIndex
    if (sel.part && sel.part !== 'auto') target.part = sel.part
    return { target, label: `手動 ${target.seasonNo}-${target.stageNo}（${target.battleMapId}:${target.templateId}）` }
  }
  const s = catalog.find((x) => x.season.id === sel.seasonId)
  const stage = s?.stages.find((x) => x.id === sel.stageId)
  if (!s || !stage) return { target: null, label: '', reason: '請選擇期與關卡' }
  const built = buildRaidTarget({ season: s.season, stage, bosses: s.bosses, difficulty: sel.difficulty, bossId: sel.bossId, part: sel.part && sel.part !== 'auto' ? sel.part : undefined })
  const d = sel.difficulty ?? highestRaidDifficulty(s.season) ?? undefined
  const variant = d ? stage.raid?.variants[d] : undefined
  const bossId = sel.bossId ?? variant?.bossIds[0]
  const boss = s.bosses.find((b) => b.id === bossId)
  const label = `#${s.season.seq} ${s.season.name}・${stage.raid?.group ?? '?'} ${variant?.name ?? stage.name}・${(d && s.season.difficultyNames[d]) || d || ''}・${boss?.name ?? ''}`
  return built.target ? { target: built.target, label } : { target: null, label, reason: built.reason }
}
