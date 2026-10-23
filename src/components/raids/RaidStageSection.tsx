import { useState } from 'react'
import type { Boss, Stage } from '../../types/boss'
import type { RaidDifficulty } from '../../types/enums'
import { RaidRichText, PendingName } from './RaidRichText'
import { RaidBossCard } from './RaidBossCard'
import { RaidTimeline } from './RaidTimeline'
import { unitMechs, type RaidSeasonLink } from '../../utils/raidView'

// ─── 一個關卡組在某個難度（PLAN-064 E-3／E-5／E-6）───────────────────────────

function Chip({ label, children, tone = 'border-border text-text-secondary' }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11.5px] bg-bg-dark/50 ${tone}`}>
      <span className="text-text-dim">{label}</span>{children}
    </span>
  )
}

function SectionLabel({ zh, en }: { zh: string; en: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-1.5">
      <span className="text-[12.5px] font-bold text-text-secondary">{zh}</span>
      <span className="text-[9.5px] tracking-[2px] text-text-dim font-[Orbitron,sans-serif] uppercase">{en}</span>
    </div>
  )
}

export function RaidStageSection({ stage, difficulty, bosses, related, defaultOpen, open: openProp, onToggle, idPrefix = 'stage' }: {
  stage: Stage
  difficulty: RaidDifficulty
  bosses: Record<string, Boss>
  /** 首領 id → 同名首領出現的其他期 */
  related?: Record<string, RaidSeasonLink[]>
  defaultOpen?: boolean
  /** 受控：由上層的關卡選單決定展開哪一關 */
  open?: boolean
  onToggle?: () => void
  idPrefix?: string
}) {
  const [openState, setOpenState] = useState(!!defaultOpen)
  const open = openProp ?? openState
  const setOpen = (f: (x: boolean) => boolean) => (onToggle ? onToggle() : setOpenState(f))
  const raid = stage.raid!
  const v = raid.variants[difficulty]
  if (!v) return null
  const unitDict = raid.unitDict
  const refDict = raid.refDict
  const stageBosses = v.bossIds.map((id) => bosses[id]).filter(Boolean)
  const summary = stageBosses.map((b) => {
    const bv = b.variants?.[difficulty]
    return [b.name, bv?.mech, bv ? `Lv ${bv.level}` : null, bv?.weapons.map((w) => w.name).join('、')].filter(Boolean).join('・')
  }).join('　')

  return (
    <section id={`${idPrefix}-${raid.group}`} className={`rounded-lg border bg-bg-card scroll-mt-24 ${raid.isFinal ? 'border-accent-orange/40' : 'border-border'}`}>
      <header className="flex items-start gap-3 flex-wrap px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] tracking-[3px] font-[Orbitron,sans-serif] uppercase ${raid.isFinal ? 'text-accent-orange' : 'text-text-dim'}`}>
            {raid.isFinal ? 'Final Stage' : `Stage ${raid.group}`}
          </div>
          <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
            {v.name}
            {raid.isFinal && <span className="px-1.5 py-px text-[10.5px] rounded bg-accent-orange/15 text-accent-orange border border-accent-orange/40">最終關</span>}
          </h3>
          {v.desc && <p className="text-[12px] text-text-dim italic">「<RaidRichText text={v.desc} refDict={refDict} unitDict={unitDict} />」</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {v.winText && <Chip label="勝利" tone="border-accent-green/40 text-accent-green"><RaidRichText text={v.winText} /></Chip>}
          {v.loseText && <Chip label="敗北" tone="border-accent-red/40 text-accent-red"><RaidRichText text={v.loseText} /></Chip>}
          {v.clueGate && <Chip label="線索門檻">出現 {v.clueGate.show}・解鎖 {v.clueGate.unlock}</Chip>}
          <button
            type="button"
            onClick={() => setOpen((x) => !x)}
            aria-expanded={open}
            className="px-2.5 py-0.5 text-[12px] rounded border border-border text-text-secondary hover:text-text-primary hover:border-border-accent transition-colors"
          >
            {open ? '收合' : '展開'}
          </button>
        </div>
      </header>

      {!open && summary && <div className="px-4 pb-3 -mt-1 text-[12.5px] text-text-secondary">{summary}</div>}

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/60 pt-3">
          {(v.anomalies?.length ?? 0) > 0 && v.anomalies!.map((a, i) => (
            <div key={`a${i}`} className="px-3 py-1.5 rounded border border-accent-yellow/30 bg-accent-yellow/10 text-[12px] text-accent-yellow">⚠ {a}</div>
          ))}
          {(v.features?.length || v.terrain?.length || v.difficultyText?.length) ? (
            <div className="space-y-1.5">
              {v.features?.map((f, i) => (
                <div key={`f${i}`} className="px-3 py-1.5 rounded border border-accent-cyan/30 bg-accent-cyan/5 text-[12.5px] text-text-secondary">
                  <span className="text-accent-cyan font-bold mr-1">關卡特性・{f.name}</span>
                  <RaidRichText text={f.desc} refDict={refDict} unitDict={unitDict} />
                </div>
              ))}
              {v.terrain?.map((t, i) => (
                <div key={`t${i}`} className="px-3 py-1.5 rounded border border-border bg-bg-dark/40 text-[12.5px] text-text-secondary">
                  <span className="text-text-primary font-bold mr-1">地形・{t.name}</span>
                  <RaidRichText text={t.desc} refDict={refDict} unitDict={unitDict} />
                </div>
              ))}
              {v.difficultyText && v.difficultyText.length > 0 && (
                <div className="text-[12px] text-text-dim">難度強化（敵方）：{v.difficultyText.join('・')}</div>
              )}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="space-y-3 min-w-0">
              <SectionLabel zh="首領" en="Boss" />
              {stageBosses.map((b) => (
                <RaidBossCard key={b.id} boss={b} difficulty={difficulty} normal={b.variants?.normal} alsoIn={related?.[b.id]} />
              ))}
            </div>
            <div className="space-y-4 min-w-0">
              <div>
                <SectionLabel zh="開場陣容" en="Deployment" />
                {v.units.length === 0 ? (
                  <div className="text-[12px] text-text-dim">只有首領。</div>
                ) : (
                  <ul className="rounded border border-border divide-y divide-border/60 bg-bg-dark/30">
                    {v.units.map((u, i) => {
                      const e = unitDict[u.unit]
                      return (
                        <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
                          <span className={`w-9 shrink-0 text-[10.5px] ${u.ally ? 'text-accent-green' : e?.kind === 'vehicle' ? 'text-accent-cyan' : 'text-text-dim'}`}>
                            {u.ally ? '友軍' : e?.kind === 'vehicle' ? '設施' : '敵機'}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-text-primary">
                            <PendingName pending={e?.pending}>{e?.name ?? '未知單位'}</PendingName>
                            {unitMechs(u, unitDict).length > 0 && <span className="text-text-dim">・{unitMechs(u, unitDict).join('／')}</span>}
                            {u.count > 1 && <span className="text-text-secondary"> ×{u.count}</span>}
                          </span>
                          {(u.level ?? e?.level) ? <span className="text-[11px] text-text-dim font-[JetBrains_Mono,monospace]">Lv {u.level ?? e?.level}</span> : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
              <div>
                <SectionLabel zh="懸賞與線索" en="Bounty · Clue" />
                <div className="space-y-2">
                  {v.bounties.map((b, i) => (
                    <div key={i} className="rounded border border-border bg-bg-dark/30 px-3 py-2">
                      <div className="text-[13px]"><span className="font-bold text-accent-yellow mr-1.5">{b.name}</span><span className="text-text-secondary"><RaidRichText text={b.desc} refDict={refDict} unitDict={unitDict} /></span></div>
                      {b.clue && (
                        <details className="mt-1 text-[12px]">
                          <summary className="cursor-pointer text-text-dim">
                            線索 <span className="text-text-secondary font-bold">{b.clue.name}</span>
                            {b.clue.desc && <span className="italic">「<RaidRichText text={b.clue.desc} />」</span>}
                          </summary>
                          {b.clue.details && <p className="mt-1 leading-relaxed text-text-secondary whitespace-pre-line"><RaidRichText text={b.clue.details} /></p>}
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div>
            <SectionLabel zh="增援與回合事件" en="Timeline" />
            <RaidTimeline variant={v} refDict={refDict} unitDict={unitDict} />
          </div>
        </div>
      )}
    </section>
  )
}
