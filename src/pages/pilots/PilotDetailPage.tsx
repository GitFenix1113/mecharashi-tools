import { useState, useRef, useLayoutEffect, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { PilotStats, NeuralDrive, Weapon, PilotTalent, TalentNdVariant, DescriptionRefs } from '../../types'
import { formatWeaponReq } from '../../types'
type NdLevel = NeuralDrive['levels'][number]
import { assetUrl } from '../../utils/assets'
import { usePilot, usePilotExclusiveWeapons, useFormsByPilot } from '../../hooks/useFirestore'
import { FormCard } from '../../components/FormCard'
import { useGameData } from '../../contexts/GameDataContext'
import { resolvePilotSkills, buildSkillMap } from '../../utils/pilotSkills'
import { resolveWeaponSkills, type ResolvedWeaponSkill } from '../../utils/weaponSkills'
import { resolveNeuralDriveLevel, buildNdAbilityMap } from '../../utils/neuralDriveAbilities'
import {
  ND_RULES, isGammaZone, zonePower, defaultNdLevels, buildNdBuffOverrides,
  effectiveLevel, buildNumLevelOf, type NdOverrideEntry,
} from '../../utils/ndOverrides'
import { parseNumRefs } from '../../utils/numRefs'
import { NdOverrideContext, useNdOverrides } from '../../contexts/NdOverrideContext'
import { NdOverrideEmpty } from '../../components/NdOverrideEmpty'
import { useReference } from '../../contexts/ReferenceContext'
import { WeaponIcon } from '../../components/WeaponIcon'
import { DiffHighlight } from '../../components/DiffHighlight'
import { RefText } from '../../components/RefText'

// ─── 神經驅動「全區算力選擇器」（PLAN-021 · 1-6）─────────────────────────────
// 玩家在 tab 卡頂部點選各區 Lv（仿遊戲內 Lv 條），天賦敘述隨配置即時改寫。
//
// 規則引擎（ND_RULES / isGammaZone / zonePower / defaultNdLevels）已於 PLAN-034 B-3
// 上移至 src/utils/ndOverrides.ts —— 天賦改寫與 BUFF 階覆寫層必須共用同一個門檻來源，
// 各留一份必然漂移。未來官方開放上限（超頻）只改那邊的數字。

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
                <span className="absolute -top-1.5 -right-2 text-[9px] text-accent-pink" title="此區算力會改寫天賦／技能敘述">★</span>
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

/**
 * 天賦卡的神經驅動強化面板：讀配置列狀態，顯示生效中的改寫敘述（Q-B：差異高亮預設開）。
 *
 * **PLAN-034 G-1：渲染條件從「有 ndVariants」放寬為「ndVariants 或 ND 覆寫任一有值」。**
 * 塌縮 ndVariants 之後（梅利莎四階全刪、艾達只留 minSum=16），改寫改為**就地**發生在
 * 上方那段主敘述裡——chip 換字、數值 token 換級，沒有第二份文字可以拿來 diff。
 * 若沿用舊條件，面板會直接 return null：「算力階／生效中」徽章連同差異高亮全部消失，
 * 而正文卻仍在隨算力變動，使用者看到字在動卻沒有任何東西告訴他為什麼（地雷五）。
 *
 * 所以面板在塌縮後的角色也跟著變：從「顯示改寫後的另一段敘述」變成
 * **「說明上方那段字為什麼跟官方原文不一樣」**。
 */
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
  const ov = useNdOverrides()
  const variants = talent.ndVariants ?? []

  // 本天賦「實際被抬升」的 buff 家族。刻意不直接列覆寫表全部內容——
  // 表是整頁共用的，天賦沒引用到的家族列出來只會讓人以為這段字被改過。
  // 判定一律走 effectiveLevel / buildNumLevelOf，與 chip、token 的裁決同源。
  const lifts = useMemo<NdOverrideEntry[]>(() => {
    const hit = new Map<string, NdOverrideEntry>()
    const mark = (refId: string) => { const e = ov.entryOf(refId); if (e) hit.set(refId, e) }
    for (const ref of Object.values(talent.descriptionRefs ?? {})) {
      if (ref?.refType !== 'buff' || !ref.refId) continue
      if (effectiveLevel(ref, ov).lifted) mark(ref.refId)
    }
    const levelOf = buildNumLevelOf(talent.descriptionRefs, ov)
    for (const text of [talent.description, talent.descriptionMax]) {
      for (const seg of parseNumRefs(text ?? '')) {
        if (seg.type === 'numRef' && levelOf(seg.refId, seg.level).lifted) mark(seg.refId)
      }
    }
    return [...hit.values()]
  }, [talent, ov])

  if (variants.length === 0 && lifts.length === 0) return null

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
        {/* 變體徽章：塌縮後這一顆會消失（沒有變體了），改由右邊的抬升徽章接手 */}
        {variants.length > 0 && (
          <span className={`text-[11px] px-2 py-0.5 rounded-md border ${
            active
              ? 'text-accent-pink border-accent-pink/45 bg-accent-pink/10 font-bold'
              : 'text-text-dim border-border bg-bg-dark'
          }`}>
            {active ? `${ndVariantLabel(active)} 生效中` : '基礎（未達改寫門檻）'}
          </span>
        )}
        {/* 就地抬升徽章：正文沒有換成另一段，但裡面的階與數值已被改寫 */}
        {lifts.map(e => (
          <span
            key={e.name}
            title={`${e.zone} 算力已把這個家族抬升到 Lv${e.level}；上方正文的階名與層數／回合數都是抬升後的值`}
            className="text-[11px] px-2 py-0.5 rounded-md border text-accent-pink border-accent-pink/45 bg-accent-pink/10 font-bold"
          >
            {e.name}（Lv{e.level}）· {e.zone} 算力
          </span>
        ))}
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
      ) : lifts.length > 0 ? (
        // 塌縮後的常態：改寫就地發生在上方主敘述，這裡只負責交代「動了什麼、為什麼」。
        // 沒有第二段文字可 diff，硬做一個 base vs base 的比對只會全綠、零資訊量。
        <p className="text-[11px] text-text-dim mt-1.5">
          ※ 上方敘述已依算力就地改寫：
          {lifts.map(e => `[${e.name}] 取 Lv${e.level}`).join('、')}
          （雙底線處即抬升後的階名與數值）。調整上方「神經驅動算力」可看到它們跟著變動。
        </p>
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
  額外打擊: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30',
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

// PLAN-032：技能收「已解析」的陣列而非從 weapon.skills 現算——本元件在 tooltip / BottomSheet
// 兩處掛載，讓呼叫端解析一次再傳，避免同一份資料在兩條路徑上各解析各的。
function WeaponDetailContent({ weapon, skills }: { weapon: Weapon; skills: ResolvedWeaponSkill[] }) {
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
      {skills.length > 0 && (
        <div className="px-4 py-3 space-y-2.5">
          <div className="text-[13px] text-text-dim tracking-widest uppercase">武器技能</div>
          {skills.map((sk, i) => (
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

function WeaponDetailTooltip({ weapon, skills, x, anchorTop }: {
  weapon: Weapon; skills: ResolvedWeaponSkill[]; x: number; anchorTop: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, weapon])

  return createPortal(
    <div ref={ref} className="fixed z-50 pointer-events-none w-80" style={{ left: x, top }}>
      <WeaponDetailContent weapon={weapon} skills={skills} />
    </div>,
    document.body
  )
}

// PLAN-032：不再是 union 的原始元素——一律是解析後的樣子，
// 浮窗 / BottomSheet 不需要知道那筆技能是內嵌拷貝還是技能庫引用。
type WeaponSkillItem = ResolvedWeaponSkill

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

function ExclusiveWeaponPanel({ weapon, skills, loading, talentNames, stageCount = 1, stageIdx = 0, onStageChange }: {
  weapon: Weapon | null; skills: ResolvedWeaponSkill[]; loading: boolean; talentNames: string[]
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
        <WeaponDetailTooltip weapon={weapon} skills={skills} x={tooltipPos.x} anchorTop={tooltipPos.anchorTop} />
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
        <WeaponDetailContent weapon={weapon} skills={skills} />
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
        {/* gate 一律接解析後的陣列：weapon.skills.length 對 union 恆真，技能庫未載入時會渲染出空技能區 */}
        {skills.length > 0 && (
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
              skills.map((sk, i) => (
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
                {skills.map((sk, i) => (
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
          <div className={`px-3 py-2 ${skills.length > 0 ? 'border-t border-border' : ''}`}>
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

  // ── 分頁狀態（PLAN-041 D-1）────────────────────────────────────────────────
  // 唯一來源是 URL 的 ?tab=，**不是 useState**。三個理由：
  //  ① 舊寫法的 activeSkillTab 沒有 [id] reset，而本頁切換機師時不 remount ——
  //     今天安全只因三個分頁恆存在；條件式分頁（形態）一落地不變式就破：停在「形態」
  //     再切到非調構師 → 所有 && 皆 false → 一塊完全空白的 <div className="p-4">。
  //     改讀 URL 後，換機師的連結不帶 query → 自然回到第一個分頁，免掉一個 useEffect([id])。
  //  ② PLAN-041 決策十一：引用浮窗對形態產出 /pilots/:id?tab=形態，落點要直接是形態分頁。
  //  ③ replace: true —— 切分頁不該在瀏覽器上留下一堆返回步驟。
  const [searchParams, setSearchParams] = useSearchParams()
  const setActiveSkillTab = (key: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)   // 保留其他 query（未來的分享參數等）
      next.set('tab', key)
      return next
    }, { replace: true })
  }

  // PLAN-004：技能改由 pilotSkills 集合解析（過渡期亦相容嵌入舊格式）
  const gd = useGameData()
  useEffect(() => { gd.ensureLoaded(['pilotSkills', 'neuralDriveAbilities']) }, [gd])

  // PLAN-041：形態（僅調構師有；非調構師此陣列恆為空 → 不多付任何讀取以外的成本）
  const { data: forms } = useFormsByPilot(id)
  // 形態卡的三層來源分別住在 buffs（形態增益）／modules（模組加成）／weapons（固定武裝 chip），
  // 全部是**反查**而來。只在真的有形態時才載——非調構師的頁面不該為此多抓三個集合。
  // ⚠ buffs 原本是條件式載入（見下方 ndNeedsBuffs），漏了這行的症狀是「形態增益」整層空白且無錯誤。
  const hasForms = forms.length > 0
  useEffect(() => { if (hasForms) gd.ensureLoaded(['buffs', 'modules', 'weapons']) }, [hasForms, gd])
  const skillMap = useMemo(() => buildSkillMap(gd.pilotSkills), [gd.pilotSkills])

  // PLAN-032：專武技能雙格式解析。共用上面那張 skillMap——武器技能與機師技能同住
  // pilotSkills 集合（它是全站技能字典，不是「機師的技能」），故不需要第二次載入。
  const exclusiveWeaponSkills = useMemo(
    () => resolveWeaponSkills(exclusiveWeapon?.skills, skillMap),
    [exclusiveWeapon, skillMap],
  )

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
    exclusiveWeaponSkills.forEach(sk => {
      if (sk.enhancesTalentName && sk.enhancedTalentDescription)
        map.set(sk.enhancesTalentName, { text: sk.enhancedTalentDescription, refs: sk.descriptionRefs })
    })
    return map
  }, [exclusiveWeaponSkills])

  // PLAN-021 · 1-6：神經驅動算力配置（tab 卡頂部常駐；換機師時重置回預設）
  const ndDefaults = useMemo(
    () => defaultNdLevels(pilot?.neuralDrive, (aid) => ndAbilityMap.get(aid)),
    [pilot, ndAbilityMap],
  )
  const [ndLevelsOverride, setNdLevelsOverride] = useState<Record<string, number> | null>(null)
  const { close: closeRefPopover } = useReference()
  // 換機師：重置算力，並關掉釘選浮窗——浮窗持有的是**上一位機師**的覆寫快照，
  // 它掛在 App.tsx 的 ReferenceProvider 下不會隨本頁重新掛載而消失（地雷一）。
  useEffect(() => { setNdLevelsOverride(null); closeRefPopover() }, [id, closeRefPopover])
  const ndLevels = ndLevelsOverride ?? ndDefaults

  // ── PLAN-034 Phase C：算力 → BUFF 階覆寫表 ────────────────────────────────
  // ⚠ 這幾個 useMemo 必須留在 early return **之前**，否則 loading / 找不到機師時
  //   hooks 數量不一致會白屏。
  const ndNeedsBuffs = useMemo(
    () => (pilot?.neuralDrive ?? []).some(z =>
      (z.levels ?? []).some(lv => lv.abilityId && ndAbilityMap.get(lv.abilityId)?.buffUpgrades?.length)),
    [pilot?.neuralDrive, ndAbilityMap],
  )
  // 只有真的有升階宣告的機師才付 buffs 的載入成本
  useEffect(() => { if (ndNeedsBuffs) gd.ensureLoaded(['buffs']) }, [ndNeedsBuffs, gd])

  const ndOverrideMap = useMemo(() => buildNdBuffOverrides({
    drives: pilot?.neuralDrive,
    levels: ndLevels,
    abilityOf: (aid) => ndAbilityMap.get(aid),
    buffOf: (bid) => gd.buffs.find(b => b.id === bid),
    onReject: import.meta.env.DEV
      ? (r) => {
          // buffs 還沒載完時每個家族都會回 buff-missing，那是設計上的中間態（閘門①），
          // 不是資料有問題。照噴的話 dev console 每次進頁都固定出現假警報，
          // 久了就沒人會認真看這些警告了。
          if (r.reason === 'buff-missing' && !gd.loadedKeys.has('buffs')) return
          console.warn(`[PLAN-034] ${r.buffId} 未進覆寫表（${r.reason}）：${r.detail}`)
        }
      : undefined,
  }), [pilot?.neuralDrive, ndLevels, ndAbilityMap, gd.buffs, gd.loadedKeys])

  // value 必須 memo 化：RefChip 是全站扇出最高的葉節點，每次 render 新建物件會讓
  // provider 底下所有 chip 失去 memo（即使覆寫表為空的機師頁也一樣）。
  const ndOverrides = useMemo(
    () => ({ entryOf: (buffId: string) => ndOverrideMap.get(buffId) }),
    [ndOverrideMap],
  )

  // ★ 標記：ndVariants 宣告的分區 ∪ 帶 buffUpgrades 的能力所在分區
  const ndAffectZones = useMemo(() => {
    const zones = new Set(
      (pilot?.talents ?? []).flatMap(t => (t.ndVariants ?? []).map(v => v.zone)).filter((z): z is string => !!z)
    )
    for (const z of pilot?.neuralDrive ?? []) {
      const has = (z.levels ?? []).some(lv => lv.abilityId && ndAbilityMap.get(lv.abilityId)?.buffUpgrades?.length)
      if (has) zones.add(z.name)
    }
    return zones
  }, [pilot, ndAbilityMap])

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

  // 分頁清單（跟隨 MechAdmin.tsx 的 MECH_EDIT_TABS 慣例：具名陣列而非硬編碼 map）。
  // 條件式分頁只要在此 push 一筆即可，計數與樣式全部自動跟上；
  // PLAN-041 D-3 的「形態」分頁就掛在這裡（`...(forms.length ? [{ key: '形態', count: forms.length }] : [])`）。
  const skillTabs = [
    { key: '天賦',     count: pilot.talents.length },
    { key: '技能',     count: regularSkills.length },
    { key: '神經驅動', count: pilot.neuralDrive?.length ?? 0 },
    // PLAN-041：條件式第 4 分頁。gate 是 forms.length，**不是** pilot.class === '調構師'
    // ——官方職業 icon 跳號，且實測 2/82 機師的 class 與職業機制對不上；用 class gate 會在
    // 新調構師上線但 forms 未填時渲染出空的「形態 (0)」。
    ...(forms.length ? [{ key: '形態', count: forms.length }] : []),
  ]
  // derived active：找不到就落回第一個分頁。這一行同時吃掉三種情況——
  // 沒有 ?tab=、?tab= 是未知值（手改網址／舊書籤）、以及該分頁在這名機師身上不存在。
  const activeSkillTab = (skillTabs.find(t => t.key === searchParams.get('tab')) ?? skillTabs[0]).key

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
            {pilot.debutVersion && <InfoRow label="登場版本" value={`v${pilot.debutVersion}`} />}
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
        {/* PLAN-041 D-2：360px 的 RWD。overflow-x-auto 單獨加是 no-op——
            必須先有 shrink-0 + whitespace-nowrap 讓按鈕拒絕被壓縮，才會真的產生溢出可捲動；
            否則第 4 個分頁上線後會把「神經驅動」壓到折行，底線跟著全歪（桌機看不到）。 */}
        <div className="flex border-b border-border overflow-x-auto">
          {skillTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveSkillTab(tab.key)}
              className={`shrink-0 whitespace-nowrap px-3 sm:px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                activeSkillTab === tab.key
                  ? 'text-accent-orange border-b-2 border-accent-orange bg-accent-orange/5'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.key} ({tab.count})
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

        {/* PLAN-041 D-4：跨分頁常駐的「特殊能力」列。位置跟隨 NdPowerBar 的慣例——
            渲染在分頁 switch **之外**，四個分頁都看得到；官方本來也是把形態做成常駐橫幅。
            gate 用 forms.length，理由同 skillTabs 的註解。 */}
        {hasForms && (
          <div className="px-4 py-2.5 border-b border-border bg-accent-cyan/5">
            <div className="flex items-center gap-2.5 overflow-x-auto">
              <span className="shrink-0 text-[11px] font-[Orbitron,sans-serif] tracking-widest uppercase text-accent-cyan">
                特殊能力
              </span>
              <div className="flex items-center gap-1.5">
                {forms.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setActiveSkillTab('形態')}
                    title={`${f.name} — 點擊查看形態詳情`}
                    className={`shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg border text-[12px] transition-colors cursor-pointer ${
                      f.isSignature
                        ? 'border-accent-yellow/50 bg-accent-yellow/10 text-accent-yellow hover:bg-accent-yellow/20'
                        : 'border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20'
                    }`}
                  >
                    {f.isSignature && '★ '}{f.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PLAN-034：算力覆寫表罩住三個分頁的引用渲染。ND 分區卡／能力卡另包
            NdOverrideEmpty 隔離——那裡是規則的宣告處，不該被自己宣告的規則改寫。 */}
        <NdOverrideContext.Provider value={ndOverrides}>
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
                skills={exclusiveWeaponSkills}
                // PLAN-032：技能庫未到時專武技能區與天賦頁的「▶ 專武強化」都會整塊消失
                // （talentEnhancementMap 從 exclusiveWeaponSkills derive）。併進 loading，
                // 讓那段時間顯示骨架而不是「這把專武沒有技能」。
                loading={exclusiveWeaponLoading || !gd.loadedKeys.has('pilotSkills')}
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
              <NdOverrideEmpty>
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
              </NdOverrideEmpty>
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
              <NdOverrideEmpty>
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
              </NdOverrideEmpty>
            </div>
          )}

          {/* PLAN-041 D-3：形態分頁。一律 forms.map，不寫死欄數——
              新調構師只有 2 個形態時自動變 2 張卡。 */}
          {activeSkillTab === '形態' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {forms.map((f) => <FormCard key={f.id} form={f} />)}
            </div>
          )}
        </div>
        </NdOverrideContext.Provider>
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
