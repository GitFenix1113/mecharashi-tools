# 故事館氛圍層素材（PLAN-042-C）

來源：鋼嵐台版官網 `https://ma.tentree-games.com`（CDN `https://media.tentree-games.com/tw/ma/officialsite/img/`），
取得日期 2026-09-16／09-17。站長與官方人員有**非營利不追究素材版權**的共識；本站不放廣告與贊助連結。
素材一律自託管、轉 WebP、裁到內容 bbox，**不熱連官方 CDN**（PLAN-029 自託管慣例，代理商網域可能改路徑）。

| 檔案 | 來源 | 用途 |
|---|---|---|
| `bg-paper.webp` 1300×1080 | `hero/bg.jpg` 切掉左側紅帶後的紙面（x 620–1920） | `.lore-shell` 整館背景（桌機） |
| `bg-m.webp` 768×1400 | `hero/bg-m.jpg` | `.lore-shell` 背景（<1024px） |
| `bg-band.webp` 620×1080 | `hero/bg.jpg` 左側紅帶（含暗紅機甲線稿） | 館首頁 hero 左側，`clip-path` 切出斜邊 |
| `kv.webp` 1600×900／`kv-m.webp` 900×506 | `images/top8.jpg` 主視覺 | 館首頁 hero |
| `title-pilots.webp` 919×547／`title-pilots-m.webp` 850×450 | `hero/sl.png`／`hero/sl-m.png` 的標題群（Pilots／操控指揮 機師出列／ULTIMATE PILOTS） | 館首頁 hero 標題 |
| `snow01.png` `snow02.png`（＋ `-w` 白點版） | `img/snow01.png` 等，原樣 | 粒子（`.lore-snow`，桌機限定） |

機師的官方圖層（8 位）在 `public/images/pilots/<名>/official-{line,color,name}.webp`，由
`_local-notes/2026-09/2026-09-17_build-official-layers.mjs` 自 `hero/h01–h08` 的 -1／-2／-3 圖層裁出；
索引由 `scripts/generate-art-index.mjs` 產生（`PILOT_OFFICIAL_INDEX`）。
重新產生本目錄：`_local-notes/2026-09/2026-09-17_build-lore-assets.mjs` 與 `…assets2.mjs`（來源檔在 `_local-notes`，不進版控）。
