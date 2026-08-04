import { useParams, Link } from 'react-router-dom'
import type { MechPart } from '../../types'
import { assetUrl, imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../../components/FallbackImage'
import { useMechWithModules } from '../../hooks/useFirestore'
import { ModuleCard } from '../../components/module/ModuleCard'

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

export default function MechDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, loading } = useMechWithModules(id)

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

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">

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
      <div>
        <SectionLabel>機甲模組</SectionLabel>
        <div className="space-y-5">

          {/* 特性模組 + 8級模組 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div className={`grid grid-cols-1 ${fixedMods.length > 1 ? 'md:grid-cols-2' : ''} gap-4`}>
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
              <div className={`grid grid-cols-1 ${exclusiveMods.length > 1 ? 'md:grid-cols-2' : ''} gap-4`}>
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
