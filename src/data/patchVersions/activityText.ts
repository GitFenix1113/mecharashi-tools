// PLAN-048 Phase 0（任務 0-3）：把硬塞在活動名稱裡的獎勵拆出來

/**
 * 既有資料把獎勵硬塞在名稱括號裡：
 *   「瑞歲百角戲(輕型通用改裝模組*1 仿生超導體*2)」
 *   → { base: '瑞歲百角戲', rewards: ['輕型通用改裝模組×1', '仿生超導體×2'] }
 *
 * 但括號內不一定是獎勵。實測 75 筆活動裡 34 筆有括號，其中真正 `A*1 B*2`
 * 形狀的只有 15 筆；其餘是外觀名（「維娜外觀【夜話邀約】」）、機制說明
 * （「體力轉票券商店」）、甚至空括號（「角雕輪盤()」）。
 * 所以規則刻意保守：**括號內沒有「符號 + 數字」就整串當名稱**——
 * 寧可少抽，也不要把機制說明顯示成獎勵。
 *
 * 為什麼做成前台 runtime fallback 而不是後台一次性 migration：
 * 後者只救得了按下按鈕的那一次；前者同時救了歷史資料與「未來維護者又用
 * 老方法打字」的情況，而後者一定會發生。`act.rewards` 已填時一律以欄位為準。
 */
export function splitActivityName(act: {
  name: string
  rewards?: string[]
}): { base: string; rewards: string[] } {
  const m = act.name.match(/^\s*(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$/)

  // 欄位優先：有 rewards 就用它，名稱仍去掉括號段（若括號段看起來就是那批獎勵）
  if (act.rewards?.length) {
    return { base: m?.[1] ?? act.name, rewards: act.rewards }
  }

  const inner = m?.[2]
  if (!inner || !/[*＊×xX]\s*\d/.test(inner)) {
    // 「白夜凍鋒（復刻）」「角雕輪盤()」等：括號不是獎勵 → 名稱保留完整
    return { base: act.name, rewards: [] }
  }

  return {
    base: m![1],
    rewards: inner
      .split(/[\s、,，]+/)
      .filter(Boolean)
      .map(s => s.replace(/[*＊xX]/, '×')),
  }
}
