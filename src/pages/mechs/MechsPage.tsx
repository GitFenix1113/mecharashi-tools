import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useMechs } from '../../hooks/useFirestore'
import { useViewMode } from '../../hooks/useViewMode'
import { imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../../components/common/FallbackImage'
import { ViewModeToggle } from '../../components/common/ViewModeToggle'
import { MechQualityBadge } from '../../components/badges/MechBadges'

const ARMOR_TYPES = ['輕型', '中甲', '重型']

/**
 * 品質篩選預設值。**預設只顯示 S 級**（63/89 台）。
 *
 * A/B 級是 2026-08-15 才收錄的低階機甲，多數人查的是 S 級；預設全開的話首屏會多載
 * 26 張立繪。想看全部按「全部」即可，計數也一直顯示「N / 89」提示還有更多。
 * 注意這只省圖片頻寬 —— 機甲資料是 GameDataContext 整包載入的，篩選不影響 Firestore 讀取次數。
 */
const DEFAULT_QUALITY = 'S'

/**
 * 機甲縮圖候選：Firestore 的 portrait → 依名稱慣例的 images/mechs/{名稱}.webp。
 * 每項還會自動再展開 .webp 變體，所以資料若殘留舊的 .png 路徑也退得回來。
 */
const mechImageCandidates = (mech: { name: string; portrait?: string }) =>
  imageCandidates(mech.portrait, `images/mechs/${mech.name}.webp`)

const ARMOR_STYLES: Record<string, { text: string; border: string; bg: string }> = {
  輕型: { text: 'text-accent-cyan', border: 'border-accent-cyan/40', bg: 'bg-accent-cyan/10' },
  中甲: { text: 'text-accent-green', border: 'border-accent-green/40', bg: 'bg-accent-green/10' },
  重型: { text: 'text-accent-red', border: 'border-accent-red/40', bg: 'bg-accent-red/10' },
}

// 機甲品質階序（沿用機師品質階序），同時用於次要排序與篩選按鈕的排列順序。
// 89 台目前全數有 quality（S 63 / A 16 / B 10）；fallback 99 保留給日後可能出現的新值，
// 讓未知品質排在最後而不是插進中間。
const QUALITY_ORDER: Record<string, number> = { EX: 0, S: 1, A: 2, B: 3 }

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
  const [qualityFilter, setQualityFilter] = useState(DEFAULT_QUALITY)
  const [versionFilter, setVersionFilter] = useState('')
  const [sortMode, setSortMode] = useState<'versionDesc' | 'versionAsc'>('versionDesc')
  const [viewMode, setViewMode] = useViewMode('mechs')

  // 登場版本篩選選項：只列出資料中實際出現過的版本（降序）；全空時整區隱藏
  const versions = useMemo(
    () =>
      Array.from(new Set(mechs.map((m) => m.debutVersion).filter(Boolean) as string[])).sort(
        (a, b) => parseFloat(b) - parseFloat(a),
      ),
    [mechs],
  )

  // 品質篩選選項：同樣只列資料中實際出現過的值，依 QUALITY_ORDER 排（S→A→B）。
  // 寫死 ['S','A','B'] 的話，日後真的出現 EX 級機甲就會篩不到它。
  const qualities = useMemo(
    () =>
      Array.from(new Set(mechs.map((m) => m.quality).filter(Boolean) as string[])).sort(
        (a, b) => (QUALITY_ORDER[a] ?? 99) - (QUALITY_ORDER[b] ?? 99),
      ),
    [mechs],
  )

  const idNum = (id: string) => parseInt(id.match(/mech_(\d+)/)?.[1] ?? '0', 10)

  const base = mechs.filter(
    (m) =>
      (!armorFilter || m.armorType === armorFilter) &&
      (!qualityFilter || m.quality === qualityFilter) &&
      (!versionFilter || m.debutVersion === versionFilter),
  )
  const filtered = [...base].sort((a, b) => {
    // 主排序：登場版本（新→舊 或 舊→新）；無版本者永遠排最後
    const va = a.debutVersion ? parseFloat(a.debutVersion) : null
    const vb = b.debutVersion ? parseFloat(b.debutVersion) : null
    if (va === null && vb !== null) return 1
    if (vb === null && va !== null) return -1
    if (va !== null && vb !== null && va !== vb) {
      return sortMode === 'versionAsc' ? va - vb : vb - va
    }
    // 次要排序：品質 S→A→B（同版本、或皆無版本時皆套用）。
    // 這層在「品質：全部」時最有感——1.0 版一口氣有 42 台，不分品質就是一團亂。
    const qd = (QUALITY_ORDER[a.quality ?? ''] ?? 99) - (QUALITY_ORDER[b.quality ?? ''] ?? 99)
    if (qd !== 0) return qd
    // 第三序：編號遞減
    return idNum(b.id) - idNum(a.id)
  })

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

        {/* Quality Filter（僅在有資料時顯示）。預設選 S，見 DEFAULT_QUALITY */}
        {qualities.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-text-dim mr-1">品質</span>
            <button className={filterBtn(!qualityFilter)} onClick={() => setQualityFilter('')}>全部</button>
            {qualities.map((q) => (
              <button
                key={q}
                onClick={() => setQualityFilter(qualityFilter === q ? '' : q)}
                className={filterBtn(qualityFilter === q)}
              >
                {q}
              </button>
            ))}
          </div>
        )}

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
            onChange={(e) => setSortMode(e.target.value as 'versionDesc' | 'versionAsc')}
            aria-label="排序方式"
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-bg-card text-text-secondary border-border hover:border-border-accent hover:text-text-primary cursor-pointer outline-none focus:border-border-accent"
          >
            <option value="versionDesc">登場版本 新→舊</option>
            <option value="versionAsc">登場版本 舊→新</option>
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
                  <FallbackImage
                    candidates={mechImageCandidates(mech)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-contain object-center transition-transform group-hover:scale-105"
                  />
                  {s && (
                    <span
                      className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${s.bg} ${s.text} ${s.border}`}
                    >
                      {mech.armorType}
                    </span>
                  )}
                  {/* 品質標示：切到「品質：全部」時，沒有它就分不出哪台是 A/B 級 */}
                  {mech.quality && (
                    <MechQualityBadge
                      quality={mech.quality}
                      className="absolute top-1 right-1 !px-1.5 !text-[10px]"
                    />
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
                  <FallbackImage
                    candidates={mechImageCandidates(mech)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-contain object-center transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-transparent to-transparent" />
                  {s && (
                    <span
                      className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[13px] font-bold border ${s.bg} ${s.text} ${s.border}`}
                    >
                      {mech.armorType}
                    </span>
                  )}
                  {mech.quality && (
                    <MechQualityBadge quality={mech.quality} className="absolute top-2 right-2" />
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
