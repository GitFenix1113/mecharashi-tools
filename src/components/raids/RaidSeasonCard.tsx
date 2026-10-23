import { Link } from 'react-router-dom'
import type { RaidSeason } from '../../types/boss'
import { RAID_DIFFICULTY_ORDER } from '../../types/enums'
import { DIFFICULTY_TONE } from '../../utils/raidView'
import { FactionLogo } from '../icons/FactionLogo'
import { BossPortrait } from './RaidBossCard'
import { PendingName } from './RaidRichText'
import type { RaidRewards } from './RaidSeasonView'

// ─── /raids 期列表的一張卡（PLAN-064 E-2）──────────────────────────────────────
//
// 比照遊戲內強敵圖鑑的分組：勢力徽章＋勢力名｜期號·期名＋英文副標，下面一排首領（最終關強調）；
// 再加台版版本與狀態、難度數、獎勵武器／背包（取自時間線）。

export function RaidStatusChip({ season }: { season: RaidSeason }) {
  if (season.twStatus === 'planned') {
    return <span className="px-1.5 py-px text-[10.5px] rounded border border-dashed border-accent-yellow/60 text-accent-yellow whitespace-nowrap">台版預計 {season.twDate ?? '未定'}</span>
  }
  return <span className="px-1.5 py-px text-[10.5px] rounded border border-accent-green/40 text-accent-green whitespace-nowrap">{season.twDate ? `台版 ${season.twDate}` : '台版已開放'}</span>
}

export function RaidSeasonCard({ season, rewards }: { season: RaidSeason; rewards?: RaidRewards | null }) {
  const diffs = RAID_DIFFICULTY_ORDER.filter((d) => season.difficulties.includes(d))
  return (
    <Link
      to={`/raids/${season.id}`}
      className="group relative block rounded-xl border border-border bg-bg-card hover:bg-bg-card-hover hover:border-border-accent transition-colors no-underline overflow-hidden p-4"
    >
      <span aria-hidden className="pointer-events-none absolute -right-2 -top-4 text-[84px] leading-none font-bold font-[Orbitron,sans-serif] text-text-primary/[0.04] select-none">
        {String(season.seq).padStart(2, '0')}
      </span>
      <div className="relative">
        <div className="flex items-center gap-1.5 text-[10px] tracking-[2px] text-text-dim font-[Orbitron,sans-serif]">
          #{season.seq}
          {season.faction && (
            <span className="inline-flex items-center gap-1 tracking-normal font-[inherit] text-[11px] text-text-secondary">
              {season.faction.emblemKey && <FactionLogo logoKey={`${season.faction.emblemKey}_00`} size={13} />}
              {season.faction.name}
            </span>
          )}
        </div>
        <div className="text-xl font-bold text-text-primary mt-0.5">
          <PendingName pending={season.i18nPending?.includes('name')}>{season.name}</PendingName>
        </div>
        {season.subtitleEn && <div className="text-[10px] tracking-[2.5px] uppercase text-text-dim font-[Orbitron,sans-serif]">{season.subtitleEn}</div>}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {season.twVersion && <span className="px-1.5 py-px text-[10.5px] rounded border border-border text-text-secondary">{season.twVersion}</span>}
          <RaidStatusChip season={season} />
          <span className="flex gap-0.5 ml-0.5" title={diffs.map((d) => season.difficultyNames[d] ?? d).join('／')}>
            {diffs.map((d) => <span key={d} className={`w-3.5 h-1 rounded-full ${DIFFICULTY_TONE[d].dot}`} />)}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5 mt-3">
          {season.groups.map((g) => {
            const name = g.bosses.map((b) => b.name).join('・') || g.name
            return (
              <div key={g.stageId} className="flex flex-col items-center gap-1 min-w-0" title={`${g.name}：${name}`}>
                <div className={g.isFinal ? 'rounded-lg ring-1 ring-accent-yellow/60' : ''}><BossPortrait name={g.bosses[0]?.name ?? g.name} size="sm" /></div>
                <span className={`text-[11px] truncate max-w-full ${g.isFinal ? 'text-accent-yellow' : 'text-text-secondary'}`}>{name}</span>
              </div>
            )
          })}
        </div>

        {rewards && (rewards.weapons.length > 0 || rewards.backpacks.length > 0) && (
          <div className="mt-3 pt-2 border-t border-border/60 text-[11.5px] space-y-0.5">
            {rewards.weapons.length > 0 && <div><span className="text-text-dim mr-2">專武</span><span className="text-text-secondary">{rewards.weapons.map((w) => w.name).join('、')}</span></div>}
            {rewards.backpacks.length > 0 && <div><span className="text-text-dim mr-2">背包</span><span className="text-text-secondary">{rewards.backpacks.join('、')}</span></div>}
          </div>
        )}
      </div>
    </Link>
  )
}
