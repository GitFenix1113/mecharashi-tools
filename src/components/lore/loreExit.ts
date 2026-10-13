/**
 * 出館過場（PLAN-042-G A-1）：進館是「推門」（LoreLayout 的 .lore-veil 以斜切擦開），出館反向「關門」——
 * 新頁面（深色的站內）以同一道斜邊從右側蓋回來。樣式在 index.css 的 `html.lore-exiting` 區塊。
 *
 * 用 View Transitions：瀏覽器先拍下館內畫面 → 呼叫 update callback 換頁 → 等 callback 回傳的 Promise 結束後拍新畫面。
 *
 * ⚠ 不能照教科書寫 `flushSync(() => navigate(to))`：React Router v7 的 <BrowserRouter> 預設把路由的 setState
 *   包在 `React.startTransition` 裡（useTransitions 沒設＝開），transition 不吃 flushSync——callback 結束時
 *   React 還沒換頁，拍到的「新畫面」仍是故事館，整段過場等於沒播。<Link viewTransition> 也只對 data router 有效。
 *   所以改成等「真的離館了」：LoreLayout 卸載時會拿掉 `html.lore-mode`，看到它消失＝新頁面已 commit、body 也換回深色。
 * ⚠ 樣式只掛在 `html.lore-exiting` 底下、不寫裸的 `::view-transition-*`：日後站上別處用到 View Transitions 不會被套上關門動畫。
 * 不支援的瀏覽器、reduced-motion：直接換頁。
 */

/** 等館外的頁面 commit 完（不等就截圖會拍到故事館）；保險絲 1.5 秒，避免畫面被凍住太久 */
const SETTLE_TIMEOUT_MS = 1500

function untilLeft(html: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (!html.classList.contains('lore-mode')) { resolve(); return }
    // MutationObserver 而不是 rAF 輪詢：update callback 期間瀏覽器暫停繪製，rAF 不保證會跑
    const mo = new MutationObserver(() => { if (!html.classList.contains('lore-mode')) finish() })
    const timer = window.setTimeout(finish, SETTLE_TIMEOUT_MS)
    function finish() {
      mo.disconnect()
      clearTimeout(timer)
      resolve()
    }
    mo.observe(html, { attributes: true, attributeFilter: ['class'] })
  })
}

export function exitLore(navigate: (to: string) => void, to: string): void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || typeof document.startViewTransition !== 'function') {
    navigate(to)
    return
  }
  const html = document.documentElement
  html.classList.add('lore-exiting')
  const vt = document.startViewTransition(() => {
    navigate(to)
    return untilLeft(html)
  })
  const done = () => html.classList.remove('lore-exiting')
  vt.finished.then(done, done)
  // 過場被跳過（分頁在背景、連點兩次）時 ready 會 reject；換頁本身照常完成，不必報錯
  vt.ready.catch(() => {})
}
