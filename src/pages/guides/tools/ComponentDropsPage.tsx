import { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { toPng } from 'html-to-image'
import { useComponents } from '../../../hooks/useFirestore'
import { ComponentType, ComponentsWType } from '../../../types/enums'
import type { Component } from '../../../types'
import { getAllStages, getComponentDrops, getBossImagePath } from '../../../data/bossDrops'
import { ComponentIcon } from '../../../components/ComponentIcon'
import { assetUrl } from '../../../utils/assets'

// ─── Tab 定義 ───────────────────────────────────────────────────────────────
// 分頁維度直接映射既有型別：componentType（觸=Condition / 應=Function）× componentsWType。
// 英文命名：觸元件 = Trigger、應元件 = Reaction（型別值仍為 Condition / Function）。
type TabKey = 'all' | 'trigger' | 'triggerW' | 'reaction' | 'reactionW'

interface TabDef {
  key: TabKey
  label: string      // 中文分頁標籤
  en: string         // 英文（供匯出檔名 / 未來 i18n）
  match: (c: Component) => boolean
}

const TABS: TabDef[] = [
  { key: 'all',       label: '總表',     en: 'All',       match: () => true },
  { key: 'trigger',   label: '觸元件',   en: 'Trigger',   match: (c) => c.componentType === ComponentType.CONDITION && c.componentsWType === ComponentsWType.NORMAL },
  { key: 'triggerW',  label: '觸元件W',  en: 'TriggerW',  match: (c) => c.componentType === ComponentType.CONDITION && c.componentsWType === ComponentsWType.W },
  { key: 'reaction',  label: '應元件',   en: 'Reaction',  match: (c) => c.componentType === ComponentType.FUNCTION  && c.componentsWType === ComponentsWType.NORMAL },
  { key: 'reactionW', label: '應元件W',  en: 'ReactionW', match: (c) => c.componentType === ComponentType.FUNCTION  && c.componentsWType === ComponentsWType.W },
]

// ─── 矩陣資料結構（A-3）─────────────────────────────────────────────────────
// 稀有度排序（高→低）
const RARITY_RANK: Record<string, number> = { EX: 0, S: 1, A: 2, B: 3 }

interface DropMatrix {
  stages: number[]                              // 欄：出現過的關卡（由小到大）
  rows: {
    comp: Component            // 代表元件（取該名稱下最高稀有度那顆）
    rarities: string[]         // 此元件擁有的稀有度層級（EX>S>A>B 排序）
    // 每個 stage → 該關掉落此元件的 BOSS 編號（無掉落則為空陣列）
    bossesByStage: Record<number, number[]>
  }[]
}

/**
 * 從一批元件組出「元件 × 關卡 × BOSS」矩陣；只保留有掉落來源的元件。
 * 同名元件的 S/A/B 稀有度變體「掉落來源完全相同、僅效果數值不同」，
 * 對掉落表而言合併成一列（以 名稱+類型+W型 為鍵），並標示其擁有的稀有度層級。
 */
function buildMatrix(list: Component[]): DropMatrix {
  const withDrops = list.filter((c) => (c.dropStages?.length ?? 0) > 0)
  const stages = getAllStages(withDrops)

  const groups = new Map<string, Component[]>()
  for (const c of withDrops) {
    const key = `${c.componentType}|${c.componentsWType}|${c.name}`
    const g = groups.get(key)
    if (g) g.push(c)
    else groups.set(key, [c])
  }

  const rows = [...groups.values()]
    .map((variants) => {
      const sorted = [...variants].sort(
        (a, b) => (RARITY_RANK[a.rarity] ?? 99) - (RARITY_RANK[b.rarity] ?? 99),
      )
      const comp = sorted[0] // 代表：最高稀有度（圖示 / 名稱 / 掉落皆相同）
      const bossesByStage: Record<number, number[]> = {}
      for (const d of getComponentDrops(comp)) bossesByStage[d.stage] = d.bosses
      return { comp, rarities: sorted.map((c) => c.rarity), bossesByStage }
    })
    // 先依等級（probabilityLevel）由高到低，再依名稱，讓表格有穩定順序
    .sort((a, b) =>
      b.comp.probabilityLevel - a.comp.probabilityLevel ||
      a.comp.name.localeCompare(b.comp.name, 'zh-Hant'),
    )

  return { stages, rows }
}

/** 去掉名稱開頭的「觸元件 / 應元件」類型前綴（分頁已標示類型時不必重複） */
function stripTypePrefix(name: string): string {
  const stripped = name.replace(/^(觸|應)元件W?\s*[-—–·:：]?\s*/, '').trim()
  return stripped || name
}

export default function ComponentDropsPage() {
  const { data: components, loading, error } = useComponents()
  const [tab, setTab] = useState<TabKey>('all')
  // 預設走「圖示模式」：元件只顯示放大圖示、掉落格只顯示 #編號 —— 語言中性、版面緊湊，供英文玩家看圖對照
  const [showName, setShowName] = useState(false)         // 顯示元件名稱（關閉則只顯示放大圖示）
  const [showBossAvatar, setShowBossAvatar] = useState(false) // 掉落格顯示 BOSS 頭像（關閉則只顯示 #編號）
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0]

  const matrix = useMemo(() => {
    const filtered = components.filter(activeTab.match)
    return buildMatrix(filtered)
  }, [components, activeTab])

  // C-1 匯出當前 Tab 表格為 PNG
  async function handleExport() {
    const el = exportRef.current
    if (!el || matrix.rows.length === 0) return
    setExporting(true)

    const savedCss = el.style.cssText
    const restore = () => { el.style.cssText = savedCss }

    try {
      // ① 展開橫向捲動，讓 toPng 擷取完整表格寬度
      el.style.overflow = 'visible'
      el.style.width = 'max-content'
      el.style.maxWidth = 'none'

      // ② 強制載入所有 BOSS 頭像（原為 lazy，離畫面者尚未載入），等全部就緒再截圖
      const imgs = Array.from(el.querySelectorAll('img'))
      imgs.forEach((img) => { img.loading = 'eager' })
      await Promise.all(
        imgs.map((img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise<void>((res) => {
                img.addEventListener('load', () => res(), { once: true })
                img.addEventListener('error', () => res(), { once: true })
              }),
        ),
      )
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

      const dataUrl = await toPng(el, { backgroundColor: '#0a0c10', pixelRatio: 2 })
      restore()

      const a = document.createElement('a')
      a.download = `元件掉落_${activeTab.label}.png`
      a.href = dataUrl
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      console.error('[ComponentDrops] export error:', err)
      restore()
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">

      {/* 麵包屑 */}
      <div className="flex items-center gap-1.5 text-[12px] text-text-dim">
        <Link to="/guides" className="hover:text-text-secondary transition-colors">攻略</Link>
        <span>›</span>
        <span className="text-text-secondary">元件掉落總表</span>
      </div>

      {/* 頁頭 */}
      <div>
        <span className="text-[10px] font-bold tracking-[3px] text-accent-orange uppercase font-[Orbitron,sans-serif]">
          Guide · Data
        </span>
        <h1 className="text-2xl font-bold mt-1"
          style={{ background: 'linear-gradient(135deg,#fff,#f97316)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          元件掉落總表
        </h1>
        <p className="text-[13px] text-text-dim mt-1">
          各關 BOSS 掉落的元件一覽 · 欄為首領關卡、格內數字為該關第幾個 BOSS 掉落
        </p>
      </div>

      {/* Tab 切換列 + 匯出 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-bold border transition-colors cursor-pointer ${
              tab === t.key
                ? 'text-accent-orange border-accent-orange/50 bg-accent-orange/10'
                : 'text-text-dim border-border hover:border-border-accent'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={handleExport}
          disabled={exporting || loading || matrix.rows.length === 0}
          className="px-3 py-1.5 rounded-lg text-[13px] font-bold border border-accent-green/50 bg-accent-green/10 text-accent-green transition-colors cursor-pointer hover:bg-accent-green/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {exporting ? '匯出中…' : '⬇ 匯出圖片'}
        </button>
      </div>

      {/* 顯示選項 */}
      <div className="flex items-center gap-5 text-[13px] text-text-secondary -mt-2">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showName}
            onChange={(e) => setShowName(e.target.checked)}
            className="accent-accent-orange w-3.5 h-3.5 cursor-pointer"
          />
          顯示元件名稱
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showBossAvatar}
            onChange={(e) => setShowBossAvatar(e.target.checked)}
            className="accent-accent-orange w-3.5 h-3.5 cursor-pointer"
          />
          顯示首領頭像
        </label>
      </div>

      {/* 內容 */}
      {loading ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          載入中…
        </div>
      ) : error ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-accent-red">
          資料載入失敗
        </div>
      ) : matrix.rows.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center text-text-dim">
          此分類目前沒有具 BOSS 掉落來源的元件。
        </div>
      ) : (
        <DropTable
          matrix={matrix}
          rootRef={exportRef}
          showName={showName}
          showBossAvatar={showBossAvatar}
          stripPrefix={tab !== 'all'}
        />
      )}
    </div>
  )
}

// ─── 稀有度層級小標（同名 S/A/B 合併後標示其擁有的層級）─────────────────────
// 目前掉落表只看 S（A/B 掉落來源相同、僅效果數值不同，對掉落無意義）→ 暫時隱藏小標。
// 合併邏輯仍保留（每列代表 = 最高稀有度 S）；日後要顯示層級時把此旗標改 true 即可。
const SHOW_RARITY_TIERS = false
const RARITY_TEXT: Record<string, string> = {
  EX: 'text-accent-orange', S: 'text-accent-yellow', A: 'text-accent-purple', B: 'text-accent-blue',
}
function RarityTiers({ rarities }: { rarities: string[] }) {
  return (
    <span className="inline-flex gap-1 leading-none">
      {rarities.map((r) => (
        <span key={r} className={`text-[10px] font-bold ${RARITY_TEXT[r] ?? 'text-text-dim'}`}>{r}</span>
      ))}
    </span>
  )
}

// ─── 掉落格：該關掉落此元件的 BOSS 頭像 + #編號（或只顯示 #編號）─────────────
function DropCell({ stage, bosses, showAvatar }: { stage: number; bosses: number[]; showAvatar: boolean }) {
  if (bosses.length === 0) return <span className="text-text-dim/30">·</span>

  if (!showAvatar) {
    return (
      <span className="text-accent-orange font-semibold whitespace-nowrap">
        {bosses.map((b) => `#${b}`).join(' ')}
      </span>
    )
  }

  return (
    <div className="flex items-center justify-center gap-1.5">
      {bosses.map((b) => (
        <div key={b} className="flex flex-col items-center gap-0.5" title={`首領${stage} · 第 ${b} 個 BOSS`}>
          <img
            src={assetUrl(getBossImagePath(stage, b))}
            alt={`首領${stage} BOSS ${b}`}
            loading="lazy"
            className="w-8 h-8 rounded object-cover object-top border border-border"
            onError={(e) => ((e.currentTarget.style.visibility = 'hidden'))}
          />
          <span className="text-[10px] font-bold text-accent-orange leading-none">#{b}</span>
        </div>
      ))}
    </div>
  )
}

// ─── 矩陣表格（元件圖示 + BOSS 頭像；rootRef 供匯出擷取）──────────────────────
interface DropTableProps {
  matrix: DropMatrix
  rootRef?: React.Ref<HTMLDivElement>
  showName: boolean       // 顯示元件名稱（否則只顯示放大圖示）
  showBossAvatar: boolean // 掉落格顯示 BOSS 頭像（否則只顯示 #編號）
  stripPrefix: boolean    // 去掉名稱的「觸/應元件」前綴（非總表時）
}

function DropTable({ matrix, rootRef, showName, showBossAvatar, stripPrefix }: DropTableProps) {
  const { stages, rows } = matrix
  const iconSize = showName ? 30 : 56

  return (
    <div ref={rootRef} className="bg-bg-card border border-border rounded-xl overflow-x-auto w-fit max-w-full">
      <table className="border-collapse text-[13px]">
        <thead>
          <tr className="bg-white/[0.03]">
            <th className={`sticky left-0 z-10 bg-bg-card px-2.5 py-1.5 font-bold border-b border-r border-border whitespace-nowrap ${showName ? 'text-left' : 'text-center'}`}>
              {showName ? '名稱' : '元件'}
            </th>
            <th className="px-2 py-1.5 text-center font-bold border-b border-r border-border whitespace-nowrap">
              等級
            </th>
            {stages.map((s) => (
              <th key={s} className="px-2 py-1.5 text-center font-bold border-b border-border text-text-secondary whitespace-nowrap">
                首領{s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ comp, rarities, bossesByStage }) => (
            <tr key={comp.id} className="hover:bg-white/[0.02]">
              <td className="sticky left-0 z-10 bg-bg-card px-2.5 py-1 border-b border-r border-border whitespace-nowrap">
                <div className={`flex items-center gap-2 ${showName ? '' : 'flex-col justify-center'}`}>
                  <ComponentIcon comp={comp} size={iconSize} />
                  {(showName || SHOW_RARITY_TIERS) && (
                    <div className={`flex flex-col gap-0.5 ${showName ? 'items-start' : 'items-center'}`}>
                      {showName && (
                        <span className="font-medium">
                          {stripPrefix ? stripTypePrefix(comp.name) : comp.name}
                        </span>
                      )}
                      {SHOW_RARITY_TIERS && <RarityTiers rarities={rarities} />}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-2 py-1 text-center border-b border-r border-border text-text-dim whitespace-nowrap">
                {comp.probabilityLevel > 0 ? `LV.${comp.probabilityLevel}` : '—'}
              </td>
              {stages.map((s) => (
                <td key={s} className="px-2 py-1 text-center border-b border-border">
                  <DropCell stage={s} bosses={bossesByStage[s] ?? []} showAvatar={showBossAvatar} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
