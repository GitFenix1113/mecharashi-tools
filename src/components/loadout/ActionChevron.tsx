// ─── 「這一列點得下去」的記號（使用者要求 2026-08-27）──────────────────────
//
// 「可以的話，能『點選』的功能，外框做出一些差異化。」——使用者逐字。
//
// 框線階（`HUD_ACTIONABLE` vs `HUD_READONLY`）解決的是**同時看到兩者**時的比較，
// 這顆 `›` 解決的是**只看到一個**時的判斷：一列孤零零地擺在那裡，玩家沒有對照組，
// 亮一階的框線幫不上忙。
//
// ⚠ **靜態的**，不是 hover 才出現：手機沒有 hover，而配裝器有一半的使用情境在手機上。
//   hover 時它會變成橘色（由父層的 `group-hover` 帶動），那是確認不是揭露。
//
// ⚠ 放**右緣垂直置中**，不放右下角：`hud-cut` 系列的切角切掉的正是左上與右下兩角，
//   角標放在那裡會被 `clip-path` 裁掉一半。
//
// ⚠ 用 `aria-hidden`：它是一個視覺提示，而那件事（可點）對輔助技術是由
//   `<button>` 或 `role="button"` 表達的。念出一個「›」只是噪音。

export function ActionChevron({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3 h-3 shrink-0 text-text-dim group-hover:text-accent-orange transition-colors ${className}`}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}
