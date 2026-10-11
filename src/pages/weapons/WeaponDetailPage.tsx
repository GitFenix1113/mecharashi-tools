import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { BackToListLink } from '../../components/layout/BackToListLink'
import {
  useWeapon, useWeapons, usePilotBriefMap, useBackpackNameMap, useWeaponSkillMap, useMechs, useForms,
} from '../../hooks/useFirestore'
import { RefChip } from '../../components/refs/RefChip'
import { fixedArmamentHosts, slotLabel } from '../../utils/mechSlots'
import { WeaponRarityBadge } from '../../components/badges/WeaponRarityBadge'
import { WeaponIcon } from '../../components/icons/WeaponIcon'
import { ExclusivePilotLink } from '../../components/icons/PilotIcon'
import {
  WeaponTypeBadge,
  WeaponEquipSlotBadge,
  WeaponMechRestrictionBadge,
  FixedArmamentBadge,
} from '../../components/badges/WeaponBadges'
import { WeaponSkillCard } from '../../components/cards/WeaponSkillCard'
import { buildUpgradeIndex, deriveFusedSkillNames, isCompositeWeapon } from '../../utils/weaponUpgrade'
import { resolveWeaponSkills } from '../../utils/weaponSkills'
import { naOr, isNaStat, isVariableStat, variableStatNote } from '../../utils/weaponStats'
import { useReference } from '../../contexts/ReferenceContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { EntityRef, Weapon } from '../../types'

// ── 固定武裝的宿主（2026-10-10）──────────────────────────────────────────────
//
// 「這把焊在誰身上」從宿主反查（fixedArmamentHosts），武器文件本身不存擁有者 ——
// 一對一的前提下兩邊都存只會漂移，理由見 src/utils/mechSlots.ts。
// ⚠ 獨立成元件：mechs／forms 只在固定武裝（全站 8 把）的頁面才載入，其餘武器頁不碰。
// ⚠ 查不到宿主時**不渲染**，不寫「未連結」—— 那是後台的待辦（武器管理會提醒），不是給訪客的資訊。

function FixedArmamentHostLine({ weaponId }: { weaponId: string }) {
  const { data: mechs } = useMechs()
  const { data: forms } = useForms()
  const pilotBrief = usePilotBriefMap().data
  const hosts = useMemo(() => fixedArmamentHosts(weaponId, mechs, forms), [weaponId, mechs, forms])
  if (!hosts.length) return null

  return (
    <div className="mt-3 space-y-1">
      {hosts.map((h) => (
        <div key={`${h.kind}:${h.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className="text-accent-yellow font-bold">焊在</span>
          {h.kind === 'mech' ? (
            <RefChip inner={h.name} entity={{ refType: 'mech', refId: h.id }} />
          ) : (
            <span>
              <RefChip inner={pilotBrief[h.pilotId]?.name ?? h.pilotId} entity={{ refType: 'pilot', refId: h.pilotId }} />
              <span className="text-text-dim">・</span>
              <RefChip inner={h.name} entity={{ refType: 'form', refId: h.id }} />
            </span>
          )}
          {h.refs.length > 0 && (
            <span className="text-text-secondary">{h.refs.map(slotLabel).join('、')}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Labels & formatters ───────────────────────────────────────────────────────

const MOD_STAT_LABELS: Record<string, string> = {
  attack:    '攻擊力',
  crit:      '暴擊',
  accuracy:  '命中',
  firepower: '火力',
  weight:    '重量',
}

const RANGE_TYPE_LABELS: Record<string, string> = {
  manhattan:  '菱形',
  orthogonal: '十字直線',
  ring:       '環形',
}

function formatRange(weapon: Weapon): string {
  return weapon.rangeType === 'ring'
    ? `${weapon.maxRange}+`
    : `${weapon.minRange}-${weapon.maxRange}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="text-xs text-text-dim tracking-[3px] uppercase font-[Orbitron,sans-serif] mb-3">
      {children}
    </h2>
  )
}

/** 緊湊格：左欄 22rem 內要排 4 欄（全站最長的值是命中 5,241 這種 5 字元），手機同樣 4 欄。 */
function StatCell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-bg-dark rounded-lg px-1 py-2 text-center">
      <div className="text-[11px] text-text-dim mb-0.5">{label}</div>
      <div className="text-[15px] font-bold text-accent-red font-[JetBrains_Mono,monospace] leading-tight">
        {value}
      </div>
      {sub && <div className="text-[11px] text-text-dim mt-0.5">{sub}</div>}
    </div>
  )
}

/** 元件插槽的一格：標籤＋小方框。插槽數只有 0 或 3 兩種，方框本身就是數量，不另標 ×N。 */
function SlotBoxes({ label, count, colorClass }: { label: string; count: number; colorClass: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-text-secondary">{label}</span>
      {count === 0 ? (
        <span className="text-text-dim font-[JetBrains_Mono,monospace]">0</span>
      ) : (
        <span className="inline-flex gap-1">
          {Array.from({ length: count }).map((_, i) => (
            <span key={i} className={`w-3.5 h-3.5 rounded-sm border-2 ${colorClass}`} />
          ))}
        </span>
      )}
    </span>
  )
}

// ── B-1 進階鏈（PLAN-031）────────────────────────────────────────────────────

/** 「特種背包製作」badge：複合武器（upgrade.station === 'specialBackpack'）專用。 */
function CompositeBadge() {
  return (
    <span className="px-2 py-0.5 rounded text-[13px] border text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30">
      特種背包製作
    </span>
  )
}

/**
 * 可點擊的武器 chip（進階鏈、同類專武共用）：連向該武器詳情頁，滑過時浮窗預覽技能（RefWeaponSkills）。
 *
 * ⚠ 與 RefChip 刻意不同：桌面「點擊＝前往」而不是釘選——它長得就是導航卡片，點了沒換頁反而像壞掉，
 *   預覽已經由 hover 給了。手機沒有 hover，點擊改成開 BottomSheet（技能＋「查看完整詳情 →」），
 *   否則手機上比不了技能、只能一把一把點進去再退出來。
 */
function WeaponHoverLink({ weapon, sub, hideRarity = false }: {
  weapon: Weapon
  /** 名稱下方的小字（同類專武放專屬機師名） */
  sub?: string
  /** 同類專武全是 SS，每顆都掛 SS 只是雜訊 */
  hideRarity?: boolean
}) {
  const { hoverRef, leaveRef, pinRef } = useReference()
  const isMobile = useIsMobile()
  const ref: EntityRef = { refType: 'weapon', refId: weapon.id }
  return (
    <Link
      to={`/weapons/${weapon.id}`}
      onMouseEnter={(e) => hoverRef(ref, e.currentTarget)}
      onMouseLeave={leaveRef}
      onClick={(e) => {
        if (!isMobile) return
        e.preventDefault()
        pinRef(ref, e.currentTarget)
      }}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-dark border border-border hover:border-accent-cyan transition-colors"
    >
      <WeaponIcon gameId={weapon.gameId} icon={weapon.icon} name={weapon.name} size="sm" isExclusive={weapon.isExclusive} />
      {sub ? (
        <span className="flex flex-col leading-tight">
          <span className="text-sm text-text-secondary">{weapon.name}</span>
          <span className="text-[11px] text-text-dim">{sub}</span>
        </span>
      ) : (
        <span className="text-sm text-text-secondary">{weapon.name}</span>
      )}
      {!hideRarity && <WeaponRarityBadge rarity={weapon.rarity} />}
    </Link>
  )
}

/**
 * 「融合自 ○○背包」純文字說明（複合武器專用）。
 * ⚠ 此元件內部才呼叫 useBackpackNameMap（觸發 backpacks 載入）——
 *   只有複合武器頁會掛載它，一般武器頁完全不付背包讀取量。
 */
function FusedBackpackNote({ backpackId }: { backpackId: string }) {
  const { data: nameMap } = useBackpackNameMap()
  const name = nameMap[backpackId]
  return (
    <div className="mt-3 text-[13px] text-text-dim">
      融合自 <span className="text-text-secondary">{name ?? backpackId}</span>
      <span className="ml-1">（特種背包製作產物）</span>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

/** split 要與頁面本體的分欄判斷一致，否則載入完會從窄版跳成寬版。 */
function LoadingSkeleton({ split }: { split: boolean }) {
  const block = 'bg-bg-card rounded-xl animate-pulse'
  return (
    <div className={`${split ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl`}>
      <div className="h-4 w-28 bg-bg-card rounded animate-pulse mb-6" />
      <div className={split ? 'flex flex-col gap-6 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)]' : 'flex flex-col gap-6'}>
        <div className="flex flex-col gap-4">
          <div className={`h-36 ${block}`} />
          <div className={`h-40 ${block}`} />
        </div>
        {split && (
          <div className="flex flex-col gap-3">
            <div className={`h-24 ${block}`} />
            <div className={`h-36 ${block}`} />
            <div className={`h-24 ${block}`} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WeaponDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: weapon, loading, error } = useWeapon(id)
  const { data: weapons } = useWeapons()
  const { data: pilotMap } = usePilotBriefMap()

  // ── B-1 進階鏈：母武器（前置）＋子武器（可進階為）＋融合/進階技能差集 ──────────
  const byId = useMemo(() => new Map(weapons.map((w) => [w.id, w])), [weapons])
  const index = useMemo(() => buildUpgradeIndex(weapons), [weapons])
  const parent = weapon?.upgrade?.fromWeaponId ? byId.get(weapon.upgrade.fromWeaponId) ?? null : null
  const children = useMemo(
    () => (weapon ? (index.childrenOf.get(weapon.id) ?? []).map((cid) => byId.get(cid)).filter(Boolean) as Weapon[] : []),
    [weapon, index, byId],
  )

  // ── 同類專武（2026-10-11）：專武常被混搭，看這把的人會想比較同種類的其他專武 ──────────
  // 只在專武頁顯示（站長決定）；不列自己。從已載入的 weapons 篩，不多讀任何集合。
  // 依文件 id 排序＝依建檔流水號（weapon_101_ < weapon_158_），也就是大致的登場順序
  const sameKindExclusives = useMemo(
    () => (weapon?.isExclusive
      ? weapons
          .filter((w) => w.isExclusive && w.kind === weapon.kind && w.id !== weapon.id)
          .sort((a, b) => a.id.localeCompare(b.id))
      : []),
    [weapon, weapons],
  )

  // PLAN-032：技能雙格式，一律先解析再用。技能庫載入中時 map 為空，引用格式會解析成 0 筆——
  // 故下方技能區的顯示 gate 接在 skills（解析後）而非 weapon.skills 上。
  // loading 一定要接進頁面 gate：只解構 data 的話，技能庫還沒到（或抓取失敗）時
  // 整頁照常渲染、但「武器技能」區塊整塊不存在，使用者看不出那是載入中還是真的沒技能。
  const { data: skillMap, loading: skillsLoading } = useWeaponSkillMap()
  const skills = useMemo(() => resolveWeaponSkills(weapon?.skills, skillMap), [weapon, skillMap])

  /** 相對於母武器新增的技能名（融合或進階帶來的），供技能列表標示。 */
  const fusedSkillNames = useMemo(() => {
    if (!weapon || !parent) return new Set<string>()
    return new Set(
      deriveFusedSkillNames(
        skills.map((s) => s.name),
        // 母武器也要解析——它可能與子武器不同格式（flip 是逐把武器進行的）。
        // 比對用的是技能「名稱」，故兩邊解析後才具可比性。
        resolveWeaponSkills(parent.skills, skillMap).map((s) => s.name),
      ),
    )
  }, [weapon, parent, skills, skillMap])

  // 骨架屏的分欄猜測：技能庫還沒到時只看得到原始 skills 筆數，與本體用的解析後筆數只在引用全數失效時才會不同
  if (loading || skillsLoading) {
    return (
      <LoadingSkeleton
        split={!weapon || (weapon.skills?.length ?? 0) > 0 || weapon.isExclusive || !!weapon.fixedMod?.planName || !!weapon.floatingMod?.planName}
      />
    )
  }

  if (error || !weapon) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
        <Link to="/weapons" className="text-accent-cyan hover:underline text-sm">← 返回武器圖鑑</Link>
        <div className="mt-8 bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          {error ? `載入失敗：${error.message}` : '找不到此武器'}
        </div>
      </div>
    )
  }

  const pilot       = weapon.exclusiveFor ? pilotMap[weapon.exclusiveFor] : undefined
  const hasFixedMod = !!(weapon.fixedMod?.planName)
  const hasFloatMod = !!(weapon.floatingMod?.planName)
  const hasSlots    = weapon.triggerSlots > 0 || weapon.effectSlots > 0 || weapon.componentLimit > 0

  /**
   * B-2 基礎屬性：先列成資料再過濾，不寫成八個 JSX 條件式——
   * 收掉的欄位還要拿來組說明句（variableStatNote），兩邊必須來自同一份清單才不會說謊。
   * keys 對齊 Weapon 的欄位名；射程是 minRange + maxRange 合成的單一格，故整組判斷。
   */
  const statCells: { keys: string[]; label: string; value: React.ReactNode; sub?: string }[] = [
    { keys: ['attack'],    label: '攻擊力', value: naOr(weapon, 'attack', weapon.attack) },
    { keys: ['accuracy'],  label: '命中',   value: naOr(weapon, 'accuracy', weapon.accuracy.toLocaleString()) },
    { keys: ['critValue'], label: '暴擊',   value: naOr(weapon, 'critValue', weapon.critValue.toLocaleString()) },
    { keys: ['weight'],    label: '重量',   value: naOr(weapon, 'weight', weapon.weight) },
    {
      keys: ['minRange', 'maxRange'],
      label: '射程',
      value: naOr(weapon, ['minRange', 'maxRange'], formatRange(weapon)),
      /* 射程不適用時連射程型態一起收掉——否則會出現「射程 — / 菱形」這種半真半假的組合 */
      sub: isNaStat(weapon, ['minRange', 'maxRange']) ? undefined : RANGE_TYPE_LABELS[weapon.rangeType],
    },
    { keys: ['ammoCount'],       label: '彈藥量',   value: naOr(weapon, 'ammoCount', weapon.ammoCount === 0 ? '∞' : weapon.ammoCount) },
    { keys: ['hitCount'],        label: '連擊數',   value: naOr(weapon, 'hitCount', weapon.hitCount) },
    { keys: ['kindCoefficient'], label: '種類係數', value: naOr(weapon, 'kindCoefficient', weapon.kindCoefficient.toFixed(2)) },
  ]
  const visibleStats    = statCells.filter((c) => !isVariableStat(weapon, c.keys))
  const variableStatMsg = variableStatNote(statCells.filter((c) => isVariableStat(weapon, c.keys)).map((c) => c.label))

  // 分欄條件：右欄（技能＋同類專武＋改裝）有內容才分。無技能武器（全站約一半，A/B/S 為主）內容本來就短，
  // 分欄只會留下一整欄空白，故退回窄版單欄。⚠ LoadingSkeleton 的 split 要跟著這裡改。
  const split = skills.length > 0 || sameKindExclusives.length > 0 || hasFixedMod || hasFloatMod

  return (
    <div className={`${split ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl`}>

      {/* Breadcrumb：上一頁就是圖鑑時回到原本捲到的位置（BackToListLink） */}
      <div className="mb-6">
        <BackToListLink to="/weapons" className="text-accent-cyan hover:underline text-sm">
          ← 返回武器圖鑑
        </BackToListLink>
      </div>

      {/*
        版面（2026-10-11）：桌面左欄放身分＋規格（sticky）、右欄整欄給武器技能；手機單欄、技能排第二。
        左欄 wrapper 在手機是 display:contents——子項目直接成為外層 flex 的項目，才能用 order 把技能
        插到身分卡與屬性之間，不必把左欄拆成兩份。lg 起恢復成一般 flex 欄，子項目 order 歸零回 DOM 順序。
        sticky top-16：讓開 Layout 的 h-12 sticky header 再留 1rem。只在視窗高 ≥ 900px 才固定——
        左欄最高約 730px（複合武器＋進階鏈），矮螢幕上左欄比視窗高時，sticky 會把底部的進階鏈
        卡在畫面外、要捲到頁尾才放出來，不如不固定。
        左欄寬用 rem 不用 px：本站 root font-size 是 19px，寫死 px 的欄寬裝 rem 尺寸的內文會擠到換行。
      */}
      <div className={split ? 'flex flex-col gap-6 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start' : 'flex flex-col gap-6'}>

        <div className={split ? 'contents lg:flex lg:flex-col lg:gap-4 lg:[@media(min-height:900px)]:sticky lg:[@media(min-height:900px)]:top-16' : 'contents'}>

          {/* ── B-1 Hero ─────────────────────────────────────────────────────── */}
          <div className="order-1 lg:order-none bg-bg-card border border-border rounded-xl p-5">
            <div className="flex items-start gap-4">
              <WeaponIcon gameId={weapon.gameId} icon={weapon.icon} name={weapon.name} size="lg" isExclusive={weapon.isExclusive} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-3 flex-wrap mb-3">
                  <h1 className="text-2xl font-bold text-text-primary leading-tight">{weapon.name}</h1>
                  <WeaponRarityBadge rarity={weapon.rarity} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <WeaponTypeBadge type={weapon.type} />
                  <span className="px-2 py-0.5 rounded text-[13px] border text-text-secondary bg-bg-dark border-border">
                    {weapon.kind}
                  </span>
                  <WeaponEquipSlotBadge slot={weapon.equipSlot} />
                  <WeaponMechRestrictionBadge restriction={weapon.mechRestriction} />
                  {isCompositeWeapon(weapon) && <CompositeBadge />}
                  {weapon.isFixedArmament && <FixedArmamentBadge />}
                </div>

                {weapon.isExclusive && pilot && weapon.exclusiveFor && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[13px] text-accent-yellow font-bold">⭐ 專屬武器</span>
                    <ExclusivePilotLink
                      pilotId={weapon.exclusiveFor}
                      pilot={pilot}
                      size="md"
                    />
                  </div>
                )}

                {weapon.isFixedArmament && <FixedArmamentHostLine weaponId={weapon.id} />}
              </div>
            </div>
          </div>

          {/* ── B-2 Stats ＋ B-5 Component Slots ─────────────────────────────── */}
          {/* 元件插槽是次要資訊，併成屬性卡底部一行，不再獨立一張卡 */}
          <div className="order-3 lg:order-none bg-bg-card border border-border rounded-xl p-5">
            <SectionHeading>基礎屬性</SectionHeading>
            {visibleStats.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {visibleStats.map((c) => (
                  <StatCell key={c.label} label={c.label} value={c.value} sub={c.sub} />
                ))}
              </div>
            )}
            {/* 收掉的格子必須有交代，否則看起來像資料沒建完 */}
            {variableStatMsg && (
              <p className={`text-[13px] text-text-dim leading-relaxed ${visibleStats.length ? 'mt-3' : ''}`}>
                {variableStatMsg}
              </p>
            )}

            {hasSlots && (
              <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
                <span className="text-text-dim">元件插槽</span>
                <SlotBoxes label="觸發" count={weapon.triggerSlots} colorClass="border-accent-orange" />
                <SlotBoxes label="應用" count={weapon.effectSlots} colorClass="border-accent-cyan" />
                {weapon.componentLimit > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-text-secondary">上限</span>
                    <span className="font-bold text-accent-red font-[JetBrains_Mono,monospace]">{weapon.componentLimit}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── B-1 進階鏈（PLAN-031）：前置／可進階為 ──────────────────────────── */}
          {/* 直式兩行配合窄欄；「本武器」就是這一頁、身分卡已經寫了，不再畫成鏈中間那顆 chip */}
          {(parent || children.length > 0) && (
            <div className="order-4 lg:order-none bg-bg-card border border-border rounded-xl p-5">
              <SectionHeading>製作 · 進階關係</SectionHeading>
              <dl className="space-y-2">
                {parent && (
                  <div className="flex items-start gap-3">
                    <dt className="w-16 shrink-0 pt-1.5 text-xs text-text-dim">前置</dt>
                    <dd className="flex flex-wrap gap-2 min-w-0">
                      <WeaponHoverLink weapon={parent} />
                    </dd>
                  </div>
                )}
                {children.length > 0 && (
                  <div className="flex items-start gap-3">
                    <dt className="w-16 shrink-0 pt-1.5 text-xs text-text-dim">可進階為</dt>
                    <dd className="flex flex-wrap gap-2 min-w-0">
                      {children.map((c) => (
                        <WeaponHoverLink key={c.id} weapon={c} />
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
              {isCompositeWeapon(weapon) && weapon.upgrade?.fusedBackpackId && (
                <FusedBackpackNote backpackId={weapon.upgrade.fusedBackpackId} />
              )}
            </div>
          )}
        </div>

        {split && (
          <div className="order-2 lg:order-none min-w-0 space-y-6">

            {/* ── B-3 Skills ─────────────────────────────────────────────────── */}
            {skills.length > 0 && (
              <div>
                <SectionHeading>武器技能</SectionHeading>
                <div className="space-y-3">
                  {skills.map((skill, i) => (
                    <WeaponSkillCard
                      key={i}
                      skill={skill}
                      fusedLabel={
                        fusedSkillNames.has(skill.name)
                          ? isCompositeWeapon(weapon) ? '融合技能' : '進階新增'
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── 同類專武：滑過看技能、點擊前往（手機點擊開底部面板）────────────── */}
            {sameKindExclusives.length > 0 && (
              <div>
                <SectionHeading>{`同類專武 · ${weapon.kind}`}</SectionHeading>
                <div className="bg-bg-card border border-border rounded-xl p-4 flex flex-wrap gap-2">
                  {sameKindExclusives.map((w) => (
                    <WeaponHoverLink
                      key={w.id}
                      weapon={w}
                      sub={w.exclusiveFor ? pilotMap[w.exclusiveFor]?.name : undefined}
                      hideRarity
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── B-4 Mods ───────────────────────────────────────────────────── */}
            {(hasFixedMod || hasFloatMod) && (
              <div>
                <SectionHeading>改裝資訊</SectionHeading>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {hasFixedMod && (
                    <div className="bg-bg-card border border-border rounded-xl p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="text-[11px] text-accent-orange font-bold tracking-widest uppercase font-[Orbitron,sans-serif]">
                          固定改裝
                        </span>
                        <span className="text-sm font-bold text-text-primary">{weapon.fixedMod.planName}</span>
                      </div>
                      <div className="text-[13px] text-text-dim mb-3">
                        可改等級上限{' '}
                        <span className="text-accent-red font-bold font-[JetBrains_Mono,monospace]">
                          {weapon.fixedMod.maxLevel}
                        </span>
                      </div>
                      {weapon.fixedMod.effects.length > 0 && (
                        <div className="space-y-2">
                          {weapon.fixedMod.effects.map((e, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span className="text-text-secondary">{MOD_STAT_LABELS[e.stat] ?? e.stat}</span>
                              <span className="text-accent-red font-bold font-[JetBrains_Mono,monospace]">
                                +{e.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {hasFloatMod && (
                    <div className="bg-bg-card border border-border rounded-xl p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="text-[11px] text-accent-cyan font-bold tracking-widest uppercase font-[Orbitron,sans-serif]">
                          浮動改裝
                        </span>
                        <span className="text-sm font-bold text-text-primary">{weapon.floatingMod.planName}</span>
                      </div>
                      <div className="text-[13px] text-text-dim mb-3">
                        可填{' '}
                        <span className="text-accent-red font-bold font-[JetBrains_Mono,monospace]">
                          {weapon.floatingMod.slots}
                        </span>{' '}
                        個效果
                      </div>
                      {weapon.floatingMod.possibleEffects.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[13px]">
                            <thead>
                              <tr className="text-text-dim border-b border-border">
                                <th className="text-left pb-2 font-medium">效果</th>
                                <th className="text-left pb-2 font-medium">條件</th>
                                <th className="text-right pb-2 font-medium">數值範圍</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {weapon.floatingMod.possibleEffects.map((e, i) => (
                                <tr key={i} className="hover:bg-bg-dark/50 transition-colors">
                                  <td className="py-1.5 text-text-secondary">
                                    {MOD_STAT_LABELS[e.stat] ?? e.stat}
                                  </td>
                                  <td className="py-1.5 text-text-dim">
                                    {e.condition ?? '無條件'}
                                  </td>
                                  <td className="py-1.5 text-right font-bold text-accent-red font-[JetBrains_Mono,monospace]">
                                    {e.min} ~ {e.max}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
