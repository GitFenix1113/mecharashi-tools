import { useState, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link } from 'react-router-dom'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useDragOffset } from '../../hooks/useDragOffset'
import type { MechPart, Module } from '../../types'
import { MechPartPosition } from '../../types/enums'
import { assetUrl, imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../../components/FallbackImage'
import { useMechWithModules } from '../../hooks/useFirestore'
import { STAT_LABELS } from '../../utils/moduleStats'
import { RefText } from '../../components/RefText'

const ARMOR_STYLES: Record<string, string> = {
  輕型: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/40',
  中甲: 'text-accent-green bg-accent-green/10 border-accent-green/40',
  重型: 'text-accent-red bg-accent-red/10 border-accent-red/40',
}

const PART_LABELS: Record<string, string> = {
  [MechPartPosition.TORSO]:     '軀幹',
  [MechPartPosition.LEFT_ARM]:  '左臂',
  [MechPartPosition.RIGHT_ARM]: '右臂',
  [MechPartPosition.LEGS]:      '腿部',
}

const RARITY_STYLES: Record<string, string> = {
  S: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/40',
  A: 'text-accent-purple bg-accent-purple/10 border-accent-purple/40',
}

type NumericPartStatKey = 'durable' | 'firepower' | 'weight' | 'output' | 'antiRiot' | 'hit' | 'dodge' | 'move'

const PART_STAT_KEYS: { key: NumericPartStatKey; label: string }[] = [
  { key: 'durable',   label: '耐久'  },
  { key: 'firepower', label: '火力'  },
  { key: 'weight',    label: '重量'  },
  { key: 'output',    label: '出力'  },
  { key: 'antiRiot',  label: '抗暴'  },
  { key: 'hit',       label: '命中'  },
  { key: 'dodge',     label: '閃避'  },
  { key: 'move',      label: '移動力' },
]


function LevelTooltipRows({ mod }: { mod: Module }) {
  const levels = mod.levels ?? []
  const activeStats = STAT_LABELS.filter(({ key }) =>
    levels.some((lv) => ((lv[key] as number | undefined) ?? 0) > 0)
  )
  return (
    <>
      {levels.map((lv) => (
        <div key={lv.level} className="bg-bg-dark rounded-lg p-2.5">
          <div className="flex items-start gap-2">
            <span className="text-[13px] px-1.5 py-0.5 rounded border text-accent-orange bg-accent-orange/10 border-accent-orange/30 font-bold flex-shrink-0">
              Lv.{lv.level}
            </span>
            {lv.description && (
              <span className="text-[14px] text-text-secondary leading-tight"><RefText text={lv.description} refs={lv.descriptionRefs ?? mod.descriptionRefs} /></span>
            )}
          </div>
          {activeStats.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 pl-1">
              {activeStats.map(({ key, label, color, suffix, prefix }) => {
                const val = (lv[key] as number | undefined) ?? 0
                if (!val) return null
                return (
                  <span key={key} className={`text-[14px] ${color}`}>
                    {label}{prefix ?? '+'}{val}{suffix}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

function LevelTooltip({ mod, pinned, mobile = false }: { mod: Module; pinned: boolean; mobile?: boolean }) {
  if ((mod.levels?.length ?? 0) === 0) return null

  if (mobile) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-accent-orange">{mod.name}</span>
          <span className="text-[13px] text-text-dim">各等級效果</span>
        </div>
        <LevelTooltipRows mod={mod} />
      </div>
    )
  }

  return (
    <div className="w-72 max-h-[min(90vh,_600px)] flex flex-col bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl">
      <div
        data-drag-handle
        className={`flex items-center justify-between mb-3 flex-shrink-0 ${pinned ? 'cursor-move select-none' : ''}`}
        title={pinned ? '拖曳標題可移動視窗' : undefined}
      >
        <span className="text-xs font-bold text-accent-orange">{mod.name}</span>
        <span className="text-[13px] text-text-dim">各等級效果{pinned ? ' · 📌' : ''}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
        <LevelTooltipRows mod={mod} />
      </div>
      {!pinned && (
        <p className="text-[13px] text-text-dim mt-2 text-center flex-shrink-0">點擊模組固定此視窗</p>
      )}
    </div>
  )
}

interface ModuleCardProps {
  mod: Module
  showBoundPart?: boolean
  isPinned: boolean
  onEnter: (el: HTMLDivElement) => void
  onLeave: () => void
  onClick: (el: HTMLDivElement, e: React.MouseEvent) => void
}

function ModuleCard({ mod, showBoundPart, isPinned, onEnter, onLeave, onClick }: ModuleCardProps) {
  const hasLevels = (mod.levels?.length ?? 0) > 0
  const rarityStyle = RARITY_STYLES[mod.rarity] ?? ''
  const parts = showBoundPart && mod.boundPart && mod.boundPart.length > 0
    ? (Array.isArray(mod.boundPart) ? mod.boundPart : [mod.boundPart as string]).map((p) => PART_LABELS[p] ?? p).join('・')
    : null

  return (
    <div
      className={`bg-bg-dark rounded-xl border p-4 transition-colors ${
        hasLevels ? 'cursor-pointer' : ''
      } ${isPinned ? 'border-accent-orange' : 'border-border hover:border-border-accent'}`}
      onMouseEnter={(e) => onEnter(e.currentTarget)}
      onMouseLeave={onLeave}
      onClick={(e) => onClick(e.currentTarget, e)}
    >
      <div className="flex items-center gap-2 mb-2">
        {mod.icon && (
          <img
            src={assetUrl(mod.icon)}
            alt=""
            className="w-8 h-8 rounded-lg bg-bg-card border border-border object-cover flex-shrink-0"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-bold text-sm text-text-primary">{mod.name}</p>
            {rarityStyle && (
              <span className={`text-[13px] px-1.5 py-0.5 rounded border ${rarityStyle}`}>{mod.rarity}</span>
            )}
            {hasLevels && (
              <span className="text-[13px] text-text-dim ml-auto flex-shrink-0">
                {isPinned ? '📌' : '◉ 等級效果'}
              </span>
            )}
          </div>
        </div>
      </div>

      {parts && (
        <div className="text-[14px] text-text-dim mb-2">
          綁定部位：<span className="text-accent-purple font-medium">{parts}</span>
        </div>
      )}

      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">
        <RefText text={mod.description} refs={mod.descriptionRefs} />
      </p>

      {(mod.dmg > 0 || (mod.crit_rate ?? 0) > 0 || mod.critDmg > 0 || (mod.acc_rate ?? 0) > 0
        || (mod.firepower_rate ?? 0) > 0 || (mod.armor_rate ?? 0) > 0 || (mod.output_bonus ?? 0) > 0
        || (mod.dodge_rate ?? 0) > 0 || (mod.durable_rate ?? 0) > 0
        || (mod.dmg_resist_rate ?? 0) > 0 || (mod.crit_resist_rate ?? 0) > 0) && (
        <div className="flex gap-2 mt-2 text-[14px] flex-wrap">
          {mod.dmg > 0                        && <ModStat label="傷害" value={`+${mod.dmg}%`} color="text-accent-orange" />}
          {(mod.crit_rate ?? 0) > 0           && <ModStat label="暴擊" value={`+${mod.crit_rate}%`} color="text-accent-yellow" />}
          {mod.critDmg > 0                    && <ModStat label="爆傷" value={`+${mod.critDmg}%`} color="text-accent-red" />}
          {(mod.acc_rate ?? 0) > 0            && <ModStat label="命中" value={`+${mod.acc_rate}%`} color="text-accent-blue" />}
          {(mod.firepower_rate ?? 0) > 0      && <ModStat label="火力" value={`+${mod.firepower_rate}%`} color="text-accent-green" />}
          {(mod.armor_rate ?? 0) > 0          && <ModStat label="護甲" value={`+${mod.armor_rate}%`} color="text-accent-cyan" />}
          {(mod.output_bonus ?? 0) > 0        && <ModStat label="出力" value={`+${mod.output_bonus}`} color="text-accent-purple" />}
          {(mod.dodge_rate ?? 0) > 0          && <ModStat label="回避" value={`+${mod.dodge_rate}%`} color="text-accent-blue" />}
          {(mod.durable_rate ?? 0) > 0        && <ModStat label="耐久" value={`+${mod.durable_rate}%`} color="text-accent-green" />}
          {(mod.dmg_resist_rate ?? 0) > 0     && <ModStat label="減傷" value={`-${mod.dmg_resist_rate}%`} color="text-accent-cyan" />}
          {(mod.crit_resist_rate ?? 0) > 0    && <ModStat label="抗暴" value={`-${mod.crit_resist_rate}%`} color="text-accent-yellow" />}
        </div>
      )}
    </div>
  )
}

function ModStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="text-[14px] bg-bg-card border border-border rounded px-2 py-0.5">
      <span className="text-text-dim">{label} </span>
      <span className={`${color} font-bold`}>{value}</span>
    </span>
  )
}

function EmptyModuleSlot() {
  return (
    <div className="bg-bg-dark/50 border border-dashed border-border rounded-xl p-4 flex items-center justify-center min-h-[72px]">
      <span className="text-xs text-text-dim">未設定</span>
    </div>
  )
}

function ModuleGroupLabel({ label, accent }: { label: string; accent: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className={`w-0.5 h-3.5 rounded-full ${accent}`} />
      <span className="text-[14px] text-text-dim tracking-wider">{label}</span>
    </div>
  )
}

function PartCard({ part, name }: { part: MechPart; name: string }) {
  return (
    <div className="bg-bg-dark border border-border rounded-xl p-3 flex flex-row gap-3 h-full">
      {part.icon && (
        <img
          src={assetUrl(part.icon)}
          alt={name}
          className="w-10 h-10 rounded-lg bg-bg-card border border-border object-contain flex-shrink-0 self-start mt-0.5"
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="mb-1.5">
          <p className="font-bold text-sm text-text-primary leading-tight">{name}</p>
          <p className="text-[13px] text-text-dim leading-tight">{part.interface}</p>
        </div>
        <div className="flex-1 divide-y divide-border">
          {PART_STAT_KEYS.filter(({ key }) => part[key] != null).map(({ key, label }) => (
            <div key={key} className="flex justify-between items-center py-1">
              <span className="text-[14px] text-text-dim">{label}</span>
              <span className="text-[14px] text-text-primary font-medium font-[JetBrains_Mono,monospace]">
                {(part[key] as number).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AttrRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border last:border-0">
      <span className="text-text-dim text-sm">{label}</span>
      <span className="text-text-primary font-medium font-[JetBrains_Mono,monospace]">{value}</span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif] mb-3">
      {children}
    </div>
  )
}

interface TooltipState { modId: string; x: number; anchorTop: number }

function computePos(cardEl: HTMLDivElement): { x: number; anchorTop: number } {
  const rect = cardEl.getBoundingClientRect()
  const tooltipW = 296
  const x = rect.right + 8 + tooltipW > window.innerWidth ? rect.left - tooltipW - 8 : rect.right + 8
  return { x, anchorTop: rect.top }
}

function TooltipPortal({ mod, pinned, x, anchorTop }: {
  mod: Module; pinned: boolean; x: number; anchorTop: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)
  const { offset, dragging, dragHandlers } = useDragOffset(pinned, mod.id)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, mod.id])

  return createPortal(
    <div
      ref={ref}
      className={`fixed z-50 ${pinned ? 'pointer-events-auto' : 'pointer-events-none'} ${dragging ? 'select-none' : ''}`}
      style={{ left: x + offset.dx, top: top + offset.dy, touchAction: pinned ? 'none' : undefined }}
      onClick={(e) => e.stopPropagation()}
      {...(pinned ? dragHandlers : {})}
    >
      <LevelTooltip mod={mod} pinned={pinned} />
    </div>,
    document.body
  )
}

export default function MechDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, loading } = useMechWithModules(id)

  const isMobile = useIsMobile()
  const [hoverTooltip,  setHoverTooltip]  = useState<TooltipState | null>(null)
  const [pinnedTooltip, setPinnedTooltip] = useState<TooltipState | null>(null)
  const [sheetMod, setSheetMod] = useState<Module | null>(null)

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="h-96 bg-bg-card border border-border rounded-xl animate-pulse" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center text-text-dim">
        <p>找不到機甲資料</p>
        <Link to="/mechs" className="text-accent-orange no-underline text-sm mt-4 inline-block">
          ← 返回機甲圖鑑
        </Link>
      </div>
    )
  }

  const { mech, mod4, mod8, fixedMods, exclusiveMods } = data
  const armorCls = ARMOR_STYLES[mech.armorType] ?? 'text-text-secondary bg-bg-card border-border'

  const torso    = mech.parts?.torso    && typeof mech.parts.torso    !== 'number' ? mech.parts.torso    as MechPart : null
  const leftArm  = mech.parts?.leftArm  && typeof mech.parts.leftArm  !== 'number' ? mech.parts.leftArm  as MechPart : null
  const rightArm = mech.parts?.rightArm && typeof mech.parts.rightArm !== 'number' ? mech.parts.rightArm as MechPart : null
  const legs     = mech.parts?.legs     && typeof mech.parts.legs     !== 'number' ? mech.parts.legs     as MechPart : null
  const hasParts = torso || leftArm || rightArm || legs

  const totalFirepower = [torso, leftArm, rightArm, legs].reduce((sum, p) => sum + (p?.firepower ?? 0), 0)
  const totalWeight = [torso, leftArm, rightArm, legs].reduce((sum, p) => sum + (p?.weight ?? 0), 0)
  const remainingOutput = mech.output - totalWeight

  const allMods = [mod4, mod8, ...fixedMods, ...exclusiveMods].filter(Boolean) as Module[]

  const handleEnter = (modId: string, cardEl: HTMLDivElement) => {
    if (isMobile || pinnedTooltip) return
    const mod = allMods.find((m) => m.id === modId)
    if (!mod?.levels?.length) return
    setHoverTooltip({ modId, ...computePos(cardEl) })
  }

  const handleLeave = () => {
    if (isMobile) return
    if (!pinnedTooltip) setHoverTooltip(null)
  }

  const handleClick = (modId: string, cardEl: HTMLDivElement, e: React.MouseEvent) => {
    e.stopPropagation()
    const mod = allMods.find((m) => m.id === modId)
    if (!mod?.levels?.length) {
      if (!isMobile) setPinnedTooltip(null)
      return
    }
    if (isMobile) {
      setSheetMod(mod)
      return
    }
    if (pinnedTooltip?.modId === modId) {
      setPinnedTooltip(null)
    } else {
      setPinnedTooltip({ modId, ...computePos(cardEl) })
      setHoverTooltip(null)
    }
  }

  const activeTooltip = pinnedTooltip ?? hoverTooltip
  const activeMod = activeTooltip ? allMods.find((m) => m.id === activeTooltip.modId) : null

  const moduleCardProps = (mod: Module) => ({
    mod,
    isPinned: pinnedTooltip?.modId === mod.id,
    onEnter:  (el: HTMLDivElement) => handleEnter(mod.id, el),
    onLeave:  handleLeave,
    onClick:  (el: HTMLDivElement, e: React.MouseEvent) => handleClick(mod.id, el, e),
  })

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 bg-bg-dark/10 backdrop-blur-sm rounded-2xl" onClick={() => setPinnedTooltip(null)}>

      {activeMod && activeTooltip && !isMobile && (
        <TooltipPortal
          key={activeTooltip.modId}
          mod={activeMod}
          pinned={!!pinnedTooltip}
          x={activeTooltip.x}
          anchorTop={activeTooltip.anchorTop}
        />
      )}

      <BottomSheet open={!!sheetMod} onClose={() => setSheetMod(null)}>
        {sheetMod && <LevelTooltip mod={sheetMod} pinned={false} mobile />}
      </BottomSheet>

      <Link
        to="/mechs"
        className="inline-flex items-center gap-1 text-sm text-text-dim hover:text-text-primary no-underline mb-6 transition-colors"
      >
        ← 機甲圖鑑
      </Link>

      {/* Header */}
      <div className="mb-8">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold border mb-2 ${armorCls}`}>
          {mech.armorType}
        </span>
        <h1 className="text-3xl font-black">{mech.name}</h1>
      </div>

      {/* 機甲屬性 */}
      <div className="bg-bg-card border border-border rounded-xl p-5 mb-6">
        <SectionLabel>機甲屬性</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8">
          <AttrRow label="火力" value={totalFirepower.toLocaleString()} />
          <AttrRow label="閃避" value={mech.evasion.toLocaleString()} />
          <AttrRow label="移動力" value={mech.mobility} />
          <AttrRow label="重量" value={mech.weight.toLocaleString()} />
          {mech.debutVersion && <AttrRow label="登場版本" value={`v${mech.debutVersion}`} />}
          <div className="flex justify-between items-center py-2 border-b border-border col-span-2 sm:col-span-2">
            <span className="text-text-dim text-sm">出力</span>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-[JetBrains_Mono,monospace] ${remainingOutput >= 0 ? 'text-accent-cyan' : 'text-accent-red'}`}>
                剩餘 {remainingOutput.toLocaleString()}
              </span>
              <span className="text-text-primary font-medium font-[JetBrains_Mono,monospace]">
                {mech.output.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 部件資訊 */}
      <div className="mb-6">
        <SectionLabel>部件資訊（滿級）</SectionLabel>
        {hasParts ? (
          <>
            {/* 手機：機體圖 + 2×2 部件卡 */}
            <div className="lg:hidden space-y-3">
              <div className="bg-bg-card border border-border rounded-xl flex items-center justify-center h-40">
                <FallbackImage
                  candidates={imageCandidates(mech.portrait, `images/mechs/${mech.name}.webp`)}
                  alt={mech.name}
                  className="max-h-36 w-full object-contain"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {torso    && <PartCard part={torso}    name="軀幹" />}
                {rightArm && <PartCard part={rightArm} name="右臂" />}
                {leftArm  && <PartCard part={leftArm}  name="左臂" />}
                {legs     && <PartCard part={legs}     name="腿部" />}
              </div>
            </div>
            {/* 桌面：十字形佈局 */}
            <div className="hidden lg:grid grid-cols-3 gap-3 items-stretch">
              <div />
              {torso ? <PartCard part={torso} name="軀幹" /> : <div />}
              <div />
              {rightArm ? <PartCard part={rightArm} name="右臂" /> : <div />}
              <div className="bg-bg-card border border-border rounded-xl flex items-center justify-center min-h-[200px]">
                <FallbackImage
                  candidates={imageCandidates(mech.portrait, `images/mechs/${mech.name}.webp`)}
                  alt={mech.name}
                  className="max-h-52 w-full object-contain"
                />
              </div>
              {leftArm ? <PartCard part={leftArm} name="左臂" /> : <div />}
              <div />
              {legs ? <PartCard part={legs} name="腿部" /> : <div />}
              <div />
            </div>
          </>
        ) : (
          <p className="text-sm text-text-dim">部件資料不可用</p>
        )}
      </div>

      {/* 機甲模組 */}
      <div onClick={(e) => e.stopPropagation()}>
        <SectionLabel>機甲模組</SectionLabel>
        <div className="space-y-5">

          {/* 特性模組 + 8級模組 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <ModuleGroupLabel label="特性模組" accent="bg-accent-orange" />
              {mod4 ? <ModuleCard {...moduleCardProps(mod4)} /> : <EmptyModuleSlot />}
            </div>
            <div>
              <ModuleGroupLabel label="8級模組" accent="bg-accent-blue" />
              {mod8 ? <ModuleCard {...moduleCardProps(mod8)} /> : <EmptyModuleSlot />}
            </div>
          </div>

          {/* 副模組 */}
          <div>
            <ModuleGroupLabel label="副模組" accent="bg-accent-green" />
            {fixedMods.length > 0 ? (
              <div className={`grid grid-cols-1 ${fixedMods.length > 1 ? 'md:grid-cols-2' : ''} gap-4`}>
                {fixedMods.map((m) => <ModuleCard key={m.id} {...moduleCardProps(m)} />)}
              </div>
            ) : (
              <EmptyModuleSlot />
            )}
          </div>

          {/* 專屬模組 */}
          <div>
            <ModuleGroupLabel label="專屬模組" accent="bg-accent-cyan" />
            {exclusiveMods.length > 0 ? (
              <div className={`grid grid-cols-1 ${exclusiveMods.length > 1 ? 'md:grid-cols-2' : ''} gap-4`}>
                {exclusiveMods.map((m) => (
                  <ModuleCard key={m.id} {...moduleCardProps(m)} showBoundPart />
                ))}
              </div>
            ) : (
              <div className="bg-bg-dark/50 border border-dashed border-border rounded-xl p-4 flex items-center justify-center min-h-[48px]">
                <span className="text-xs text-text-dim">此機甲無專屬模組</span>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 機體描述 */}
      {mech.lore && (
        <div className="mt-6 bg-bg-card border border-border rounded-xl p-5">
          <SectionLabel>機體描述</SectionLabel>
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{mech.lore}</p>
        </div>
      )}
    </div>
  )
}
