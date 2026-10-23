import type { RaidEvent, RaidReinforcement, RaidRefDict, RaidStageVariant, RaidUnit, RaidUnitEntry } from '../../types/boss'
import { turnTimeline, whenLabel } from '../../utils/raidView'
import { RaidRichText, PendingName } from './RaidRichText'

// ─── 增援時程與回合事件（PLAN-064 E-5）──────────────────────────────────────
//
// 「第 N 回合」的增援排進回合格（預警、增援、懸賞期限、回合上限）；每回合、條件觸發、
// 開戰時的另列一行一條。推不出時點的寫「特定條件觸發」，不猜（決策五）。

function UnitList({ units, unitDict }: { units: RaidUnit[]; unitDict: Record<string, RaidUnitEntry> }) {
  return (
    <>
      {units.map((u, i) => {
        const e = unitDict[u.unit]
        return (
          <span key={i}>
            {i > 0 && '、'}
            <PendingName pending={e?.pending} className={u.ally ? 'text-accent-green' : ''}>{e?.name ?? '未知單位'}</PendingName>
            {u.count > 1 && <span className="text-text-dim"> ×{u.count}</span>}
            {u.ally && <span className="text-accent-green text-[10px]">（友軍）</span>}
          </span>
        )
      })}
    </>
  )
}

function WhenText({ when, refDict, unitDict }: { when: RaidReinforcement['when']; refDict: RaidRefDict; unitDict: Record<string, RaidUnitEntry> }) {
  return <RaidRichText text={whenLabel(when)} refDict={refDict} unitDict={unitDict} />
}

export function RaidTimeline({ variant, refDict, unitDict }: {
  variant: RaidStageVariant
  refDict: RaidRefDict
  unitDict: Record<string, RaidUnitEntry>
}) {
  const tl = turnTimeline(variant)
  const events: RaidEvent[] = variant.events ?? []
  const everyTurn = events.filter((e) => e.when.kind === 'everyTurn' || e.when.kind === 'start')
  const otherEvents = events.filter((e) => e.when.kind !== 'everyTurn' && e.when.kind !== 'start')
  const hasTurnContent = tl.cells.some((c) => c.warns.length || c.arrivals.length || c.bounties.length) || variant.turnLimit > 0

  return (
    <div className="space-y-2">
      {everyTurn.map((e, i) => (
        <div key={`ev-${i}`} className="px-3 py-1.5 rounded border border-accent-purple/30 bg-accent-purple/5 text-[12.5px] text-text-secondary">
          <span className="text-accent-purple font-bold mr-1"><WhenText when={e.when} refDict={refDict} unitDict={unitDict} />：</span>
          <RaidRichText text={e.text} refDict={refDict} unitDict={unitDict} />
          {e.also && <span className="text-text-dim">（若 <RaidRichText text={e.also.join('、')} refDict={refDict} unitDict={unitDict} />）</span>}
        </div>
      ))}

      {hasTurnContent && (
        <div className="overflow-x-auto overscroll-x-contain -mx-1 px-1 pb-1">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${tl.cells.length}, minmax(112px, 1fr))` }}>
            {tl.cells.map((c) => (
              <div key={c.turn} className={`rounded border p-1.5 min-h-[64px] ${c.isLimit ? 'border-accent-red/50 bg-accent-red/5' : c.bounties.length ? 'border-accent-yellow/40' : 'border-border bg-bg-dark/40'}`}>
                <div className="text-[10px] tracking-[2px] text-text-dim font-[Orbitron,sans-serif]">TURN {c.turn}</div>
                <div className="space-y-1 mt-1 text-[11.5px] leading-snug">
                  {c.warns.map((_, i) => (
                    <div key={`w${i}`} className="px-1.5 py-0.5 rounded bg-accent-yellow/10 text-accent-yellow">⚠ 增援預警</div>
                  ))}
                  {c.arrivals.map(({ rf, timing }, i) => (
                    <div key={`a${i}`} className="px-1.5 py-0.5 rounded bg-accent-red/10 text-text-secondary">
                      <span className="text-accent-red font-bold">{timing === 'end' ? '回合末增援' : '增援'}</span>{' '}
                      <UnitList units={rf.units} unitDict={unitDict} />
                      {rf.also && <div className="text-[10.5px] text-text-dim">若 <RaidRichText text={rf.also.join('、')} refDict={refDict} unitDict={unitDict} /></div>}
                    </div>
                  ))}
                  {c.bounties.map((b, i) => <div key={`b${i}`} className="px-1.5 py-0.5 rounded bg-accent-yellow/10 text-accent-yellow">懸賞「{b}」期限</div>)}
                  {c.isLimit && <div className="px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red font-bold">回合上限</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tl.others.map((rf, i) => (
        <div key={`o-${i}`} className="px-3 py-1.5 rounded border border-border bg-bg-dark/40 text-[12.5px] text-text-secondary">
          <span className={`font-bold mr-1 ${rf.when.kind === 'unknown' ? 'text-text-dim' : 'text-text-primary'}`}>
            <WhenText when={rf.when} refDict={refDict} unitDict={unitDict} />
          </span>
          {rf.also && <span className="text-text-dim">（若 <RaidRichText text={rf.also.join('、')} refDict={refDict} unitDict={unitDict} />）</span>}
          ：增援 <UnitList units={rf.units} unitDict={unitDict} />
          {rf.warn && <span className="text-accent-yellow text-[11.5px]">（預警：<WhenText when={rf.warn} refDict={refDict} unitDict={unitDict} />）</span>}
        </div>
      ))}

      {otherEvents.map((e, i) => (
        <div key={`oe-${i}`} className="px-3 py-1.5 rounded border border-border bg-bg-dark/40 text-[12.5px] text-text-secondary">
          <span className="font-bold mr-1 text-text-primary"><WhenText when={e.when} refDict={refDict} unitDict={unitDict} /></span>
          {e.also && <span className="text-text-dim">（若 <RaidRichText text={e.also.join('、')} refDict={refDict} unitDict={unitDict} />）</span>}
          ：<RaidRichText text={e.text} refDict={refDict} unitDict={unitDict} />
        </div>
      ))}

      {!hasTurnContent && !tl.others.length && !events.length && (
        <div className="text-[12px] text-text-dim">這一關沒有增援或回合事件。</div>
      )}
    </div>
  )
}
