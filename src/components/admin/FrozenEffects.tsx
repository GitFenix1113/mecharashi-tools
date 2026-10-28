// ── 凍結的人工效果欄位（PLAN-065-A C-1）─────────────────────────────────────────
// 總綱決策四：效果數值改由遊戲資料帶出，後台不再提供輸入。這些欄位從上線到凍結**全庫 0 筆**填過
// （2026-10-17 備份實測：技能、BUFF 頂層與各級、背包技能頂層與各級、神驅能力、天賦、模組條件效果），
// 保留輸入口只會讓兩套數值來源將來打架。
//
// 只拿掉輸入，**不刪欄位、不動前台讀取**（型別標 @deprecated）。萬一有殘留的舊值仍唯讀列出——
// 看不到的殘留才是麻煩。用 JSON 原樣列是刻意的：預期永遠是空的，為它做漂亮的格式不划算，
// 而原樣列才不會因為格式化漏掉某個欄位。

export function FrozenEffectsNote({ label, items }: { label: string; items: readonly unknown[] | undefined }) {
  const list = items ?? []
  return (
    <div>
      <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider">{label}</span>
      <p className="mt-1.5 rounded-lg border border-border/60 bg-bg-dark/40 px-3 py-2 text-[12px] text-text-dim leading-relaxed">
        PLAN-065-A 起，效果數值改由遊戲資料帶出，不再人工輸入。
      </p>
      {list.length > 0 && (
        <div className="mt-2 rounded-lg border border-accent-yellow/40 bg-accent-yellow/10 px-3 py-2">
          <p className="text-[12px] text-accent-yellow mb-1">⚠ 既有 {list.length} 筆舊值（唯讀）：</p>
          <ul className="space-y-1">
            {list.map((item, i) => (
              <li key={i} className="font-mono text-[11px] text-text-secondary break-all">{JSON.stringify(item)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
