import { Suspense, useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'

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
 * （`.lore-viewport`（100dvh）→ `main flex-1 min-h-0` → `.lore-shell height:100%` → `.lore-scroll flex-1`），
 * 由 `.lore-scroll` 當**全館唯一的** scrollport。館內元件不得再開第二層 overflow-y。
 * 這條 flex 鏈是決策 (E)：不做 `calc(100vh - …)` 減法，因為 `SignedOutBanner`
 * 的高度不可預測，任何減法都算不到它。
 *
 * ⚠ 手機觸控捲動的兩個前提（2026-10-13 上線當天 iPhone 實測「往下拉不到底」）——拿掉任一個都會壞，而桌機與 Chromium 手機模擬都看不出來：
 *   ① `.lore-scroll` 自成 stacking context（index.css 的 isolation）：否則館內有 z-index 的定位層
 *     （舞台、卷宗）在 iOS 會被合成到捲動容器的外面，手指按在它們上面推的是整份文件、不是 .lore-scroll。
 *   ② 外殼高度用 dvh（Layout.tsx 的 .lore-viewport）：iOS 的 100vh 比工具列展開時的可見區高一截，
 *     文件因此多出一小段可捲範圍——①失效時手指就是推動這一段，看起來像「捲了一點就卡住」。
 */
export default function LoreLayout() {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  const shellRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 每個路徑最後的捲動位置（③ 的 POP 還原用）；只活在這次進館，離館就丟 */
  const positions = useRef(new Map<string, number>())
  const pathRef = useRef(pathname)

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

  // ①-b 故事館正文字型（PLAN-042-D D-2）：Lore Serif／Lore Kai 的 unicode-range 分片，build 時由
  //    scripts/copy-lore-fonts.mjs 放進 public/fonts/lore/。進館才掛 <link>——館外一個位元組都不下載；
  //    離館不拿掉（已經載過的拿掉也省不了什麼，再進館還要重抓）。檔案不存在時只是退回系統字型，不會壞。
  useEffect(() => {
    const id = 'lore-fonts-css'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `${import.meta.env.BASE_URL}fonts/lore/lore-fonts.css`
    document.head.appendChild(link)
  }, [])

  // ② 進場「推門進館」**完全交給 CSS**（`.lore-veil` 的 lore-veil-wipe animation：深色遮罩
  //    以斜切從左下往右上擦開，PLAN-042-C A-4），所以這裡沒有 state、也沒有 requestAnimationFrame。
  //    animation 自帶 from 幀，不需要雙層 rAF。
  //    ⚠ 不是為了繞過分頁節流——`document.hidden` 時 Chrome 連 animation 的時間軸都不推進
  //    （2026-09-10 實測），rAF 版本同樣被暫停。那是背景分頁的正常行為，不必處理。

  // ③ 跨路由捲頂（決策 (I)）。館首頁→扉頁、扉頁→章節、章節之間、換人都要重置。
  //    LoreLayout 全程不卸載，`.lore-scroll` 的 scrollTop 不會自己歸零 ——
  //    89 位機師的牆捲到底再點進去，扉頁會直接開在中段。全站沒有既有的捲頂機制可依賴。
  //    **例外：按上一頁（POP）回到看過的路徑，還原離開時的位置**（PLAN-042-D A-1）。
  //    舊版一律捲頂，從扉頁按上一頁回牆面時位置歸零（實測 900／1800／2600 → 0），89 位要重新捲一次。
  //    位置靠 scroll 事件持續記（rAF 節流），**不是**換頁當下才讀：那時新頁面已經渲染，
  //    內容變短的話 scrollTop 早就被瀏覽器夾掉了。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        positions.current.set(pathRef.current, el.scrollTop)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  useEffect(() => {
    pathRef.current = pathname
    const el = scrollRef.current
    if (!el) return
    const saved = navType === 'POP' ? positions.current.get(pathname) : undefined
    if (!saved) {
      el.scrollTo({ top: 0 })
      return
    }
    // 牆面要等 lazy chunk 與資料：撐得起那個高度才捲，最多等約 1.5 秒（之後照樣捲到能到的最低處）
    let raf = 0
    let tries = 0
    const attempt = () => {
      if (el.scrollHeight - el.clientHeight >= saved || tries++ > 90) el.scrollTo({ top: saved })
      else raf = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(raf)
  }, [pathname, navType])

  // ④ 把 scrollport 的實測高度寫成 --lore-viewport-h（決策 (J)），供故事館頁面的舞台高度（.lore-page 的 --stage-h）取用。
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
        舞台線稿濾鏡（PLAN-042-C A-2；PLAN-042-D 起由 LoreStage 的 `.lore-figure__sketch.is-filtered` 引用）。
        一份定義、全館共用，以 `filter: url(#lore-sketch)` 引用。放在 layout 而不是每套立繪各帶一份：
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
      <div className="lore-scroll" ref={scrollRef}>
        {/* 粒子（PLAN-042-C B-4）：純 CSS，桌機限定、reduced-motion 關閉，樣式在 index.css。
            它是掛在整館視窗上的一層、不隨內容捲動（官網是 fixed），所以是 sticky 全高、不佔版面高度。
            ⚠ 放在 scrollport **裡面**是為了疊層：.lore-scroll 自成 stacking context（iOS 觸控捲動，見 index.css），
              粒子留在外面的話 z-index 20 會一口氣蓋過館內所有浮層（切換列、名冊、鑑賞模式）。 */}
        <div className="lore-snow" aria-hidden="true">
          <span className="lore-snow__p lore-snow__p--1" />
          <span className="lore-snow__p lore-snow__p--big lore-snow__p--2" />
          <span className="lore-snow__p lore-snow__p--3" />
          <span className="lore-snow__p lore-snow__p--big lore-snow__p--4" />
          <span className="lore-snow__p lore-snow__p--5" />
          <span className="lore-snow__p lore-snow__p--big lore-snow__p--6" />
        </div>
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
