/**
 * 等 n 個動畫幀，**但帶逾時退場**。
 *
 * ── 這支存在的理由：背景分頁不會觸發 requestAnimationFrame ────────────────────
 *
 * 站上四處「把畫面拍成 PNG」的匯出功能，都要在改完樣式（撐開捲動容器、
 * 換成 inline-grid…）之後等瀏覽器重排完才能 `toPng`，否則拍到的是舊版面。
 * 慣用寫法是裸的雙層 rAF：
 *
 *     await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
 *
 * 問題是 **rAF 在背景分頁不會被觸發**。使用者按下匯出後切去別的分頁——
 * 一個再普通不過的動作，因為匯出本來就要等幾秒——這個 Promise 就**永遠不 resolve**：
 * `toPng` 不會被呼叫、沒有任何錯誤、按鈕停在「匯出中…」。
 * 而使用者切回來只會看到一顆壞掉的按鈕，完全不會聯想到是自己切走造成的。
 *
 * 逾時值取 400ms：正常情況下兩幀約 32ms 就走完，400ms 只在「幀根本不會來」時才生效。
 * 退場時**照樣 resolve 而不是 reject** —— 目的是讓匯出繼續走完，
 * 背景分頁拍出來的圖可能少一次重排，但那遠好過一顆永遠轉不完的按鈕。
 *
 * ⚠ 與另一個 toPng 地雷是一組：React StrictMode 的 effect 雙呼叫會吃掉「已啟動」
 *   去重旗標（run → cleanup 取消第一輪 → run 看到旗標直接 return ⇒ 兩輪都沒拍成），
 *   而那個症狀**只在 dev 出現、正式站看起來是好的**。任何「掛載即開拍」的匯出元件
 *   都要讓 effect 本來就可重入，不要用 ref 去重。
 *
 * @param n 要等幾個動畫幀（匯出路徑一律用 2：一幀送出樣式、一幀讓重排落地）
 * @param timeoutMs 逾時退場毫秒數。測試用，正式呼叫端不要傳。
 */
export function nextFrames(n: number, timeoutMs = 400): Promise<void> {
  return new Promise((resolve) => {
    // 幀數 <= 0 直接放行，省掉一次無意義的 rAF 排程
    if (n <= 0) { resolve(); return }
    // 非瀏覽器環境（SSR／單元測試）沒有 rAF，退回逾時那條路
    if (typeof requestAnimationFrame !== 'function') { setTimeout(resolve, 0); return }

    let left = n
    const bail = setTimeout(resolve, timeoutMs)
    const step = () => {
      if (--left <= 0) { clearTimeout(bail); resolve(); return }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}
