# public/images/og/ — 社群連結預覽用圖（PLAN-038）

社群平台（Discord / LINE / Slack / X 等）分享連結時，卡片顯示的 `og:image` 素材放這裡。

## 命名慣例

| 檔名 | 用途 | 規格 |
|---|---|---|
| `default.jpg` | **全站預設圖**。首頁、各 list 頁、功能頁（simulator / research / news / guides / tools）與所有沒有專屬圖的頁面共用；亦是實體頁圖片缺值時的 fallback | 1200×630、< 1MB |

## 規則

1. **一律 1200×630、控制在 1MB 內**（各平台的建議規格；超過 1MB 有平台會放棄抓圖）。
2. **不要放透明背景 PNG**。去背圖在深色底的 App 會變成一整片黑（`cat_no_bg.png` 就是反例）。
3. **不要拿 `public/images/banners/` 的版更宣傳圖來用**。那批是站內公告素材，比例與檔案大小都不符。
4. 機師 / 機甲 / 武器詳情頁的分享卡片**不放這裡** —— 直接重用實體既有的 `portrait` / `icon` 欄位（PLAN-038 決策二）。
5. 未來若真的需要「依大分類各一張」，在本目錄下新增 `home.jpg`、`simulator.jpg` 這類檔名即可，路徑慣例不變（決策三：圖片數量按實際需求長，不預先拆）。

## default.jpg 怎麼重產

由腳本合成，改站名 / 標語 / 配色後重跑即可覆蓋：

```bash
node scripts/generate-og-image.mjs
```

素材來源：`public/images/General/homepage_background.webp`（底圖）＋ `public/images/cat_no_bg.png`（吉祥物）。
