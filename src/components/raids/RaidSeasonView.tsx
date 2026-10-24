import { useState } from 'react'
import type { Boss, RaidSeason, Stage } from '../../types/boss'
import { RAID_DIFFICULTY_ORDER, type RaidDifficulty } from '../../types/enums'
import { DIFFICULTY_TONE, type RaidSeasonLink } from '../../utils/raidView'
import { FactionLogo } from '../icons/FactionLogo'
import { PendingName, RaidRichText } from './RaidRichText'
import { RaidStageSection } from './RaidStageSection'
import { Tx } from './RaidTx'
import { RaidManualNote } from './RaidManualNote'

// ─── 一期武裝討伐（PLAN-064 E-3）：/raids/:seasonId 與後台預覽共用 ─────────────────
//
// 難度分頁只畫該期實際有的難度（第 1 期只有初試、第 2–5 期沒有煉獄）。
// 頁首來源說明：依陸版資料、面板是推算值、虛線底線＝譯名待校（E-8，措辭依開放問題 ① 選 A：不寫推算方式）。

export interface RaidRewards {
  weapons: { name: string; pilot?: string }[]
  backpacks: string[]
}

function twStatusChip(s: RaidSeason) {
  if (s.twStatus === 'planned') {
    return <span className="px-1.5 py-px text-[11px] rounded border border-dashed border-accent-yellow/60 text-accent-yellow">台版預計 {s.twDate ?? '未定'}</span>
  }
  return <span className="px-1.5 py-px text-[11px] rounded border border-accent-green/40 text-accent-green">{s.twDate ? `台版 ${s.twDate}` : '台版已開放'}</span>
}

export function RaidSeasonView({ season, stages, bosses, related, rewards, difficulty, onDifficultyChange, preview = false }: {
  season: RaidSeason
  stages: Stage[]
  bosses: Record<string, Boss>
  /** 首領 id → 同名首領出現的其他期（後台預覽不傳） */
  related?: Record<string, RaidSeasonLink[]>
  rewards?: RaidRewards
  difficulty: RaidDifficulty
  onDifficultyChange: (d: RaidDifficulty) => void
  /** 後台預覽：不顯示來源說明以外的頁尾，關卡全部展開 */
  preview?: boolean
}) {
  const diffs = RAID_DIFFICULTY_ORDER.filter((d) => season.difficulties.includes(d))
  const [openGroup, setOpenGroup] = useState<number | null>(stages[0]?.raid?.group ?? null)
  const weekApplies = season.weekBuffs.some((w) => w.difficulties.includes(difficulty))
  const totalLevels = stages.reduce((a, st) => a + Object.keys(st.raid?.variants ?? {}).length, 0)
  const idPrefix = preview ? 'preview-stage' : 'stage'

  const jumpTo = (group: number) => {
    setOpenGroup(group)
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-${group}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="space-y-5">
      {/* ── 頁首 ── */}
      <div className="flex flex-wrap gap-4 items-start">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">#{season.seq} · Armament Raid</div>
          <h1 className="text-3xl font-bold mt-1">
            <PendingName pending={season.i18nPending?.includes('name')}>{season.name}</PendingName>
          </h1>
          {season.subtitleEn && <div className="text-[11px] tracking-[3px] uppercase text-text-dim font-[Orbitron,sans-serif] mt-0.5"><Tx text={season.subtitleEn} /></div>}
          <div className="flex items-center gap-1.5 flex-wrap mt-2 text-[11px]">
            {season.twVersion && <span className="px-1.5 py-px rounded border border-border text-text-secondary">{season.twVersion}</span>}
            {twStatusChip(season)}
            {season.cnOpenDate && <span className="px-1.5 py-px rounded border border-border text-text-dim">陸版 {season.cnOpenDate} 開放</span>}
            <span className="px-1.5 py-px rounded border border-border text-text-dim">{season.difficulties.length} 難度・{totalLevels} 關</span>
            {season.faction && (
              <span className="inline-flex items-center gap-1 px-1.5 py-px rounded border border-border text-text-secondary">
                {season.faction.emblemKey && <FactionLogo logoKey={`${season.faction.emblemKey}_00`} size={14} />}
                <PendingName pending={season.i18nPending?.includes('faction')}>{season.faction.name}</PendingName>
              </span>
            )}
          </div>
        </div>
        {rewards && (rewards.weapons.length > 0 || rewards.backpacks.length > 0) && (
          <div className="rounded-lg border border-border bg-bg-card px-3 py-2 min-w-[220px] text-[12.5px]">
            <div className="text-[9.5px] tracking-[2px] text-text-dim font-[Orbitron,sans-serif] uppercase mb-1">Rewards・取自版本時間線</div>
            {rewards.weapons.map((w, i) => (
              <div key={`w${i}`} className="flex justify-between gap-3"><span>專武「{w.name}」</span>{w.pilot && <span className="text-text-dim">{w.pilot}</span>}</div>
            ))}
            {rewards.backpacks.length > 0 && <div>{rewards.backpacks.join('、')}</div>}
          </div>
        )}
      </div>

      <p className="px-3 py-2 rounded border border-accent-cyan/25 bg-accent-cyan/5 text-[12px] text-text-secondary">
        ℹ 本頁依陸版遊戲資料整理，台版若有平衡調整可能不同。首領面板標「推算值」者是依資料推算的數字，未經台版實測、不含戰鬥中才成立的條件效果。
        <span className="border-b border-dashed border-text-dim/70">虛線底線</span>的名稱是簡轉繁暫譯，尚在校對。
      </p>

      {/* ── 難度分頁 ── */}
      <div role="tablist" aria-label="難度" className="flex gap-1 border-b border-border overflow-x-auto">
        {diffs.map((d) => {
          const tone = DIFFICULTY_TONE[d]
          const active = d === difficulty
          return (
            <button
              key={d}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => onDifficultyChange(d)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-[13.5px] whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active ? `${tone.text} border-current font-bold` : 'text-text-secondary border-transparent hover:text-text-primary'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
              <Tx text={season.difficultyNames[d] ?? d} />
            </button>
          )
        })}
        <span className="ml-auto self-center text-[11px] whitespace-nowrap pl-2">
          {weekApplies
            ? <span className="px-1.5 py-px rounded border border-accent-green/40 text-accent-green">每週加成適用</span>
            : season.weekBuffs.length > 0 && <span className="text-text-dim">每週加成不適用此難度</span>}
        </span>
      </div>

      {/* ── 關卡選單 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {stages.map((st) => {
          const raid = st.raid!
          const v = raid.variants[difficulty]
          const g = season.groups.find((x) => x.stageId === st.id)
          const active = openGroup === raid.group
          return (
            <button
              key={st.id}
              type="button"
              onClick={() => jumpTo(raid.group)}
              disabled={!v}
              className={`text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-40 ${
                active ? 'border-text-secondary bg-bg-card-hover' : 'border-border bg-bg-card hover:border-border-accent'
              }`}
            >
              <div className={`text-[9.5px] tracking-[2px] font-[Orbitron,sans-serif] uppercase ${raid.isFinal ? 'text-accent-orange' : 'text-text-dim'}`}>
                {raid.isFinal ? 'Final・最終關' : `Stage ${raid.group}`}
              </div>
              <div className="text-[13.5px] font-bold text-text-primary truncate"><Tx text={v?.name ?? st.name} /></div>
              <div className="text-[11.5px] text-text-secondary truncate">{(g?.bosses ?? []).map((b) => b.name).join('、')}</div>
            </button>
          )
        })}
      </div>

      {/* ── 各關 ── */}
      <div className="space-y-3">
        {stages.map((st) => (
          <RaidStageSection
            key={`${st.id}-${difficulty}`}
            stage={st}
            difficulty={difficulty}
            bosses={bosses}
            related={related}
            open={preview ? undefined : openGroup === st.raid!.group}
            defaultOpen={preview}
            onToggle={preview ? undefined : () => setOpenGroup((g) => (g === st.raid!.group ? null : st.raid!.group))}
            idPrefix={idPrefix}
          />
        ))}
      </div>

      {/* ── 每週規則與加成 ── */}
      {((season.rules?.length ?? 0) > 0 || season.weekBuffs.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2 rounded-lg border border-border bg-bg-card px-4 py-3">
          {(season.rules?.length ?? 0) > 0 && (
            <div>
              <div className="text-[13px] font-bold text-text-primary mb-1">每週規則</div>
              <ul className="list-disc pl-5 text-[12.5px] text-text-secondary space-y-0.5">
                {season.rules!.map((r) => <li key={r}><Tx text={r} /></li>)}
              </ul>
            </div>
          )}
          {season.weekBuffs.length > 0 && (
            <div>
              <div className="text-[13px] font-bold text-text-primary mb-1">
                每週加成（{season.weekBuffs[0].difficulties.map((d) => season.difficultyNames[d] ?? d).join('、')}）
              </div>
              <ul className="space-y-1 text-[12.5px] text-text-secondary">
                {season.weekBuffs.map((w) => (
                  <li key={w.week}>
                    <span className="text-text-primary">第 {w.week} 週起「<Tx text={w.name} />」</span>
                    {w.desc && <span>：<RaidRichText text={w.desc} /></span>}
                    {w.effects.length > 0 && <div className="text-[11.5px] text-text-dim">{w.effects.map((x, i) => <span key={i}>{i > 0 && '・'}<Tx text={x} /></span>)}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <RaidManualNote paths={season.manualPaths} />
      <p className="text-[11px] text-text-dim">
        資料來源：依陸版遊戲資料整理・譯名尚在校對，簡轉繁暫譯的名稱以虛線底線標示
      </p>
    </div>
  )
}
