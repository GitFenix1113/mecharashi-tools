import { useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { BackToListLink } from '../../components/layout/BackToListLink'
import type { Mech, MechPart } from '../../types'
import { mechPartCandidates, mechPortraitCandidates } from '../../utils/assets'
import { FallbackImage } from '../../components/common/FallbackImage'
import { useMechWithModules, useMechs, usePilots } from '../../hooks/useFirestore'
import { RefChip } from '../../components/refs/RefChip'
import { pairedPilotOf } from '../../utils/officialPairs'
import { ModuleCard } from '../../components/module/ModuleCard'
import { chassisFirepower, chassisWeight } from '../../utils/chassisStats'
import { occupiedSlots } from '../../utils/mechSlots'
import { slotKey } from '../../types/slots'
import { WeaponEquipSlot } from '../../types/enums'
import { ShoulderArmamentCard } from '../../components/mechs/ShoulderArmamentCard'
import { mechWeightBadgeClass, mechWeightShort } from '../../data/mechWeightClasses'
import { MechTypeIcon } from '../../components/icons/MechTypeIcon'
import { usePageTitle } from '../../contexts/PageTitleContext'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import GachaBanner from '../../components/gacha/GachaBanner'

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

/**
 * 精簡模式下每個部位保留的重點數值。
 *
 * 選法是「該部位**獨有**的那一項 + 通用的耐久／火力」——重量與抗暴在精簡模式收起，
 * 因為重量的總和已經在頁首那條出力（`剩餘 = 出力 − 總重量`）講完了，逐部件的分子
 * 沒有第一眼就得看到的理由。
 */
const PART_KEY_STATS: Record<MechPart['position'], NumericPartStatKey[]> = {
  torso:    ['durable', 'firepower', 'output'],
  leftArm:  ['durable', 'firepower', 'hit'],
  rightArm: ['durable', 'firepower', 'hit'],
  legs:     ['durable', 'dodge', 'move'],
}

const PART_KEY_STATS_FALLBACK: NumericPartStatKey[] = ['durable', 'firepower']

// ── 部件詳細屬性的展開偏好 ─────────────────────────────────────────────────────
//
// 純本機 UI 偏好，不同步到帳戶（比照 VersionGanttPanel 的版本資訊摺疊：要跨裝置就得動
// ViewPrefsKey 與 userApi，代價與這顆開關不成比例）。lazy initializer + try/catch，
// 隱私模式或 storage 被鎖時退回預設，而不是讓整頁炸掉。
//
// 預設**展開**：精簡會少掉重量／抗暴等欄位，圖鑑頁預設不該藏資料。版面壓力先由
// 「左右分欄 + 更緊的字級」吸收，摺疊是給看熟的人再省一次捲動。

const LS_PARTS_EXPANDED = 'mecharashi_mechdetail_partsExpanded'

function loadPartsExpanded(): boolean {
  try {
    return localStorage.getItem(LS_PARTS_EXPANDED) !== '0'
  } catch {
    return true
  }
}

function savePartsExpanded(v: boolean) {
  try {
    localStorage.setItem(LS_PARTS_EXPANDED, v ? '1' : '0')
  } catch {
    // ignore
  }
}

/** @param compact 單行高度（副模組用，與 ModuleCard variant="row" 同高） */
function EmptyModuleSlot({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`bg-bg-dark/50 border border-dashed border-border rounded-xl flex items-center justify-center ${
      compact ? 'px-3 py-2' : 'p-4 min-h-[64px]'
    }`}>
      <span className="text-xs text-text-dim">未設定</span>
    </div>
  )
}

function ModuleGroupLabel({ label, accent }: { label: string; accent: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className={`w-0.5 h-3.5 rounded-full ${accent}`} />
      <span className="text-[13px] text-text-dim tracking-wider">{label}</span>
    </div>
  )
}

function PartCard({ mech, position, part, name, expanded }: {
  mech: Mech
  position: 'torso' | 'leftArm' | 'rightArm' | 'legs'
  part: MechPart
  name: string
  expanded: boolean
}) {
  const keyStats = PART_KEY_STATS[part.position] ?? PART_KEY_STATS_FALLBACK
  const rows = PART_STAT_KEYS.filter(
    ({ key }) => part[key] != null && (expanded || keyStats.includes(key))
  )

  return (
    <div className="bg-bg-dark border border-border rounded-xl p-2.5 flex flex-row gap-2.5 h-full">
      {/* 官方部件圖 Icon_wap<wap>_1~4（PLAN-054）→ 部件自己記的 icon；全數失敗就不佔位 */}
      <FallbackImage
        candidates={mechPartCandidates(mech, position, part)}
        alt={name}
        className="w-9 h-9 rounded-lg bg-bg-card border border-border object-contain flex-shrink-0 self-start"
        fallback={null}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="mb-1">
          <p className="font-bold text-[13px] text-text-primary leading-tight truncate">{name}</p>
          {/* 空接口不留白：留白會被讀成「應該有但我們沒查到」，而事實正好相反 ——
              這台機甲確實沒有這個槽（今天只有 B 品質機甲，官方兩階皆空、已佐證）。
              語意見 src/utils/mechInterface.ts */}
          <p className={`text-[11px] leading-tight truncate ${part.interface ? 'text-text-dim' : 'text-text-dim/70 italic'}`}>
            {part.interface || '無模組接口'}
          </p>
        </div>
        <div className="flex-1 divide-y divide-border/70">
          {rows.map(({ key, label }) => (
            <div key={key} className="flex justify-between items-center gap-1 py-[3px]">
              <span className="text-[12px] text-text-dim">{label}</span>
              <span className="text-[12px] text-text-primary font-medium font-[JetBrains_Mono,monospace]">
                {(part[key] as number).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 頁首重點屬性：標籤在上、數值在下的小方塊，一列掃完，不吃垂直空間。 */
function KeyStat({ label, value, sub }: { label: string; value: string | number; sub?: ReactNode }) {
  return (
    <div className="min-w-[64px]">
      <div className="text-[11px] text-text-dim leading-none mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[17px] leading-none text-text-primary font-medium font-[JetBrains_Mono,monospace]">
          {value}
        </span>
        {sub}
      </div>
    </div>
  )
}

/**
 * 手機／平板的重點屬性：五項一列五格（375px 每格約 60px）。
 * 與 KeyStat 差在副標（出力的「剩餘」）換到第三行 —— 桌面版是接在數值右邊，手機格子塞不下。
 */
function CompactStat({ label, value, sub }: { label: string; value: string | number; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-text-dim leading-none mb-1 truncate">{label}</div>
      <div className="text-[14px] leading-none text-text-primary font-medium font-[JetBrains_Mono,monospace] truncate">
        {value}
      </div>
      {sub && <div className="mt-1 leading-none truncate">{sub}</div>}
    </div>
  )
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
        {children}
      </div>
      {action}
    </div>
  )
}

/** 精簡 / 詳細切換：沿用 Layout 字級切換的分段按鈕樣式。 */
function DensityToggle({ expanded, onChange }: { expanded: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center bg-bg-card border border-border rounded-lg overflow-hidden shrink-0">
      {([false, true] as const).map((v) => (
        <button
          key={String(v)}
          onClick={() => onChange(v)}
          aria-pressed={expanded === v}
          className={`px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${
            expanded === v
              ? 'bg-accent-orange/20 text-accent-orange'
              : 'text-text-dim hover:text-text-secondary'
          }`}
        >
          {v ? '詳細' : '精簡'}
        </button>
      ))}
    </div>
  )
}

/** 機甲故事館入口（PLAN-042-B H-4）：頁首名字旁（桌機）／第二列（手機）各一顆，className 決定哪一顆顯示 */
function LoreLink({ id, className }: { id: string; className: string }) {
  return (
    <Link
      to={`/lore/mechs/${encodeURIComponent(id)}`}
      className={`${className} shrink-0 rounded-md border border-accent-orange/40 px-2 py-0.5 text-xs font-bold text-accent-orange no-underline transition-colors hover:bg-accent-orange/10`}
    >
      故事館 ▸
    </Link>
  )
}

export default function MechDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, loading } = useMechWithModules(id)
  usePageTitle(data ? `${data.mech.name} 機甲資料` : null)
  const [partsExpanded, setPartsExpanded] = useState(loadPartsExpanded)
  // 官配機師（由機師側推導）與塗裝本體（PLAN-054）。pilots 在版本快取內，不多花 Firestore read。
  const { data: allPilots } = usePilots()
  const { data: allMechs } = useMechs()
  const pairedPilot = data ? pairedPilotOf(data.mech.id, allPilots) : undefined
  const skinOf = data?.mech.skinOfId ? allMechs.find((m) => m.id === data.mech.skinOfId) : undefined
  // 卡池橫條的檔期（PLAN-063）：每個 session 一次 Worker 請求、與首頁共用快取（逛過首頁就是 0 次）
  const { data: patchVersions, loading: patchVersionsLoading } = usePatchVersions()

  const togglePartsExpanded = (v: boolean) => {
    setPartsExpanded(v)
    savePartsExpanded(v)
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="h-96 bg-bg-card border border-border rounded-xl animate-pulse" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-text-dim">
        <p>找不到機甲資料</p>
        <Link to="/mechs" className="text-accent-orange no-underline text-sm mt-4 inline-block">
          ← 返回機甲圖鑑
        </Link>
      </div>
    )
  }

  const { mech, mod4, mod8, fixedMods, exclusiveMods } = data
  const armorCls = mechWeightBadgeClass(mech.armorType)

  const torso    = mech.parts?.torso    && typeof mech.parts.torso    !== 'number' ? mech.parts.torso    as MechPart : null
  const leftArm  = mech.parts?.leftArm  && typeof mech.parts.leftArm  !== 'number' ? mech.parts.leftArm  as MechPart : null
  const rightArm = mech.parts?.rightArm && typeof mech.parts.rightArm !== 'number' ? mech.parts.rightArm as MechPart : null
  const legs     = mech.parts?.legs     && typeof mech.parts.legs     !== 'number' ? mech.parts.legs     as MechPart : null
  const hasParts = torso || leftArm || rightArm || legs

  // 肩部固定武裝（帕斯卡衝擊炮／破曉者-01 嵐質儲能艙／霸王多功能彈倉）。
  // 只取肩部兩格：今天沒有任何機甲把固定武裝焊在手部或背部，十字下排的兩個角落先空著。
  const occupied = occupiedSlots(mech.parts)
  const rightShoulder = occupied.get(slotKey({ bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'right' }))
  const leftShoulder  = occupied.get(slotKey({ bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: 'left' }))

  // 火力／重量走 chassisStats 的單一實作（本頁原本自己 reduce 一次，與 MechsPage 讀頂層欄位
  // 的做法不一致 —— 同一台機甲在圖鑑顯示 1255、在詳情頁顯示 5020）
  const totalFirepower = chassisFirepower(mech.parts)
  const totalWeight = chassisWeight(mech.parts)
  const remainingOutput = mech.output - totalWeight

  const portrait = (
    <FallbackImage
      candidates={mechPortraitCandidates(mech)}
      alt={mech.name}
      className="max-h-full w-full object-contain"
      fallback={<span className="text-xs text-text-dim">尚無立繪</span>}
    />
  )

  const stats: { label: string; value: string | number; sub?: ReactNode }[] = [
    { label: '火力',   value: totalFirepower.toLocaleString() },
    { label: '閃避',   value: mech.evasion.toLocaleString() },
    { label: '移動力', value: mech.mobility },
    { label: '重量',   value: mech.weight.toLocaleString() },
    {
      label: '出力',
      value: mech.output.toLocaleString(),
      sub: (
        <span className={`text-[11px] font-[JetBrains_Mono,monospace] ${remainingOutput >= 0 ? 'text-accent-cyan' : 'text-accent-red'}`}>
          剩餘 {remainingOutput.toLocaleString()}
        </span>
      ),
    },
  ]

  return (
    // 2026-10-10「一屏看完」改版：上方留白 py-8 → py-4，返回連結併進名稱橫幅（省一整行）
    <div className="max-w-6xl xl:max-w-[1520px] mx-auto px-4 py-4 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      {/* 頁首：一行講完（桌面）。改版前是「返回連結一行＋名稱一行＋數值一行」共 169px，
          資訊卻只有名稱、三個標籤與五個數字。手機：名稱列右側放立繪縮圖（取代原本 190px 的大立繪），
          五項數值一列五格、不再換成兩行 */}
      <div className="bg-bg-card border border-border rounded-xl px-3 py-2.5 sm:px-4 mb-4">
        <div className="flex items-center gap-3 lg:gap-6">
          {/* 手機：「← 名稱 裝甲」與「登場／官配／塗裝」固定兩列（一條 flex-wrap 會被縮圖擠成三列）；
              lg 以上兩組併回同一行 */}
          <div className="flex-1 min-w-0 flex flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-3">
            <div className="flex items-center gap-x-2.5 lg:gap-x-3 min-w-0">
              {/* 上一頁就是圖鑑時回到原本捲到的位置（BackToListLink）；捲到一半要返回則用常駐分頁列的「← 機甲」 */}
              <BackToListLink
                to="/mechs"
                aria-label="返回機甲圖鑑"
                title="機甲圖鑑"
                className="text-lg leading-none text-text-dim hover:text-text-primary no-underline transition-colors"
              >
                ←
              </BackToListLink>
              <h1 className="text-xl sm:text-2xl xl:text-3xl font-black leading-tight truncate">{mech.name}</h1>
              {/* 只換字牌、不加新列：頁首 2026-10-10 才為「一屏看完」改版過（PLAN-059 F-2）。
                  滑過提示誰開得動它——駕照與機甲類型是同一套圖示 */}
              <span
                title={`${mechWeightShort(mech.armorType)}駕照的機師可駕駛`}
                className={`inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded text-xs font-bold border ${armorCls}`}
              >
                <MechTypeIcon type={mech.armorType} decorative />
                {mechWeightShort(mech.armorType)}
              </span>
              {/* 故事館入口（PLAN-042-B 決策 B-7，比照機師圖鑑 042-E）：圖鑑只做數值與機制，介紹、系譜、塗裝都在機甲故事館。
                  ⚠ 只放連結、**不帶任何故事內容**：帶首句就得載入 mechLore，圖鑑就跨進故事館了（單向依賴）。
                  每台機甲都有故事館頁（館首頁列的是 mechs），所以不會連到空頁。
                  手機放到第二列（下面那顆）：第一列還有右邊的立繪縮圖，放這裡會把名字擠成「格·」 */}
              <LoreLink id={mech.id} className="max-lg:hidden" />
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 lg:gap-x-3 gap-y-1">
                <LoreLink id={mech.id} className="lg:hidden" />
                {mech.debutVersion && (
                  <span className="text-[11px] text-text-dim border border-border rounded px-2 py-0.5">
                    登場 v{mech.debutVersion}
                  </span>
                )}
                {/* 官配機師與塗裝本體（PLAN-054）：官配由機師側推導、只存一邊；沒有就不出現 */}
                {pairedPilot && (
                  <span className="text-[12px] text-text-dim">
                    官配 <RefChip inner={pairedPilot.name} entity={{ refType: 'pilot', refId: pairedPilot.id }} />
                  </span>
                )}
                {skinOf && (
                  <span className="text-[12px] text-text-dim">
                    <RefChip inner={skinOf.name} entity={{ refType: 'mech', refId: skinOf.id }} /> 的付費塗裝
                  </span>
                )}
            </div>
          </div>
          {/* 手機／平板：立繪縮圖（桌面的十字中央已經有立繪）。用 px 而不是 w-20：
              站上的字級切換會放大 rem，w-20 在「中」字級是 95px，會把名稱列擠到換行 */}
          <div className="lg:hidden w-[72px] h-[52px] shrink-0 flex items-center justify-center">{portrait}</div>
          {/* 桌面：五項數值靠右，與名稱同一行 */}
          <div className="hidden lg:flex items-start gap-x-6 shrink-0">
            {stats.map((s) => <KeyStat key={s.label} label={s.label} value={s.value} sub={s.sub} />)}
          </div>
        </div>
        {/* 手機／平板：五項數值一列五格。出力那格放寬：底下的「剩餘 2,100」在等寬五格裡會被截斷 */}
        <div className="lg:hidden grid grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)] gap-x-1.5 mt-2.5">
          {stats.map((s) => <CompactStat key={s.label} label={s.label} value={s.value} sub={s.sub} />)}
        </div>
      </div>

      {/* 卡池橫條（PLAN-063，站長 10-17 選定頁首下方）：招募插畫＋池名＋狀態，點開看全景與卡池動態。
          代價是桌機多約 136px、把 10-10「一屏看完」吃回一截——站長看過原型後接受。
          ⚠ 不讀 mechLore（PLAN-042-B 決策 B-7）：池名取版本活動名；沒插畫也沒紀錄的機甲整塊不出現 */}
      <GachaBanner kind="mech" subject={mech} versions={patchVersions} statusReady={!patchVersionsLoading} className="mb-4" />

      {/* 主體：xl 以上左右分欄——左邊部件（寬而扁）、右邊模組（窄而長），模組因此不必等部件捲完才出現。
          xl 以下疊成單欄：lg～xl 維持「部件 → 模組」；**lg 以下（手機／平板）改成「模組 → 部件」**
          （2026-10-10）—— 改版前手機要捲過立繪、部件與約 500px 的機體描述，特性模組才出現在第 1499px */}
      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,46fr)_minmax(0,54fr)] xl:gap-6 xl:items-start">

        {/* 左欄：部件資訊（機體描述 PLAN-042-B H-4 搬進機甲故事館，頁首名字旁的「故事館 ▸」） */}
        <div className="space-y-5 max-lg:order-last">
          <div>
            <SectionLabel
              action={
                hasParts ? <DensityToggle expanded={partsExpanded} onChange={togglePartsExpanded} /> : undefined
              }
            >
              部件資訊（滿級）
            </SectionLabel>
            {hasParts ? (
              <>
                {/* 手機：肩部卡 + 2×2 部件卡（立繪已移到頁首縮圖） */}
                <div className="lg:hidden space-y-2.5">
                  {/* 手機沒有十字的角落可放 → 一條「右肩｜左肩」（從正面看，與桌面版同向） */}
                  {(rightShoulder || leftShoulder) && (
                    <div className="grid grid-cols-2 gap-2.5">
                      {rightShoulder ? <ShoulderArmamentCard occupied={rightShoulder} /> : <div />}
                      {leftShoulder  ? <ShoulderArmamentCard occupied={leftShoulder} />  : <div />}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2.5">
                    {torso    && <PartCard mech={mech} position="torso"    part={torso}    name="軀幹" expanded={partsExpanded} />}
                    {rightArm && <PartCard mech={mech} position="rightArm" part={rightArm} name="右臂" expanded={partsExpanded} />}
                    {leftArm  && <PartCard mech={mech} position="leftArm"  part={leftArm}  name="左臂" expanded={partsExpanded} />}
                    {legs     && <PartCard mech={mech} position="legs"     part={legs}     name="腿部" expanded={partsExpanded} />}
                  </div>
                </div>
                {/* 桌面：十字形佈局，中央立繪為基準。上排兩個角落是肩部：
                    左上＝右肩、右上＝左肩（從正面看機體，肩膀在同側手臂正上方）；沒有固定武裝就空著 */}
                <div className="hidden lg:grid grid-cols-3 gap-2.5 items-stretch">
                  {rightShoulder ? <ShoulderArmamentCard occupied={rightShoulder} /> : <div />}
                  {torso ? <PartCard mech={mech} position="torso" part={torso} name="軀幹" expanded={partsExpanded} /> : <div />}
                  {leftShoulder ? <ShoulderArmamentCard occupied={leftShoulder} /> : <div />}
                  {rightArm ? <PartCard mech={mech} position="rightArm" part={rightArm} name="右臂" expanded={partsExpanded} /> : <div />}
                  <div className="bg-bg-card border border-border rounded-xl flex items-center justify-center min-h-[200px] p-2">
                    {portrait}
                  </div>
                  {leftArm ? <PartCard mech={mech} position="leftArm" part={leftArm} name="左臂" expanded={partsExpanded} /> : <div />}
                  <div />
                  {legs ? <PartCard mech={mech} position="legs" part={legs} name="腿部" expanded={partsExpanded} /> : <div />}
                  <div />
                </div>
                {/* 原本掛在四部位表底下的口徑說明；那張表收起後搬到這裡，數字的口徑不能跟著消失 */}
                <p className="text-[11px] text-text-dim mt-2.5 leading-relaxed">
                  本站數值一律以<strong className="text-text-secondary">滿級／滿品質階</strong>計算；火力不含科技加成。
                </p>
              </>
            ) : (
              <p className="text-sm text-text-dim">部件資料不可用</p>
            )}
          </div>

          {/* ⏸ 2026-10-10 站長決定收起「槽位配置」與「四部位表」（PLAN-052-A E-1 的兩個區塊），以後看情況再決定要不要用：
              · 四部位表的重量／火力／接口，十字卡與頁首都已經有了；「來源」欄只在模擬器混搭部件時才有意義（那邊仍在用）
              · 槽位配置裡唯一不重複的資訊是「哪幾格被固定武裝佔住」，已搬進十字上排的肩部卡（ShoulderArmamentCard）
              要恢復：重新 import `MechSlotPanel` / `MechPartsTable`（src/components/mechs/MechSlotPanel.tsx），
              在這裡放回 `<MechSlotPanel mech={mech} />` 與 `<MechPartsTable mech={mech} />` 即可，元件都還在。 */}

        </div>

        {/* 右欄：機甲模組。@container —— 要不要雙欄取決於這一欄自己的寬度，不是視窗寬度。
            2026-10-10 依重要性重排：特性、8級各佔整寬（描述最長：8級中位數 53 字、最長 128 字，
            半寬會擠成 4 行且兩卡高低不齊）→ 專屬（只有 10 台有，沒有就整組不出）→ 副模組一行 */}
        <div className="@container">
          <SectionLabel>機甲模組</SectionLabel>
          <div className="space-y-2.5">
            <div>
              <ModuleGroupLabel label="特性模組" accent="bg-accent-orange" />
              {mod4 ? <ModuleCard mod={mod4} variant="detail" /> : <EmptyModuleSlot />}
            </div>

            <div>
              <ModuleGroupLabel label="8級模組" accent="bg-accent-blue" />
              {mod8 ? <ModuleCard mod={mod8} variant="detail" /> : <EmptyModuleSlot />}
            </div>

            {/* 專屬模組：沒有就整組不出（82/92 台沒有）。改版前是一塊「此機甲無專屬模組」的虛線框 */}
            {exclusiveMods.length > 0 && (
              <div>
                <ModuleGroupLabel label="專屬模組" accent="bg-accent-cyan" />
                <div className={`grid grid-cols-1 ${exclusiveMods.length > 1 ? '@[640px]:grid-cols-2' : ''} gap-3`}>
                  {exclusiveMods.map((m) => (
                    <ModuleCard key={m.id} mod={m} variant="detail" showBoundPart />
                  ))}
                </div>
              </div>
            )}

            {/* 副模組：每台剛好 1 顆、描述約 8 個字 → 單行（ModuleCard variant="row"） */}
            <div>
              <ModuleGroupLabel label="副模組" accent="bg-accent-green" />
              {fixedMods.length > 0 ? (
                <div className="space-y-2">
                  {fixedMods.map((m) => <ModuleCard key={m.id} mod={m} variant="row" />)}
                </div>
              ) : (
                <EmptyModuleSlot compact />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
