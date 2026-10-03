import { Suspense, useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

/**
 * 機師故事館的共用外殼（PLAN-042-A C-4 / D-1）。
 *
 * **靜態 import**（它是 `<Route element>`，不在 Suspense 內），比照 `VersionsLayout`。
 * 刻意零依賴：不 import 任何 lore 資料、任何大型元件 —— 它會留在主 bundle 裡，
 * 多帶一個 import 就是替全站每一位訪客付這份體積。
 *
 * ── 為什麼自己開 scrollport ──
 * `Layout.tsx` 的 `<main>` 是 `flex-1 overflow-hidden`，館內任何 `position: sticky`
 * 都會相對「最近的可捲祖先」定位，而那個祖先在 overflow:hidden 之下根本不捲 ——
 * 章節軸會變成「有時黏有時不黏」。因此高度沿著 flex 一路傳下來
 * （`h-screen` → `main flex-1 min-h-0` → `.lore-shell height:100%` → `.lore-scroll flex-1`），
 * 由 `.lore-scroll` 當**全館唯一的** scrollport。館內元件不得再開第二層 overflow-y。
 * 這條 flex 鏈是決策 (E)：不做 `calc(100vh - …)` 減法，因為 `SignedOutBanner`
 * 的高度不可預測，任何減法都算不到它。
 */
export default function LoreLayout() {
  const { pathname } = useLocation()
  const shellRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ① 根元素旗標：文件層的捲軸配色與 body 背景圖只有 <html> 管得到，
  //    .lore-shell 搆不著。掛在這一層而不是每個子頁各掛一次 ——
  //    子頁切換時 cleanup/add 會交錯，畫面上是一幀深色閃爍。
  //    ⚠ cleanup 漏了會讓「離館之後全站都是紙色」，而 StrictMode 的
  //    add → remove → add 讓最終狀態仍正確，dev 期間完全看不出來。
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('lore-mode')
    return () => html.classList.remove('lore-mode')
  }, [])

  // ② 進場「推門進館」**完全交給 CSS**（`.lore-veil` 的 lore-veil-wipe animation：深色遮罩
  //    以斜切從左下往右上擦開，PLAN-042-C A-4），所以這裡沒有 state、也沒有 requestAnimationFrame。
  //    animation 自帶 from 幀，不需要雙層 rAF。
  //    ⚠ 不是為了繞過分頁節流——`document.hidden` 時 Chrome 連 animation 的時間軸都不推進
  //    （2026-09-10 實測），rAF 版本同樣被暫停。那是背景分頁的正常行為，不必處理。

  // ③ 跨路由捲頂（決策 (I)）。館首頁→扉頁、扉頁→章節、章節之間、扉頁→館首頁四條路徑都要重置。
  //    LoreLayout 全程不卸載，`.lore-scroll` 的 scrollTop 不會自己歸零 ——
  //    89 位機師的牆捲到底再點進去，扉頁會直接開在中段（立繪柱是 sticky，
  //    看起來更像壞掉而不是捲過頭）。全站沒有既有的捲頂機制可依賴。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  // ④ 把 scrollport 的實測高度寫成 --lore-viewport-h（決策 (J)），供 .lore-portrait-col 取用。
  //    量實際的可視高度而不是減法，`SignedOutBanner` 出現／消失時立繪欄會自動跟上。
  //    CSS 端已備有純減法的 fallback，環境不支援 ResizeObserver 時退回那條。
  useEffect(() => {
    const el = scrollRef.current
    const shell = shellRef.current
    if (!el || !shell || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      shell.style.setProperty('--lore-viewport-h', `${entry.contentRect.height}px`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="lore-shell flex flex-col" ref={shellRef}>
      <div className="lore-veil" aria-hidden="true" />
      {/*
        LoreArt 的線稿濾鏡（PLAN-042-C A-2）。一份定義、全館共用，`.lore-art__sketch--filtered`
        以 `filter: url(#lore-sketch)` 引用。放在 layout 而不是每個 LoreArt 各帶一份：
        同一個 id 重複出現時瀏覽器只認第一個，兩份不同步會讓調參「改了沒反應」。

        管線（與 042-A 的三層 CSS 版同一套數學，只是收進一張圖裡，並把「白」轉成「透明」）：
          ① 灰階 → ② 反相＋高斯模糊(σ=6 CSS px) → ③ color-dodge：平面推爆成白、只剩邊緣
          → ④ 反相後取亮度當 alpha：白→透明、線→不透明 → ⑤ alpha ×1.6 加濃
          → ⑥ 上墨色 #2b2621 → ⑦ 裁回原圖輪廓（模糊外溢的光暈全部裁掉，紙上不留幽靈）
        color-interpolation-filters="sRGB"：CSS filter 是在 sRGB 算的，預設的 linearRGB 會讓模糊與 dodge 變味。
        線稿太淡／太重只調 ⑤ 的 slope，其餘參數是量測基準。
      */}
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
        <defs>
          <filter id="lore-sketch" colorInterpolationFilters="sRGB" x="-5%" y="-5%" width="110%" height="110%">
            <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="gray" />
            <feColorMatrix in="gray" type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" result="inv" />
            <feGaussianBlur in="inv" stdDeviation="6" result="blur" />
            <feBlend in="blur" in2="gray" mode="color-dodge" result="dodge" />
            <feColorMatrix in="dodge" type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" result="dodgeInv" />
            <feColorMatrix in="dodgeInv" type="luminanceToAlpha" result="inkA" />
            <feComponentTransfer in="inkA" result="inkA2">
              <feFuncA type="linear" slope="1.6" />
            </feComponentTransfer>
            <feFlood floodColor="#2b2621" result="ink" />
            <feComposite in="ink" in2="inkA2" operator="in" result="inked" />
            <feComposite in="inked" in2="SourceGraphic" operator="in" />
          </filter>
        </defs>
      </svg>
      {/* 粒子（PLAN-042-C B-4）：純 CSS，桌機限定、reduced-motion 關閉，樣式在 index.css。
          放在 scrollport 外面：它是掛在整館視窗上的一層，不隨內容捲動（官網是 fixed）。 */}
      <div className="lore-snow" aria-hidden="true">
        <span className="lore-snow__p lore-snow__p--1" />
        <span className="lore-snow__p lore-snow__p--big lore-snow__p--2" />
        <span className="lore-snow__p lore-snow__p--3" />
        <span className="lore-snow__p lore-snow__p--big lore-snow__p--4" />
        <span className="lore-snow__p lore-snow__p--5" />
        <span className="lore-snow__p lore-snow__p--big lore-snow__p--6" />
      </div>
      <div className="lore-scroll" ref={scrollRef}>
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
