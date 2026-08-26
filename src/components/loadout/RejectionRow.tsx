import { WeaponIcon } from '../icons/WeaponIcon'
import type { Rejection } from '../../utils/loadoutRules'

// ─── 挑選器的一列（PLAN-052-B C-1）───────────────────────────────────────────
//
// 決策二的兩層拒絕呈現，在這裡落地成三種列：
//   可裝           → 正常可點
//   situational    → **灰掉 ＋ 原因 ＋ 解法按鈕**（改別的就能解）
//   structural     → 預設摺疊；展開後灰掉 ＋ 原因，**沒有**解法按鈕（改別的也解不掉）
//
// ⚠ 灰掉卻沒有解法按鈕的 situational 列，就是「玩家會來問客服」的那一種 ——
//   型別層已經逼你在 `rejectSituational()` 填 resolution，這裡只負責把它畫出來。

/**
 * 一列要顯示的東西。武器、背包、機師、機甲都先攤成這個形狀，
 * 呈現層（清單列／頭像牆／機甲卡）不認識那四個型別。
 */
export interface PickerRowItem {
  id: string
  name: string
  icon?: string
  /** 重量。機師這種「沒有重量可言」的實體留空，不要填 0 —— 0 看起來像一個真的數值 */
  weight?: number
  /** 副標，如「戰術 · 電磁炮 · 背後」或「出力背包 · S」 */
  meta: string
  isExclusive?: boolean
  /** 主色（Tailwind `text-*`）。頭像牆的職業色條與副標、機甲卡的裝甲類型都走它（PLAN-052-I C-2） */
  tone?: string
  /** 右上角小徽章，目前只用於品質（S／A／B） */
  badge?: string
  /** 第二行細節，如機甲的「出力 2,740 · 手2 肩2 背1」 */
  sub?: string
  /**
   * 黃字警語。**與 rejection 不同**：這一列照樣可選，只是有件事得先講。
   * 現有唯一來源是數值未公布的佔位機甲（出力 0）—— 那不是拒絕，是資料狀態。
   */
  warning?: string
}

interface Props {
  item: PickerRowItem
  rejection: Rejection | null
  /** 裝上這一件之後的剩餘出力（可裝的列才給）。讓玩家不必按下去才知道還剩多少 */
  remainingAfter?: number
  /** 「裝上將取代 右手 麥克斯」—— 先印出來，**不灰掉也不阻擋**（決策三） */
  replaceNote?: string
  onPick: () => void
  /** 解法按鈕：把 rejection 附的 action 派給 reducer（UI 不自己組動作） */
  onResolve?: () => void
  onHover?: (hovering: boolean) => void
}

export function RejectionRow({ item, rejection, remainingAfter, replaceNote, onPick, onResolve, onHover }: Props) {
  const blocked = rejection !== null
  const situational = rejection?.tier === 'situational'

  return (
    <div
      className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg border transition-colors ${
        blocked
          ? 'border-border-subtle bg-bg-dark/30 opacity-70'
          : 'border-border bg-bg-card hover:border-accent-orange/60 cursor-pointer'
      }`}
      onClick={blocked ? undefined : onPick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      role={blocked ? undefined : 'button'}
      tabIndex={blocked ? undefined : 0}
      onKeyDown={(e) => { if (!blocked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick() } }}
    >
      <WeaponIcon icon={item.icon} name={item.name} size="sm" isExclusive={item.isExclusive} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-[13px] truncate ${blocked ? 'text-text-secondary' : 'text-text-primary'}`}>
            {item.name}
          </span>
          {item.weight !== undefined && (
            <span className="ml-auto shrink-0 text-[11px] text-text-dim font-[JetBrains_Mono,monospace]">
              {item.weight.toLocaleString()}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-dim truncate">{item.meta}</div>
        {item.sub && <div className="text-[11px] text-text-dim truncate">{item.sub}</div>}
        {item.warning && <div className="text-[11px] text-accent-yellow/90">{item.warning}</div>}

        {rejection && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-[11px] ${situational ? 'text-accent-yellow/90' : 'text-text-dim'}`}>
              {rejection.reason}
            </span>
            {situational && onResolve && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onResolve() }}
                className="text-[11px] px-2 py-0.5 rounded border border-accent-orange/40 text-accent-orange hover:bg-accent-orange/10 transition-colors cursor-pointer"
              >
                {rejection.tier === 'situational' ? rejection.resolution.label : ''}
              </button>
            )}
          </div>
        )}

        {/* ⚠ 取代提示先印出來，但**不灰掉也不阻擋**：換手上那把是配裝最常見的動作，
            擋下來只會逼玩家先卸再裝、多按一次 */}
        {!rejection && replaceNote && (
          <div className="mt-0.5 text-[11px] text-accent-cyan/90">{replaceNote}</div>
        )}
        {!rejection && remainingAfter !== undefined && (
          <div className="mt-0.5 text-[11px] text-text-dim">
            裝上後餘 <span className="font-[JetBrains_Mono,monospace]">{remainingAfter.toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  )
}
