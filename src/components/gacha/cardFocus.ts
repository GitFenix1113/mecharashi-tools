// 招募插畫在卡池橫條收合時的垂直焦點（PLAN-063 決策 5，欄位 Mech.cardFocus）。
// 寬橫條只露出約 20% 的畫面高度：構圖每張不同（原型實測莫比烏斯X 要 15%、芬里厄要 40%），預設值只求「多數看起來還行」。

/** 未填時的焦點（%）：多數插畫的機體上半身落在這附近 */
export const CARD_FOCUS_DEFAULT = 30

/** 0–100 的整數；不是有限數字（未填、資料打錯）就回預設值 */
export function clampCardFocus(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v))) : CARD_FOCUS_DEFAULT
}
