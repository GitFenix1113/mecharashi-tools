import { useState, useLayoutEffect, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useBackpacks } from '../../hooks/useFirestore'
import { useGameData } from '../../contexts/GameDataContext'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useDragOffset } from '../../hooks/useDragOffset'
import {
  BACKPACK_TYPE_CONFIG,
  ASSEMBLABLE_ARMOR_CONFIG,
  BackpackTypeBadge,
  AssemblableArmorTypeBadge,
  BackpackIcon,
} from '../../components/BackpackBadges'
import { WeaponRarityBadge } from '../../components/WeaponRarityBadge'
import { WeaponIcon } from '../../components/WeaponIcon'
import { EQUIP_SLOT_LABELS } from '../../components/WeaponBadges'
import { resolveWeaponSkills, type ResolvedWeaponSkill } from '../../utils/weaponSkills'
import { assetUrl, resolveIconSrc } from '../../utils/assets'
import { STAT_LABELS } from '../../utils/moduleStats'
import { RefText } from '../../components/RefText'
import {
  resolveBackpackSkills,
  buildBackpackSkillMap,
  type ResolvedBackpackSkill,
} from '../../utils/backpackSkills'
import {
  isCompositeWeapon,
  projectedBackpackType,
  weaponArmorTypes,
  type BackpackListItem,
} from '../../utils/weaponUpgrade'
import {
  tierFromRarity,
  parseBackpackName,
  backpackAbility,
  blueprintName,
  TIER_LABELS,
  TIER_ORDER,
  DEFAULT_TIERS,
  type BackpackTier,
  type BackpackLine,
} from '../../utils/backpackClassify'
import type { Backpack, Weapon } from '../../types'

const ALL_BACKPACK_TYPES = [
  'Heal', 'Ammo', 'Interference', 'Invisible', 'BackupEquipment',
  'MovePointAdd', 'Flow', 'Radar', 'EMP', 'Enhance', 'PowerAdd',
]
const RARITY_ORDER: Record<string, number> = { SS: 0, 'S+': 1, S: 2, A: 3, B: 4 }

// 合併列表條目的取值輔助（背包 / 投影武器共用篩選邏輯）
const itemId = (it: BackpackListItem) => it.data.id
const itemRarity = (it: BackpackListItem) => it.data.rarity
// 合成階層 ＝ rarity 的粗化（PLAN-035 決策三：階層 facet 取代稀有度多選）
const itemTier = (it: BackpackListItem): BackpackTier | null => tierFromRarity(it.data.rarity)

function Num({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-accent-red font-bold font-[JetBrains_Mono,monospace] ${className}`}>
      {children}
    </span>
  )
}

/**
 * 背包側技能圖示（PLAN-031 陷阱：武器技能圖示走另一路徑，見下）。
 *
 * ⚠ PLAN-043 修正：原本是「取檔名 → 拼回 /images/skills/{filename}」。那個寫法會把
 * `/images/skills/背包技能/x.png` 的資料夾剝掉，接著 normalizeSkillPath 依 `passive`
 * 前綴把它推去「被動技能/」——結果不是 404 就是指到同名但不同來源的圖。
 * 改走 resolveIconSrc：它保留明確寫出的已知子資料夾，扁平舊路徑仍會依前綴推導。
 */
function SkillIcon({ icon, name }: { icon?: string; name: string }) {
  const [err, setErr] = useState(false)
  if (err || !icon) {
    return (
      <div className="w-9 h-9 rounded-lg bg-bg-dark border border-border flex items-center justify-center text-text-dim text-xs flex-shrink-0">
        技
      </div>
    )
  }
  return (
    <img
      src={resolveIconSrc(icon)}
      alt={name}
      className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
      onError={() => setErr(true)}
    />
  )
}

/** 武器技能圖示：iconLocal 已是 /images/weapons/skills/... 完整路徑，直接用（不可套背包側 SkillIcon）。 */
function WeaponSkillMiniIcon({ iconLocal, name }: { iconLocal?: string; name: string }) {
  const [err, setErr] = useState(false)
  if (err || !iconLocal) {
    return (
      <div className="w-9 h-9 rounded-lg bg-bg-dark border border-border flex items-center justify-center text-text-dim text-xs flex-shrink-0">
        技
      </div>
    )
  }
  return (
    <img
      src={assetUrl(iconLocal)}
      alt={name}
      className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
      onError={() => setErr(true)}
    />
  )
}

/** 「特種背包製作」小標籤（複合武器投影條目用）。 */
function CraftBadge() {
  return (
    <span className="text-[11px] font-bold text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30 rounded px-1.5 py-0.5">
      特種背包製作
    </span>
  )
}

// ── 背包浮窗內容（既有，未動）────────────────────────────────────────────────────
function BackpackTooltipContent({ bp, skills, prereqName, pinned = false }: {
  bp: Backpack
  /** PLAN-043：已解析（含 @N 等級覆寫）的掛載技能 */
  skills: ResolvedBackpackSkill[]
  prereqName?: string
  pinned?: boolean
}) {
  const armorLabel =
    bp.assemblableArmorType.length === 0
      ? '無限制'
      : bp.assemblableArmorType
          .map((t) => ASSEMBLABLE_ARMOR_CONFIG[t]?.label ?? t)
          .join('、')

  return (
    <>
      <div
        data-drag-handle
        className={`flex items-start gap-3 mb-3 flex-shrink-0 ${pinned ? 'cursor-move select-none' : ''}`}
        title={pinned ? '拖曳標題可移動視窗' : undefined}
      >
        <BackpackIcon icon={bp.icon} name={bp.name} rarity={bp.rarity} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <div className="font-bold text-sm text-text-primary leading-tight">{bp.name}</div>
            <WeaponRarityBadge rarity={bp.rarity} className="px-2" />
          </div>
          <div className="mt-1">
            <BackpackTypeBadge type={bp.type} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="bg-bg-dark rounded-lg p-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-text-dim">重量</span>
            <Num className="text-[14px]">{bp.weight}</Num>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-text-dim">部位</span>
            <span className="text-[14px] text-text-secondary">{EQUIP_SLOT_LABELS[bp.slot] ?? bp.slot}</span>
          </div>
          {bp.repairAmount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-text-dim">修理量</span>
              <Num className="text-[14px]">{bp.repairAmount}</Num>
            </div>
          )}
          <div className="flex items-center gap-1.5 col-span-2">
            <span className="text-[13px] text-text-dim">裝備限制</span>
            <span className="text-[14px] text-text-secondary">{armorLabel}</span>
          </div>
        </div>

        {/* PLAN-036：SS 特種背包製作提示（圖紙＝name+設計圖；衍生自 前置主背包，有 craft 才顯示） */}
        {bp.rarity === 'SS' && (
          <div className="bg-bg-dark rounded-lg p-2.5 text-[13px] text-text-secondary space-y-1">
            <div>製作圖紙 · <span className="text-text-primary">{blueprintName(bp)}</span></div>
            {bp.craft?.prereqBackpackId
              ? (prereqName
                  ? <div>衍生自 <span className="text-text-primary">{prereqName}</span></div>
                  : <div className="text-text-dim">前置主背包待確認</div>)
              : <div className="text-text-dim">前置主背包未設定</div>}
          </div>
        )}

        {/* PLAN-043：掛載技能（可多個；階梯技能顯示該級的階名與正文） */}
        {skills.map((sk) => (
          <div key={sk.raw} className="bg-bg-dark rounded-lg overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border flex items-center gap-2">
              <SkillIcon icon={sk.icon} name={sk.name} />
              <span className="text-[13px] font-bold text-text-primary">{sk.name}</span>
              <span className="text-[11px] text-text-dim ml-auto shrink-0">{sk.doc.skillType}</span>
            </div>
            <div className="p-2.5 space-y-2">
              <p className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-line">
                <RefText text={sk.description} refs={sk.descriptionRefs} />
              </p>
              {/* 結構化數值（管理員手填的 effects）。舊格式那四個平坦欄位在正式庫實測 0/22
                  有值，已於 PLAN-043 遷移時確認無資料遺失，故此處只渲染新格式。 */}
              {sk.effects.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {sk.effects.map((ef, i) => (
                    <span key={i} className="text-[14px] text-text-dim">
                      {STAT_LABELS.find((s) => s.key === ef.stat)?.label ?? ef.stat}{' '}
                      <Num className="text-[14px]">{ef.value > 0 ? '+' : ''}{ef.value}</Num>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* PLAN-043：背包風味文案（遊戲內卡片下方的灰字敘述） */}
        {bp.flavor && (
          <p className="text-[12px] text-text-dim leading-relaxed px-0.5">{bp.flavor}</p>
        )}
      </div>
    </>
  )
}

// ── 複合武器投影浮窗內容（PLAN-031 B-2）──────────────────────────────────────────
function WeaponProjectionContent({ w, skills, parentName, fusedBackpackName, onNavigate }: {
  w: Weapon
  /** PLAN-032：已解析的武器技能（雙格式攤平後） */
  skills: ResolvedWeaponSkill[]
  parentName?: string
  fusedBackpackName?: string
  onNavigate?: () => void
}) {
  const stats: Array<{ label: string; value: string }> = [
    { label: '攻擊力', value: w.attack.toLocaleString() },
    { label: '命中', value: w.accuracy.toLocaleString() },
    { label: '暴擊', value: w.critValue.toLocaleString() },
    { label: '重量', value: w.weight.toString() },
  ]
  return (
    <>
      <div data-drag-handle className="flex items-start gap-3 mb-3 flex-shrink-0">
        <WeaponIcon icon={w.icon} name={w.name} size="lg" isExclusive={w.isExclusive} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <div className="font-bold text-sm text-text-primary leading-tight">{w.name}</div>
            <WeaponRarityBadge rarity={w.rarity} className="px-2" />
          </div>
          <div className="text-[13px] text-text-dim mt-0.5">{w.type} · {w.kind}</div>
          <div className="mt-1"><CraftBadge /></div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="bg-bg-dark rounded-lg p-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
          {stats.map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="text-[13px] text-text-dim">{label}</span>
              <Num className="text-[14px]">{value}</Num>
            </div>
          ))}
        </div>

        <div className="bg-bg-dark rounded-lg p-2.5 text-[13px] text-text-secondary space-y-1">
          {parentName && <div>特種背包製作產物 · 衍生自 <span className="text-text-primary">{parentName}</span></div>}
          {fusedBackpackName
            ? <div>融合自 <span className="text-text-primary">{fusedBackpackName}</span></div>
            : <div className="text-text-dim">融合背包待確認</div>}
        </div>

        {/* gate 接解析後的陣列：w.skills.length 對 union 恆真，技能庫未載入時會渲染空框 */}
        {skills.length > 0 && (
          <div className="bg-bg-dark rounded-lg overflow-hidden">
            <div className="px-2.5 py-1.5 border-b border-border">
              <span className="text-[13px] text-text-dim tracking-widest uppercase">武器技能</span>
            </div>
            <div className="flex flex-wrap gap-2 p-2.5">
              {skills.map((sk, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <WeaponSkillMiniIcon iconLocal={sk.iconLocal} name={sk.name} />
                  <span className="text-[11px] text-text-secondary max-w-24 leading-tight">{sk.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Link
          to={`/weapons/${w.id}`}
          className="block text-center text-sm text-accent-orange hover:underline pt-1"
          onClick={onNavigate}
        >
          查看武器詳情 →
        </Link>
      </div>
    </>
  )
}

function BackpackTooltip({ bp, skills, prereqName, pinned }: {
  bp: Backpack
  skills: ResolvedBackpackSkill[]
  prereqName?: string
  pinned: boolean
}) {
  // 任一技能（含其指定級）有引用就顯示提示——只看第一個會讓多技能背包漏提示
  const hasRefs = skills.some((sk) => Object.keys(sk.descriptionRefs ?? {}).length > 0)
  return (
    <div className="w-80 max-h-[min(90vh,_600px)] flex flex-col bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl">
      <div className="flex-1 min-h-0 overflow-y-auto p-1">
        <BackpackTooltipContent bp={bp} skills={skills} prereqName={prereqName} pinned={pinned} />
      </div>
      {hasRefs && (
        <p className="text-[13px] text-text-dim mt-2 text-center flex-shrink-0">
          {pinned ? '📌 點擊引用查看詳情' : '點擊背包固定此視窗以查看引用'}
        </p>
      )}
    </div>
  )
}

interface TooltipState {
  itemId: string
  x: number
  anchorTop: number
}

function TooltipPortal({ item, pinned, x, anchorTop, parentName, fusedBackpackName, prereqName, skills, weaponSkills }: {
  item: BackpackListItem
  pinned: boolean
  x: number
  anchorTop: number
  parentName?: string
  fusedBackpackName?: string
  prereqName?: string
  /** PLAN-043：已解析的掛載技能（僅 kind==='backpack' 時有意義） */
  skills: ResolvedBackpackSkill[]
  /** PLAN-032：已解析的武器技能（僅 kind==='weapon' 時有意義） */
  weaponSkills: ResolvedWeaponSkill[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorTop)
  const { offset, dragging, dragHandlers } = useDragOffset(pinned, itemId(item))

  useLayoutEffect(() => {
    if (!ref.current) return
    const h = ref.current.offsetHeight
    setTop(Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)))
  }, [anchorTop, item])

  return createPortal(
    <div
      ref={ref}
      className={`fixed z-50 ${pinned ? 'pointer-events-auto' : 'pointer-events-none'} ${dragging ? 'select-none' : ''}`}
      style={{ left: x + offset.dx, top: top + offset.dy, touchAction: pinned ? 'none' : undefined }}
      onClick={(e) => e.stopPropagation()}
      {...(pinned ? dragHandlers : {})}
    >
      {item.kind === 'backpack' ? (
        <BackpackTooltip bp={item.data} skills={skills} prereqName={prereqName} pinned={pinned} />
      ) : (
        <div className="w-80 max-h-[min(90vh,_600px)] flex flex-col bg-bg-tooltip border border-border-accent rounded-xl p-4 shadow-2xl">
          <div className="flex-1 min-h-0 overflow-y-auto p-1">
            <WeaponProjectionContent w={item.data} skills={weaponSkills} parentName={parentName} fusedBackpackName={fusedBackpackName} />
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

export default function BackpacksPage() {
  const { data: backpacks, loading } = useBackpacks()
  const { weapons, backpackSkills, pilotSkills, ensureLoaded, loadedKeys } = useGameData()
  const navigate = useNavigate()

  // PLAN-043：技能本體改由 backpackSkills 集合提供（22 筆，有版本快取，回訪 0 read）
  useEffect(() => { void ensureLoaded(['backpackSkills']) }, [ensureLoaded])
  // 一次算完全部（180 筆 × 各 0–1 個技能，成本可忽略）。
  // 刻意不做「render 期間才算、算完存進閉包 Map」的惰性快取——那會在 render 中變異狀態。
  const skillsById = useMemo(() => {
    const map = buildBackpackSkillMap(backpackSkills)
    return new Map(backpacks.map((bp) => [bp.id, resolveBackpackSkills(bp, map)]))
  }, [backpacks, backpackSkills])
  const skillsOf = (bp: Backpack): ResolvedBackpackSkill[] => skillsById.get(bp.id) ?? []

  // PLAN-032：武器技能同樣一次算完（本頁武器數量是個位數）。形制沿用上方 skillsById。
  const weaponSkillsById = useMemo(() => {
    const map = new Map(pilotSkills.map((sk) => [sk.id, sk]))
    return new Map(weapons.map((w) => [w.id, resolveWeaponSkills(w.skills, map)]))
  }, [weapons, pilotSkills])
  const weaponSkillsOf = (w: Weapon): ResolvedWeaponSkill[] => weaponSkillsById.get(w.id) ?? []

  const [search, setSearch]               = useState('')
  // 合成階層多選；PLAN-037 預設只顯示特種(SS)，查詢量小 → 不再分頁限制
  const [tierFilters, setTierFilters]     = useState<Set<BackpackTier>>(new Set(DEFAULT_TIERS))
  const [typeFilters, setTypeFilters]     = useState<Set<string>>(new Set())
  const [armorFilter, setArmorFilter]     = useState<string | null>(null)
  const [lineFilter, setLineFilter]       = useState<BackpackLine | null>(null)  // 強化/干擾 軸
  const [abilityFilter, setAbilityFilter] = useState<string | null>(null)        // 能力子篩選（僅選線後可用）
  const [includeWeapons, setIncludeWeapons] = useState(true)  // PLAN-037「包含武器」預設開（納入特殊強化武器）

  // 「包含武器」預設開 → 進頁即載入 weapons（複合武器僅 3 把但需整包才能篩；有版本快取，回訪 0 read）
  //
  // PLAN-032：一併載入 pilotSkills（＝技能庫，武器技能引用化後的技能本體所在）。
  // ⚠ 這是本頁新增的讀取量（冷快取 ~646 read），刻意綁在 includeWeapons 這個既有開關上——
  //   關掉「包含武器」的使用者一筆都不付。不能只在 tooltip 內載入：
  //   下方搜尋是**跨全部武器比對技能正文**的，那條路徑在頁面層，缺了技能庫會靜默搜不到。
  useEffect(() => { if (includeWeapons) void ensureLoaded(['weapons', 'pilotSkills']) }, [includeWeapons, ensureLoaded])
  // PLAN-032：技能庫也算進去。下方搜尋會比對「解析後」的武器技能正文，
  // pilotSkills 還沒到時每把武器都解析成空陣列 → 技能正文搜尋恆不命中。
  // 只看 weapons 的話，「載入武器中…」提示會在技能庫到齊前就消失，
  // 使用者會以為搜尋結果已完整。
  const weaponsLoading = includeWeapons && (!loadedKeys.has('weapons') || !loadedKeys.has('pilotSkills'))

  // 能力清單依資料 derive（不硬編，避免改版漏改）；依所選線收斂
  const abilitiesByLine = useMemo(() => {
    const map: Record<BackpackLine, string[]> = { 強化: [], 干擾: [] }
    const seen: Record<BackpackLine, Set<string>> = { 強化: new Set(), 干擾: new Set() }
    for (const bp of backpacks) {
      const { line, variant } = parseBackpackName(bp.name)
      if (line && variant && !seen[line].has(variant)) { seen[line].add(variant); map[line].push(variant) }
    }
    return map
  }, [backpacks])

  // 選線 / 清線時一併重置能力（能力只在某條線下有意義）
  const pickLine = (line: BackpackLine | null) => { setLineFilter(line); setAbilityFilter(null) }

  const isMobile = useIsMobile()
  const [hoverTooltip, setHoverTooltip] = useState<TooltipState | null>(null)
  const [pinnedTooltip, setPinnedTooltip] = useState<TooltipState | null>(null)
  const [sheetItem, setSheetItem] = useState<BackpackListItem | null>(null)

  const backpackById = useMemo(() => new Map(backpacks.map((b) => [b.id, b])), [backpacks])
  const weaponById = useMemo(() => new Map(weapons.map((w) => [w.id, w])), [weapons])

  // 母武器名 / 融合背包名（供投影浮窗顯示「衍生自 ○○」「融合自 ○○」）
  const parentNameOf = (w: Weapon) => (w.upgrade?.fromWeaponId ? weaponById.get(w.upgrade.fromWeaponId)?.name : undefined)
  const fusedBackpackNameOf = (w: Weapon) => (w.upgrade?.fusedBackpackId ? backpackById.get(w.upgrade.fusedBackpackId)?.name : undefined)

  // PLAN-036：前置主背包名（供 SS 浮窗顯示「衍生自 ○○」）
  const prereqNameOf = (bp: Backpack) => (bp.craft?.prereqBackpackId ? backpackById.get(bp.craft.prereqBackpackId)?.name : undefined)

  function toggleSet<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) { next.delete(value) } else { next.add(value) }
      return next
    })
  }

  // 來源：全部背包 ＋（「包含武器」開時）複合武器；由階層/類型等篩選統一收斂（PLAN-037）
  const items: BackpackListItem[] = useMemo(() => [
    ...backpacks.map((bp) => ({ kind: 'backpack', data: bp } as const)),
    ...(includeWeapons ? weapons.filter(isCompositeWeapon).map((w) => ({ kind: 'weapon', data: w } as const)) : []),
  ], [backpacks, weapons, includeWeapons])

  const itemType = (it: BackpackListItem) =>
    it.kind === 'backpack' ? it.data.type : (projectedBackpackType(it.data, backpackById) ?? '')
  const itemArmor = (it: BackpackListItem) =>
    it.kind === 'backpack' ? it.data.assemblableArmorType : weaponArmorTypes(it.data)

  const filtered = items
    .filter((it) => {
      // 階層篩選（取代稀有度）：未知階層或不在選取集內即排除
      const tier = itemTier(it)
      if (!tier || !tierFilters.has(tier)) return false
      if (typeFilters.size > 0 && !typeFilters.has(itemType(it))) return false
      // 強化/干擾 + 能力（PLAN-037）：沿 craft 前置鏈取「能力」（SS/S+ 循線），
      // 只顯示能力線相符者；無能力（功能背包 / 武器 / 鏈底功能）在選線時排除。
      if (lineFilter) {
        const ability = it.kind === 'backpack' ? backpackAbility(it.data, backpackById) : { line: null, variant: null }
        if (ability.line !== lineFilter) return false
        if (abilityFilter && ability.variant !== abilityFilter) return false
      }
      const armor = itemArmor(it)
      if (armorFilter === 'none' && armor.length > 0) return false
      if (armorFilter && armorFilter !== 'none' && !armor.includes(armorFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        if (it.kind === 'backpack') {
          // PLAN-043：技能正文改由集合提供，且要吃得到階名與該級正文
          // （搜「移動強化Ⅱ」時應命中掛 @2 的背包）
          return it.data.name.toLowerCase().includes(q)
            || skillsOf(it.data).some((sk) =>
              sk.name.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q))
        }
        // PLAN-032：改比對解析後的技能——直接讀 it.data.skills 的話，引用化的武器
        // 只會拿到 { skillId, activation }，正文搜尋會靜默永遠不命中。
        return it.data.name.toLowerCase().includes(q)
          || weaponSkillsOf(it.data).some((s) => s.description.toLowerCase().includes(q))
      }
      return true
    })
    .sort((a, b) => (RARITY_ORDER[itemRarity(a)] ?? 9) - (RARITY_ORDER[itemRarity(b)] ?? 9))

  const computePos = (el: HTMLDivElement): { x: number; anchorTop: number } => {
    const rect = el.getBoundingClientRect()
    const tooltipW = 320
    const margin = 8
    const rightX = rect.right + margin
    const leftX = rect.left - tooltipW - margin
    const x = rightX + tooltipW > window.innerWidth - margin
      ? Math.max(margin, leftX)
      : rightX
    return { x: Math.max(margin, Math.min(x, window.innerWidth - tooltipW - margin)), anchorTop: rect.top }
  }

  const activeTooltip = pinnedTooltip ?? hoverTooltip
  const activeItem = activeTooltip
    ? items.find((it) => itemId(it) === activeTooltip.itemId) ?? null
    : null

  const handleCardClick = (it: BackpackListItem, el: HTMLDivElement) => {
    // 複合武器：直接導向武器詳情頁（B-1 進階鏈在那裡）；不進釘選流程
    if (it.kind === 'weapon') {
      if (isMobile) { setSheetItem(it); return }
      navigate(`/weapons/${it.data.id}`)
      return
    }
    // 背包：維持既有釘選 / BottomSheet 行為
    if (isMobile) { setSheetItem(it); return }
    if (pinnedTooltip?.itemId === it.data.id) {
      setPinnedTooltip(null)
    } else {
      setPinnedTooltip({ itemId: it.data.id, ...computePos(el) })
      setHoverTooltip(null)
    }
  }

  const filterBtn = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-pink/15 text-accent-pink border-accent-pink/40'
        : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  const typeFilterBtn = (type: string) => {
    const active = typeFilters.has(type)
    const config = BACKPACK_TYPE_CONFIG[type]
    if (active && config) return `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${config.className}`
    return filterBtn(false)
  }

  const armorFilterBtn = (key: string) => {
    const active = armorFilter === key
    const config = ASSEMBLABLE_ARMOR_CONFIG[key]
    if (active && config) return `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${config.className}`
    return filterBtn(active)
  }

  return (
    <div
      className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl"
      onClick={() => setPinnedTooltip(null)}
    >

      {activeItem && activeTooltip && !isMobile && (
        <TooltipPortal
          key={activeTooltip.itemId}
          item={activeItem}
          pinned={!!pinnedTooltip}
          x={activeTooltip.x}
          anchorTop={activeTooltip.anchorTop}
          parentName={activeItem.kind === 'weapon' ? parentNameOf(activeItem.data) : undefined}
          fusedBackpackName={activeItem.kind === 'weapon' ? fusedBackpackNameOf(activeItem.data) : undefined}
          prereqName={activeItem.kind === 'backpack' ? prereqNameOf(activeItem.data) : undefined}
          skills={activeItem.kind === 'backpack' ? skillsOf(activeItem.data) : []}
          weaponSkills={activeItem.kind === 'weapon' ? weaponSkillsOf(activeItem.data) : []}
        />
      )}

      <BottomSheet open={!!sheetItem} onClose={() => setSheetItem(null)}>
        {sheetItem && (sheetItem.kind === 'backpack'
          ? <BackpackTooltipContent bp={sheetItem.data} skills={skillsOf(sheetItem.data)} prereqName={prereqNameOf(sheetItem.data)} />
          : <WeaponProjectionContent
              w={sheetItem.data}
              skills={weaponSkillsOf(sheetItem.data)}
              parentName={parentNameOf(sheetItem.data)}
              fusedBackpackName={fusedBackpackNameOf(sheetItem.data)}
              onNavigate={() => setSheetItem(null)}
            />)}
      </BottomSheet>

      {/* Header */}
      <div className="mb-8">
        <span className="text-xs text-accent-pink tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Database
        </span>
        <h1 className="text-3xl font-bold mt-2">背包圖鑑</h1>
        <p className="text-text-secondary mt-2">
          所有背包裝備的技能效果、重量與裝配限制。共 {backpacks.length} 件背包。
        </p>
      </div>

      {/* Filters */}
      <div
        className="bg-bg-card border border-border rounded-xl p-4 mb-6 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          placeholder="搜尋背包名稱或效果描述..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-bg-dark border border-border rounded-lg px-4 py-2 text-sm text-text-primary placeholder-text-dim outline-none focus:border-border-accent"
        />

        {/* 合成階層 – multi-select（取代稀有度；預設隱藏素材 A/B）*/}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">階層</span>
          <button
            className={filterBtn(tierFilters.size === TIER_ORDER.length)}
            onClick={() => setTierFilters(new Set(TIER_ORDER))}
          >
            全部
          </button>
          {TIER_ORDER.map((t) => (
            <button key={t} className={filterBtn(tierFilters.has(t))} onClick={() => toggleSet(setTierFilters, t)}>
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Type – multi-select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">類型</span>
          <button className={filterBtn(typeFilters.size === 0)} onClick={() => setTypeFilters(new Set())}>全部</button>
          {ALL_BACKPACK_TYPES.map((t) => (
            <button key={t} className={typeFilterBtn(t)} onClick={() => toggleSet(setTypeFilters, t)}>
              {BACKPACK_TYPE_CONFIG[t]?.label ?? t}
            </button>
          ))}
        </div>

        {/* 強化 / 干擾 軸 – single-select（PLAN-037：沿 craft 前置鏈取能力，SS/S+ 循線）*/}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 flex-shrink-0">強化/干擾</span>
          <button className={filterBtn(!lineFilter)} onClick={() => pickLine(null)}>全部</button>
          {(['強化', '干擾'] as const).map((ln) => (
            <button key={ln} className={filterBtn(lineFilter === ln)} onClick={() => pickLine(lineFilter === ln ? null : ln)}>
              {ln}
            </button>
          ))}
          {lineFilter && (
            <span className="text-[11px] text-text-dim">（沿前置鏈比對，含特種/複合）</span>
          )}
        </div>

        {/* 能力 – single-select，依所選線收斂；未選線時不顯示（PLAN-037：原「變體」）*/}
        {lineFilter && abilitiesByLine[lineFilter].length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">能力</span>
            <button className={filterBtn(!abilityFilter)} onClick={() => setAbilityFilter(null)}>全部</button>
            {abilitiesByLine[lineFilter].map((v) => (
              <button key={v} className={filterBtn(abilityFilter === v)} onClick={() => setAbilityFilter(abilityFilter === v ? null : v)}>
                {v}
              </button>
            ))}
          </div>
        )}

        {/* Armor – single-select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">裝備</span>
          <button className={filterBtn(!armorFilter)} onClick={() => setArmorFilter(null)}>全部</button>
          <button className={filterBtn(armorFilter === 'none')} onClick={() => setArmorFilter(armorFilter === 'none' ? null : 'none')}>
            無限制
          </button>
          {Object.entries(ASSEMBLABLE_ARMOR_CONFIG).map(([key]) => (
            <button key={key} className={armorFilterBtn(key)} onClick={() => setArmorFilter(armorFilter === key ? null : key)}>
              {ASSEMBLABLE_ARMOR_CONFIG[key].label}
            </button>
          ))}
        </div>

        {/* 包含武器 – 正交 toggle（PLAN-037，原「特種背包製作」）：預設開，納入特殊強化武器 */}
        <div className="flex flex-wrap gap-1.5 items-center pt-1 border-t border-border">
          <span className="text-xs text-text-dim mr-1 w-10 flex-shrink-0">武器</span>
          <button
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              includeWeapons
                ? 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/40'
                : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
            }`}
            onClick={() => setIncludeWeapons((v) => !v)}
          >
            包含武器{includeWeapons ? ' ✓' : ''}
          </button>
          <span className="text-[11px] text-text-dim">
            {includeWeapons ? '已納入特殊強化武器（裁決者等），與背包同條件篩選' : '打開後把特殊強化武器也篩選進來'}
          </span>
        </div>
      </div>

      {/* Count */}
      {!loading && (
        <p className="text-xs text-text-dim mb-4">
          顯示 <Num className="text-xs">{filtered.length}</Num> 項
          {weaponsLoading && <span className="ml-1">· 載入武器中…</span>}
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
          沒有符合條件的項目
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((it) => it.kind === 'backpack' ? (
            <BackpackCard
              key={`bp_${it.data.id}`}
              bp={it.data}
              skills={skillsOf(it.data)}
              pinned={pinnedTooltip?.itemId === it.data.id}
              onEnter={(el) => { if (!isMobile && !pinnedTooltip) setHoverTooltip({ itemId: it.data.id, ...computePos(el) }) }}
              onLeave={() => { if (!isMobile && !pinnedTooltip) setHoverTooltip(null) }}
              onClick={(el) => handleCardClick(it, el)}
            />
          ) : (
            <WeaponProjectionCard
              key={`wp_${it.data.id}`}
              w={it.data}
              typeLabel={projectedBackpackType(it.data, backpackById)}
              onEnter={(el) => { if (!isMobile && !pinnedTooltip) setHoverTooltip({ itemId: it.data.id, ...computePos(el) }) }}
              onLeave={() => { if (!isMobile && !pinnedTooltip) setHoverTooltip(null) }}
              onClick={(el) => handleCardClick(it, el)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 卡片元件 ────────────────────────────────────────────────────────────────────

function BackpackCard({ bp, skills, pinned, onEnter, onLeave, onClick }: {
  bp: Backpack
  /** PLAN-043：已解析的掛載技能（badge 用） */
  skills: ResolvedBackpackSkill[]
  pinned: boolean
  onEnter: (el: HTMLDivElement) => void
  onLeave: () => void
  onClick: (el: HTMLDivElement) => void
}) {
  return (
    <div
      className={`bg-bg-card border rounded-xl p-3 cursor-pointer transition-all select-none hover:bg-bg-card-hover ${
        pinned ? 'border-border-accent' : 'border-border hover:border-border-accent'
      }`}
      onMouseEnter={(e) => onEnter(e.currentTarget)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(e.currentTarget) }}
    >
      <div className="flex items-start gap-2 mb-2">
        <BackpackIcon icon={bp.icon} name={bp.name} rarity={bp.rarity} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1 mb-0.5">
            <span className="font-bold text-sm text-text-primary leading-tight line-clamp-2">{bp.name}</span>
            <WeaponRarityBadge rarity={bp.rarity} />
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            <BackpackTypeBadge type={bp.type} />
            {bp.assemblableArmorType.length > 0 && (
              <>
                <span className="text-[11px] text-text-dim self-center leading-none select-none">|</span>
                <AssemblableArmorTypeBadge armorType={bp.assemblableArmorType} />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[14px]">
        <div><span className="text-text-dim">重 </span><Num>{bp.weight}</Num></div>
        {bp.repairAmount > 0 && (
          <div><span className="text-text-dim">修理 </span><Num>{bp.repairAmount}</Num></div>
        )}
        {skills.length > 0 && (
          <div className="col-span-2 mt-0.5 flex flex-wrap gap-1">
            {skills.map((sk) => (
              <span key={sk.raw} className="text-[11px] text-accent-pink bg-accent-pink/8 border border-accent-pink/20 rounded px-1.5 py-0.5">
                ✦ {sk.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 複合武器投影卡片：務必用 WeaponIcon（背包側圖示元件會拼 /images/backpacks/ 而 404 → 顯示「背」佔位字）。 */
function WeaponProjectionCard({ w, typeLabel, onEnter, onLeave, onClick }: {
  w: Weapon
  typeLabel: string | null
  onEnter: (el: HTMLDivElement) => void
  onLeave: () => void
  onClick: (el: HTMLDivElement) => void
}) {
  const armor = weaponArmorTypes(w)
  return (
    <div
      className="bg-bg-card border border-accent-yellow/30 rounded-xl p-3 cursor-pointer transition-all select-none hover:bg-bg-card-hover hover:border-accent-yellow/60"
      onMouseEnter={(e) => onEnter(e.currentTarget)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(e.currentTarget) }}
    >
      <div className="flex items-start gap-2 mb-2">
        <WeaponIcon icon={w.icon} name={w.name} size="md" isExclusive={w.isExclusive} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1 mb-0.5">
            <span className="font-bold text-sm text-text-primary leading-tight line-clamp-2">{w.name}</span>
            <WeaponRarityBadge rarity={w.rarity} />
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {typeLabel && <BackpackTypeBadge type={typeLabel} />}
            {armor.length > 0 && (
              <>
                <span className="text-[11px] text-text-dim self-center leading-none select-none">|</span>
                <AssemblableArmorTypeBadge armorType={armor} />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[14px]">
        <div><span className="text-text-dim">攻 </span><Num>{w.attack}</Num></div>
        <div><span className="text-text-dim">重 </span><Num>{w.weight}</Num></div>
        <div className="col-span-2 mt-0.5"><CraftBadge /></div>
      </div>
    </div>
  )
}
