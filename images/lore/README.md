# 故事館氛圍層素材（PLAN-042-C）

來源：鋼嵐台版官網 `https://ma.tentree-games.com`（CDN `https://media.tentree-games.com/tw/ma/officialsite/img/`），
取得日期 2026-09-16／09-17。站長與官方人員有**非營利不追究素材版權**的共識；本站不放廣告與贊助連結。
素材一律自託管、轉 WebP、裁到內容 bbox，**不熱連官方 CDN**（PLAN-029 自託管慣例，代理商網域可能改路徑）。

| 檔案 | 來源 | 用途 |
|---|---|---|
| `bg-paper.webp` 1300×1080 | `hero/bg.jpg` 切掉左側紅帶後的紙面（x 620–1920） | `.lore-shell` 整館背景（桌機） |
| `bg-m.webp` 768×1400 | `hero/bg-m.jpg` | `.lore-shell` 背景（<1024px） |
| `bg-band.webp` 620×1080 | `hero/bg.jpg` 左側紅帶（含暗紅機甲線稿） | 館首頁 hero 紅帶的**紋理**：只取左上全紅的一角放大，底色與斜邊由 CSS 決定（原圖右下是紙面，不能直接加寬） |
| `snow01.png` `snow02.png`（＋ `-w` 白點版） | `img/snow01.png` 等，原樣 | 粒子（`.lore-snow`，桌機限定） |

> 2026-10-14 起館首頁 hero 不再用官網 KV（`top8.jpg` → `kv.webp`／`kv-m.webp`）與招募標語圖（`sl.png` → `title-pilots.webp`／`-m`），
> 已自本目錄移除，改成紅帶＋8 位官方圖層的立繪群像＋自排標題；原始檔仍在 `_local-notes/2026-09/2026-09-16_故事館美化工程_素材/official/`。

機師的官方圖層（8 位）在 `public/images/pilots/<名>/official-{line,color,name}.webp`，由
`_local-notes/2026-09/2026-09-17_build-official-layers.mjs` 自 `hero/h01–h08` 的 -1／-2／-3 圖層裁出；
索引由 `scripts/generate-art-index.mjs` 產生（`PILOT_OFFICIAL_INDEX`）。
重新產生本目錄：`_local-notes/2026-09/2026-09-17_build-lore-assets.mjs` 與 `…assets2.mjs`（來源檔在 `_local-notes`，不進版控）。
