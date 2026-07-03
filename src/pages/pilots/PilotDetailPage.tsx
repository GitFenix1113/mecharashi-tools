import { useState, useRef, useLayoutEffect, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link } from 'react-router-dom'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { PilotStats, NeuralDrive, Weapon, PilotTalent, TalentNdVariant, DescriptionRefs } from '../../types'
import { formatWeaponReq } from '../../types'
type NdLevel = NeuralDrive['levels'][number]
import { assetUrl } from '../../utils/assets'
import { usePilot, usePilotExclusiveWeapons } from '../../hooks/useFirestore'
import { useGameData } from '../../contexts/GameDataContext'
import { resolvePilotSkills, buildSkillMap } from '../../utils/pilotSkills'
import { resolveNeuralDriveLevel, buildNdAbilityMap } from '../../utils/neuralDriveAbilities'
import { WeaponIcon } from '../../components/WeaponIcon'
import { DiffHighlight } from '../../components/DiffHighlight'
import { RefText } from '../../components/RefText'

// ─── 神經驅動「全區算力選擇器」（PLAN-021 · 1-6）─────────────────────────────
// 玩家在 tab 卡頂部點選各區 Lv（仿遊戲內 Lv 條），天賦敘述隨配置即時改寫。
// 規則引擎集中於 ND_RULES，未來官方開放上限（超頻）只改數字。

const ND_RULES = {
  /** γ 區（名稱以 γ 開頭）合計算力上限：上下16（16+7 / 7+16） */
  gammaPairCap: 23,
  /** 各區預設 Lv；未列出的區預設滿級（α/β 可並存、通常不影響天賦） */
  defaultLevels: { 'γ1': 3, 'γ2': 1 } as Record<string, number>,
}

const isGammaZone = (name: string) => name.startsWith('γ')

/** 該區選到 Lv 時的算力值（讀該機師資料的 minSum，不寫死 1/4/7/10/13/16） */
function zonePower(drive: NeuralDrive, lv: number): number {
  return lv > 0 ? drive.levels[lv - 1]?.minSum ?? 0 : 0
}

function defaultNdLevels(drives: NeuralDrive[] | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of drives ?? []) {
    const max = d.levels?.length ?? 0
    out[d.name] = Math.min(ND_RULES.defaultLevels[d.name] ?? max, max)
  }
  return out
}

function ndVariantLabel(v: TalentNdVariant): string {
  return v.label ?? `${v.zone ? `${v.zone} ` : ''}算力 ≥ ${v.minSum}`
}

/** tab 卡頂部的算力配置列（三分頁常駐）。★ = 此區算力會改寫天賦（由 ndVariants.zone 推導） */
function NdPowerBar({
  drives, levels, affectZones, onChange,
}: {
  drives: NeuralDrive[]
  levels: Record<string, number>
  affectZones: Set<string>
  onChange: (next: Record<string, number>) => void
}) {
  const [capHint, setCapHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const gammaSum = drives
    .filter(d => isGammaZone(d.name))
    .reduce((s, d) => s + zonePower(d, levels[d.name] ?? 0), 0)

  function canSet(drive: NeuralDrive, lv: number): boolean {
    if (!isGammaZone(drive.name)) return true
    const others = drives
      .filter(d => isGammaZone(d.name) && d.name !== drive.name)
      .reduce((s, d) => s + zonePower(d, levels[d.name] ?? 0), 0)
    return others + zonePower(drive, lv) <= ND_RULES.gammaPairCap
  }

  function clickSquare(drive: NeuralDrive, lv: number) {
    const cur = levels[drive.name] ?? 0
    const target = cur === lv ? lv - 1 : lv // 點最上面那格 = 降一級
    if (target > cur && !canSet(drive, target)) {
      setCapHint(true)
      if (hintTimer.current) clearTimeout(hintTimer.current)
      hintTimer.current = setTimeout(() => setCapHint(false), 2600)
      return
    }
    onChange({ ...levels, [drive.name]: target })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2 bg-accent-pink/[0.04] border-b border-border">
      <span className="text-[11px] font-bold tracking-[2px] text-accent-pink uppercase whitespace-nowrap">
        ▶ 神經驅動算力
      </span>
      {drives.map((d) => {
        const cur = levels[d.name] ?? 0
        return (
          <span key={d.name} className="flex items-center gap-1.5">
            <span className="relative text-[13px] font-bold text-text-primary">
              {d.name}
              {affectZones.has(d.name) && (
                <span className="absolute -top-1.5 -right-2 text-[9px] text-accent-pink" title="此區算力會改寫天賦">★</span>
              )}
            </span>
            <span className="flex gap-[3px] ml-1.5">
              {d.levels.map((lvl, i) => {
                const lv = i + 1
                const on = cur >= lv
                const locked = !on && !canSet(d, lv)
                return (
                  <button
                    key={lv}
                    type="button"
                    title={`Lv${lv}（算力 ${lvl.minSum}）`}
                    onClick={() => clickSquare(d, lv)}
                    className={`w-3.5 h-3.5 rounded-[3px] border transition-all ${
                      on
                        ? 'bg-accent-yellow border-accent-yellow shadow-[0_0_5px_rgba(251,191,36,0.45)]'
                        : locked
                          ? 'bg-bg-dark border-border border-dashed opacity-25 cursor-not-allowed'
                          : 'bg-bg-dark border-[#4a4f5e] hover:border-accent-yellow cursor-pointer'
                    }`}
                  />
                )
              })}
            </span>
            <span className="text-[11px] text-text-dim font-mono whitespace-nowrap">
              {zonePower(d, cur)}
            </span>
          </span>
        )
      })}
      <span className={`ml-auto text-[11.5px] font-mono px-2.5 py-0.5 rounded-md border border-border bg-bg-dark ${
        gammaSum >= ND_RULES.gammaPairCap ? 'text-accent-red' : 'text-text-secondary'
      }`}>
        γ合計 {gammaSum} / {ND_RULES.gammaPairCap}
      </span>
      {capHint && (
        <span className="w-full text-[11.5px] text-accent-red">
          ⚠ γ 區合計算力上限 {ND_RULES.gammaPairCap}（上下16）—— 先降低另一個 γ 區。
        </span>
      )}
    </div>
  )
}

/** 天賦卡的神經驅動強化面板：讀配置列狀態，顯示生效中的改寫敘述（Q-B：差異高亮預設開） */
function TalentNdPanel({
  talent, drives, levels, baseText, viewMax,
}: {
  talent: PilotTalent
  drives: NeuralDrive[]
  levels: Record<string, number>
  /** 差異高亮的對照基準：跟隨天賦卡的 初始/最大強化 切換 */
  baseText: string
  /** 天賦卡目前是否切在「最大強化」：是 → 顯示變體的 descriptionMax（滿星版改寫） */
  viewMax: boolean
}) {
  const [diffOn, setDiffOn] = useState(true)
  const variants = talent.ndVariants ?? []
  if (variants.length === 0) return null

  const powerByZone = new Map(drives.map(d => [d.name, zonePower(d, levels[d.name] ?? 0)]))
  // 資料缺 zone 時優雅退化：取所有 γ 區的最大算力判定
  const maxGamma = Math.max(0, ...drives.filter(d => isGammaZone(d.name)).map(d => powerByZone.get(d.name) ?? 0))
  const powerOf = (zone?: string) => (zone ? powerByZone.get(zone) ?? 0 : maxGamma)

  const active = variants
    .filter(v => powerOf(v.zone) >= v.minSum)
    .sort((a, b) => b.minSum - a.minSum)[0] ?? null

  return (
    <div className="mt-2 rounded-lg bg-accent-pink/5 border border-accent-pink/25 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-accent-pink tracking-widest uppercase">
          ▶ 神經驅動強化
        </span>
        <span className={`text-[11px] px-2 py-0.5 rounded-md border ${
          active
            ? 'text-accent-pink border-accent-pink/45 bg-accent-pink/10 font-bold'
            : 'text-text-dim border-border bg-bg-dark'
        }`}>
          {active ? `${ndVariantLabel(active)} 生效中` : '基礎（未達改寫門檻）'}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => setDiffOn(o => !o)}
            className="text-[11px] text-accent-cyan underline decoration-dotted underline-offset-2 cursor-pointer"
          >
            差異高亮：{diffOn ? '開' : '關'}
          </button>
        )}
      </div>
      {active ? (
        <>
          <p className="text-sm text-text-secondary leading-relaxed mt-2">
            {diffOn ? (
              <DiffHighlight
                base={baseText}
                enhanced={viewMax ? active.descriptionMax ?? active.description : active.description}
                refs={{ ...talent.descriptionRefs, ...active.descriptionRefs }}
              />
            ) : (
              <RefText
                text={viewMax ? active.descriptionMax ?? active.description : active.description}
                refs={{ ...talent.descriptionRefs, ...active.descriptionRefs }}
              />
            )}
          </p>
          <p className="text-[11px] text-text-dim mt-1.5">
            ※ 各算力階互斥，實戰只生效達標的最高階。
            {viewMax && !active.descriptionMax && '（此階尚未補錄滿星版改寫，目前顯示初始版）'}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-text-dim mt-1.5">
          調整上方「神經驅動算力」配置，即可預覽天賦被改寫後的敘述（門檻：
          {variants.map(v => ndVariantLabel(v)).join('、')}）。
        </p>
      )}
    </div>
  )
}

// ─── 天賦卡（PLAN-021）─────────────────────────────────────────────────────────
// 桌面：初始正文＋「▶ 最大強化」區塊同時顯示（原始設計，一眼看到兩版）。
// 手機：版面有限，改用頂部「初始天賦 ⇌ 最大強化」切換按鈕，一次只顯示一版。
// 專武 / 神經驅動強化的對照基準跟隨目前顯示的最高版本（桌面固定為最大強化）。

/** 專武強化敘述暫時只顯示在右側專武面板，天賦卡內的重複區塊先隱藏；要恢復改 true */
const SHOW_WEAPON_ENHANCE_IN_TALENT: boolean = true

function TalentCard({
  talent, drives, levels, weaponEnhanceText, weaponEnhanceRefs, weaponName,
}: {
  talent: PilotTalent
  drives: NeuralDrive[]
  levels: Record<string, number>
  weaponEnhanceText?: string
  weaponEnhanceRefs?: DescriptionRefs
  weaponName?: string
}) {
  const isMobile = useIsMobile()
  const hasMax = !!talent.descriptionMax && talent.descriptionMax !== talent.description
  const [showMax, setShowMax] = useState(false)
  const viewMax = hasMax && (!isMobile || showMax)
  // 當前主敘述（也是各強化區塊的差異對照基準）
  const currentBase = viewMax ? talent.descriptionMax! : talent.description

  return (
    <div className="flex gap-3 p-3 bg-bg-dark rounded-xl border border-border">
      <SkillIcon iconLocal={talent.iconLocal} name={talent.name} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <span className="font-bold text-base">{talent.name}</span>
          {/* 天賦區塊顯示覆寫：不論原始 type（多為被動技能），一律標示「天賦技能」 */}
          <SkillTypeBadge type="天賦技能" />
          {isMobile && hasMax && (
            <button
              type="button"
              onClick={() => setShowMax(v => !v)}
              title="切換 初始天賦 / 最大強化（滿星效果）"
              className={`ml-auto text-[12px] px-2.5 py-1 rounded-full border font-medium transition-colors cursor-pointer ${
                viewMax
                  ? 'text-accent-cyan border-accent-cyan/45 bg-accent-cyan/15'
                  : 'text-text-secondary border-border bg-bg-card hover:text-text-primary hover:border-border-accent'
              }`}
            >
              ⇌ {viewMax ? '最大強化' : '初始天賦'}
            </button>
          )}
        </div>

        {isMobile ? (
          <p className="text-sm text-text-secondary leading-relaxed">
            {viewMax ? (
              <DiffHighlight base={talent.description} enhanced={talent.descriptionMax!} refs={talent.descriptionRefs} />
            ) : (
              <RefText text={talent.description} refs={talent.descriptionRefs} />
            )}
          </p>
        ) : (
          <>
            <p className="text-sm text-text-secondary leading-relaxed">
              <RefText text={talent.description} refs={talent.descriptionRefs} />
            </p>
            {hasMax && (
              <div className="mt-2.5 rounded-lg bg-accent-cyan/5 border border-accent-cyan/25 px-3 py-2.5">
                <span className="text-[13px] font-bold text-accent-cyan tracking-widest uppercase">▶ 最大強化</span>
                <p className="text-sm text-text-secondary leading-relaxed mt-1.5">
                  <DiffHighlight base={talent.description} enhanced={talent.descriptionMax!} refs={talent.descriptionRefs} />
                </p>
              </div>
            )}
          </>
        )}

        {SHOW_WEAPON_ENHANCE_IN_TALENT && weaponEnhanceText && (
          <div className="mt-2 rounded-lg bg-accent-yellow/5 border border-accent-yellow/25 px-3 py-2.5">
            <span className="text-[13px] font-bold text-accent-yellow tracking-widest uppercase">
              ▶ 專武強化{weaponName ? ` · ${weaponName}` : ''}
            </span>
            <p className="text-sm text-text-secondary leading-relaxed mt-1.5">
              <DiffHighlight base={currentBase} enhanced={weaponEnhanceText} refs={{ ...talent.descriptionRefs, ...weaponEnhanceRefs }} />
            </p>
          </div>
        )}

        <TalentNdPanel talent={talent} drives={drives} levels={levels} baseText={currentBase} viewMax={viewMax} />
      </div>
    </div>
  )
}

// ─── Radar Chart ─────────────────────────────────────────────────────────────

const STAT_AXES: { key: keyof PilotStats; label: string; angle: number }[] = [
  { key: 'shooting', label: '射擊', angle: -90 },
  { key: 'defense', label: '防禦', angle: -30 },
  { key: 'engineering', label: '機械', angle: 30 },
  { key: 'melee', label: '格鬥', angle: 90 },
  { key: 'assault', label: '突擊', angle: 150 },
  { key: 'tactics', label: '戰術', angle: 210 },
]

const MAX_STAT = 5500
const CX = 130
const CY = 110
const R = 75

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

function axisPoint(angle: number, scale: number) {
  return {
    x: CX + scale * R * Math.cos(toRad(angle)),
    y: CY + scale * R * Math.sin(toRad(angle)),
  }
}

function RadarChart({ stats }: { stats: PilotStats }) {
  const gridLevels = [0.25, 0.5, 0.75, 1.0]

  const statPoints = STAT_AXES.map((ax) => {
    const scale = Math.min(stats[ax.key] / MAX_STAT, 1)
    return axisPoint(ax.angle, scale)
  })

  const polyPoints = statPoints.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <svg viewBox="0 0 260 220" className="w-full select-none">
      {/* Grid rings */}
      {gridLevels.map((lvl) => {
        const pts = STAT_AXES.map((ax) => axisPoint(ax.angle, lvl))
        return (
          <polygon
            key={lvl}
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#1e2330"
            strokeWidth="1"
          />
        )
      })}

      {/* Axis lines */}
      {STAT_AXES.map((ax) => {
        const p = axisPoint(ax.angle, 1)
        return (
          <line
            key={ax.key}
            x1={CX}
            y1={CY}
            x2={p.x}
            y2={p.y}
            stroke="#1e2330"
            strokeWidth="1"
          />
        )
      })}

      {/* Stat fill */}
      <polygon
        points={polyPoints}
        fill="rgba(255,107,43,0.2)"
        stroke="#ff6b2b"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Labels */}
      {STAT_AXES.map((ax) => {
        const labelScale = 1.28
        const p = axisPoint(ax.angle, labelScale)
        const val = stats[ax.key]
        const anchor =
          Math.abs(ax.angle % 180) < 5
            ? 'middle'
            : ax.angle > 0 && ax.angle < 180
            ? 'start'
            : 'end'

        return (
          <g key={ax.key}>
            <text
              x={p.x}
              y={p.y - 6}
              textAnchor={anchor as 'middle' | 'start' | 'end'}
              fill="#9ca3af"
              fontSize="10"
              fontFamily="'Noto Sans TC',sans-serif"
            >
              {ax.label}
            </text>
            <text
              x={p.x}
              y={p.y + 7}
              textAnchor={anchor as 'middle' | 'start' | 'end'}
              fill="#e8eaed"
              fontSize="10"
              fontWeight="600"
              fontFamily="'JetBrains Mono',monospace"
            >
              {val.toLocaleString()}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Skill Icon ───────────────────────────────────────────────────────────────

function SkillIcon({ iconLocal, name, size = 'md' }: { iconLocal: string; name: string; size?: 'sm' | 'md' }) {
  const [err, setErr] = useState(false)
  const cls = size === 'sm' ? 'w-7 h-7' : 'w-10 h-10'
  if (err || !iconLocal) {
    return (
      <div className={`${cls} rounded-lg bg-bg-dark border border-border flex items-center justify-center text-text-dim text-xs flex-shrink-0`}>
        ?
      </div>
    )
  }
  return (
    <img
      src={assetUrl(iconLocal)}
      alt={name}
      className={`${cls} rounded-lg object-cover flex-shrink-0`}
      onError={() => setErr(true)}
    />
  )
}

// ─── Skill Type Badge ─────────────────────────────────────────────────────────

const SKILL_TYPE_CLS: Record<string, string> = {
  被動技能: 'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
  主動技能: 'text-accent-red bg-accent-red/10 border-accent-red/30',
  指令技能: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
  PP技能: 'text-accent-green bg-accent-green/10 border-accent-green/30',
  // 顯示層專用：機師天賦區塊一律顯示「天賦技能」（資料仍存原始 type，多為被動技能），避免與一般被動混淆
  天賦技能: 'text-accent-orange bg-accent-orange/10 border-accent-orange/30',
}

function SkillTypeBadge({ type }: { type: string }) {
  const cls = SKILL_TYPE_CLS[type] ?? 'text-text-dim bg-bg-dark border-border'
  return (
    <span className={`px-2 py-0.5 rounded text-[13px] font-bold border ${cls}`}>{type}</span>
  )
}

// ─── Diff Highlight ──────────────────────────────────────────────────────────


// ─── Exclusive Weapon Panel ──────────────────────────────────────────────────

const ACTIVATION_LABEL: Record<string, string> = { carry: '攜帶', equip: '裝備', use: '使用' }
const WEAPON_RARITY_CLS: Record<string, string> = {
  SS:  'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/40',
  'S+':'text-accent-purple bg-accent-purple/10 border-accent-purple/40',
  S:   'text-accent-blue   bg-accent-blue/10   border-accent-blue/40',
  A:   'text-text-secondary bg-bg-card border-border',
}

function WeaponDetailContent({ weapon }: { weapon: Weapon }) {
  const rangeStr = weapon.rangeType === 'ring'
    ? `${weapon.maxRange}+`
    : `${weapon.minRange}-${weapon.maxRange}`
  const rarityCls = WEAPON_RARITY_CLS[weapon.rarity] ?? 'text-text-dim border-border'

  return (
    <div className="bg-bg-tooltip border border-border-accent rounded-xl overflow-hidden text-xs">
      <div className="px-4 py-3 border-b border-border bg-accent-yellow/5">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-bold text-sm text-text-primary">{weapon.name}</span>
          <span className={`text-[13px] px-1.5 py-0.5 rounded border font-bold ${rarityCls}`}>
            {weapon.rarity}
          </span>
        </div>
        <p className="text-text-dim">{weapon.type} · {weapon.kind} · 射程 {rangeStr}</p>
      </div>
      <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1 border-b border-border">
        {[
          { label: '攻擊力', value: weapon.attack },
          { label: '精度',   value: weapon.accuracy },
          { label: '暴擊值', value: weapon.critValue },
          { label: '重量',   value: weapon.weight },
          { label: '彈藥量', value: weapon.ammoCount },
          { label: '連擊數', value: weapon.hitCount },
          { label: '觸發槽', value: weapon.triggerSlots },
          { label: '效果槽', value: weapon.effectSlots },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between">
            <span className="text-text-dim">{label}</span>
            <span className="text-text-primary font-medium font-[JetBrains_Mono,monospace]">{value}</span>
          </div>
        ))}
      </div>
      {weapon.skills.length > 0 && (
        <div className="px-4 py-3 space-y-2.5">
          <div className="text-[13px] text-text-dim tracking-widest uppercase">武器技能</div>
          {weapon.skills.map((sk, i) => (
            <div key={i}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-bold text-text-primary">{sk.name}</span>
                <span className="text-[13px] text-text-dim bg-bg-dark border border-border px-1.5 py-0.5 rounded">
                  {ACTIVATION_LABEL[sk.activation] ?? sk.activation}
                </span>
              </div>
              <p className="text-text-secondary leading-relaxed"><RefText text={sk.description} refs={sk.descriptionRefs} /></p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WeaponDetailTooltip({ weapon, x, anchorTop }: { weapon: Weapon; x: number; anchorTop: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, weapon])

  return createPortal(
    <div ref={ref} className="fixed z-50 pointer-events-none w-80" style={{ left: x, top }}>
      <WeaponDetailContent weapon={weapon} />
    </div>,
    document.body
  )
}

type WeaponSkillItem = Weapon['skills'][number]

/** 單一武器技能的內容（懸停浮窗 / 手機 BottomSheet 共用） */
function WeaponSkillContent({ sk, isEnhance }: { sk: WeaponSkillItem; isEnhance: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <SkillIcon iconLocal={sk.iconLocal ?? ''} name={sk.name} size="sm" />
        <span className="font-bold text-sm text-text-primary">{sk.name}</span>
        <span className="text-[13px] text-text-dim bg-bg-dark border border-border px-1.5 py-0.5 rounded">
          {ACTIVATION_LABEL[sk.activation] ?? sk.activation}
        </span>
      </div>
      {isEnhance && sk.enhancesTalentName && (
        <p className="text-[13px] text-accent-yellow/70">▶ 強化天賦：{sk.enhancesTalentName}</p>
      )}
      <p className="text-xs text-text-secondary leading-relaxed"><RefText text={sk.description} refs={sk.descriptionRefs} /></p>
    </div>
  )
}

function WeaponSkillTooltipPortal({ sk, isEnhance, x, anchorTop }: {
  sk: WeaponSkillItem; isEnhance: boolean; x: number; anchorTop: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, sk])

  return createPortal(
    <div ref={ref} className="fixed z-50 pointer-events-none w-72" style={{ left: x, top }}>
      <div className="bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl">
        <WeaponSkillContent sk={sk} isEnhance={isEnhance} />
      </div>
    </div>,
    document.body
  )
}

function ExclusiveWeaponPanel({ weapon, loading, talentNames, stageCount = 1, stageIdx = 0, onStageChange }: {
  weapon: Weapon | null; loading: boolean; talentNames: string[]
  stageCount?: number; stageIdx?: number; onStageChange?: (i: number) => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const [tooltipPos, setTooltipPos] = useState<{ x: number; anchorTop: number } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // 武器技能：預設縮圖（仿神經驅動收合態），展開後排列顯示全部正文；
  // 縮圖逐一懸停顯示該技能、武器標頭懸停顯示詳細數值
  const [expanded, setExpanded] = useState(false)
  const [skillHover, setSkillHover] = useState<{ sk: WeaponSkillItem; x: number; anchorTop: number } | null>(null)
  const [skillSheet, setSkillSheet] = useState<WeaponSkillItem | null>(null)

  const handleMouseEnter = () => {
    if (isMobile || !cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const ttW = 320
    const x = rect.left - ttW - 12 < 8 ? rect.right + 12 : rect.left - ttW - 12
    setTooltipPos({ x, anchorTop: rect.top })
  }

  const handleSkillHover = (sk: WeaponSkillItem, el: HTMLElement) => {
    if (isMobile) return
    const rect = el.getBoundingClientRect()
    const ttW = 288
    const x = rect.right + 8 + ttW > window.innerWidth ? rect.left - ttW - 8 : rect.right + 8
    setSkillHover({ sk, x, anchorTop: rect.top })
  }

  if (loading) {
    return <div className="rounded-xl border border-border min-h-[120px] animate-pulse bg-bg-dark" />
  }

  if (!weapon) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-bg-dark flex items-center justify-center min-h-[120px]">
        <span className="text-sm text-text-dim">暫無專屬武器</span>
      </div>
    )
  }

  const rarityCls = WEAPON_RARITY_CLS[weapon.rarity] ?? 'text-text-dim bg-bg-dark border-border'
  const talentSet = new Set(talentNames)
  const isEnhanceSkill = (sk: WeaponSkillItem) =>
    !!sk.enhancesTalentName && talentSet.has(sk.enhancesTalentName)

  return (
    <>
      {tooltipPos && !isMobile && (
        <WeaponDetailTooltip weapon={weapon} x={tooltipPos.x} anchorTop={tooltipPos.anchorTop} />
      )}
      {skillHover && !isMobile && !expanded && (
        <WeaponSkillTooltipPortal
          sk={skillHover.sk}
          isEnhance={isEnhanceSkill(skillHover.sk)}
          x={skillHover.x}
          anchorTop={skillHover.anchorTop}
        />
      )}
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <WeaponDetailContent weapon={weapon} />
      </BottomSheet>
      <BottomSheet open={!!skillSheet} onClose={() => setSkillSheet(null)}>
        {skillSheet && <WeaponSkillContent sk={skillSheet} isEnhance={isEnhanceSkill(skillSheet)} />}
      </BottomSheet>
      {stageCount > 1 && onStageChange && (
        <div className="flex gap-1 mb-2">
          {Array.from({ length: stageCount }, (_, i) => (
            <button
              key={i}
              onClick={() => onStageChange(i)}
              className={`flex-1 text-xs px-2 py-1 rounded-lg border transition-colors cursor-pointer ${
                stageIdx === i
                  ? 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/40 font-bold'
                  : 'text-text-secondary bg-bg-dark border-border hover:text-text-primary hover:border-border-accent'
              }`}
            >
              階段 {['I', 'II', 'III', 'IV'][i]}
            </button>
          ))}
        </div>
      )}
      <div
        ref={cardRef}
        className="bg-bg-dark border border-border rounded-xl overflow-hidden text-sm cursor-default hover:border-border-accent transition-colors"
      >
        {/* Header: icon + name + rarity（懸停/點選 → 武器詳細數值） */}
        <div
          className="px-3 py-3 border-b border-border bg-accent-yellow/5"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setTooltipPos(null)}
          onClick={() => { if (isMobile) setSheetOpen(true) }}
        >
          <div className="flex items-center gap-3">
            <WeaponIcon icon={weapon.icon} name={weapon.name} size="md" isExclusive={weapon.isExclusive} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                <span className="font-bold text-text-primary leading-tight">{weapon.name}</span>
                <span className={`text-[13px] px-1.5 py-0.5 rounded border font-bold flex-shrink-0 ${rarityCls}`}>
                  {weapon.rarity}
                </span>
              </div>
              <p className="text-xs text-text-dim">{weapon.type} · {weapon.kind}</p>
            </div>
          </div>
        </div>

        {/* 武器技能：縮圖（預設，逐一懸停看該技能） ⇄ 全部排列展開（展開詳情） */}
        {weapon.skills.length > 0 && (
          <div className="px-3 py-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="text-[13px] text-accent-yellow tracking-widest uppercase">武器技能</div>
              <button
                type="button"
                onClick={() => {
                  setExpanded(prev => !prev)
                  setSkillHover(null)
                }}
                className={`ml-auto text-xs px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                  expanded
                    ? 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30'
                    : 'text-text-secondary bg-bg-card border-border hover:text-text-primary hover:border-border-accent'
                }`}
              >
                {expanded ? '▼ 收合詳情' : '▶ 展開詳情'}
              </button>
            </div>
            {expanded ? (
              weapon.skills.map((sk, i) => (
                <div key={i}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`font-bold text-xs ${isEnhanceSkill(sk) ? 'text-accent-yellow' : 'text-text-primary'}`}>{sk.name}</span>
                    <span className="text-[13px] text-text-dim bg-bg-card border border-border px-1.5 py-0.5 rounded">
                      {ACTIVATION_LABEL[sk.activation] ?? sk.activation}
                    </span>
                  </div>
                  {isEnhanceSkill(sk) && sk.enhancesTalentName && (
                    <p className="text-[13px] text-accent-yellow/70 mb-0.5">▶ 強化天賦：{sk.enhancesTalentName}</p>
                  )}
                  <p className="text-xs text-text-secondary leading-relaxed"><RefText text={sk.description} refs={sk.descriptionRefs} /></p>
                </div>
              ))
            ) : (
              <div className="flex flex-wrap gap-2">
                {weapon.skills.map((sk, i) => (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-1 w-16 rounded-lg p-1.5 hover:bg-bg-card cursor-default transition-colors"
                    onMouseEnter={(e) => handleSkillHover(sk, e.currentTarget)}
                    onMouseLeave={() => { if (!isMobile) setSkillHover(null) }}
                    onClick={() => { if (isMobile) setSkillSheet(sk) }}
                  >
                    <SkillIcon iconLocal={sk.iconLocal ?? ''} name={sk.name} />
                    <div className="text-center w-full">
                      <div className={`text-xs font-medium leading-tight line-clamp-2 break-all ${isEnhanceSkill(sk) ? 'text-accent-yellow' : ''}`}>
                        {sk.name}
                      </div>
                      <div className="text-[13px] text-text-dim leading-none mt-0.5">
                        {ACTIVATION_LABEL[sk.activation] ?? sk.activation}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!expanded && (
          <div className={`px-3 py-2 ${weapon.skills.length > 0 ? 'border-t border-border' : ''}`}>
            <p className="text-[13px] text-text-dim text-center">
              {isMobile ? '◈ 點武器看數值 · 點技能看說明' : '◈ 懸停武器看數值 · 懸停技能看說明'}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Neural Drive Zone Card ───────────────────────────────────────────────────

const ND_ORDER = ['α', 'β', 'γ1', 'γ2']
const ND_POSITION_CLASS: Record<string, string> = {
  'α':  'sm:row-start-1 sm:col-start-1',
  'β':  'sm:row-start-2 sm:col-start-1',
  'γ1': 'sm:row-start-1 sm:col-start-2',
  'γ2': 'sm:row-start-2 sm:col-start-2',
}

// 神經驅動插槽晶片類型 → 顏色（對應遊戲內晶片配色）。slot 字串格式：「插槽X：{Type}芯片」。
const CHIP_TYPE_STYLES: { test: RegExp; dot: string }[] = [
  { test: /attack|攻擊/i,         dot: 'bg-accent-red'    }, // Attack 芯片 → 紅
  { test: /dodge|迴避|回避/i,     dot: 'bg-accent-yellow' }, // Dodge 芯片 → 黃
  { test: /crit|暴擊/i,           dot: 'bg-accent-blue'   }, // Critical 芯片 → 藍
]

function chipDotClass(slot: string): string {
  const type = /：\s*(.+?)\s*芯片/.exec(slot)?.[1] ?? slot
  return CHIP_TYPE_STYLES.find((c) => c.test.test(type))?.dot ?? 'bg-text-dim'
}

/** 以顏色方塊表示各插槽的晶片類型（不顯示文字；hover 顯示原始插槽說明）。 */
function SlotChips({ slots, size = 'md' }: { slots: string[]; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  return (
    <div className="flex gap-1 items-center ml-auto">
      {slots.map((slot, si) => (
        <span
          key={si}
          title={slot}
          className={`${box} rounded-[4px] ${chipDotClass(slot)} ring-1 ring-inset ring-white/20 shadow-sm`}
        />
      ))}
    </div>
  )
}

function NdLevelContent({ level }: { level: NdLevel }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] px-1.5 py-0.5 rounded border text-accent-purple bg-accent-purple/10 border-accent-purple/30 font-bold flex-shrink-0">
          Lv.{level.level}
        </span>
        <span className="text-sm font-bold">{level.skillName}</span>
      </div>
      <p className="text-[13px] text-text-dim">芯片總計 ≥{level.minSum}</p>
      <p className="text-xs text-text-secondary leading-relaxed"><RefText text={level.effect} refs={level.descriptionRefs} /></p>
    </div>
  )
}

function NdLevelTooltipPortal({ level, x, anchorTop }: { level: NdLevel; x: number; anchorTop: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, level])

  return createPortal(
    <div ref={ref} className="fixed z-50 pointer-events-none w-72" style={{ left: x, top }}>
      <div className="bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl">
        <NdLevelContent level={level} />
      </div>
    </div>,
    document.body
  )
}

function NeuralDriveZoneCard({ nd, zoneName, className, expanded, onLevelHover, onLevelLeave, onLevelClick }: {
  nd: NeuralDrive | undefined
  zoneName: string
  className?: string
  expanded: boolean
  onLevelHover?: (level: NdLevel, el: HTMLElement) => void
  onLevelLeave?: () => void
  onLevelClick?: (level: NdLevel) => void
}) {
  if (!nd) {
    return (
      <div className={`border border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-1 ${expanded ? 'min-h-[160px]' : 'min-h-[80px]'} ${className ?? ''}`}>
        <span className="text-sm font-bold text-accent-purple/40 font-[Orbitron,sans-serif]">{zoneName}</span>
        <span className="text-xs text-text-dim">暫無資料</span>
      </div>
    )
  }

  if (!expanded) {
    return (
      <div className={`bg-bg-dark rounded-xl border border-border overflow-hidden ${className ?? ''}`}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-accent-purple/5">
          <span className="text-accent-purple font-bold text-xs font-[Orbitron,sans-serif]">
            神經驅動 {nd.name}
          </span>
          <SlotChips slots={nd.slots} size="sm" />
        </div>
        <div className="flex flex-wrap gap-2 p-3">
          {nd.levels.map((lv) => (
            <div
              key={lv.level}
              className="flex flex-col items-center gap-1 w-16 rounded-lg p-1.5 hover:bg-bg-card cursor-default transition-colors"
              onMouseEnter={(e) => onLevelHover?.(lv, e.currentTarget)}
              onMouseLeave={onLevelLeave}
              onClick={() => onLevelClick?.(lv)}
            >
              <SkillIcon iconLocal={lv.iconLocal} name={lv.skillName} />
              <div className="text-center w-full">
                <div className="text-xs font-medium leading-tight line-clamp-2 break-all">{lv.skillName}</div>
                <div className="text-[13px] text-text-dim leading-none mt-0.5">Lv.{lv.level}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-bg-dark rounded-xl border border-border overflow-hidden ${className ?? ''}`}>
      <div className="flex items-center gap-3 p-3 border-b border-border bg-accent-purple/5">
        <span className="text-accent-purple font-bold text-sm font-[Orbitron,sans-serif]">
          神經驅動 {nd.name}
        </span>
        <SlotChips slots={nd.slots} />
      </div>
      <div className="divide-y divide-border">
        {nd.levels.map((lv) => (
          <div key={lv.level} className="flex gap-3 p-3 items-start">
            <SkillIcon iconLocal={lv.iconLocal} name={lv.skillName} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm">{lv.skillName}</span>
                <span className="text-[13px] text-text-dim">
                  Lv.{lv.level}（芯片總計 ≥{lv.minSum}）
                </span>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed"><RefText text={lv.effect} refs={lv.descriptionRefs} /></p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const CLASS_STYLES: Record<string, string> = {
  守護者: 'text-accent-green bg-accent-green/10 border-accent-green/40',
  突擊手: 'text-accent-orange bg-accent-orange/10 border-accent-orange/40',
  格鬥家: 'text-accent-red bg-accent-red/10 border-accent-red/40',
  狙擊手: 'text-accent-blue bg-accent-blue/10 border-accent-blue/40',
  戰術家: 'text-accent-purple bg-accent-purple/10 border-accent-purple/40',
  機械師: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/40',
  調構師: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/40',
}

export default function PilotDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: pilot, loading } = usePilot(id)
  const { data: exclusiveWeapons, loading: exclusiveWeaponLoading } = usePilotExclusiveWeapons(id)
  const [exclusiveWeaponIdx, setExclusiveWeaponIdx] = useState(0)
  const exclusiveWeapon = exclusiveWeapons[exclusiveWeaponIdx] ?? null
  const isMobile = useIsMobile()
  const [activeSkillTab, setActiveSkillTab] = useState<'技能' | '天賦' | '神經驅動'>('天賦')

  // PLAN-004：技能改由 pilotSkills 集合解析（過渡期亦相容嵌入舊格式）
  const gd = useGameData()
  useEffect(() => { gd.ensureLoaded(['pilotSkills', 'neuralDriveAbilities']) }, [gd])
  const skillMap = useMemo(() => buildSkillMap(gd.pilotSkills), [gd.pilotSkills])

  // PLAN-023 N1-5：神驅 level 改走 resolve（相容 abilityId 引用／嵌入舊格式）。
  // 目前 level 尚無 abilityId → 回退嵌入、輸出不變；N1-6 flip 後改吃能力庫（單一資料源）。
  const ndAbilityMap = useMemo(() => buildNdAbilityMap(gd.neuralDriveAbilities), [gd.neuralDriveAbilities])
  const resolvedNeuralDrive = useMemo<NeuralDrive[] | undefined>(() => {
    if (!pilot?.neuralDrive) return pilot?.neuralDrive
    return pilot.neuralDrive.map(zone => ({
      ...zone,
      levels: zone.levels.map(lv => {
        const a = resolveNeuralDriveLevel(lv, ndAbilityMap)
        return { ...lv, skillName: a.name, effect: a.description, skillIcon: a.icon ?? lv.skillIcon, iconLocal: a.iconLocal ?? lv.iconLocal, effects: a.effects, buffIds: a.buffIds, descriptionRefs: a.descriptionRefs ?? lv.descriptionRefs }
      }),
    }))
  }, [pilot?.neuralDrive, ndAbilityMap])
  useEffect(() => { setExclusiveWeaponIdx(0) }, [id])
  const [ndExpanded, setNdExpanded] = useState(false)
  const [ndHoverState, setNdHoverState] = useState<{ level: NdLevel; x: number; anchorTop: number } | null>(null)
  const [ndSheetLevel, setNdSheetLevel] = useState<NdLevel | null>(null)

  // 專武強化敘述：text 取自武器技能的 enhancedTalentDescription，refs 也一併帶出該技能的
  // descriptionRefs —— 強化敘述新增的 [xxx]（如 [虛情實意]）只側錄在武器技能上，天賦自身的
  // descriptionRefs 沒有，若只用天賦 refs 這些引用會降級成純文字（PLAN-019 引用渲染缺漏修正）。
  const talentEnhancementMap = useMemo(() => {
    const map = new Map<string, { text: string; refs?: DescriptionRefs }>()
    exclusiveWeapon?.skills.forEach(sk => {
      if (sk.enhancesTalentName && sk.enhancedTalentDescription)
        map.set(sk.enhancesTalentName, { text: sk.enhancedTalentDescription, refs: sk.descriptionRefs })
    })
    return map
  }, [exclusiveWeapon])

  // PLAN-021 · 1-6：神經驅動算力配置（tab 卡頂部常駐；換機師時重置回預設）
  const ndDefaults = useMemo(() => defaultNdLevels(pilot?.neuralDrive), [pilot])
  const [ndLevelsOverride, setNdLevelsOverride] = useState<Record<string, number> | null>(null)
  useEffect(() => { setNdLevelsOverride(null) }, [id])
  const ndLevels = ndLevelsOverride ?? ndDefaults
  const ndAffectZones = useMemo(
    () => new Set(
      (pilot?.talents ?? []).flatMap(t => (t.ndVariants ?? []).map(v => v.zone)).filter((z): z is string => !!z)
    ),
    [pilot]
  )

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="h-96 bg-bg-card border border-border rounded-xl animate-pulse" />
      </div>
    )
  }

  if (!pilot) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-text-dim">
        <p>找不到機師資料</p>
        <Link to="/pilots" className="text-accent-orange no-underline text-sm mt-4 inline-block">
          ← 返回機師圖鑑
        </Link>
      </div>
    )
  }

  const classCls = CLASS_STYLES[pilot.class] ?? 'text-text-secondary bg-bg-card border-border'

  // 從 Firestore 中已存的 biometicComputer 交叉比對 unitType（現有資料無 skill.unitType 時使用）
  type BiomUnit = { unitType: string; skill?: { name: string } }
  const biomUnits = ((pilot as unknown as Record<string, unknown>).biometicComputer as BiomUnit[] | undefined) ?? []
  const unitTypeByName: Record<string, string> = {}
  biomUnits.forEach(u => { if (u.skill?.name) unitTypeByName[u.skill.name] = u.unitType })

  const getUnitType = (sk: { name: string; unitType?: string }) => sk.unitType ?? unitTypeByName[sk.name]
  const resolvedSkills = resolvePilotSkills(pilot.skills, skillMap)
  const classSkills  = resolvedSkills.filter(sk => getUnitType(sk) === '6')
  const regularSkills = resolvedSkills.filter(sk => getUnitType(sk) !== '6')

  const handleNdLevelHover = (level: NdLevel, el: HTMLElement) => {
    if (isMobile) return
    const rect = el.getBoundingClientRect()
    const tooltipW = 288
    const x = rect.right + 8 + tooltipW > window.innerWidth ? rect.left - tooltipW - 8 : rect.right + 8
    setNdHoverState({ level, x, anchorTop: rect.top })
  }
  const handleNdLevelLeave = () => { if (!isMobile) setNdHoverState(null) }
  const handleNdLevelClick = (level: NdLevel) => { if (isMobile) setNdSheetLevel(level) }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      {/* Back */}
      <Link
        to="/pilots"
        className="inline-flex items-center gap-1 text-sm text-text-dim hover:text-text-primary no-underline mb-6 transition-colors"
      >
        ← 機師圖鑑
      </Link>

      {/* Hero Row: 3-col grid */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[160px_1fr_auto] lg:gap-12 mb-4 lg:items-start">
        {/* 左欄: 肖像，固定 160px */}
        <div className="w-32 h-44 mx-auto bg-bg-card border border-border rounded-xl overflow-hidden lg:w-40 lg:h-52 lg:mx-0 lg:flex-shrink-0">
          <img
            src={assetUrl(pilot.portrait)}
            alt={pilot.name}
            className="w-full h-full object-cover object-top"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>

        {/* 中欄: 資訊＋AP */}
        <div className="flex flex-col gap-3 min-w-0">
          <div>
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-bold border mb-2 ${classCls}`}
            >
              {pilot.class}
            </span>
            <h1 className="text-3xl font-black">{pilot.name}</h1>
            <p className="text-text-secondary text-sm mt-1">{pilot.fullName}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <InfoRow label="勢力" value={pilot.faction} />
            <InfoRow label="駕照" value={pilot.license} />
            <InfoRow label="駕駛等級" value={pilot.masterLevel} />
            {pilot.profile?.gender && <InfoRow label="性別" value={pilot.profile.gender} />}
            {pilot.profile?.height && <InfoRow label="身高" value={pilot.profile.height} />}
            {pilot.profile?.bloodType && (
              <InfoRow label="血型" value={pilot.profile.bloodType} />
            )}
            {pilot.profile?.additionalInfo &&
              Object.entries(pilot.profile.additionalInfo).map(([k, v]) => (
                <InfoRow key={k} label={k} value={v} />
              ))}
          </div>

          {/* AP */}
          {(() => {
            const ndAp = parseNdApBonus(resolvedNeuralDrive)
            const hasNdBonus = ndAp.init + ndAp.max + ndAp.recovery > 0
            return (
              <div className="mt-1">
                <div className="flex flex-wrap gap-3">
                  <APBadge label="初始AP" value={pilot.ap.init} bonus={ndAp.init} />
                  <APBadge label="上限AP" value={pilot.ap.max} bonus={ndAp.max} />
                  <APBadge label="AP回復" value={pilot.ap.recovery} bonus={ndAp.recovery} />
                </div>
                <p className="text-[13px] text-text-dim mt-1.5">
                  滿潛力數值{hasNdBonus ? '，括號為加神經驅動滿配後' : ''}
                </p>
              </div>
            )
          })()}
        </div>

        {/* 右欄: 縮小版雷達圖 */}
        <div className="w-full max-w-xs mx-auto lg:w-64 lg:mx-0 lg:flex-shrink-0">
          <SectionLabel>六維屬性</SectionLabel>
          <RadarChart stats={pilot.stats} />
        </div>
      </div>

      {/* Skills / Talents / Neural Drive Tabs */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border">
          {(['天賦', '技能', '神經驅動'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveSkillTab(tab)}
              className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                activeSkillTab === tab
                  ? 'text-accent-orange border-b-2 border-accent-orange bg-accent-orange/5'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab}
              {tab === '天賦' && ` (${pilot.talents.length})`}
              {tab === '技能' && ` (${regularSkills.length})`}
              {tab === '神經驅動' && ` (${pilot.neuralDrive?.length ?? 0})`}
            </button>
          ))}
        </div>

        {(pilot.neuralDrive?.length ?? 0) > 0 && (
          <NdPowerBar
            drives={resolvedNeuralDrive ?? []}
            levels={ndLevels}
            affectZones={ndAffectZones}
            onChange={setNdLevelsOverride}
          />
        )}

        <div className="p-4">
          {activeSkillTab === '天賦' && (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex-1 min-w-0 space-y-3">
              {pilot.talents.map((t, i) => (
                <TalentCard
                  key={i}
                  talent={t}
                  drives={resolvedNeuralDrive ?? []}
                  levels={ndLevels}
                  weaponEnhanceText={talentEnhancementMap.get(t.name)?.text}
                  weaponEnhanceRefs={talentEnhancementMap.get(t.name)?.refs}
                  weaponName={exclusiveWeapon?.name}
                />
              ))}
            </div>
            <div className="w-full lg:w-72 lg:flex-shrink-0">
              <ExclusiveWeaponPanel
                weapon={exclusiveWeapon}
                loading={exclusiveWeaponLoading}
                talentNames={pilot.talents.map(t => t.name)}
                stageCount={exclusiveWeapons.length}
                stageIdx={exclusiveWeaponIdx}
                onStageChange={setExclusiveWeaponIdx}
              />
            </div>
            </div>
          )}

          {activeSkillTab === '技能' && (
            <div className="space-y-3">
              {regularSkills.map((sk, i) => (
                <div key={i} className="flex gap-3 p-3 bg-bg-dark rounded-xl border border-border">
                  <SkillIcon iconLocal={sk.iconLocal} name={sk.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className="font-bold text-base">{sk.name}</span>
                      <SkillTypeBadge type={sk.type} />
                      {sk.ap && (
                        <span className="text-[13px] text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30 px-2 py-0.5 rounded">
                          AP {sk.ap}
                        </span>
                      )}
                      {sk.cd && (
                        <span className="text-[13px] text-accent-cyan bg-accent-cyan/10 border border-accent-cyan/30 px-2 py-0.5 rounded">
                          CD {sk.cd}
                        </span>
                      )}
                      {sk.pp && (
                        <span className="text-[13px] text-accent-green bg-accent-green/10 border border-accent-green/30 px-2 py-0.5 rounded">
                          消耗 {sk.pp}PP
                        </span>
                      )}
                      {sk.weapon && (
                        <span className="text-[13px] text-text-dim bg-bg-card border border-border px-2 py-0.5 rounded">
                          {formatWeaponReq(sk.weapon)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed"><RefText text={sk.description} refs={sk.descriptionRefs} /></p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeSkillTab === '神經驅動' && (
            <div className="space-y-4">
              {ndHoverState && !ndExpanded && !isMobile && (
                <NdLevelTooltipPortal
                  level={ndHoverState.level}
                  x={ndHoverState.x}
                  anchorTop={ndHoverState.anchorTop}
                />
              )}
              <BottomSheet open={!!ndSheetLevel && !ndExpanded} onClose={() => setNdSheetLevel(null)}>
                {ndSheetLevel && <NdLevelContent level={ndSheetLevel} />}
              </BottomSheet>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-text-dim">
                  <span className="uppercase tracking-wider">插槽晶片</span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-[3px] bg-accent-red ring-1 ring-inset ring-white/20" />Attack 攻擊
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-[3px] bg-accent-yellow ring-1 ring-inset ring-white/20" />Dodge 迴避
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-[3px] bg-accent-blue ring-1 ring-inset ring-white/20" />Critical 暴擊
                  </span>
                </div>
                <button
                  onClick={() => setNdExpanded(prev => !prev)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                    ndExpanded
                      ? 'text-accent-purple bg-accent-purple/10 border-accent-purple/30'
                      : 'text-text-secondary bg-bg-card border-border hover:text-text-primary hover:border-border-accent'
                  }`}
                >
                  {ndExpanded ? '▼ 收合詳情' : '▶ 展開詳情'}
                </button>
              </div>
              {classSkills.length > 0 && (
                <div>
                  <div className="text-[13px] text-accent-green tracking-widest uppercase mb-2 font-[Orbitron,sans-serif]">初始被動能力</div>
                  <div className="space-y-2">
                    {classSkills.map((sk, i) => (
                      <div key={i} className="flex gap-3 p-3 bg-bg-dark rounded-xl border border-accent-green/20">
                        <SkillIcon iconLocal={sk.iconLocal} name={sk.name} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="font-bold text-base">{sk.name}</span>
                            <SkillTypeBadge type={sk.type} />
                          </div>
                          <p className="text-sm text-text-secondary leading-relaxed"><RefText text={sk.description} refs={sk.descriptionRefs} /></p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-rows-2 gap-3">
                {ND_ORDER.map((zoneName) => {
                  const nd = (resolvedNeuralDrive ?? []).find((d) => d.name === zoneName)
                  return (
                    <NeuralDriveZoneCard
                      key={zoneName}
                      nd={nd}
                      zoneName={zoneName}
                      className={ND_POSITION_CLASS[zoneName]}
                      expanded={ndExpanded}
                      onLevelHover={handleNdLevelHover}
                      onLevelLeave={handleNdLevelLeave}
                      onLevelClick={handleNdLevelClick}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pilot Lore */}
      {pilot.lore && (
        <div className="mt-6 bg-bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-accent-orange/5">
            <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
              機師故事
            </span>
          </div>
          <p className="px-5 py-5 text-sm text-text-secondary leading-loose whitespace-pre-line">{pilot.lore}</p>
        </div>
      )}
    </div>
  )
}

// ─── AP Neural Drive Bonus Parser ────────────────────────────────────────────

function parseNdApBonus(neuralDrive: NeuralDrive[] | undefined): {
  init: number; max: number; recovery: number
} {
  const bonus = { init: 0, max: 0, recovery: 0 }
  if (!neuralDrive) return bonus
  for (const zone of neuralDrive) {
    for (const lv of zone.levels) {
      const t = lv.effect ?? ''
      const m1 = t.match(/AP的?初始[值]?\+(\d+)/)
      if (m1) bonus.init += parseInt(m1[1])
      const m2 = t.match(/AP的?上限[值]?\+(\d+)/)
      if (m2) bonus.max += parseInt(m2[1])
      const m3 = t.match(/AP的?回復[值量]?\+(\d+)/)
      if (m3) bonus.recovery += parseInt(m3[1])
    }
  }
  return bonus
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-text-dim text-xs w-16 shrink-0">{label}</span>
      <span className="text-text-primary text-sm font-medium truncate">{value}</span>
    </div>
  )
}

function APBadge({ label, value, bonus = 0 }: { label: string; value: number; bonus?: number }) {
  return (
    <div className="flex flex-col items-center bg-bg-dark border border-border rounded-lg px-3 py-1.5">
      <span className="text-[13px] text-text-dim">{label}</span>
      <span className="text-base font-bold text-accent-yellow font-[Orbitron,sans-serif]">
        {value}
        {bonus > 0 && (
          <span className="text-accent-cyan text-sm font-bold ml-0.5">({value + bonus})</span>
        )}
      </span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif] mb-4">
      {children}
    </div>
  )
}
