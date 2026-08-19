import { useCallback, useState } from 'react'
import type { PatchVersion } from '../../data/patchVersions'
import { resolveBannerSrc } from '../../utils/assets'
import VersionGanttPanel from './VersionGanttPanel'
import VersionRail from './VersionRail'

interface Props {
  versions: PatchVersion[]
  activeIndex: number
  onNavigate: (idx: number) => void
}

/**
 * 單一版本的內容視圖（PLAN-050 C-2 / C-3 之後）。
 *
 * 以前這是一個 clip-path 圓形展開的 modal，蓋在焦點輪播上。那個設計讓
 * **「比較兩個版本」變成不可能**，而那正是版本頁最常見的問題；現在它是頁面本體，
 * 版本選擇列常駐、每個版本都有自己的網址，要比較就開兩個分頁並排。
 *
 * 頂部的信箱式色帶取代了原本鋪在資料底下的橫幅（見下方 BANNER 註解）。
 */

// ═══════════════════════════════════════════════════════════════════════════
// 版本橫幅：從「資料的底」搬到「資料的上」
// ═══════════════════════════════════════════════════════════════════════════
//
// 原本橫幅是鋪滿整個面板的背景，甘特與卡片的 11–13px 細字直接壓在機甲立繪上。
// 那是一場**裝飾與可讀性的零和**：為了搶回對比度，程式碼長出三個互相耦合的調整鈕
// （BANNER_OPACITY / BANNER_SCRIM / SURFACE），而且三次都往同一個方向調 —— 把圖蓋掉。
// 終點很明確：把 scrim 加到圖看不見，那就等於沒放圖。
//
// 而且它保證不了對比度：橫幅是一張張不同的畫作，亮度各異，沒有任何一組固定的
// opacity/scrim 能讓所有版本都達到 WCAG AA（4.5:1）。
//
// 解法是換位置而不是丟掉：桌機把橫幅切成頂部的信箱式色帶（object-top 取畫面上緣，
// 那裡通常是角色臉部），右端漸暗成純色，版本名與工具列壓在暗端 —— 文字底下永遠是
// 實色，對比度可驗證。行動版垂直預算最緊，不吃高度，改用右上角的暈影。
//
// 行動版刻意用 min-h 而不是固定高度：工具列在 390px 下必然換行，
// 寫死高度會把下面的版本選擇列擠出 overflow-hidden 的邊界（實測整條消失）。
const BAND_H = 'min-h-[76px] lg:h-[116px]'

export default function VersionDetailView({ versions, activeIndex, onNavigate }: Props) {
  const version = versions[activeIndex]
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex < versions.length - 1

  /**
   * 預設看哪一服：**未來版本看陸版，當前與過去看台版**。
   *
   * 理由是哪一邊的資料才是「查得到的事實」：台服還沒到的版本，它的檔期是社群依陸版
   * 反推的（`twIsPredicted`），而同一段期間的陸版早就跑完、公告俱在。
   * 預設攤開推估值而不是既成事實，等於讓讀者先看到最不確定的那一份。
   *
   * 用 `isTwCurrent` 當分界而不是自己比日期：那個旗標由 usePatchVersions 統一計算
   * （`applyTwCurrent`），且**支援後台手動覆寫** —— 兩邊各算一次遲早會不一致。
   * 找不到當前版本（資料未標）時全部維持台版，與改動前同行為。
   */
  const twCurrentIndex = versions.findIndex(v => v.isTwCurrent)
  const isFutureVersion = twCurrentIndex >= 0 && activeIndex > twCurrentIndex
  const autoSide: 'tw' | 'cn' = isFutureVersion ? 'cn' : 'tw'

  /**
   * 手動切換只在「停留在這個版本時」有效，一換版本就回到自動判斷。
   *
   * 曾經做成「記住每個版本各自的選擇」，實測後改掉：那會讓同一個版本這次開是陸版、
   * 下次開是台版，取決於使用者稍早做過什麼 —— 自動行為一旦不可預測就比沒有更糟。
   * 現在的規則只有一句話：**換版本 ＝ 重置為自動**。
   *
   * 用包一層 navigate 而不是在 effect 裡重設 state（後者會多一次 render，
   * 也是 react-hooks/set-state-in-effect 明文反對的寫法）。
   */
  const [manualSide, setManualSide] = useState<'tw' | 'cn' | null>(null)
  const side = manualSide ?? autoSide
  const toggleSide = () => setManualSide(side === 'tw' ? 'cn' : 'tw')

  const navigate = useCallback((idx: number) => {
    setManualSide(null)
    onNavigate(idx)
  }, [onNavigate])

  const bannerSrc = version.bannerImage ? resolveBannerSrc(version.bannerImage) : null

  const NavBtn = ({ dir }: { dir: 'prev' | 'next' }) => {
    const disabled = dir === 'prev' ? !hasPrev : !hasNext
    const label = dir === 'prev' ? '上版' : '下版'
    const d = dir === 'prev' ? 'M9 3L5 7L9 11' : 'M5 3L9 7L5 11'
    return (
      <button
        onClick={() => !disabled && navigate(dir === 'prev' ? activeIndex - 1 : activeIndex + 1)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-bg-dark/70 text-xs text-text-dim
                   disabled:opacity-30 hover:enabled:border-accent-orange/50 hover:enabled:text-accent-orange
                   transition-colors cursor-pointer"
        aria-label={label}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {label}
      </button>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0 rounded-2xl border border-border bg-bg-dark overflow-hidden">

      {/* ── 信箱式橫幅帶 ── */}
      <div className={`relative shrink-0 overflow-hidden ${BAND_H} bg-bg-card`}>
        {bannerSrc && (
          <>
            {/* 桌機：滿寬信箱帶 */}
            <img
              src={bannerSrc}
              alt=""
              className="hidden lg:block absolute inset-0 w-full h-full object-cover object-top"
              draggable={false}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            {/* 右端漸暗成純色 —— 工具列文字底下永遠是實色，不必再跟畫作賭對比度 */}
            <div className="hidden lg:block absolute inset-0 bg-gradient-to-r from-transparent via-bg-dark/70 to-bg-dark" />
            {/* 行動版：不吃高度的角落暈影（垂直預算最緊，信箱帶在這裡是奢侈品） */}
            <img
              src={bannerSrc}
              alt=""
              className="lg:hidden absolute right-0 top-0 h-full w-1/2 object-cover object-top opacity-25
                         [mask-image:linear-gradient(to_left,black,transparent)]"
              draggable={false}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          </>
        )}

        {/* 帶上的內容：上排工具列、下排版本選擇列 */}
        <div className="relative z-10 h-full flex flex-col justify-between py-1.5">
          <div className="flex items-center justify-start lg:justify-end gap-x-2 gap-y-1 px-3 flex-wrap">
            <span className="text-sm font-bold text-accent-orange font-[Orbitron,sans-serif] drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              v{version.version}{version.name ? ` ${version.name}` : ''}
            </span>
            <span className="text-[11px] text-text-dim font-[JetBrains_Mono,monospace]">
              台 {version.upper.twDate ?? '—'}
            </span>
            {version.isTwCurrent && (
              <span className="text-[10px] bg-accent-green/15 text-accent-green border border-accent-green/30 px-1.5 py-0.5 rounded">
                ★ 台服當前
              </span>
            )}
            {/* 未來版本標記。沒有這一行的話，讀者只會看到畫面莫名其妙變成陸版 ——
                自動行為必須說得出理由，否則就是不可預測 */}
            {isFutureVersion && (
              <span
                className="text-[10px] bg-accent-purple/15 text-accent-purple border border-accent-purple/30 px-1.5 py-0.5 rounded"
                title="台服尚未推出，檔期由社群依陸版反推；預設顯示陸版的既成事實"
              >
                未來版本
              </span>
            )}
            <button
              onClick={toggleSide}
              title={isFutureVersion && side === 'cn'
                ? '這是未來版本，預設顯示陸版；台版檔期為社群推估'
                : undefined}
              className="px-2 py-1 text-[11px] rounded border border-accent-purple/50 bg-accent-purple/15 text-accent-purple hover:bg-accent-purple/25 transition-colors font-medium tracking-wide cursor-pointer"
            >
              {side === 'tw' ? '台版' : '陸版'} ⇄ {side === 'tw' ? '切換陸版' : '切換台版'}
            </button>
            <div className="flex gap-1.5">
              <NavBtn dir="prev" />
              <span className="hidden lg:inline text-xs text-text-dim self-center px-1">{activeIndex + 1}/{versions.length}</span>
              <NavBtn dir="next" />
            </div>
          </div>

          {/*
            版本選擇列坐在**近乎不透明**的底條上，而不是直接壓在橫幅圖上。
            理由與 C-3 換掉三顆透明度旋鈕的理由是同一個：橫幅一張張亮度不同
            （v3.4 是整片銀白），12px 的版本號疊上去就會消失。
            信箱帶的價值在於「圖有出現」，不在於「圖鋪滿每一個像素」。
          */}
          <div className="bg-bg-dark/95">
            <VersionRail versions={versions} activeIndex={activeIndex} onSelect={navigate} />
          </div>
        </div>
      </div>

      {/* ── 資料區：不透明實色 ── */}
      <div className="flex-1 min-h-0 flex flex-col p-2 lg:p-3">
        <VersionGanttPanel
          version={version}
          // 上一個版本 —— 甘特要據此撈出「跨進本版的活動」（戰令常跨版，
          // 標在它開跑的那一版，但下一版仍在進行中，讀者需要看得到）
          prevVersion={activeIndex > 0 ? versions[activeIndex - 1] : undefined}
          side={side}
        />
      </div>
    </div>
  )
}
