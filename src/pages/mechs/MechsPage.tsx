import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useMechs } from '../../hooks/useFirestore'
import { useViewMode } from '../../hooks/useViewMode'
import { assetUrl } from '../../utils/assets'
import { ViewModeToggle } from '../../components/ViewModeToggle'

const ARMOR_TYPES = ['輕型', '中甲', '重型']

const ARMOR_STYLES: Record<string, { text: string; border: string; bg: string }> = {
  輕型: { text: 'text-accent-cyan', border: 'border-accent-cyan/40', bg: 'bg-accent-cyan/10' },
  中甲: { text: 'text-accent-green', border: 'border-accent-green/40', bg: 'bg-accent-green/10' },
  重型: { text: 'text-accent-red', border: 'border-accent-red/40', bg: 'bg-accent-red/10' },
}

function StatBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div>
      <div className="flex justify-between text-[14px] mb-0.5">
        <span className="text-text-dim">{label}</span>
        <span className="text-text-secondary font-[JetBrains_Mono,monospace] font-semibold">
          {value.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 bg-bg-dark rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-orange rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function MobilityGrid({ value }: { value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[14px] mb-1">
        <span className="text-text-dim">移動</span>
        <span className="text-accent-cyan font-[JetBrains_Mono,monospace] font-semibold">{value}</span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: value }).map((_, i) => (
          <div key={i} className="w-3 h-2.5 rounded-sm bg-accent-cyan" />
        ))}
      </div>
    </div>
  )
}

export default function MechsPage() {
  const { data: mechs, loading } = useMechs()
  const [armorFilter, setArmorFilter] = useState('')
  const [versionFilter, setVersionFilter] = useState('')
  const [sortMode, setSortMode] = useState<'default' | 'version'>('default')
  const [viewMode, setViewMode] = useViewMode('mechs')

  // 登場版本篩選選項：只列出資料中實際出現過的版本（降序）；全空時整區隱藏
  const versions = useMemo(
    () =>
      Array.from(new Set(mechs.map((m) => m.debutVersion).filter(Boolean) as string[])).sort(
        (a, b) => parseFloat(b) - parseFloat(a),
      ),
    [mechs],
  )

  const idNum = (id: string) => parseInt(id.match(/mech_(\d+)/)?.[1] ?? '0', 10)

  const base = mechs.filter(
    (m) =>
      (!armorFilter || m.armorType === armorFilter) &&
      (!versionFilter || m.debutVersion === versionFilter),
  )
  // 登場版本 新→舊：有版本者依版本降序，無版本者排最後（依編號降序當次序）
  const filtered =
    sortMode === 'version'
      ? [...base].sort((a, b) => {
          const va = a.debutVersion ? parseFloat(a.debutVersion) : -Infinity
          const vb = b.debutVersion ? parseFloat(b.debutVersion) : -Infinity
          if (va !== vb) return vb - va
          return idNum(b.id) - idNum(a.id)
        })
      : base

  const filterBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/40'
        : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
    }`

  const MAX_FP = Math.max(...mechs.map((m) => m.firepower), 1)
  const MAX_EV = Math.max(...mechs.map((m) => m.evasion), 1)

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 bg-bg-dark/10 backdrop-blur-sm rounded-2xl">
      <div className="mb-8">
        <span className="text-xs text-accent-orange tracking-[3px] uppercase font-[Orbitron,sans-serif]">
          Database
        </span>
        <h1 className="text-3xl font-bold mt-2">機甲圖鑑</h1>
        <p className="text-text-secondary mt-2">
          瀏覽所有機甲的部件耐久、火力、模組配置。共 {mechs.length} 架機甲。
        </p>
      </div>

      {/* Filters */}
      <div className="bg-bg-card border border-border rounded-xl p-4 mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-text-dim mr-1">裝甲</span>
          <button className={filterBtn(!armorFilter)} onClick={() => setArmorFilter('')}>
            全部
          </button>
          {ARMOR_TYPES.map((a) => {
            const s = ARMOR_STYLES[a]
            const active = armorFilter === a
            return (
              <button
                key={a}
                onClick={() => setArmorFilter(active ? '' : a)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  active && s
                    ? `${s.bg} ${s.text} ${s.border}`
                    : 'bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary'
                }`}
              >
                {a}
              </button>
            )
          })}
        </div>

        {/* Debut Version Filter（僅在有資料時顯示） */}
        {versions.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-text-dim mr-1">登場版本</span>
            <button className={filterBtn(!versionFilter)} onClick={() => setVersionFilter('')}>全部</button>
            {versions.map((v) => (
              <button
                key={v}
                onClick={() => setVersionFilter(versionFilter === v ? '' : v)}
                className={filterBtn(versionFilter === v)}
              >
                v{v}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Count + View toggle */}
      <div className="flex items-center justify-between gap-3 mb-4 min-h-[28px]">
        {!loading ? (
          <p className="text-xs text-text-dim">
            顯示 {filtered.length} / {mechs.length} 架機甲
          </p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as 'default' | 'version')}
            aria-label="排序方式"
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary cursor-pointer outline-none focus:border-border-accent"
          >
            <option value="default">預設（編號）</option>
            <option value="version">登場版本 新→舊</option>
          </select>
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl h-72 animate-pulse" />
          ))}
        </div>
      ) : viewMode === 'compact' ? (
        /* ── 緊湊檢視：機甲圖 + 名 ── */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((mech) => {
            const s = ARMOR_STYLES[mech.armorType]
            return (
              <Link
                key={mech.id}
                to={`/mechs/${mech.id}`}
                className="group block bg-bg-card border border-border rounded-lg overflow-hidden no-underline transition-all hover:bg-bg-card-hover hover:border-border-accent hover:-translate-y-0.5"
              >
                <div className="relative aspect-square bg-bg-dark overflow-hidden">
                  <img
                    src={mech.portrait ? assetUrl(mech.portrait) : assetUrl(`images/mechs/${mech.name}.png`)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-contain object-center transition-transform group-hover:scale-105"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement
                      if (!el.dataset.fb) {
                        el.dataset.fb = '1'
                        el.src = assetUrl(`images/mechs/${mech.name}.png`)
                      } else {
                        el.style.display = 'none'
                      }
                    }}
                  />
                  {s && (
                    <span
                      className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${s.bg} ${s.text} ${s.border}`}
                    >
                      {mech.armorType}
                    </span>
                  )}
                </div>
                <p className="px-1.5 py-1.5 text-xs font-bold text-text-primary text-center truncate">
                  {mech.name}
                </p>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((mech) => {
            const s = ARMOR_STYLES[mech.armorType]
            return (
              <Link
                key={mech.id}
                to={`/mechs/${mech.id}`}
                className="group block bg-bg-card border border-border rounded-xl overflow-hidden no-underline transition-all hover:bg-bg-card-hover hover:border-border-accent hover:-translate-y-0.5"
              >
                {/* Portrait */}
                <div className="relative h-36 bg-bg-dark overflow-hidden">
                  <img
                    src={mech.portrait ? assetUrl(mech.portrait) : assetUrl(`images/mechs/${mech.name}.png`)}
                    alt=""
                    className="w-full h-full object-contain object-center transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement
                      if (!el.dataset.fb) {
                        el.dataset.fb = '1'
                        el.src = assetUrl(`images/mechs/${mech.name}.png`)
                      } else {
                        el.style.display = 'none'
                      }
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-transparent to-transparent" />
                  {s && (
                    <span
                      className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[13px] font-bold border ${s.bg} ${s.text} ${s.border}`}
                    >
                      {mech.armorType}
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-base text-text-primary group-hover:text-accent-orange transition-colors">
                      {mech.name}
                    </h3>
                  </div>
                  <div className="text-right text-xs text-text-dim">
                    <p>
                      出力{' '}
                      <span className="text-accent-cyan font-bold">
                        {mech.output.toLocaleString()}
                      </span>
                    </p>
                    <p>
                      重量{' '}
                      <span className="text-text-secondary">{mech.weight.toLocaleString()}</span>
                    </p>
                  </div>
                </div>

                {/* Stat Bars */}
                <div className="space-y-2">
                  <StatBar label="火力" value={mech.firepower} max={MAX_FP} />
                  <StatBar label="閃避" value={mech.evasion} max={MAX_EV} />
                  <MobilityGrid value={mech.mobility} />
                </div>

                {/* Parts */}
                <div className="mt-4 grid grid-cols-4 gap-1 text-center">
                  {[
                    { label: '軀幹', value: typeof mech.parts.torso === 'number' ? mech.parts.torso : mech.parts.torso?.durable ?? 0 },
                    { label: '左臂', value: typeof mech.parts.leftArm === 'number' ? mech.parts.leftArm : mech.parts.leftArm?.durable ?? 0 },
                    { label: '右臂', value: typeof mech.parts.rightArm === 'number' ? mech.parts.rightArm : mech.parts.rightArm?.durable ?? 0 },
                    { label: '腿部', value: typeof mech.parts.legs === 'number' ? mech.parts.legs : mech.parts.legs?.durable ?? 0 },
                  ].map((p) => (
                    <div key={p.label} className="bg-bg-dark border border-border rounded-lg p-1.5">
                      <p className="text-[12px] text-text-dim">{p.label}</p>
                      <p className="text-[14px] font-bold text-text-secondary">
                        {p.value.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
                </div>{/* /p-5 */}
              </Link>
            )
          })}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          沒有符合條件的機甲
        </div>
      )}
    </div>
  )
}
