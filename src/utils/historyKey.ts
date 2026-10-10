// 歷史項目的 key（2026-10-11，給 components/layout/ScrollManager.tsx 的換頁捲動記錄用）

/**
 * React Router 給「history.state 裡沒有 key 的那一項」的 key ——
 * 也就是從網址列、書籤、搜尋結果**直接打開**的第一頁。同一個分頁裡每次直接打開新網址都是它，
 * 拿它當記錄的鍵，新網址就會繼承上一個網址的高度。
 * 正常情況下 `ensureHistoryKey()` 已經替第一頁補上真的 key，走不到這裡；保留這道防線以防萬一。
 */
export const UNKEYED_HISTORY_KEY = 'default'

/**
 * 替「直接打開的第一頁」補一個歷史 key。**必須在 <BrowserRouter> 建立之前呼叫**（main.tsx）。
 *
 * 不補的話第一頁的 key 是 `'default'`（見上），只能不記 —— 結果偏偏擋掉最常見的路徑：
 * 從搜尋結果直接進機甲圖鑑、捲下去點一台、按上一頁，會回到頂端。
 * 寫進 history.state 的 key 重新整理後仍在，所以重新整理也回得到原位。
 *
 * ⚠ 相容性：React Router 讀 `history.state.key`，初始化時的 replaceState 會展開既有 state
 *   （`{ ...globalHistory.state, idx }`），所以補上的 key 會被保留、並成為 location.key。
 *   格式比照它自己的 createKey()（8 碼 base36）。
 */
export function ensureHistoryKey(): void {
  try {
    const state = window.history.state as { key?: string } | null
    if (state && typeof state === 'object' && state.key) return
    const key = Math.random().toString(36).substring(2, 10)
    window.history.replaceState({ ...(state ?? {}), key }, '')
  } catch {
    // 拿不到 history（極少數嵌入環境）：退回 'default' 的保守行為
  }
}
