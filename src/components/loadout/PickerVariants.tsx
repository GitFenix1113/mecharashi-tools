import { imageCandidates } from '../../utils/assets'
import { FallbackImage } from '../common/FallbackImage'
import { HUD } from './loadoutTheme'
import type { PickerRowItem } from './RejectionRow'
import type { Rejection } from '../../utils/loadoutRules'

// ─── 挑選器的兩種非清單呈現（PLAN-052-I C-2／C-3）────────────────────────────
//
// 武器與背包用清單列（`RejectionRow`）；機師與機甲各有自己的長相，理由不同：
//
//   機師 → **頭像牆**。87 位機師是站上最大的一批美術資產，用文字清單挑等於把
//          「認人」這件本來一眼就能做完的事，退化成讀 87 行字。
//   機甲 → **橫向卡**。`portrait.webp` 是 560×340 的橫圖，塞進 40px 的方形 icon
//          會縮到看不出是哪一台；橫向卡讓縮圖有 3:2 的空間。
//
// ⚠ 兩者都**沿用同一套拒絕呈現**：可選正常、`situational` 灰掉＋原因＋解法鍵、
//   `structural` 由 `HiddenCountBar` 摺疊。呈現換了，規則沒有第二份。

interface CardProps {
  item: PickerRowItem
  rejection: Rejection | null
  /**
   * 「裝上將取代 …」這類**不擋、只提示**的一句話。
   *
   * ⚠ 頭像牆上它**不印成文字**，只把該格調暗並掛一顆警示點（完整句子進 `title`）。
   *   理由是密度：89 位機師裡通常有三分之二執照不符，逐格印兩行青字會讓整面牆
   *   變成一片說明文，反而看不出誰能選。真正該講的那一句改成整份清單上方的一行提要
   *   （`hint`），只講一次。
   */
  replaceNote?: string
  /** 目前選中的那一個（機師／機甲挑選器是單選，要標出來） */
  selected?: boolean
  onPick: () => void
  onResolve?: () => void
  onHover?: (hovering: boolean) => void
}

// ─── 機師頭像格 ─────────────────────────────────────────────────────────────

/**
 * ⚠ `half.webp` **不是去背圖**，每張帶各自不同的原生背景色（實測有灰、綠、粉）。
 *   直接鋪成網格會花掉整面牆，所以每一格一律三件套：
 *     統一卡框 ＋ 底部漸層遮罩（壓住背景、讓名字讀得到）＋ 左側 3px 職業色條。
 *
 * ⚠ 87 張必須 `loading="lazy"`：全載約 2.6MB。
 */
export function PilotAvatarCard({
  item, rejection, replaceNote, selected, onPick, onResolve, onHover,
}: CardProps) {
  const blocked = rejection !== null
  const situational = rejection?.tier === 'situational'
  const tone = item.tone ?? 'text-text-secondary'

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <button
        type="button"
        onClick={blocked ? undefined : onPick}
        disabled={blocked}
        onMouseEnter={() => onHover?.(true)}
        onMouseLeave={() => onHover?.(false)}
        title={replaceNote ? `${item.name}｜${item.meta}｜${replaceNote}` : `${item.name}｜${item.meta}`}
        className={`hud-cut-sm relative block w-full aspect-square overflow-hidden bg-bg-dark border transition-colors ${
          selected ? 'border-accent-orange' : blocked ? 'border-border-subtle' : 'border-border hover:border-accent-orange/60'
        } ${blocked ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer'} ${
          !blocked && replaceNote ? 'opacity-80' : ''
        }`}
      >
        <FallbackImage
          candidates={imageCandidates(item.icon)}
          alt=""
          loading="lazy"
          className={`w-full h-full object-cover contrast-[1.04] ${
            !blocked && replaceNote ? 'saturate-[0.35]' : 'saturate-[0.92]'
          }`}
          fallback={
            <span className="absolute inset-0 flex items-center justify-center text-[11px] text-text-dim">
              尚無立繪
            </span>
          }
        />
        {/* 遮罩壓住各不相同的原生背景色，名字才讀得到 */}
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,12,16,0.05)_38%,rgba(10,12,16,0.92))]"
        />
        <span aria-hidden className={`absolute left-0 top-0 w-[3px] h-full ${toneBar(tone)}`} />

        {item.badge && (
          <span className="hud-cut-sm absolute right-1 top-1 px-1.5 text-[10px] font-bold text-bg-dark bg-accent-orange">
            {item.badge}
          </span>
        )}
        {/* 執照與目前機甲不符：只標記，不擋 —— 完整原因在 title 與上方的提要 */}
        {!blocked && replaceNote && (
          <span
            className="hud-cut-sm absolute left-1 top-1 w-4 h-4 flex items-center justify-center bg-accent-yellow/85 text-bg-dark text-[10px] font-bold leading-none"
            aria-label={replaceNote}
          >
            !
          </span>
        )}

        <span className="absolute left-2 right-2 bottom-1.5 flex flex-col text-left">
          <span className="text-[13px] font-bold text-text-primary leading-tight truncate">{item.name}</span>
          <span className={`text-[11px] leading-tight truncate ${tone}`}>{item.meta}</span>
        </span>
      </button>

      {rejection && (
        <div className="flex flex-col gap-1">
          <span className={`text-[11px] leading-tight ${situational ? 'text-accent-yellow/90' : 'text-text-dim'}`}>
            {rejection.reason}
          </span>
          {situational && onResolve && (
            <button
              type="button"
              onClick={onResolve}
              className="hud-cut-sm self-start text-[11px] px-2 py-0.5 border border-accent-orange/40 text-accent-orange hover:bg-accent-orange/10 transition-colors cursor-pointer"
            >
              {rejection.tier === 'situational' ? rejection.resolution.label : ''}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 職業色條：`CLASS_CONFIG` 給的是 `text-*`，色條要的是 `bg-*`。
 * 用查表而不是字串替換 —— Tailwind v4 掃的是**原始碼裡出現過的完整類名**，
 * 執行期拼出來的 `bg-accent-green` 不會被產生（會靜默變成沒有底色的色條）。
 */
const TONE_BAR: Record<string, string> = {
  'text-accent-green': 'bg-accent-green',
  'text-accent-orange': 'bg-accent-orange',
  'text-accent-red': 'bg-accent-red',
  'text-accent-blue': 'bg-accent-blue',
  'text-accent-purple': 'bg-accent-purple',
  'text-accent-cyan': 'bg-accent-cyan',
  'text-accent-yellow': 'bg-accent-yellow',
}
const toneBar = (tone: string) => TONE_BAR[tone] ?? 'bg-text-dim'

// ─── 機甲橫向卡 ─────────────────────────────────────────────────────────────

export function MechPickerCard({
  item, rejection, replaceNote, selected, onPick, onResolve, onHover,
}: CardProps) {
  const blocked = rejection !== null
  const situational = rejection?.tier === 'situational'

  return (
    <div
      className={`hud-cut-sm flex gap-2.5 p-2 border transition-colors ${
        selected ? 'border-accent-orange bg-accent-orange/5'
        : blocked ? 'border-border-subtle bg-bg-dark/30 opacity-70'
        : 'border-border bg-bg-card hover:border-accent-orange/60 cursor-pointer'
      }`}
      onClick={blocked ? undefined : onPick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      role={blocked ? undefined : 'button'}
      tabIndex={blocked ? undefined : 0}
      onKeyDown={(e) => { if (!blocked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick() } }}
    >
      {/* 3:2 的縮圖框 —— portrait.webp 是 560×340 的橫圖 */}
      <span className="hud-cut-sm shrink-0 w-[78px] h-[52px] flex items-center justify-center bg-bg-dark border border-border-subtle overflow-hidden">
        <FallbackImage
          candidates={imageCandidates(item.icon)}
          alt=""
          loading="lazy"
          className="max-w-full max-h-full object-contain"
          fallback={<span className="text-[10px] text-text-dim">無圖</span>}
        />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-[13px] font-semibold truncate ${blocked ? 'text-text-secondary' : 'text-text-primary'}`}>
            {item.name}
          </span>
          {item.weight !== undefined && (
            <span className={`ml-auto shrink-0 ${HUD.num} text-[11px] text-text-dim`}>
              {item.weight.toLocaleString()}
            </span>
          )}
        </div>
        <div className={`text-[11px] truncate ${item.tone ?? 'text-text-dim'}`}>{item.meta}</div>
        {item.sub && <div className={`${HUD.num} text-[10px] text-text-dim truncate`}>{item.sub}</div>}
        {item.warning && <div className="text-[11px] text-accent-yellow/90 leading-snug">{item.warning}</div>}

        {rejection && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-[11px] ${situational ? 'text-accent-yellow/90' : 'text-text-dim'}`}>
              {rejection.reason}
            </span>
            {situational && onResolve && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onResolve() }}
                className="hud-cut-sm text-[11px] px-2 py-0.5 border border-accent-orange/40 text-accent-orange hover:bg-accent-orange/10 transition-colors cursor-pointer"
              >
                {rejection.tier === 'situational' ? rejection.resolution.label : ''}
              </button>
            )}
          </div>
        )}
        {!rejection && replaceNote && (
          <div className="mt-0.5 text-[11px] text-accent-cyan/90 leading-snug">{replaceNote}</div>
        )}
      </div>
    </div>
  )
}
