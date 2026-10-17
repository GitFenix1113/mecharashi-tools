import { mechCardArt, pilotCardArt } from '../../utils/gameArt'
import { usePatchVersions } from '../../hooks/usePatchVersions'
import GachaBanner from '../gacha/GachaBanner'
import { CARD_FOCUS_DEFAULT, clampCardFocus } from '../gacha/cardFocus'
import type { GachaSubjectKind } from '../gacha/gachaBannerStatus'

/**
 * 機甲／機師後台：卡池橫條的收合焦點（PLAN-063 C-1，欄位 Mech.cardFocus／Pilot.cardFocus）。
 *
 * 預覽直接用前台的 GachaBanner——同一個元件、同一套 CSS，所見即所得。只換外框比例：
 * 前台橫條的高度固定、寬度跟著視窗走，而後台的編輯框比前台窄得多；cover 裁切時框越窄、露出的高度越多，
 * 照後台寬度預覽會比前台寬鬆、調出來的焦點在前台就切歪了。所以兩個預覽各自鎖在前台的實際比例
 * （桌機約 1408×120、手機約 358×110），在任何寬度下看到的裁切都和前台一樣。桌機那條太扁、放不下文字，只看裁切。
 */
export function CardFocusField({ kind, form, onChange }: {
  kind: GachaSubjectKind
  form: { name: string; gameId?: string; cardFocus?: number }
  onChange: (v: number | undefined) => void
}) {
  const { data: versions, loading } = usePatchVersions()
  if (!(kind === 'mech' ? mechCardArt(form) : pilotCardArt(form))) {
    return (
      <p className="text-xs text-text-dim">
        卡池橫條焦點：{kind === 'mech' ? '這台' : '這位'}沒有招募插畫（多半是沒開過專屬卡池），不需要調。
      </p>
    )
  }
  const value = clampCardFocus(form.cardFocus)
  const isDefault = form.cardFocus === undefined
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-text-secondary">卡池橫條焦點 cardFocus</span>
        <input
          type="range" min={0} max={100} step={1} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 min-w-[160px] accent-[#ff6b2b]"
          aria-label="卡池橫條焦點（0＝頂、100＝底）"
        />
        <span className="font-mono text-sm w-12 text-right">{value}%</span>
        <button
          type="button"
          disabled={isDefault}
          onClick={() => onChange(undefined)}
          className="text-xs px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          {isDefault ? `預設（${CARD_FOCUS_DEFAULT}）` : '回預設'}
        </button>
      </div>
      <p className="text-[11px] text-text-dim">
        寬橫條只露出插畫約 20% 的高度：往左拉看上面（頭部、天空），往右拉看下面。只調切到腳或天空的那幾台就好。
      </p>
      <div className="space-y-1.5">
        <p className="text-[11px] text-text-dim">桌機（約 1408×120）</p>
        <GachaBanner kind={kind} subject={form} versions={versions} statusReady={!loading} className="gacha-preview gacha-preview--desktop" />
        <p className="text-[11px] text-text-dim">手機（約 358×110）</p>
        <GachaBanner kind={kind} subject={form} versions={versions} statusReady={!loading} className="gacha-preview gacha-preview--mobile" />
      </div>
    </div>
  )
}
