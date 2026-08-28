// 天生模組的「推導 / 人工覆寫」視覺標記 —— PLAN-052-K C-5
//
// ── 為什麼是一個共用元件，而不是兩邊各寫一次 ──────────────────────────────────
// 覆寫是**例外**：全站 90 台今天 0 台有值，而它一旦出現，後台與前台看到的必須是
// 同一個符號 —— 維護者在 MechAdmin 標了「這格我自己填」，玩家在配裝面板要看得出
// 那一格不是規則算的。兩邊各寫一次的下場是其中一邊悄悄漏掉。
//
// ⚠ 052-G 的教訓逐字：「這類做完之後外觀沒有任何改變的功能，收尾時一定要退一步看整頁。」
//   沉默的覆寫＝沉默的技術債 —— 畫面上那個數字來自規則還是人工，看的人永遠不確定。
//
// 沿用 052-G Phase D 的橘色 ◆（`MechPartStrip` 的「◆來源機甲」）：同一種顏色、同一個符號，
// 意思都是「這一格偏離了預設」。

import type { InnateSource } from '../../utils/innateModules'

/**
 * 一格天生模組的來源標記。
 *
 * `override` 一律畫；`rule` **預設不畫** —— 88 台原廠卡上寫「規則推導」是滿版雜訊
 * （與 052-G「換過的部件才印來源機甲」同一條理由）。後台需要它時傳 `showRule`：
 * 維護者判斷「要不要覆寫」的依據就是「現在這格是算的還是填的」，那裡沉默不得。
 */
export function InnateSourceBadge({
  source,
  showRule = false,
  className = '',
}: {
  source: InnateSource
  showRule?: boolean
  className?: string
}) {
  if (source === 'override') {
    return (
      <span
        className={`text-accent-orange text-[11px] leading-tight whitespace-nowrap ${className}`}
        title="這個部位的天生模組是人工指定的，不由規則推導"
      >
        ◆ 人工覆寫
      </span>
    )
  }
  if (!showRule) return null
  return (
    <span
      className={`text-text-dim text-[11px] leading-tight whitespace-nowrap ${className}`}
      title="這個部位的天生模組由規則算出（品質規則表 ＋ 專屬模組的 boundPart / levels）"
    >
      規則推導
    </span>
  )
}
