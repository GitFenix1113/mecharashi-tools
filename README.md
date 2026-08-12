# 米赫瑪超吉情豹站 — Milkhama PawInfo Station

> 鋼嵐（Mecharashi）非官方WIKI — 資料庫查詢 · 配裝模擬器 · 攻略工具 · 版本時間軸
>
> 正式站：<https://mecharashi.wiki>

## 專案說明

本專案為鋼嵐（Mecharashi）遊戲的輔助工具站，提供玩家各類實用工具與資料庫查詢功能。
資料以爬蟲從官方來源蒐集後整理進 Firestore，前台透過版本控制的快取層讀取，並經由 Cloudflare Worker 代理對外提供。

主要功能區塊：

- **資料庫**：機師、機甲、武器、背包、模組、元件（含詳情頁與交叉引用）
- **配裝模擬器** `/simulator`：機體配裝與數值試算
- **科研設定** `/research`：神經驅動 / 科研配置
- **攻略工具** `/tools`、`/guides`：彩虹機規劃器、元件掉落查詢等
- **版本資訊** `/news`：改版時間軸與更新內容
- **文件站** `/documents`：專案技術文件與使用說明（由 `docs/` 白名單複製而來）
- **個人中心 / 管理後台** `/profile`、`/admin`：資料編輯、變更歷史、系統日誌、使用統計

## 技術棧

| 層 | 內容 |
|---|---|
| 前端框架 | React 19 + TypeScript 6 |
| 建構工具 | Vite 8 |
| 樣式 | Tailwind CSS v4（CSS-first，無 `tailwind.config.js`）+ Floating UI |
| 路由 | React Router v7（`basename={import.meta.env.BASE_URL}`） |
| 後端 | Firebase Auth / Cloud Firestore / Storage |
| API 代理 | Cloudflare Workers（`/api/*`，同源掛在 `mecharashi.wiki` zone） |
| 部署 | GitHub Pages（自訂網域 + PR 預覽部署） |
| 資料蒐集 | Playwright 爬蟲腳本 → migrate/patch 腳本 → Firestore |
| 測試 | `node --test`（前端）、Vitest + `@cloudflare/vitest-pool-workers`（Worker）、Firebase Emulator（規則） |

## 架構重點

### 1. 三層 Provider（[src/App.tsx](./src/App.tsx)）

`AuthProvider` → `GameDataProvider` → `ReferenceProvider`

- **AuthContext**：Firebase Auth 登入狀態與角色，`AdminRoute` 據此 gate `/admin/*`
- **GameDataContext**：全站遊戲資料的單一快取層（見下）
- **ReferenceContext**：實體引用（`EntityRef`）的 hover 浮窗 / 釘選 / 手機 BottomSheet

### 2. 版本 gate 的三層資料快取

前台一律透過 [src/hooks/useFirestore.ts](./src/hooks/useFirestore.ts) 的 `useXxx()` hook 取資料，**不直接呼叫 `firestoreApi`**：

```
記憶體（本 session 已載入）
  ↓ miss
localStorage（mecharashi_gd_*，版本相符即可用）
  ↓ miss / 版本過期
Worker /api/data/:collection（或本機 dev 直連 Firestore）
```

版本來源為 `meta/gameData`，每集合一個版本號 + 全域 fallback；整個 session 只讀版本一次。
後台存檔後呼叫 `bumpDataVersion(key)` 讓所有 client 該集合快取失效。

> 用腳本批次改資料後，**務必 bump 版本**（`node scripts/bump-data-version.mjs`），否則使用者讀到舊快取。

### 3. Cloudflare Worker 代理（`workers/`）

公開遊戲資料不再由前端直連 Firestore，改打 `/api/data/:collection`。Worker 以 service account 走 Firestore REST 代讀，因此 Firestore 規則可收成僅管理員可讀，同時提供來源白名單與反爬守門。另有 `/api/collect` 收集匿名使用統計（含每日寫入預算與 kill switch）。

> Worker 的 `ARRAY_COLLECTIONS` 必須與 `GameDataContext` 的 `ALL_COLLECTION_KEYS` 同步；漏一個 key 只會在正式站炸（本機 dev 直連 Firestore 看不出來）。

## 開發指令

```bash
npm install            # 安裝依賴（postinstall 會設定 git hooks 與 commit template）

npm run dev            # 開發伺服器（predev 先跑 generate-image-manifest + copy-docs）
npm run build          # generate-image-manifest → copy-docs → tsc -b → vite build
npm run preview        # 預覽 production build
npm run lint           # ESLint
npm test               # node --test，跑 src/**/*.test.ts
```

### Firebase Emulator

```bash
npm run emu            # 啟動 emulator（匯入/匯出 ./emulator-data）
npm run emu:fresh      # 不匯入既有資料
npm run emu:seed       # 灌入種子資料
npm run emu:slice      # 匯出資料切片
npm run dev:emu        # 前端連 emulator（--mode emulator）
npm run emu:test-rules # 驗證 Firestore 安全規則
```

### 資產與文件

```bash
npm run manifest:images  # 掃 public/images/ 產生可用圖片清單
npm run images:webp      # 圖片轉 WebP
npm run docs:copy        # 依白名單把 docs/ 複製進 public/docs（route 為 /documents）
npm run docs:stamp       # 為文件加上更新時間戳
```

### 資料蒐集與寫入（需 Playwright）

```bash
npm run scrape:v3           # 爬取機師（scrape-pilots-v3.js）
npm run scrape:mechs        # 爬取機甲
node scripts/scrape-weapons.js
node scripts/scrape-modules.js
node scripts/scrape-components.js
node scripts/scrape-backpacks.js

npm run migrate             # 將資料寫入 Firestore
npm run migrate:dry         # 只預覽 diff，不寫入
node scripts/bump-data-version.mjs <collection>   # 寫入後務必 bump
```

> ⚠ `scrape-pilots-v3.js` 的 `--force` 會覆蓋人工欄位（`talent.buffIds` / `manual` / `debutVersion`），使用前先確認。

### Cloudflare Worker

```bash
cd workers
npm install
npm run dev        # wrangler dev
npm test           # vitest
npm run deploy     # wrangler deploy（含 mecharashi.wiki/api/* route）
```

## 資料夾結構

```
mecharashi-tools/
├── .github/workflows/
│   ├── deploy.yml              # push to main → build → 清理孤兒 docs → GitHub Pages
│   └── preview.yml             # PR 預覽部署
├── .githooks/                  # commit-msg（履歷防呆）、pre-push（build 把關 + CHANGELOG）
│
├── docs/                       # HTML 文件站（共用 _shared/style.css）
│   ├── 01_規劃書/
│   ├── 02_技術文件/            # 架構設計 / 資料模型 / 遊戲機制 / Firebase
│   ├── 03_頁面規劃/            # 各頁面規劃書
│   ├── 04_進度表/
│   ├── 05_階段性開發計畫/      # PLAN-xxx：執行中 / 觀察維護中 / 歷史記錄
│   └── 06_使用說明/
│
├── public/
│   ├── images/                 # 遊戲圖片資源
│   ├── fonts/                  # 自託管字體
│   ├── docs/                   # 由 copy-docs.mjs 產生（勿手改）
│   └── debug/                  # API 回應範例（開發用）
│
├── scripts/                    # 爬蟲、migrate/patch、emulator、建構前置腳本
│   └── temp_scripts/           # 一次性腳本
│
├── tests/emulator/             # Firestore 規則測試
│
├── workers/                    # Cloudflare Worker（/api 代理 + 使用統計）
│   └── src/                    # index / firestoreRest / gcpAuth / versions / collect
│
└── src/
    ├── App.tsx                 # 路由 + 三層 Provider
    ├── index.css               # Tailwind v4 @theme（CSS-first）
    │
    ├── types/                  # 依領域拆檔的型別（barrel: index.ts；enums.ts 獨立）
    ├── contexts/               # Auth / GameData / Reference / NdOverride
    ├── hooks/                  # useFirestore、useViewMode、usePageTracking…
    ├── lib/
    │   ├── firestoreApi.ts     # barrel，re-export ./api/*
    │   ├── api/                # 按集合拆分（pilots/mechs/weapons/…）+ firestoreCore
    │   ├── analytics/          # 使用統計上報
    │   └── diag/               # 連線診斷
    ├── utils/                  # 純函式工具（多數附 *.test.ts）
    ├── data/
    │   ├── patchVersions/      # 遊戲改版資料
    │   ├── siteChangelog/      # 網站更新履歷（commit 前需更新）
    │   └── bossDrops.ts
    │
    ├── components/             # 共用 UI，全部歸類到子資料夾（扁平層不放檔案）
    │   ├── layout/ auth/       # 全站外框、登入與權限
    │   ├── refs/               # 實體引用層（RefText / RefChip / EntityRefView…）
    │   ├── badges/ icons/      # 徽章、實體圖示
    │   ├── cards/ common/      # 領域卡片、泛用基礎件（FallbackImage / BottomSheet…）
    │   └── module/ planner/ timeline/ home/ profile/ admin/   # 各功能領域元件家族
    └── pages/
        ├── home/ pilots/ mechs/ weapons/ backpacks/ modules/ components/
        ├── simulator/          # 配裝模擬器 + 科研設定
        ├── guides/ tools/      # 攻略百科與工具（彩虹機規劃器、元件掉落）
        ├── news/ documents/
        ├── debug/              # 儲存偵錯、連線診斷（/connectivity）
        ├── admin/              # 版本編輯器、變更歷史、系統日誌、使用統計
        └── user/               # 個人頁 & 資料管理後台（user/admin/ 各集合子模組）
```

## 開發流程約定

- **PLAN 制**：階段性開發計畫放 `docs/05_階段性開發計畫/`，由 `plan-manager` skill 管理
- **commit 前**：更新 `src/data/siteChangelog/`（`commit-msg` hook 會擋）、必要時同步 `docs/`
- **push 前**：`pre-push` hook 會先跑 `npm run build`，失敗即中止；並自動更新 `CHANGELOG.md`（**請勿手動編輯**）
- **環境變數**：`VITE_FIREBASE_*`、`VITE_FIREBASE_APPCHECK_SITE_KEY`、`VITE_WORKER_API_BASE` 等放 `.env.local`（不進版控）
- 詳細規則見 [CLAUDE.md](./CLAUDE.md)

## 開發進度

- 開發進度表：[docs/04_進度表/開發進度表.html](./docs/04_進度表/開發進度表.html)
- 階段性開發計畫：[docs/05_階段性開發計畫/index.html](./docs/05_階段性開發計畫/index.html)

## 授權 License

本專案**原始碼公開，但僅限非商業使用**（source-available, noncommercial）。

- ✅ **歡迎**：學習、研究、fork、二次開發、個人與非營利用途
- ❌ **禁止**：未經書面同意的**商業／營利**用途（如掛廣告、付費服務、販售、商業託管等）

| 內容 | 授權 |
|---|---|
| **程式碼**（`src/`、`scripts/`、`workers/` 等） | [PolyForm Noncommercial License 1.0.0](./LICENSE) |
| **文件與整理的資料**（`docs/`、`src/data/` 等） | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| **遊戲原始素材**（圖片、遊戲數值） | 智慧財產權屬《鋼嵐 Mecharashi》原廠，本站為非商業同好用途 |

### 商業使用須事先取得我的同意

我經營本站純屬非營利性質，**本人沒有營利打算，也不會收取任何費用**——這不是商業合作或授權販售的邀約。
但**若你想將本專案（程式碼或資料）用於商業／營利用途，請務必先徵得我的同意**；未經同意的商業使用，視為違反授權。

聯絡我（**我很少看 Email，請以 Discord 為主**）：

- **Discord**：`fenix_nkodpm` ← 優先
- Email：fenix1113@gmail.com
