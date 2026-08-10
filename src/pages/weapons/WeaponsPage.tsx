import { useState, useLayoutEffect, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useWeapons, usePilotBriefMap, useWeaponSkillMap, type PilotBrief } from '../../hooks/useFirestore'
import { resolveWeaponSkills } from '../../utils/weaponSkills'
import { WeaponIcon } from '../../components/WeaponIcon'
import { ExclusivePilotLink } from '../../components/PilotIcon'
import { WeaponRarityBadge } from '../../components/WeaponRarityBadge'
import {
  EQUIP_SLOT_LABELS,
  MECH_RESTRICTION_LABELS,
  ACTIVATION_CONFIG,
  ACTIVATION_LABELS,
  FixedArmamentBadge,
} from '../../components/WeaponBadges'
import { assetUrl } from '../../utils/assets'
import { isCompositeWeapon } from '../../utils/weaponUpgrade'
import { naOr, isNaStat } from '../../utils/weaponStats'
import { WeaponType, WeaponKind } from '../../types/enums'
import type { Weapon } from '../../types'

/** 「特種背包製作」badge（PLAN-031 複合武器）——熠光與裁決者數值全同、連 icon 都共用，必須有視覺區隔。 */
function CompositeBadge() {
  return (
    <span className="text-[13px] text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30 px-1.5 py-0.5 rounded">
      特種背包製作
    </span>
  )
}

const PAGE_SIZE = 36

const RARITY_ORDER: Record<string, number> = { SS: 0, 'S+': 1, S: 2, A: 3, B: 4 }

const ALL_RARITIES   = ['SS', 'S+', 'S', 'A', 'B']
/**
 * 圖鑑篩選器**刻意直接跟隨 enum**（PLAN-040 B-3）：圖鑑是「查得到」的那一層，
 * 必須篩得到每一個存在的類型／種類，新增 enum 值就該自動出現在篩選列。
 * 原本是手抄的字串陣列，加「特殊」時才發現它與 enum 早已是兩份要人工對齊的清單。
 *
 * ⚠ 對照組：ComponentsPage 的元件武器類型限定**不可**這樣跟隨，見 enums.ts 的
 *   COMPONENT_WEAPON_TYPES——那裡跟隨 enum 會讓 204 個元件長出假的「限定」標籤。
 *   「跟不跟隨 enum」要逐處判斷，不是全站一致的規則。
 */
const ALL_TYPES      = Object.values(WeaponType)
const ALL_KINDS      = Object.values(WeaponKind)
const ALL_EQUIP_SLOTS = ['singleHand', 'dualHand', 'shoulder', 'back']


function Num({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-accent-red font-bold font-[JetBrains_Mono,monospace] ${className}`}>
      {children}
    </span>
  )
}

function SkillIcon({ iconLocal, name, size = 'md' }: { iconLocal?: string; name: string; size?: 'sm' | 'md' }) {
  const [err, setErr] = useState(false)
  const cls = size === 'sm' ? 'w-7 h-7' : 'w-10 h-10'
  if (err || !iconLocal) {
    return (
      <div className={`${cls} rounded-lg bg-bg-dark border border-border flex items-center justify-center text-text-dim text-xs flex-shrink-0`}>
        技
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

function formatRange(w: Weapon): string {
  return w.rangeType === 'ring' ? `${w.maxRange}+` : `${w.minRange}-${w.maxRange}`
}

function formatRangeType(rangeType: string): string {
  if (rangeType === 'ring') return '環形'
  if (rangeType === 'orthogonal') return '十字直線'
  return '菱形'
}

/**
 * ⚠ 本元件內部呼叫 useWeaponSkillMap（PLAN-032），會觸發 pilotSkills 載入（冷快取 ~646 read）。
 *   刻意掛在這個邊界而非頁面層——tooltip 只在滑鼠移上武器卡時才掛載，
 *   單純瀏覽圖鑑的使用者完全不付這筆讀取量。形制沿用 useBackpackNameMap 的同款告誡。
 */
function WeaponTooltipContent({ weapon, pilotMap }: {
  weapon: Weapon
  pilotMap: Record<string, PilotBrief>
}) {
  const pilot = weapon.exclusiveFor ? pilotMap[weapon.exclusiveFor] : undefined
  const { data: skillMap, loading: skillsLoading } = useWeaponSkillMap()
  const skills = resolveWeaponSkills(weapon.skills, skillMap)
  // 技能庫是在本元件掛載時才開始載入的（ensureLoaded 跑在 useEffect），
  // 所以**第一次 hover 必然**還沒有資料。單純 gate 掉技能區的話，
  // 使用者看到的是「這把武器沒有技能」——與事實相反且沒有任何提示。
  // 有掛載條目但解析不到 → 顯示載入中，而不是消失。
  const skillsPending = skillsLoading && (weapon.skills?.length ?? 0) > 0 && skills.length === 0
  const rangeNa = isNaStat(weapon, ['minRange', 'maxRange'])
  const stats: Array<{ label: string; value: string; noRed?: boolean }> = [
    { label: '攻擊力',  value: naOr(weapon, 'attack', weapon.attack.toLocaleString()) },
    { label: '命中',    value: naOr(weapon, 'accuracy', weapon.accuracy.toLocaleString()) },
    { label: '暴擊',    value: naOr(weapon, 'critValue', weapon.critValue.toLocaleString()) },
    { label: '重量',    value: naOr(weapon, 'weight', weapon.weight.toString()) },
    { label: '射程',    value: naOr(weapon, ['minRange', 'maxRange'], formatRange(weapon)) },
    // 射程不適用時整列收掉，而不是顯示「射程型態 菱形」——那會是對一個不存在的射程做出的肯定陳述
    ...(rangeNa ? [] : [{ label: '射程型態', value: formatRangeType(weapon.rangeType), noRed: true }]),
    { label: '連擊數',  value: naOr(weapon, 'hitCount', weapon.hitCount.toString()) },
    { label: '彈藥量',  value: naOr(weapon, 'ammoCount', weapon.ammoCount === 0 ? '∞' : weapon.ammoCount.toString()) },
    { label: '種類係數',value: naOr(weapon, 'kindCoefficient', weapon.kindCoefficient.toFixed(2)) },
    { label: '裝備部位',value: EQUIP_SLOT_LABELS[weapon.equipSlot] ?? weapon.equipSlot, noRed: true },
    ...(weapon.mechRestriction !== 'none'
      ? [{ label: '機甲限制', value: MECH_RESTRICTION_LABELS[weapon.mechRestriction] ?? weapon.mechRestriction, noRed: true }]
      : []),
  ]

  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <WeaponIcon icon={weapon.icon} name={weapon.name} size="lg" isExclusive={weapon.isExclusive} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <div className="font-bold text-sm text-text-primary leading-tight">{weapon.name}</div>
            <WeaponRarityBadge rarity={weapon.rarity} className="px-2" />
          </div>
          <div className="text-[13px] text-text-dim mt-0.5">{weapon.type} · {weapon.kind}</div>
          {isCompositeWeapon(weapon) && <div className="mt-1"><CompositeBadge /></div>}
          {weapon.isFixedArmament && <div className="mt-1"><FixedArmamentBadge /></div>}
          {pilot && weapon.exclusiveFor && (
            <ExclusivePilotLink
              pilotId={weapon.exclusiveFor}
              pilot={pilot}
              prefix="専武："
              className="mt-0.5"
            />
          )}
        </div>
      </div>

      <div className="space-y-2">
        {/* Stats grid */}
        <div className="bg-bg-dark rounded-lg p-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
          {stats.map(({ label, value, noRed }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="text-[13px] text-text-dim whitespace-nowrap">{label}</span>
              {noRed
                ? <span className="text-[14px] text-text-secondary">{value}</span>
                : <Num className="text-[14px]">{value}</Num>
              }
            </div>
          ))}
        </div>

        {/* Slots */}
        <div className="bg-bg-dark rounded-lg px-2.5 py-2 flex items-center gap-4 text-[14px]">
          <span className="text-text-dim">觸元件</span>
          <Num>{weapon.triggerSlots}</Num>
          <span className="text-text-dim">應元件</span>
          <Num>{weapon.effectSlots}</Num>
          {weapon.componentLimit > 0 && (
            <>
              <span className="text-text-dim border-l border-border pl-4">上限</span>
              <Num>{weapon.componentLimit}</Num>
            </>
          )}
        </div>

        {/* Skills —— gate 接在解析後的陣列（weapon.skills.length 對 union 恆真，技能庫未載入時會渲染空框） */}
        {skillsPending && (
          <div className="bg-bg-dark rounded-lg overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border">
              <span className="text-[13px] text-text-dim tracking-widest uppercase">武器技能</span>
            </div>
            <div className="flex flex-wrap gap-2 p-2.5">
              {Array.from({ length: weapon.skills.length }).map((_, i) => (
                <div key={i} className="w-16 h-[52px] rounded-lg bg-bg-card animate-pulse" />
              ))}
            </div>
          </div>
        )}
        {skills.length > 0 && (
          <div className="bg-bg-dark rounded-lg overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border">
              <span className="text-[13px] text-text-dim tracking-widest uppercase">武器技能</span>
            </div>
            <div className="flex flex-wrap gap-2 p-2.5">
              {skills.map((sk, i) => {
                const actCls = ACTIVATION_CONFIG[sk.activation]?.className ?? 'text-text-dim bg-bg-dark border-border'
                return (
                  <div key={i} className="flex flex-col items-center gap-1 w-16 rounded-lg p-1.5 cursor-default">
                    <SkillIcon iconLocal={sk.iconLocal} name={sk.name} />
                    <div className="text-center w-full">
                      <div className="text-[11px] font-medium leading-tight line-clamp-2 break-all">{sk.name}</div>
                      <span className={`text-[10px] border rounded px-1 py-0.5 mt-0.5 inline-block ${actCls}`}>
                        {ACTIVATION_LABELS[sk.activation] ?? sk.activation}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Fixed mod */}
        {weapon.fixedMod?.planName && (
          <div className="bg-bg-dark rounded-lg p-2.5">
            <div className="text-[13px] text-accent-orange font-bold mb-1">
              固定改裝 · {weapon.fixedMod.planName}
            </div>
            <div className="text-[14px] text-text-dim mb-1">
              上限等級 <Num>{weapon.fixedMod.maxLevel}</Num>
            </div>
            {weapon.fixedMod.effects.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {weapon.fixedMod.effects.map((e, i) => (
                  <span key={i} className="text-[14px] text-text-secondary">
                    {e.stat} <Num>+{e.value}</Num>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Floating mod */}
        {weapon.floatingMod?.planName && (
          <div className="bg-bg-dark rounded-lg p-2.5">
            <div className="text-[13px] text-accent-cyan font-bold mb-1">
              浮動改裝 · {weapon.floatingMod.planName}
            </div>
            <div className="text-[14px] text-text-dim mb-1">
              插槽 <Num>{weapon.floatingMod.slots}</Num> 格
            </div>
            {weapon.floatingMod.possibleEffects.length > 0 && (
              <div className="space-y-0.5">
                {weapon.floatingMod.possibleEffects.map((e, i) => (
                  <div key={i} className="text-[14px] text-text-dim">
                    {e.stat}
                    {e.condition ? <span className="text-text-dim/70"> ({e.condition})</span> : ''}
                    {' '}<Num>{e.min}–{e.max}</Num>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function WeaponTooltip({ weapon, pilotMap }: { weapon: Weapon; pilotMap: Record<string, PilotBrief> }) {
  return (
    <div className="w-80 max-h-[min(90vh,_640px)] flex flex-col bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl">
      <div className="flex-1 min-h-0 overflow-y-auto p-1">
        <WeaponTooltipContent weapon={weapon} pilotMap={pilotMap} />
      </div>
    </div>
  )
}

interface TooltipState {
  weaponId: string
  x: number
  anchorTop: number
}

function TooltipPortal({ weapon, pilotMap, x, anchorTop }: {
  weapon: Weapon
  pilotMap: Record<string, PilotBrief>
  x: number
  anchorTop: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, weapon.id])

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 pointer-events-none"
      style={{ left: x, top }}
    >
      <WeaponTooltip weapon={weapon} pilotMap={pilotMap} />
    </div>,
    document.body
  )
}

export default function WeaponsPage() {
  const { data: weapons, loading } = useWeapons()
  const { data: pilotMap } = usePilotBriefMap()

  const [search, setSearch] = useState('')
  const [rarityFilters, setRarityFilters]     = useState<Set<string>>(new Set())
  const [typeFilters, setTypeFilters]         = useState<Set<string>>(new Set())
  const [kindFilters, setKindFilters]         = useState<Set<string>>(new Set())
  const [equipSlotFilter, setEquipSlotFilter] = useState<string | null>(null)
  /**
   * 固定武裝**預設不顯示**（PLAN-040 決策八，使用者原話：「最好單獨篩選分類，
   * 平常沒事別給人直接看到，喜歡看故事的人以後再查吧」）。
   * 這不是美觀問題——不排除的話，六筆會污染下面每一條計算：總數統計、
   * 搜尋（吃 name + kind，搜「彈倉」會跳出不是武器的東西）、部位篩選計數、
   * 以及稀有度排序（六筆 rarity 皆為 'S'，RARITY_ORDER 有 S: 2 → 不會落 fallback，
   * 而是**安靜地混進 S 級排序區**，比落 fallback 更難察覺）。
   */
  const [showFixedArmament, setShowFixedArmament] = useState(false)
  const [displayCount, setDisplayCount]       = useState(PAGE_SIZE)

  useEffect(() => { setDisplayCount(PAGE_SIZE) }, [search, rarityFilters, typeFilters, kindFilters, equipSlotFilter, showFixedArmament])

  const isMobile = useIsMobile()
  const [hoverTooltip, setHoverTooltip] = useState<TooltipState | null>(null)
  const [sheetWeapon, setSheetWeapon] = useState<Weapon | null>(null)

  const navigate = useNavigate()

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const filtered = weapons
    .filter((w) => {
      // 起手就排除，不可只靠 badge 補救——badge 是視覺提示，管不到統計／搜尋／計數／排序
      if (!showFixedArmament && w.isFixedArmament)                  return false
      if (rarityFilters.size > 0 && !rarityFilters.has(w.rarity))   return false
      if (typeFilters.size > 0   && !typeFilters.has(w.type))       return false
      if (kindFilters.size > 0   && !kindFilters.has(w.kind))       return false
      if (equipSlotFilter && w.equipSlot !== equipSlotFilter)        return false
      if (search) {
        const q = search.toLowerCase()
        return w.name.toLowerCase().includes(q) || w.kind.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9))

  /** 「全 N 把」的基數：只套用固定武裝開關，不套用其他篩選條件 */
  const visibleTotal = showFixedArmament ? weapons.length : weapons.filter((w) => !w.isFixedArmament).length

  const paginated = filtered.slice(0, displayCount)

  const computePos = (cardEl: HTMLDivElement): { x: number; anchorTop: number } => {
    const rect = cardEl.getBoundingClientRect()
    const tooltipW = 320
    const margin = 8
    const rightX = rect.right + margin
    const leftX = rect.left - tooltipW - margin
    const x = rightX + tooltipW > window.innerWidth - margin
      ? Math.max(margin, leftX)
      : rightX
    return { x: Math.max(margin, Math.min(x, window.innerWidth - tooltipW - margin)), anchorTop: rect.top }
  }

  const handleMouseEnter = (weaponId: string, cardEl: HTMLDivElement) => {
    if (isMobile) return
    setHoverTooltip({ weaponId, ...computePos(cardEl) })
  }

  const handleMouseLeave = () => {
    if (isMobile) return
    setHoverTooltip(null)
  }

  const activeTooltip = hoverTooltip
  const activeWeapon  = activeTooltip
    ? weapons.find((w) => w.id === activeTooltip.weaponId) ?? null
    : null

  const filterBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
        : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      {activeWeapon && activeTooltip && !isMobile && (
        <TooltipPortal
          key={activeTooltip.weaponId}
          weapon={activeWeapon}
          pilotMap={pilotMap}
          x={activeTooltip.x}
          anchorTop={activeTooltip.anchorTop}
        />
      )}

      <BottomSheet open={!!sheetWeapon} onClose={() => setSheetWeapon(null)}>
        {sheetWeapon && (
          <>
            <WeaponTooltipContent weapon={sheetWeapon} pilotMap={pilotMap} />
            <Link
              to={`/weapons/${sheetWeapon.id}`}
              className="mt-4 block text-center text-sm text-accent-orange hover:underline"
              onClick={() => setSheetWeapon(null)}
            >
              查看完整詳情 →
            </Link>
          </>
        )}
      </BottomSheet>

      {/* Header */}
      <div className="mb-8">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Database
        </span>
        <h1 className="text-3xl font-bold mt-2">武器圖鑑</h1>
        <p className="text-text-secondary mt-2">
          所有武器種類、射程、技能效果與元件插槽配置。共 {weapons.length} 把武器。
        </p>
      </div>

      {/* Filters */}
      <div
        className="bg-bg-card border border-border rounded-xl p-4 mb-6 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <input
          type="text"
          placeholder="搜尋武器名稱或種類..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-bg-dark border border-border rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-border-accent"
        />

        {/* Rarity – multi-select OR */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">稀有度</span>
          <button className={filterBtn(rarityFilters.size === 0)} onClick={() => setRarityFilters(new Set())}>全部</button>
          {ALL_RARITIES.map((r) => (
            <button
              key={r}
              className={filterBtn(rarityFilters.has(r))}
              onClick={() => toggleSet(setRarityFilters, r)}
            >{r}</button>
          ))}
        </div>

        {/* Type – multi-select OR */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">類型</span>
          <button className={filterBtn(typeFilters.size === 0)} onClick={() => setTypeFilters(new Set())}>全部</button>
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              className={filterBtn(typeFilters.has(t))}
              onClick={() => toggleSet(setTypeFilters, t)}
            >{t}</button>
          ))}
        </div>

        {/* Kind – multi-select OR */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">種類</span>
          <button className={filterBtn(kindFilters.size === 0)} onClick={() => setKindFilters(new Set())}>全部</button>
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              className={filterBtn(kindFilters.has(k))}
              onClick={() => toggleSet(setKindFilters, k)}
            >{k}</button>
          ))}
        </div>

        {/* Equip slot – single select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">部位</span>
          <button className={filterBtn(!equipSlotFilter)} onClick={() => setEquipSlotFilter(null)}>全部</button>
          {ALL_EQUIP_SLOTS.map((s) => (
            <button
              key={s}
              className={filterBtn(equipSlotFilter === s)}
              onClick={() => setEquipSlotFilter(equipSlotFilter === s ? null : s)}
            >{EQUIP_SLOT_LABELS[s]}</button>
          ))}
        </div>

        {/* 固定武裝 – 單獨開關，預設關閉（決策八） */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">特殊</span>
          <button
            className={filterBtn(showFixedArmament)}
            onClick={() => setShowFixedArmament((v) => !v)}
            title="固定武裝＝無法更換的武器（如帕斯卡的衝擊炮）。預設不列入圖鑑統計與排序。"
          >🔒 顯示固定武裝</button>
        </div>
      </div>

      {/* Count */}
      {!loading && (
        <p className="text-xs text-text-dim mb-4">
          顯示 <Num className="text-xs">{Math.min(displayCount, filtered.length)}</Num> / {filtered.length} 把武器
          {/* 基數必須跟著開關走：拿含固定武裝的 weapons.length 當「全 N 把」，
              開關關閉時會顯示一個使用者永遠數不到的總數，等於把隱藏的六筆洩漏在括號裡 */}
          {filtered.length !== visibleTotal && <span className="ml-1">（全 {visibleTotal} 把）</span>}
        </p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          沒有符合條件的武器
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {paginated.map((w) => {
            const pilot = w.exclusiveFor ? pilotMap[w.exclusiveFor] : undefined

            return (
              <div
                key={w.id}
                className="bg-bg-card border border-border rounded-xl p-3 cursor-pointer transition-all select-none hover:border-border-accent hover:bg-bg-card-hover"
                onMouseEnter={(e) => handleMouseEnter(w.id, e.currentTarget)}
                onMouseLeave={handleMouseLeave}
                onClick={() => { if (isMobile) setSheetWeapon(w); else navigate(`/weapons/${w.id}`) }}
              >
                {/* Top row: icon + name/rarity */}
                <div className="flex items-start gap-2 mb-2">
                  <WeaponIcon icon={w.icon} name={w.name} size="md" isExclusive={w.isExclusive} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <Link
                        to={`/weapons/${w.id}`}
                        className="font-bold text-sm text-text-primary leading-tight line-clamp-2 hover:text-accent-orange transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {w.name}
                      </Link>
                      <WeaponRarityBadge rarity={w.rarity} />
                    </div>
                    {/* Type · Kind + pilot link */}
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[13px] text-text-dim bg-bg-dark border border-border px-1.5 py-0.5 rounded">
                        {w.type}·{w.kind}
                      </span>
                      {isCompositeWeapon(w) && <CompositeBadge />}
                      {w.isFixedArmament && <FixedArmamentBadge />}
                      {w.isExclusive && pilot && w.exclusiveFor && (
                        <ExclusivePilotLink
                          pilotId={w.exclusiveFor}
                          pilot={pilot}
                          size="xs"
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Key stats */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[14px]">
                  <div>
                    <span className="text-text-dim">射 </span>
                    <Num>{naOr(w, ['minRange', 'maxRange'], formatRange(w))}</Num>
                    {!isNaStat(w, ['minRange', 'maxRange']) && (
                      <span className="text-text-dim text-[12px] ml-0.5">{{ manhattan: '(菱)', orthogonal: '(直)', ring: '(圈)' }[w.rangeType]}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-text-dim">重 </span>
                    <Num>{naOr(w, 'weight', w.weight)}</Num>
                  </div>
                  <div>
                    <span className="text-text-dim">命中 </span>
                    <Num>{naOr(w, 'accuracy', w.accuracy.toLocaleString())}</Num>
                  </div>
                  <div>
                    <span className="text-text-dim">暴擊 </span>
                    <Num>{naOr(w, 'critValue', w.critValue.toLocaleString())}</Num>
                  </div>
                  {w.hitCount > 1 && (
                    <div className="col-span-2">
                      <span className="text-text-dim">連擊 </span>
                      <Num>{w.hitCount}</Num>
                      <span className="text-text-dim text-[12px] ml-0.5">次</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && displayCount < filtered.length && (
        <div className="mt-6 text-center">
          <button
            className="px-6 py-2.5 rounded-xl border border-border bg-bg-card text-text-secondary text-sm hover:border-border-accent hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => setDisplayCount((n) => n + PAGE_SIZE)}
          >
            載入更多（{filtered.length - displayCount} 把）
          </button>
        </div>
      )}
    </div>
  )
}
