import { assetUrl } from '../../utils/assets'
import type {
  PlannerResult, SlotPlan, Gold3Node, Gold2Node, Gold1Node, FertPair, SlotApproach,
} from '../../types/mechUpgrade'
import type { MechPartPosition } from '../../types/enums'

export type Weight = 'light' | 'medium' | 'heavy'

const SLOT_LABELS: Record<MechPartPosition, string> = {
  torso: '軀幹', leftArm: '左臂', rightArm: '右臂', legs: '腿部',
}

// ─── 來源徽章 ─────────────────────────────────────────────────────────────────

function SrcBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${color}`}>
      {label}
    </span>
  )
}

const C = {
  owned: 'text-accent-green  border-accent-green/40  bg-accent-green/10',
  sf:    'text-accent-yellow border-accent-yellow/40 bg-accent-yellow/10',
  univ:  'text-accent-cyan   border-accent-cyan/40   bg-accent-cyan/10',
  buy:   'text-accent-orange border-accent-orange/40 bg-accent-orange/10',
  core:  'text-accent-purple border-accent-purple/40 bg-accent-purple/10',
  synth: 'text-text-dim      border-border           bg-bg-dark',
}

const GOLD1_BADGE: Record<Gold1Node['source'], { label: string; color: string }> = {
  owned:     { label: '已擁有',   color: C.owned },
  sf_s:      { label: 'S 零件',   color: C.sf   },
  universal: { label: '需備通用', color: C.univ },
  core_raw:  { label: '需備核心原始', color: C.core },
}

// ─── 橫向樹（左→右）─────────────────────────────────────────────────────────

interface TNode { box: React.ReactNode; kids?: TNode[] }

function HTree({ node }: { node: TNode }) {
  if (!node.kids || node.kids.length === 0) {
    return <div className="htree-node">{node.box}</div>
  }
  return (
    <div className="htree-branch">
      <div className="htree-node">{node.box}</div>
      <div className="htree-link" />
      <div className="htree-kids">
        {node.kids.map((k, i) => (
          <div className="htree-kid" key={i}><HTree node={k} /></div>
        ))}
      </div>
    </div>
  )
}

// ─── 視覺節點卡：外框 + 部件/模組圖 或 粗體符號 + 勳章 ──────────────────────

type Tint = 'owned' | 'sf' | 'univ' | 'core' | 'buy' | 'red' | 'plain'
const TINT: Record<Tint, { border: string; bg: string; text: string }> = {
  owned: { border: 'border-accent-green/55',  bg: 'bg-accent-green/10',  text: 'text-accent-green'  },
  sf:    { border: 'border-accent-yellow/60', bg: 'bg-accent-yellow/10', text: 'text-accent-yellow' },
  univ:  { border: 'border-accent-cyan/55',   bg: 'bg-accent-cyan/10',   text: 'text-accent-cyan'   },
  core:  { border: 'border-accent-purple/55', bg: 'bg-accent-purple/10', text: 'text-accent-purple' },
  buy:   { border: 'border-accent-orange/60', bg: 'bg-accent-orange/10', text: 'text-accent-orange' },
  red:   { border: 'border-accent-red/55',    bg: 'bg-accent-red/10',    text: 'text-accent-red'    },
  plain: { border: 'border-border-accent',    bg: 'bg-bg-dark/80',       text: 'text-text-dim'      },
}

interface Ctx { partIcon?: string; weight: Weight }

const SF_MODEL = { s: 'megafactory_s_model', sp: 'megafactory_sp_model', spp: 'megafactory_spp_model' }
const modelUrl   = (f: string)        => `images/mechs/mech_models/${f}.png`
const chevronUrl = (n: 1 | 2 | 3)     => `images/mechs/mech_badges/badge_${n}chevron.png`

const RAINBOW_BG =
  'linear-gradient(135deg, rgba(239,68,68,0.30) 0%, rgba(234,179,8,0.26) 25%, rgba(34,197,94,0.26) 50%, rgba(6,182,212,0.26) 75%, rgba(168,85,247,0.30) 100%)'

/** 外框 + 主圖（部件/模組圖 或 粗體符號）+ 左上勳章 */
function Glyph({ img, symbol, chevron, tint, title, rainbow = false }: {
  img?: string; symbol?: string; chevron?: 1 | 2 | 3; tint: Tint; title?: string; rainbow?: boolean
}) {
  const t = TINT[tint]
  // 超級工廠零件：彩色背景、無勳章
  if (rainbow) {
    return (
      <div
        className="relative w-12 h-12 rounded-lg border border-white/25 flex items-center justify-center"
        style={{ background: RAINBOW_BG }}
        title={title}
      >
        {img && <img src={assetUrl(img)} alt="" className="w-9 h-9 object-contain drop-shadow" />}
      </div>
    )
  }
  return (
    <div className={`relative w-12 h-12 rounded-lg border-2 flex items-center justify-center ${t.border} ${t.bg}`} title={title}>
      {img
        ? <img src={assetUrl(img)} alt="" className="w-9 h-9 object-contain" />
        : <span className={`text-2xl font-black leading-none ${t.text}`}>{symbol ?? '?'}</span>}
      {chevron && (
        <img src={assetUrl(chevronUrl(chevron))} alt="" className="absolute -top-2 -left-2 w-[18px] h-[18px] drop-shadow" />
      )}
    </div>
  )
}

/** 圖示 + 下方標題，作為樹節點的 box */
function Cap({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      {children}
      <span className="text-[10px] text-text-secondary whitespace-nowrap font-medium">{caption}</span>
    </div>
  )
}

function gold1TNode(node: Gold1Node, label: string, ctx: Ctx): TNode {
  const title = GOLD1_BADGE[node.source].label
  let g: React.ReactNode
  if (node.source === 'owned')          g = <Glyph img={ctx.partIcon} chevron={1} tint="owned" title={title} />
  else if (node.source === 'sf_s')      g = <Glyph img={modelUrl(SF_MODEL.s)} tint="sf" title={title} />
  else if (node.source === 'universal') g = <Glyph img={modelUrl(`${ctx.weight}_universal_model`)} chevron={1} tint="univ" title={title} />
  else                                  g = <Glyph img={modelUrl(`${ctx.weight}_core_model`)} chevron={1} tint="core" title={title} />
  return { box: <Cap caption={label}>{g}</Cap> }
}

function fertGlyph(f: 'owned' | 'buy') {
  return f === 'owned'
    ? <Glyph symbol="✓" chevron={2} tint="owned" title="已擁有金二" />
    : <Glyph symbol="?" chevron={2} tint="buy" title="需備金二" />
}

function fertTNode(ferts: FertPair): TNode {
  if (ferts.usedSp) {
    return { box: <Cap caption="肥料 (S+)"><Glyph img={modelUrl(SF_MODEL.sp)} tint="sf" title="S+ 替代兩個肥料" /></Cap> }
  }
  return {
    box: (
      <Cap caption="肥料">
        <div className="flex gap-1.5">{fertGlyph(ferts.fert1)}{fertGlyph(ferts.fert2)}</div>
      </Cap>
    ),
  }
}

function gold2TNode(node: Gold2Node, ctx: Ctx, isCore = false): TNode {
  if (node.source === 'owned') {
    return { box: <Cap caption="目標金二"><Glyph img={ctx.partIcon} chevron={2} tint="owned" title="已擁有金二" /></Cap> }
  }
  const kids: TNode[] = []
  if (node.gold1a) kids.push(gold1TNode(node.gold1a, '金一①', ctx))
  if (node.gold1b) kids.push(gold1TNode(node.gold1b, '金一②', ctx))
  // 核心路線：目標金二為核心金二（核心模型圖 + 核心色 + 兩勳章 + 標題改名）
  const g = isCore
    ? <Glyph img={modelUrl(`${ctx.weight}_core_model`)} chevron={2} tint="core" title="核心金二" />
    : <Glyph img={ctx.partIcon} chevron={2} tint="plain" title="合成金二" />
  return { box: <Cap caption={isCore ? '核心金二' : '目標金二'}>{g}</Cap>, kids }
}

function gold3TNode(node: Gold3Node, idx: 1 | 2, ctx: Ctx): TNode {
  const caption = `金三${idx === 1 ? '①' : '②'}`

  if ((node.source === 'synth' || node.source === 'core') && node.targetGold2 && node.ferts) {
    const isCore = node.source === 'core'
    const g = isCore
      ? <Glyph img={modelUrl(`${ctx.weight}_core_model`)} chevron={3} tint="core" title="核心金三" />
      : <Glyph img={ctx.partIcon} chevron={3} tint="plain" title="合成金三" />
    return { box: <Cap caption={caption}>{g}</Cap>, kids: [gold2TNode(node.targetGold2, ctx, isCore), fertTNode(node.ferts)] }
  }
  if (node.source === 'owned') {
    return { box: <Cap caption={caption}><Glyph img={ctx.partIcon} chevron={3} tint="owned" title="已擁有金三" /></Cap> }
  }
  if (node.source === 'sf_spp') {
    return { box: <Cap caption={caption}><Glyph img={modelUrl(SF_MODEL.spp)} tint="sf" title="S++ 萬能金三" rainbow /></Cap> }
  }
  return {
    box: <Cap caption={caption}><Glyph symbol="?" chevron={3} tint="red" title="缺零件" /></Cap>,
    kids: [{ box: <span className="text-[11px] text-accent-red whitespace-nowrap self-center">需再取得 1 個真實零件，或改用核心</span> }],
  }
}

// ─── 部位卡 ───────────────────────────────────────────────────────────────────

function SlotResultCard({
  plan, approach, onApproachChange, ctx,
}: {
  plan: SlotPlan
  approach: SlotApproach
  onApproachChange: (a: SlotApproach) => void
  ctx: Ctx
}) {
  const label = SLOT_LABELS[plan.slot]
  const done  = plan.gold3a.source === 'owned' && plan.gold3b.source === 'owned'
  const isShort = plan.gold3a.source === 'shortage' || plan.gold3b.source === 'shortage'
  const hasCore = plan.gold3a.source === 'core' || plan.gold3b.source === 'core'
  // 缺真實零件時，通用(自行farm) vs 核心(用核心金三補) 才有意義
  const showToggle = plan.feasible && (isShort || hasCore)

  // 此部位需準備的材料 chips（填補合成樹右側留白，並提供逐部位視角）
  const needChips: { label: string; color: string }[] = []
  if (plan.sfUsed.spp   > 0) needChips.push({ label: `S++ ×${plan.sfUsed.spp}`,    color: C.sf   })
  if (plan.sfUsed.sp    > 0) needChips.push({ label: `S+ ×${plan.sfUsed.sp}`,      color: C.sf   })
  if (plan.sfUsed.s     > 0) needChips.push({ label: `S ×${plan.sfUsed.s}`,        color: C.sf   })
  if (plan.buy.coreRaw  > 0) needChips.push({ label: `核心原始 ×${plan.buy.coreRaw}`, color: C.core })
  if (plan.buy.universal> 0) needChips.push({ label: `通用 ×${plan.buy.universal}`,   color: C.univ })
  if (plan.buy.fertBuy  > 0) needChips.push({ label: `肥料 ×${plan.buy.fertBuy}`,     color: C.buy  })

  // 完全沒有零件：無法升級
  if (!plan.feasible) {
    return (
      <div className="rounded-xl border border-accent-red/40 bg-accent-red/5 p-4 flex flex-col gap-2">
        <span className="text-[14px] font-bold text-text-primary">{label}</span>
        <div className="text-[12px] text-accent-red">⚠ 尚未持有任何零件，至少需 1 個才能升彩甲</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-bg-dark/70 p-4 flex flex-col gap-3">
      {/* 標頭 */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-bold text-text-primary">{label}</span>
        {showToggle ? (
          <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-bold flex-shrink-0">
            <button
              onClick={() => onApproachChange('universal')}
              className={`px-2.5 py-1 transition-colors cursor-pointer ${
                approach === 'universal' ? 'bg-accent-cyan/20 text-accent-cyan' : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              通用
            </button>
            <button
              onClick={() => onApproachChange('core')}
              className={`px-2.5 py-1 transition-colors cursor-pointer ${
                approach === 'core' ? 'bg-accent-purple/20 text-accent-purple' : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              核心
            </button>
          </div>
        ) : done ? (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'linear-gradient(90deg, #ef4444, #eab308, #22c55e, #06b6d4, #a855f7)', color: '#fff' }}>
            已彩甲
          </span>
        ) : null}
      </div>

      {/* 合成樹（左，撐滿並置中）＋ 逐部位需備材料（右，填補留白） */}
      <div className="flex flex-wrap items-stretch gap-3">
        <div data-tree-scroll className="flex-1 min-w-0 bg-bg-dark/60 rounded-lg p-3 overflow-x-auto">
          <div className="flex flex-col gap-3 w-max mx-auto">
            <HTree node={gold3TNode(plan.gold3a, 1, ctx)} />
            <div className="h-px bg-border" />
            <HTree node={gold3TNode(plan.gold3b, 2, ctx)} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 shrink-0 sm:w-[124px]">
          <span className="text-[9px] font-bold tracking-[2px] text-text-dim uppercase font-[Orbitron,sans-serif]">
            需備材料
          </span>
          {needChips.map((c, i) => (
            <span key={i} className={`text-[11px] font-bold px-2 py-1 rounded border text-center ${c.color}`}>
              {c.label}
            </span>
          ))}
          {isShort && (
            <span className="text-[11px] font-semibold text-accent-red leading-tight">
              缺 {plan.shortage} 個真實零件，可切「核心」補
            </span>
          )}
          {needChips.length === 0 && !isShort && (
            <span className="text-[11px] font-semibold text-accent-green">✓ 材料已備齊</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 主元件 ───────────────────────────────────────────────────────────────────

interface PlanResultProps {
  result:           PlannerResult
  slotApproach:     Record<MechPartPosition, SlotApproach>
  onApproachChange: (slot: MechPartPosition, a: SlotApproach) => void
  partIcons:        Partial<Record<MechPartPosition, string>>
  weight:           Weight
}

export function PlanResult({ result, slotApproach, onApproachChange, partIcons, weight }: PlanResultProps) {
  const { slots, totalBuy, sfUsed } = result
  const sfTotal  = sfUsed.s + sfUsed.sp + sfUsed.spp
  const buyTotal = totalBuy.universal + totalBuy.fertBuy + totalBuy.coreRaw
  const allOwned = slots.every(p => p.gold3a.source === 'owned' && p.gold3b.source === 'owned')
  const blockedSlots = slots.filter(p => !p.feasible)
  const shortSlots   = slots.filter(p => p.feasible && p.shortage > 0)

  return (
    <div className="flex flex-col gap-5">

      {/* 需準備材料總覽 */}
      <div className="bg-bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
        <span className="text-[10px] font-bold tracking-[3px] text-text-dim uppercase font-[Orbitron,sans-serif]">
          Shopping List
        </span>

        {allOwned ? (
          <div className="text-[13px] text-accent-green font-semibold">✓ 四部位皆已具備彩甲材料。</div>
        ) : (
          <>
            {/* 超級工廠耗用 */}
            {sfTotal > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-text-dim flex-shrink-0">超級工廠耗用：</span>
                {sfUsed.spp > 0 && <SrcBadge label={`S++ ×${sfUsed.spp}`} color={C.sf} />}
                {sfUsed.sp  > 0 && <SrcBadge label={`S+ ×${sfUsed.sp}`}  color={C.sf} />}
                {sfUsed.s   > 0 && <SrcBadge label={`S ×${sfUsed.s}`}    color={C.sf} />}
              </div>
            )}

            {/* 需要準備 */}
            {buyTotal > 0 ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <span className="text-[11px] text-text-dim">需要準備：</span>
                {totalBuy.coreRaw > 0 && (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-accent-purple/5 border border-accent-purple/20">
                    <span className="text-[13px] text-text-secondary flex-1">核心改進模組（原始）</span>
                    <span className="font-[JetBrains_Mono,monospace] font-bold text-accent-purple text-[15px]">×{totalBuy.coreRaw}</span>
                  </div>
                )}
                {totalBuy.universal > 0 && (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-accent-cyan/5 border border-accent-cyan/20">
                    <span className="text-[13px] text-text-secondary flex-1">通用改進模組</span>
                    <span className="font-[JetBrains_Mono,monospace] font-bold text-accent-cyan text-[15px]">×{totalBuy.universal}</span>
                  </div>
                )}
                {totalBuy.fertBuy > 0 && (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-accent-orange/5 border border-accent-orange/20">
                    <span className="text-[13px] text-text-secondary flex-1">金二零件（肥料，任意部位）</span>
                    <span className="font-[JetBrains_Mono,monospace] font-bold text-accent-orange text-[15px]">×{totalBuy.fertBuy}</span>
                  </div>
                )}
              </div>
            ) : blockedSlots.length === 0 && shortSlots.length === 0 ? (
              <div className="text-[13px] text-accent-green font-semibold pt-1">
                ✓ 以現有材料{sfTotal > 0 ? '與超級工廠資源' : ''}即可達成全彩甲，無需額外準備。
              </div>
            ) : null}

            {/* 缺零件提示 */}
            {(blockedSlots.length > 0 || shortSlots.length > 0) && (
              <div className="flex flex-col gap-1 pt-1 text-[12px] text-accent-red">
                {blockedSlots.length > 0 && (
                  <div>⚠ {blockedSlots.map(p => SLOT_LABELS[p.slot]).join('、')} 尚無任何零件，無法升級。</div>
                )}
                {shortSlots.length > 0 && (
                  <div>⚠ {shortSlots.map(p => SLOT_LABELS[p.slot]).join('、')} 真實零件不足，可於該部位切換「核心」改用核心金三。</div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 各部位合成樹 */}
      <div data-slots-grid className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {slots.map((plan) => (
          <SlotResultCard
            key={plan.slot}
            plan={plan}
            approach={slotApproach[plan.slot] ?? 'universal'}
            onApproachChange={(a) => onApproachChange(plan.slot, a)}
            ctx={{ partIcon: partIcons[plan.slot], weight }}
          />
        ))}
      </div>
    </div>
  )
}
