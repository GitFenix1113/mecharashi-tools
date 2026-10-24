import { Link } from 'react-router-dom'
import type { Boss, BossVariant } from '../../types/boss'
import type { RaidDifficulty } from '../../types/enums'
import { SkillIcon } from '../icons/SkillIcon'
import { RaidRichText, PendingName } from './RaidRichText'
import { Tx } from './RaidTx'
import { RaidManualNote } from './RaidManualNote'
import { sortBossSkills, skillChangedFromNormal, SKILL_KIND_LABEL, type RaidSeasonLink } from '../../utils/raidView'

// ─── 首領卡（PLAN-064 E-4）────────────────────────────────────────────────────
//
// 面板一律標「推算值」：依陸版資料推算、未經台版實測，戰鬥中才成立的效果列在「未計入」（決策六）。
// 推算方式不在前台說明（開放問題 ① 選 A）。技能依難度完整存放，與初試不同的加提示（決策四）。
// 頭像：資料包的機師模板沒有圖檔鍵，先用名字首字佔位（E-4 待查項）。

const PARTS: { key: 'torso' | 'leftArm' | 'rightArm' | 'legs'; label: string }[] = [
  { key: 'torso', label: '軀幹' }, { key: 'leftArm', label: '左臂' }, { key: 'rightArm', label: '右臂' }, { key: 'legs', label: '腿部' },
]
const PILOT_STATS: { key: 'melee' | 'assault' | 'shooting' | 'tactics' | 'engineering' | 'defense'; label: string }[] = [
  { key: 'melee', label: '格鬥' }, { key: 'assault', label: '突擊' }, { key: 'shooting', label: '射擊' },
  { key: 'tactics', label: '戰術' }, { key: 'engineering', label: '工程' }, { key: 'defense', label: '防禦' },
]

const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))

function Stat({ label, value, sub, ratio }: { label: string; value: string; sub?: string; ratio?: number }) {
  return (
    <div className="rounded border border-border bg-bg-dark/60 px-2.5 py-2 min-w-0">
      <div className="text-[11px] text-text-dim">{label}</div>
      <div className="text-[15px] font-semibold text-text-primary font-[JetBrains_Mono,monospace] tabular-nums truncate">{value}</div>
      {ratio != null && (
        <div className="h-1 mt-1 rounded-full bg-bg-card overflow-hidden">
          <div className="h-full bg-accent-green/80 rounded-full" style={{ width: `${Math.max(4, Math.min(100, ratio * 100))}%` }} />
        </div>
      )}
      {sub && <div className="text-[10.5px] text-text-dim mt-0.5 font-[JetBrains_Mono,monospace] tabular-nums">{sub}</div>}
    </div>
  )
}

export function BossPortrait({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-11 h-11 text-lg' : 'w-16 h-16 text-2xl'
  return (
    <div className={`${dim} shrink-0 rounded-lg border border-accent-red/30 bg-gradient-to-b from-accent-red/15 to-bg-dark flex items-center justify-center font-bold text-accent-red/80`} aria-hidden>
      {name.slice(0, 1)}
    </div>
  )
}

export function RaidBossCard({ boss, difficulty, normal, alsoIn }: {
  boss: Boss
  difficulty: RaidDifficulty
  /** 初試的變體，用來標出「與初試不同」的技能 */
  normal?: BossVariant
  /** 同名首領出現的其他期（後台預覽不傳） */
  alsoIn?: RaidSeasonLink[]
}) {
  const v = boss.variants?.[difficulty]
  if (!v) return null
  const refDict = boss.refDict ?? {}
  const talent = v.skills.find((s) => s.kind === 'talent')
  const maxHp = Math.max(1, ...PARTS.map((p) => v.parts?.[p.key]?.durable ?? 0))
  const weapon = v.weapons[0]

  return (
    <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
      <div className="flex gap-3 p-3">
        <BossPortrait name={boss.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <PendingName pending={boss.i18nPending?.includes('name')} className="text-lg font-bold text-text-primary">{boss.name}</PendingName>
            <span className="px-1.5 py-px text-[10.5px] rounded border border-accent-red/40 text-accent-red bg-accent-red/10">首領</span>
            {v.mech && <span className="px-1.5 py-px text-[10.5px] rounded border border-border text-text-secondary"><Tx text={v.mech} /></span>}
          </div>
          <div className="grid grid-cols-[3.5em_1fr] gap-x-2 text-[12.5px] mt-1 text-text-secondary">
            <span className="text-text-dim">等級</span><span>Lv {v.level}</span>
            {weapon && (<><span className="text-text-dim">武器</span><span>{v.weapons.map((w, i) => <span key={i}>{i > 0 && '、'}<Tx text={w.name} /></span>)}</span></>)}
            {talent && (<><span className="text-text-dim">天賦</span><span><Tx text={talent.name} /></span></>)}
          </div>
          {boss.quote && (
            <p className="text-[12px] text-text-dim italic mt-1.5">「<RaidRichText text={boss.quote} refDict={refDict} />」</p>
          )}
          {alsoIn && alsoIn.length > 0 && (
            <div className="text-[11.5px] text-text-dim mt-1.5">
              也出現在：
              {alsoIn.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && '、'}
                  <Link to={`/raids/${s.id}`} className="text-accent-cyan hover:underline">第 {s.seq} 期「{s.name}」</Link>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {v.anomaly && (
        <div className="mx-3 mb-2 px-2.5 py-1.5 rounded border border-accent-yellow/30 bg-accent-yellow/10 text-[12px] text-accent-yellow">⚠ {v.anomaly}</div>
      )}

      {v.estimated && v.parts && (
        <div className="px-3 pb-3 border-t border-border/60 pt-2.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] text-text-secondary font-bold">面板</span>
            <span className="px-1.5 py-px text-[10.5px] rounded border border-accent-cyan/40 text-accent-cyan bg-accent-cyan/10" title="依陸版資料推算，未經台版實測">推算值</span>
            {v.hpTotal != null && <span className="ml-auto text-[11.5px] text-text-dim">四部位耐久合計 <span className="text-text-primary font-[JetBrains_Mono,monospace]">{fmt(v.hpTotal)}</span></span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {PARTS.map((p) => {
              const part = v.parts?.[p.key]
              return <Stat key={p.key} label={p.label} value={fmt(part?.durable)} sub={part ? `裝甲 ${fmt(part.armor)}` : undefined} ratio={part ? part.durable / maxHp : undefined} />
            })}
            {v.weapons.filter((w) => w.attack != null).map((w, i) => <Stat key={`w${i}`} label={`${w.name} 攻擊`} value={fmt(w.attack)} />)}
            {v.antiCrit != null && <Stat label="抗暴" value={fmt(v.antiCrit)} />}
            {v.dodge != null && <Stat label="閃避（腿部）" value={fmt(v.dodge)} />}
            {PILOT_STATS.filter((s) => v.pilotStats?.[s.key] != null).map((s) => <Stat key={s.key} label={s.label} value={fmt(v.pilotStats?.[s.key])} />)}
          </div>
          {(v.notCounted?.length ?? 0) > 0 && (
            <div className="mt-2 text-[11.5px] text-text-dim">
              未計入面板（戰鬥中才成立）：{v.notCounted!.join('、')}
            </div>
          )}
        </div>
      )}

      {v.difficultyText && v.difficultyText.length > 0 && (
        <div className="px-3 py-2 border-t border-border/60 text-[12px] text-text-secondary">
          <span className="text-text-dim mr-1.5">難度強化</span>{v.difficultyText.map((x, i) => <span key={i}>{i > 0 && '・'}<Tx text={x} /></span>)}
        </div>
      )}

      <ul className="border-t border-border/60 divide-y divide-border/50">
        {sortBossSkills(v.skills).map((s, i) => {
          const changed = skillChangedFromNormal(s, normal?.skills, difficulty === 'normal')
          return (
            <li key={`${s.name}-${i}`} className="flex gap-2.5 px-3 py-2.5">
              <SkillIcon icon={s.icon} name={s.name} size="compact" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="px-1.5 py-px text-[10.5px] rounded border border-border text-text-dim">{SKILL_KIND_LABEL[s.kind ?? 'passive']}</span>
                  <span className="text-[13.5px] font-bold text-text-primary"><Tx text={s.name} /></span>
                  {s.ap && s.ap !== '0' && <span className="text-[11px] text-accent-cyan">AP {s.ap}</span>}
                  {changed && (
                    <span className={`px-1.5 py-px text-[10px] rounded border ${changed === 'new' ? 'border-accent-orange/40 text-accent-orange' : 'border-accent-yellow/40 text-accent-yellow'}`}>
                      {changed === 'new' ? '此難度新增' : '與初試不同'}
                    </span>
                  )}
                </div>
                <p className="text-[12.5px] leading-relaxed text-text-secondary mt-1">
                  <RaidRichText text={s.description} refDict={refDict} />
                </p>
              </div>
            </li>
          )
        })}
      </ul>
      <RaidManualNote paths={boss.manualPaths} difficulty={difficulty} className="px-3 py-2 border-t border-border/60" />
    </div>
  )
}
