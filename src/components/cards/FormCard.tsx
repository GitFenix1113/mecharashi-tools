import { useMemo } from 'react'
import type { MechForm } from '../../types'
import { useGameData } from '../../contexts/GameDataContext'
import { resolveIconSrc } from '../../utils/assets'
import { RefText } from '../refs/RefText'
import { RefChip } from '../refs/RefChip'
import { slotKey } from '../../types/slots'
import { mountLabel } from '../../utils/mechSlots'

/**
 * 機師形態卡（PLAN-041 D-3）。
 *
 * 官方把形態的效果拆在三個不同地方，玩家要自己拼：形態卡正文、天賦滿星給的形態增益、
 * 專屬模組的形態加成。本卡把三者並列，**每段各自標來源、不聚合成單一數值**——
 * 丟失來源標註的聚合表會讓人誤判「這個數字是形態本身給的」。
 *
 * 第二～四層全部是**反查**出來的，不在 MechForm 上落盤：
 *   · 形態增益 ← form.grantedBuffIds
 *   · 模組加成 ← 哪個 module 的 descriptionRefs 指向本形態（refType:'form'）
 *   · 相關技能 ← 哪個 pilotSkill 的 descriptionRefs 指向本形態
 * 反查的好處是「新增一個提到本形態的模組／技能」不必回頭改形態文件；
 * 箭頭方向也與計畫書一致（module/skill → form，永不反向）。
 */

/** 從一段多行正文裡挑出提到指定 token 的行（帕姆斯陣列一行一形態）。 */
function linesMentioning(text: string, tokens: string[]): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && tokens.some((t) => l.includes(`[${t}]`)))
}

function Layer({
  title,
  source,
  accent,
  children,
}: {
  title: string
  source?: string
  accent: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-border pt-2.5 mt-2.5 first:border-t-0 first:pt-0 first:mt-0">
      {/* 標題 shrink-0 + nowrap：來源字串可能很長（「帕姆斯陣列・與上方形態固有效果可疊加」），
          不擋的話 360px 下會把「模組加成」四個字自己折成兩行。要折的是來源不是標題。 */}
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <span className={`shrink-0 whitespace-nowrap text-[11px] font-bold tracking-wider ${accent}`}>▎{title}</span>
        {source && <span className="text-[11px] text-text-dim">ⓘ {source}</span>}
      </div>
      <div className="text-[13px] text-text-secondary leading-relaxed space-y-1">{children}</div>
    </div>
  )
}

export function FormCard({ form }: { form: MechForm }) {
  const gd = useGameData()

  const grantedBuffs = useMemo(
    () => (form.grantedBuffIds ?? []).map((id) => gd.buffs.find((b) => b.id === id)).filter(Boolean),
    [form.grantedBuffIds, gd.buffs],
  )

  // 模組加成：反查引用本形態的模組，並挑出正文中提到它的那幾行
  const moduleHits = useMemo(() => {
    return gd.modules.flatMap((m) => {
      const refs = m.descriptionRefs ?? {}
      const tokens = Object.keys(refs).filter((k) => refs[k]?.refType === 'form' && refs[k]?.refId === form.id)
      if (!tokens.length) return []
      const lines = linesMentioning(m.description ?? '', tokens)
      return lines.length ? [{ module: m, lines, refs }] : []
    })
  }, [gd.modules, form.id])

  // 相關技能：反查引用本形態的技能（虛粒子形態的「獲得所有形態增益效果」就是靠這層被看見）
  const skillHits = useMemo(
    () => gd.pilotSkills.filter((s) =>
      Object.values(s.descriptionRefs ?? {}).some((r) => r?.refType === 'form' && r?.refId === form.id),
    ),
    [gd.pilotSkills, form.id],
  )

  const restrict = form.restrict

  const sig = !!form.isSignature

  return (
    <div className={`rounded-xl border p-3.5 bg-bg-dark ${
      sig ? 'border-accent-yellow/50 shadow-[0_0_0_1px_rgba(234,179,8,0.15)]' : 'border-border'
    }`}>
      {/* ── 標頭 ── */}
      <div className="flex items-center gap-2.5 mb-2.5">
        {form.icon && (
          <img
            src={resolveIconSrc(form.icon)}
            alt=""
            className="w-9 h-9 rounded object-contain bg-bg-card border border-border/60 shrink-0"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {sig && <span className="text-accent-yellow shrink-0">★</span>}
            <h3 className="font-bold text-[15px] text-text-primary truncate">{form.name}</h3>
            {sig && (
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow shrink-0">
                天賦專屬
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 裝備限制 ── */}
      <div className="rounded-lg bg-bg-card/60 border border-border/60 px-2.5 py-2 mb-2.5 text-[12px]">
        {restrict?.kind === 'fixedArmament' ? (
          <>
            <div className="text-text-secondary mb-1.5">
              <span className="text-accent-yellow font-medium">武裝焊死</span>
              ：本形態下所有槽位皆不可調整
            </div>
            <div className="flex flex-wrap gap-1.5">
              {/* key 用 slotKey() 而不是 weaponId：同一把武器可能掛在兩格（帕斯卡的兩肩） */}
              {restrict.mounts.map((mount) => {
                const w = gd.weapons.find((x) => x.id === mount.weaponId)
                return (
                  <span
                    key={slotKey({ bank: 'main', slot: mount.slot, side: mount.side })}
                    className="px-1.5 py-0.5 rounded border border-accent-yellow/30 bg-accent-yellow/10"
                  >
                    {w
                      ? <RefChip inner={w.name} entity={{ refType: 'weapon', refId: mount.weaponId }} />
                      : <span className="text-accent-red">⚠ {mount.weaponId}</span>}
                    <span className="text-text-dim ml-1">{mountLabel(mount)}</span>
                  </span>
                )
              })}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 flex-wrap text-text-secondary">
            <span>可裝備</span>
            {(restrict?.allow ?? []).map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded border border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan">
                {t}
              </span>
            ))}
            <span className="text-text-dim">武器</span>
          </div>
        )}
      </div>

      {/* ── 第一層：形態固有 ── */}
      <Layer title="形態固有" accent="text-accent-orange">
        <RefText text={form.description} refs={form.descriptionRefs} />
      </Layer>

      {/* ── 第二層：形態增益 ── */}
      {grantedBuffs.length > 0 ? (
        <Layer title="形態增益" source="天賦滿星" accent="text-accent-purple">
          {grantedBuffs.map((b) => (
            <p key={b!.id}>
              <RefText text={b!.description ?? ''} refs={b!.descriptionRefs} />
            </p>
          ))}
        </Layer>
      ) : skillHits.length > 0 ? (
        <Layer title="形態增益" accent="text-accent-purple">
          <p className="text-text-dim">
            本形態沒有專屬的形態增益，取得方式寫在下方的相關技能正文裡。
          </p>
        </Layer>
      ) : null}

      {/* ── 第三層：模組加成 ── */}
      {moduleHits.map(({ module: m, lines, refs }) => (
        <Layer key={m.id} title="模組加成" source={`${m.name}・與上方形態固有效果可疊加`} accent="text-accent-green">
          {lines.map((l, i) => (
            <p key={i}><RefText text={l} refs={refs} /></p>
          ))}
        </Layer>
      ))}

      {/* ── 第四層：相關技能 ──
          反查而來，不落盤。虛粒子形態的「消耗所有[激發能]切換為[虛粒子形態]，獲得所有形態增益
          效果」正是靠這層出現在卡上——否則玩家在該卡找不到任何增益資訊。 */}
      {skillHits.length > 0 && (
        <Layer title="相關技能" source="正文提到本形態" accent="text-accent-cyan">
          {skillHits.map((s) => (
            <p key={s.id}>
              <span className="text-text-primary font-medium">{s.name}</span>
              <span className="text-text-dim">：</span>
              <RefText text={s.description ?? ''} refs={s.descriptionRefs} />
            </p>
          ))}
        </Layer>
      )}

      {/* 入退場條件（目前四筆皆空；官方寫在技能上時本欄留空是正確的） */}
      {form.entryNote && (
        <Layer title="入退場條件" accent="text-text-dim">
          <p>{form.entryNote}</p>
        </Layer>
      )}
    </div>
  )
}
