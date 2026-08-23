import { useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { MechPart } from '../../types'
import { assetUrl, imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../../components/common/FallbackImage'
import { useMechWithModules } from '../../hooks/useFirestore'
import { ModuleCard } from '../../components/module/ModuleCard'
import { chassisFirepower, chassisWeight } from '../../utils/chassisStats'
import { MechSlotPanel, MechPartsTable } from '../../components/mechs/MechSlotPanel'

const ARMOR_STYLES: Record<string, string> = {
  輕型: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/40',
  中甲: 'text-accent-green bg-accent-green/10 border-accent-green/40',
  重型: 'text-accent-red bg-accent-red/10 border-accent-red/40',
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

function EmptyModuleSlot() {
  return (
    <div className="bg-bg-dark/50 border border-dashed border-border rounded-xl p-4 flex items-center justify-center min-h-[64px]">
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

function PartCard({ part, name, expanded }: { part: MechPart; name: string; expanded: boolean }) {
  const keyStats = PART_KEY_STATS[part.position] ?? PART_KEY_STATS_FALLBACK
  const rows = PART_STAT_KEYS.filter(
    ({ key }) => part[key] != null && (expanded || keyStats.includes(key))
  )

  return (
    <div className="bg-bg-dark border border-border rounded-xl p-2.5 flex flex-row gap-2.5 h-full">
      {part.icon && (
        <img
          src={assetUrl(part.icon)}
          alt={name}
          className="w-9 h-9 rounded-lg bg-bg-card border border-border object-contain flex-shrink-0 self-start"
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="mb-1">
          <p className="font-bold text-[13px] text-text-primary leading-tight truncate">{name}</p>
          {/* 空接口不留白：留白會被讀成「這格沒有接口」，那是我們並不知道的否定陳述
              （B 品質機甲 10 台 40 格未建檔、美杜莎MK2 是官方數值未公布） */}
          <p className={`text-[11px] leading-tight truncate ${part.interface ? 'text-text-dim' : 'text-text-dim/70 italic'}`}>
            {part.interface || '接口未建檔'}
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

export default function MechDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, loading } = useMechWithModules(id)
  const [partsExpanded, setPartsExpanded] = useState(loadPartsExpanded)

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
  const armorCls = ARMOR_STYLES[mech.armorType] ?? 'text-text-secondary bg-bg-card border-border'

  const torso    = mech.parts?.torso    && typeof mech.parts.torso    !== 'number' ? mech.parts.torso    as MechPart : null
  const leftArm  = mech.parts?.leftArm  && typeof mech.parts.leftArm  !== 'number' ? mech.parts.leftArm  as MechPart : null
  const rightArm = mech.parts?.rightArm && typeof mech.parts.rightArm !== 'number' ? mech.parts.rightArm as MechPart : null
  const legs     = mech.parts?.legs     && typeof mech.parts.legs     !== 'number' ? mech.parts.legs     as MechPart : null
  const hasParts = torso || leftArm || rightArm || legs

  // 火力／重量走 chassisStats 的單一實作（本頁原本自己 reduce 一次，與 MechsPage 讀頂層欄位
  // 的做法不一致 —— 同一台機甲在圖鑑顯示 1255、在詳情頁顯示 5020）
  const totalFirepower = chassisFirepower(mech.parts)
  const totalWeight = chassisWeight(mech.parts)
  const remainingOutput = mech.output - totalWeight

  const portrait = (
    <FallbackImage
      candidates={imageCandidates(mech.portrait)}
      alt={mech.name}
      className="max-h-full w-full object-contain"
      fallback={<span className="text-xs text-text-dim">尚無立繪</span>}
    />
  )

  return (
    <div className="max-w-6xl xl:max-w-[1520px] mx-auto px-4 py-8 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

      <Link
        to="/mechs"
        className="inline-flex items-center gap-1 text-sm text-text-dim hover:text-text-primary no-underline mb-4 transition-colors"
      >
        ← 機甲圖鑑
      </Link>

      {/* 頁首：名稱與重點屬性合成一條橫帶，把垂直預算讓給下面的部件與模組 */}
      <div className="bg-bg-card border border-border rounded-xl px-4 py-3.5 mb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3.5">
          <h1 className="text-2xl xl:text-3xl font-black leading-none">{mech.name}</h1>
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${armorCls}`}>
            {mech.armorType}
          </span>
          {mech.debutVersion && (
            <span className="text-[11px] text-text-dim border border-border rounded px-2 py-0.5">
              登場 v{mech.debutVersion}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-x-7 gap-y-3">
          <KeyStat label="火力" value={totalFirepower.toLocaleString()} />
          <KeyStat label="閃避" value={mech.evasion.toLocaleString()} />
          <KeyStat label="移動力" value={mech.mobility} />
          <KeyStat label="重量" value={mech.weight.toLocaleString()} />
          <KeyStat
            label="出力"
            value={mech.output.toLocaleString()}
            sub={
              <span
                className={`text-[11px] font-[JetBrains_Mono,monospace] ${
                  remainingOutput >= 0 ? 'text-accent-cyan' : 'text-accent-red'
                }`}
              >
                剩餘 {remainingOutput.toLocaleString()}
              </span>
            }
          />
        </div>
      </div>

      {/* 主體：xl 以上左右分欄——左邊部件（寬而扁）、右邊模組（窄而長），
          模組因此不必等部件捲完才出現 */}
      <div className="xl:grid xl:grid-cols-[minmax(0,46fr)_minmax(0,54fr)] xl:gap-6 xl:items-start">

        {/* 左欄：部件資訊 + 機體描述 */}
        <div>
          <div className="mb-5">
            <SectionLabel
              action={
                hasParts ? <DensityToggle expanded={partsExpanded} onChange={togglePartsExpanded} /> : undefined
              }
            >
              部件資訊（滿級）
            </SectionLabel>
            {hasParts ? (
              <>
                {/* 手機：機體圖 + 2×2 部件卡 */}
                <div className="lg:hidden space-y-3">
                  <div className="bg-bg-card border border-border rounded-xl flex items-center justify-center h-40 p-2">
                    {portrait}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {torso    && <PartCard part={torso}    name="軀幹" expanded={partsExpanded} />}
                    {rightArm && <PartCard part={rightArm} name="右臂" expanded={partsExpanded} />}
                    {leftArm  && <PartCard part={leftArm}  name="左臂" expanded={partsExpanded} />}
                    {legs     && <PartCard part={legs}     name="腿部" expanded={partsExpanded} />}
                  </div>
                </div>
                {/* 桌面：十字形佈局，中央立繪為基準 */}
                <div className="hidden lg:grid grid-cols-3 gap-2.5 items-stretch">
                  <div />
                  {torso ? <PartCard part={torso} name="軀幹" expanded={partsExpanded} /> : <div />}
                  <div />
                  {rightArm ? <PartCard part={rightArm} name="右臂" expanded={partsExpanded} /> : <div />}
                  <div className="bg-bg-card border border-border rounded-xl flex items-center justify-center min-h-[200px] p-2">
                    {portrait}
                  </div>
                  {leftArm ? <PartCard part={leftArm} name="左臂" expanded={partsExpanded} /> : <div />}
                  <div />
                  {legs ? <PartCard part={legs} name="腿部" expanded={partsExpanded} /> : <div />}
                  <div />
                </div>
              </>
            ) : (
              <p className="text-sm text-text-dim">部件資料不可用</p>
            )}
          </div>

          {/* PLAN-052-A E-1：槽位配置與四部位表。放在部件十字之後——
              十字講的是「每個部位有多強」，這兩塊講的是「這台能裝什麼、數字從哪來」。 */}
          {hasParts && (
            <div className="space-y-3 mb-5">
              <MechSlotPanel mech={mech} />
              <MechPartsTable mech={mech} />
            </div>
          )}

          {/* 機體描述留在左欄底部：右欄的模組才是進頁要先看到的東西 */}
          {mech.lore && (
            <div className="bg-bg-card border border-border rounded-xl p-4 mb-5 xl:mb-0">
              <SectionLabel>機體描述</SectionLabel>
              <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{mech.lore}</p>
            </div>
          )}
        </div>

        {/* 右欄：機甲模組。@container —— 要不要雙欄取決於這一欄自己的寬度，不是視窗寬度 */}
        <div className="@container">
          <SectionLabel>機甲模組</SectionLabel>
          <div className="space-y-4">

            {/* 特性模組 + 8級模組 */}
            <div className="grid grid-cols-1 @[640px]:grid-cols-2 gap-3">
              <div>
                <ModuleGroupLabel label="特性模組" accent="bg-accent-orange" />
                {mod4 ? <ModuleCard mod={mod4} variant="detail" /> : <EmptyModuleSlot />}
              </div>
              <div>
                <ModuleGroupLabel label="8級模組" accent="bg-accent-blue" />
                {mod8 ? <ModuleCard mod={mod8} variant="detail" /> : <EmptyModuleSlot />}
              </div>
            </div>

            {/* 副模組 */}
            <div>
              <ModuleGroupLabel label="副模組" accent="bg-accent-green" />
              {fixedMods.length > 0 ? (
                <div className={`grid grid-cols-1 ${fixedMods.length > 1 ? '@[640px]:grid-cols-2' : ''} gap-3`}>
                  {fixedMods.map((m) => <ModuleCard key={m.id} mod={m} variant="detail" />)}
                </div>
              ) : (
                <EmptyModuleSlot />
              )}
            </div>

            {/* 專屬模組 */}
            <div>
              <ModuleGroupLabel label="專屬模組" accent="bg-accent-cyan" />
              {exclusiveMods.length > 0 ? (
                <div className={`grid grid-cols-1 ${exclusiveMods.length > 1 ? '@[640px]:grid-cols-2' : ''} gap-3`}>
                  {exclusiveMods.map((m) => (
                    <ModuleCard key={m.id} mod={m} variant="detail" showBoundPart />
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
      </div>
    </div>
  )
}
