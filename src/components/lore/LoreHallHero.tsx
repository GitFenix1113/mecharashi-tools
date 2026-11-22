import { assetUrl } from '../../utils/assets'

/**
 * 故事館各館館首頁共用的 hero：紅帶＋招募插畫（2600×1080 卡池主視覺）＋自排標題，就是官網首頁本來的構圖。
 * 插畫鋪在紅帶右側、紅帶壓在它左緣上（index.css 的 .lore-home-hero__card）；每次進館抽一張（loreHeroCast.ts）。
 * 一張約 200 KB，純裝飾（aria-hidden）。
 *
 * 沿革：機師廳最早是官網 KV＋「操控指揮 機師出列」招募標語圖（冷色 3D 寫實跟紙面館格格不入、主角是機甲、
 * 而且和下面一列「機師故事館」雙標題 → 真正的 <h1> 移進 hero）；2026-10-14 換成官網立繪群像（8 位抽 4 位），
 * 2026-10-18 比照機甲廳（PLAN-042-B F-2）換成招募插畫，兩館的 hero 從此同一套。
 * 2026-11-22 劇情故事館加入，從 LoreHomePage 抽出成共用元件（三館同一套）。
 */
export function LoreHallHero({ script, title, lead, card }: {
  /** 紅帶上的黃色手寫字 */
  script: string
  title: string
  lead: React.ReactNode
  /** 插畫路徑；池子是空的就只剩紅帶與標題 */
  card?: string
}) {
  return (
    <header className="lore-home-hero mb-6 sm:mb-8">
      <div className="lore-home-hero__band" aria-hidden="true" />
      <div className="lore-home-hero__cast" aria-hidden="true">
        {card && (
          <img
            className="lore-home-hero__card"
            src={assetUrl(card)}
            alt=""
            width={2600}
            height={1080}
            decoding="async"
            fetchPriority="high"
            // 載完才淡入（CSS 的 [data-loaded]）：圖要等 React 渲染後才開始抓，直接顯示會在紙面上「啪」一聲冒出來。
            // 用 data 屬性不用 className：React 不管這個屬性，重繪（骨架 → 內容）時不會被洗掉
            onLoad={(e) => { e.currentTarget.dataset.loaded = '' }}
          />
        )}
      </div>
      <div className="lore-home-hero__title">
        <span className="lore-script-font lore-home-hero__script" aria-hidden="true">{script}</span>
        <span className="lore-home-hero__eyebrow">ARCHIVE · 檔案館</span>
        <h1 className="lore-home-hero__h1">{title}</h1>
        <p className="lore-home-hero__lead">{lead}</p>
      </div>
    </header>
  )
}
