import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DescriptionRefs, NeuralDrive, NeuralDriveAbility } from '../../types'
import { resolveNeuralDriveLevel } from '../../utils/neuralDriveAbilities'
import { useIsMobile } from '../../hooks/useIsMobile'
import { SkillIcon } from '../icons/SkillIcon'
import { RefText } from '../refs/RefText'
import { BottomSheet } from './BottomSheet'

// ─── 目前生效的神經驅動能力（PLAN-052-I D-1 → F 補強）────────────────────────
//
// 配裝模擬器左欄算力面板底下那一段。回答的問題只有一個：**我剛剛點的那一格，換到了什麼？**
//
// ⚠ **逐級全列，不只列最高階**：神經驅動的每一級各給一個獨立能力（不是同一個能力的多階），
//   只印最高的等於少講了 N−1 件事。
//
// ⚠ 互動語彙**與機師詳情頁的神經驅動分頁對齊**（本站已有一套，不另發明）：
//     細指標 → hover 出浮窗 ／ 粗指標 → 點擊開 BottomSheet ／ 兩者皆有「展開詳情」就地攤開
//   同一個玩家在兩頁看同一批能力，手感必須一樣。
//
// ⚠ 浮窗走 `createPortal`，**不是絕對定位在面板裡**：面板外框是 `hud-cut`（clip-path），
//   而 clip-path 會裁掉溢出的子元素（PLAN-052-I A-1 已踩過）。浮窗掛到 body 才不會被切掉。
//
// ⚠ 敘述用 `RefText` 而不是純文字：正文裡的 `[凝勢]` 這類引用在別處都是可 hover 的 chip，
//   這裡印成裸括號會變成全站唯一一個「引用不會亮」的地方。`RefText` 本身會優雅降級
//   （buffs 未載入時 chip 仍在、數值 token 顯示為暗色 `?`），且只有正文真的含數值 token
//   時才會去載 buffs —— 不匯出、不展開的人不必付這筆。

/** 一則已達門檻的能力。攤平成這個形狀，渲染端就不必再碰 drives 的巢狀結構。 */
interface ActiveAbility {
  key: string
  zone: string
  level: number
  minSum: number
  name: string
  description: string
  iconLocal?: string
  refs?: DescriptionRefs
}

export function NdActiveAbilities({
  drives, levels, abilityMap,
}: {
  drives: NeuralDrive[]
  /** 分區名 → 選定 Lv（呼叫端已疊過 defaultNdLevels） */
  levels: Record<string, number>
  abilityMap: Map<string, NeuralDriveAbility>
}) {
  const isMobile = useIsMobile()
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState<{ ability: ActiveAbility; x: number; top: number } | null>(null)
  const [sheet, setSheet] = useState<ActiveAbility | null>(null)

  const active = useMemo<ActiveAbility[]>(() => {
    const out: ActiveAbility[] = []
    for (const d of drives) {
      const cur = levels[d.name] ?? 0
      for (const lvl of d.levels ?? []) {
        if (lvl.level > cur) continue
        const a = resolveNeuralDriveLevel(lvl, abilityMap)
        // 資料未遷移且嵌入欄位也空 → 不印一列空白（那一列除了佔位什麼都沒說）
        if (!a.name) continue
        out.push({
          key: `${d.name}-${lvl.level}`,
          zone: d.name,
          level: lvl.level,
          minSum: lvl.minSum,
          name: a.name,
          description: a.description ?? '',
          iconLocal: a.iconLocal,
          refs: a.descriptionRefs ?? lvl.descriptionRefs,
        })
      }
    }
    return out
  }, [drives, levels, abilityMap])

  if (active.length === 0) {
    return (
      <div className="flex flex-col border-t border-border pt-2" style={{ gap: 6 }}>
        <div className="text-[10px] font-bold tracking-wide text-text-dim">目前生效</div>
        <p className="text-[12px] text-text-dim leading-relaxed">
          目前沒有已達門檻的能力 —— 點上面的 Lv 條加算力。
        </p>
      </div>
    )
  }

  // 展開時浮窗必須關掉：同一段敘述同時出現在列上與浮窗裡，只會擋住自己
  const openHover = (ability: ActiveAbility, el: HTMLElement) => {
    if (isMobile || expanded) return
    const r = el.getBoundingClientRect()
    setHover({ ability, x: Math.min(r.right + 10, window.innerWidth - 300), top: r.top })
  }

  return (
    <div className="flex flex-col border-t border-border pt-2" style={{ gap: 6 }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span className="text-[10px] font-bold tracking-wide text-text-dim">目前生效</span>
        <span className="text-[10px] text-text-dim font-[JetBrains_Mono,monospace]">{active.length}</span>
        <button
          type="button"
          onClick={() => { setExpanded((v) => !v); setHover(null) }}
          className={`ml-auto hud-cut-sm px-2 py-0.5 text-[11px] border transition-colors cursor-pointer ${
            expanded
              ? 'border-accent-pink/50 text-accent-pink bg-accent-pink/10'
              : 'border-border text-text-secondary hover:border-border-accent'
          }`}
        >
          {expanded ? '▼ 收合詳情' : '▶ 展開詳情'}
        </button>
      </div>

      <div className="flex flex-col" style={{ gap: expanded ? 8 : 5 }}>
        {active.map((a) => (
          <div
            key={a.key}
            role={isMobile && !expanded ? 'button' : undefined}
            tabIndex={isMobile && !expanded ? 0 : undefined}
            onMouseEnter={(e) => openHover(a, e.currentTarget)}
            onMouseLeave={() => setHover(null)}
            onClick={() => { if (isMobile && !expanded) setSheet(a) }}
            className={`flex items-start transition-colors ${
              expanded ? '' : 'hover:bg-bg-dark/60'
            } ${isMobile && !expanded ? 'cursor-pointer' : ''}`}
            style={{ gap: 8, padding: '2px 4px', marginInline: -4 }}
          >
            <SkillIcon iconLocal={a.iconLocal} name={a.name} size="sm" />
            <div className="flex flex-col min-w-0 grow" style={{ gap: 2 }}>
              <div className="flex items-baseline" style={{ gap: 8 }}>
                <span className="text-[13px] text-text-primary leading-snug min-w-0">{a.name}</span>
                <span className="ml-auto shrink-0 font-[JetBrains_Mono,monospace] tabular-nums text-[11px] text-text-dim whitespace-nowrap">
                  {a.zone} Lv{a.level}
                </span>
              </div>
              {expanded && (
                <>
                  <span className="font-[JetBrains_Mono,monospace] tabular-nums text-[10px] text-text-dim">
                    算力 ≥ {a.minSum}
                  </span>
                  <p className="text-[12px] text-text-secondary leading-relaxed">
                    <RefText text={a.description} refs={a.refs} />
                  </p>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {hover && !expanded && !isMobile && (
        <AbilityTooltip ability={hover.ability} x={hover.x} anchorTop={hover.top} />
      )}

      <BottomSheet open={!!sheet && !expanded} onClose={() => setSheet(null)}>
        {sheet && <AbilityBody ability={sheet} />}
      </BottomSheet>
    </div>
  )
}

/** 浮窗與 BottomSheet 共用的內容 —— 兩處各寫一份會在改文案時只改到一邊。 */
function AbilityBody({ ability }: { ability: ActiveAbility }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SkillIcon iconLocal={ability.iconLocal} name={ability.name} size="sm" />
        <span className="text-[14px] font-bold text-text-primary min-w-0">{ability.name}</span>
      </div>
      <p className="text-[11px] text-text-dim font-[JetBrains_Mono,monospace] tabular-nums">
        {ability.zone} Lv{ability.level} · 算力 ≥ {ability.minSum}
      </p>
      <p className="text-[12px] text-text-secondary leading-relaxed">
        <RefText text={ability.description} refs={ability.refs} />
      </p>
    </div>
  )
}

/**
 * 視窗內夾住的浮窗。掛 `document.body`（見檔頭：面板外框的 clip-path 會裁掉它）。
 *
 * `pointer-events-none` 是刻意的：浮窗蓋在滑鼠與列之間會讓 `mouseleave` 立刻觸發，
 * 於是浮窗開了又關、不停閃爍。代價是浮窗裡的引用 chip 點不到 —— 要點的人展開詳情。
 */
function AbilityTooltip({ ability, x, anchorTop }: { ability: ActiveAbility; x: number; anchorTop: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, ability])

  return createPortal(
    <div ref={ref} className="fixed z-50 pointer-events-none w-72" style={{ left: x, top }}>
      {/* ⚠ 底色用不透明的 bg-bg-tooltip：bg-bg-card 帶 0.65 alpha，底下的列會透出來 */}
      <div className="rounded-xl border border-border-accent bg-bg-tooltip p-3.5 shadow-2xl">
        <AbilityBody ability={ability} />
      </div>
    </div>,
    document.body,
  )
}
