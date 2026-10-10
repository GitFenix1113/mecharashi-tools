// 歷史足跡：每個歷史位置（history.state.idx）當時的網址（2026-10-11）
//
// 用途只有一個 ——「返回清單」要知道**上一頁是不是那份清單**：
//   是 → 等同按上一頁（navigate(-1)），回到清單原本捲到的位置、篩選條件也還在
//   否 → 開一份新的清單（從引用浮窗、外部連結、書籤進來的人沒有可以「回去」的清單）
// 不這樣分的話，「← 機甲圖鑑」永遠是開一份新的清單、停在最上方 —— 使用者在清單捲到的位置白白丟掉。
//
// ⚠ 只能問「前一格」：瀏覽器不讓網頁讀別的歷史項目，所以由 ScrollManager 在每次換頁時
//   記下「這一格是哪個網址」。PUSH 會讓瀏覽器丟掉目前位置之後的歷史，這裡較大的 idx 可能是舊的，
//   但 idx - 1 一定是剛剛走過的那一格（同一次瀏覽、同一個文件裡），問它是安全的。
// ⚠ 跨文件（從網址列打開新網址）時 idx 從 0 重新起算，舊記錄會被覆寫；
//   萬一對不上，最壞的結果是退回「開一份新的清單」，不會把人帶到錯的地方。

const STORAGE_KEY = 'mecharashi_history_trail'
/** 只留最近的位置；超過就從最舊的丟 */
const MAX_ENTRIES = 100

type Trail = Record<string, string>   // idx → pathname + search

let trail: Trail | null = null

function load(): Trail {
  if (trail) return trail
  try {
    trail = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Trail
  } catch {
    trail = {}
  }
  return trail
}

/** 記下「第 idx 格是這個網址」。由 ScrollManager 在每次換頁時呼叫 */
export function recordTrailEntry(idx: number, path: string): void {
  const t = load()
  t[idx] = path
  const keys = Object.keys(t).map(Number).sort((a, b) => a - b)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete t[k]
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(t))
  } catch {
    // 儲存被鎖：只是重新整理後「返回清單」退回開新清單，不影響本次瀏覽
  }
}

/** 目前所在的歷史位置；React Router 寫在 history.state.idx（初始化時一定會補上） */
export function currentHistoryIdx(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : 0
}

export function previousTrailPath(idx: number): string | undefined {
  return idx > 0 ? load()[idx - 1] : undefined
}

/**
 * 「返回清單」該怎麼回去。純函式，給單元測試釘住。
 * @param prevPath 前一格的網址（pathname + search）；不知道就是 undefined
 * @param listPath 清單的路徑，例如 `/mechs`
 */
export function backToListAction(prevPath: string | undefined, idx: number, listPath: string): 'back' | 'push' {
  if (idx <= 0 || !prevPath) return 'push'
  const prevPathname = prevPath.split(/[?#]/)[0]
  // 只比 pathname：清單上的篩選（?armor=…）正是要原樣帶回去的狀態
  return prevPathname === listPath ? 'back' : 'push'
}
