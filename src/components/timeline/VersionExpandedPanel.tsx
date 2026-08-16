import type { PatchVersion } from '../../data/patchVersions'
import { resolveBannerSrc } from '../../utils/assets'
import VersionGanttPanel from './VersionGanttPanel'

// ═══════════════════════════════════════════════════════════════════════════
// 版本橫幅背景的濃淡 —— 想調整就改這三個常數，不必翻下面的 JSX
// ═══════════════════════════════════════════════════════════════════════════
//
// 三層由下往上疊：底色 → 橫幅圖 → 遮罩(scrim)。
// 橫幅圖本身很花（機甲立繪 + 高彩度背景），而甘特的活動條與卡片是 11–13px
// 的細字，直接壓在畫作上會讀不到 —— 對比度不足時，資訊等於沒顯示。
//
// 調整方向：
//   想讓橫幅更明顯 → BANNER_OPACITY 調高（如 opacity-55）、SCRIM 調低（如 /40 /50 /65）
//   想讓文字更清楚 → BANNER_OPACITY 調低（如 opacity-30）、SCRIM 調高（如 /70 /80 /90）
// 數字是 Tailwind 的不透明度百分比；必須寫成完整的 class 字面值，
// 否則 Tailwind v4 掃不到、不會產生對應的 CSS。

/** 橫幅圖本身的不透明度（原 opacity-80，過亮） */
const BANNER_OPACITY = 'opacity-40'

/** 橫幅之上的暗色遮罩，由上往下漸深（原 /20 /35 /65，頂部幾乎沒遮） */
const BANNER_SCRIM = 'from-bg-dark/60 via-bg-dark/70 to-bg-dark/85'

/** 橫幅之下的底色（沒有橫幅圖的版本只會看到這層） */
const BANNER_BASE = 'from-bg-card/30 to-bg-card-hover/60'

interface Props {
  version: PatchVersion
  isExpanded: boolean
  /** Server side currently displayed in the Gantt panel. */
  side?: 'tw' | 'cn'
}

export default function VersionExpandedPanel({ version, isExpanded, side = 'tw' }: Props) {
  const bannerSrc = version.bannerImage
    ? resolveBannerSrc(version.bannerImage)
    : null

  return (
    <div
      className="flex-1 min-h-0 flex flex-col overflow-hidden transition-opacity duration-300 ease-in-out"
      style={{ opacity: isExpanded ? 1 : 0 }}
    >
      <div className="relative overflow-hidden flex-1 min-h-0 flex flex-col rounded-xl">

        {/* ── Background layer ── */}
        <div className="absolute inset-0 pointer-events-none select-none">
          <div className={`absolute inset-0 bg-gradient-to-br ${BANNER_BASE}`} />
          {bannerSrc && (
            <img
              src={bannerSrc}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover object-top ${BANNER_OPACITY}`}
              draggable={false}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <div className={`absolute inset-0 bg-gradient-to-b ${BANNER_SCRIM}`} />
        </div>

        <div className="relative z-10 pt-3 pb-3 px-3 flex-1 min-h-0 flex flex-col">
          <VersionGanttPanel version={version} side={side} />
        </div>

      </div>
    </div>
  )
}
