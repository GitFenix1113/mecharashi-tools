# 鋼嵐工具站 | Mecharashi Tools

> 鋼嵐（Mecharashi）遊戲玩家工具網站 — 傷害模擬器 · 配裝計算器 · 角色資料庫 · 攻略百科

## 專案說明

本專案為鋼嵐（Mecharashi）遊戲的輔助工具站，提供玩家各類實用工具與資料庫查詢功能。

## 技術棧

- **框架**: React 19 + TypeScript 6
- **建構**: Vite 8
- **樣式**: Tailwind CSS v4 + Floating UI
- **路由**: React Router v7
- **部署**: GitHub Pages（含 PR 預覽部署）
- **後端**: Firebase Auth + Cloud Firestore
- **資料蒐集**: Playwright 爬蟲腳本 → Firebase Firestore

## 開發指令

```bash
npm install      # 安裝依賴
npm run dev      # 啟動開發伺服器
npm run build    # 建構生產版本
npm run preview  # 預覽生產版本
npm run lint     # ESLint 檢查

# 資料蒐集（需 Playwright）
npm run scrape:pilots     # 爬取飛行員資料
npm run scrape:mechs      # 爬取機體資料
npm run scrape:weapons    # 爬取武器資料
npm run scrape:modules    # 爬取模組資料
npm run scrape:components # 爬取零件資料
npm run scrape:backpacks  # 爬取背包資料
npm run migrate           # 將資料遷移至 Firestore
```

## 資料夾結構

```
mecharashi-tools/
├── .github/
│   └── workflows/
│       ├── deploy.yml          # 部署至 GitHub Pages（push to main）
│       └── preview.yml         # PR 預覽部署
│
├── docs/
│   ├── 01_規劃書/              # 專案規劃文件
│   ├── 02_設計稿/              # UI/UX 設計稿
│   ├── 03_進度表/              # 開發進度追蹤
│   ├── 04_需求文件/            # 功能需求規格
│   ├── 05_會議記錄/            # 會議紀錄
│   └── 06_技術文件/            # 技術架構與 API 文件
│
├── public/
│   ├── images/                 # 遊戲圖片資源（機體、飛行員、武器等）
│   └── debug/                  # API 回應範例（開發用）
│
├── scripts/                    # Node.js 爬蟲與資料遷移腳本
│   ├── scrape-pilots-v3.js
│   ├── scrape-mechs.js
│   ├── scrape-weapons.js
│   ├── scrape-modules.js
│   ├── scrape-components.js
│   ├── scrape-backpacks.js
│   ├── migrate-to-firestore.mjs
│   └── update-changelog.js
│
└── src/
    ├── main.tsx                # 應用程式進入點
    ├── App.tsx                 # 根元件（路由設定）
    ├── index.css               # 全域樣式
    │
    ├── assets/                 # 靜態資源
    ├── data/                   # 本地資料
    │   ├── bossDrops.ts
    │   └── patchVersions/      # 版本更新資料（v2.8 ~ v3.3）
    │
    ├── types/                  # TypeScript 型別定義
    │   ├── index.ts
    │   └── enums.ts
    │
    ├── contexts/               # React Context
    │   ├── AuthContext.tsx     # 使用者驗證狀態
    │   └── GameDataContext.tsx # 遊戲資料快取
    │
    ├── hooks/                  # 自訂 React Hooks
    │   ├── useFirestore.ts
    │   ├── useIsMobile.ts
    │   └── usePatchVersions.ts
    │
    ├── lib/                    # Firebase / API 整合
    │   ├── firebase.ts
    │   ├── firestoreApi.ts
    │   ├── profileApi.ts
    │   └── userApi.ts
    │
    ├── utils/                  # 工具函式
    │   ├── assets.ts
    │   └── moduleStats.tsx
    │
    ├── components/             # 共用 UI 元件
    │   ├── Layout.tsx
    │   ├── AuthModal.tsx
    │   ├── AdminRoute.tsx
    │   ├── admin/              # 管理員用編輯元件
    │   ├── home/               # 首頁區塊元件
    │   ├── profile/            # 個人檔案元件
    │   └── timeline/           # 版本時間軸元件
    │
    └── pages/                  # 路由頁面
        ├── home/               # 首頁
        ├── mechs/              # 機體列表 & 詳情
        ├── pilots/             # 飛行員列表 & 詳情
        ├── weapons/            # 武器列表 & 詳情
        ├── modules/            # 模組列表
        ├── components/         # 零件列表
        ├── backpacks/          # 背包列表
        ├── simulator/          # 傷害模擬器 & 研究頁
        ├── guides/             # 攻略百科
        ├── news/               # 公告資訊
        ├── admin/              # 版本編輯器（管理員）
        └── user/               # 個人頁 & 資料管理後台
            └── admin/          # 各資料類型管理子模組
```

## 開發進度

詳見 [docs/03_進度表/開發進度表.html](./docs/03_進度表/開發進度表.html)（含連結至規劃書對應章節）

## 授權 License

本專案**原始碼公開，但僅限非商業使用**（source-available, noncommercial）。

- ✅ **歡迎**：學習、研究、fork、二次開發、個人與非營利用途
- ❌ **禁止**：未經書面同意的**商業／營利**用途（如掛廣告、付費服務、販售、商業託管等）

| 內容 | 授權 |
|---|---|
| **程式碼**（`src/`、`scripts/` 等） | [PolyForm Noncommercial License 1.0.0](./LICENSE) |
| **文件與整理的資料**（`docs/`、`src/data/` 等） | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| **遊戲原始素材**（圖片、遊戲數值） | 智慧財產權屬《鋼嵐 Mecharashi》原廠，本站為非商業同好用途 |

### 商業合作 / 授權洽詢

如有商業使用或合作需求，歡迎聯絡我（**我很少看 Email，請以 Discord 為主**）：

- **Discord**：`fenix_nkodpm` ← 優先
- Email：fenix1113@gmail.com
