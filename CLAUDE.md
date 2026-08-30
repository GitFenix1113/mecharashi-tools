# CLAUDE.md — 米赫瑪超吉情豹站 專案規則

---

## 1. 每次 commit 前：更新網站更新履歷

每當被要求執行 `git commit` 時，必須先更新 `src/data/siteChangelog/` 的靜態資料，再執行 commit。

### 規則

1. 根據本次 commit 的日期，判斷屬於哪個月份（`YYYY-MM`）
2. 如果對應月份的檔案已存在（例如 `2026-05.ts`），在 `entries` 陣列的**最前面**插入新記錄
3. 如果對應月份的檔案不存在，建立新的月份檔案，並在 `src/data/siteChangelog/index.ts` 的 `SITE_CHANGELOG` 陣列最前面 import 並加入
4. 每筆記錄格式：
   ```ts
   { date: 'YYYY-MM-DD', type: 'feat' | 'fix' | 'perf' | 'style' | 'refactor', summary: '一行中文摘要' }
   ```
5. `chore` / `ci` / `docs` 類型的 commit 不需要加入履歷（這些是內部維護用，不影響使用者）
6. 一個 commit 可以對應多筆 entries（若包含多個獨立功能）
7. 摘要以**使用者視角**描述，例如「機師詳情頁新增專武資訊」

> **注意：** `CHANGELOG.md` 由 `npm run changelog`（CI 腳本）自動維護，**請勿手動編輯**。

---

## 2. 每次 commit 前：檢查相關文件是否需要同步更新

當本次 commit 的變更內容涉及以下項目時，必須**先更新對應文件，再一起 commit**。

### 觸發條件與對應文件

| 變更的來源檔案 | 需要同步的 docs 文件 |
|---|---|
| `src/types/index.ts`（新增/修改 interface/type） | `docs/02_技術文件/02_資料模型/*.html` 對應的資料模型頁 |
| `src/types/enums.ts`（新增/修改 enum） | `docs/02_技術文件/04_Firebase/資料庫設計文件/enums.html` |
| `src/lib/firestoreApi.ts`（Firestore 讀寫邏輯） | `docs/02_技術文件/04_Firebase/資料庫設計文件/` 對應的集合文件 |
| `src/lib/userApi.ts`（用戶資料結構） | `docs/02_技術文件/04_Firebase/資料庫設計文件/users.html` |
| 新增頁面或重大頁面重構 | `docs/03_頁面規劃/` 對應的頁面規劃文件 |
| PLAN 計畫進度更新 | `docs/05_階段性開發計畫/` 對應的進度表 |

### 判斷原則

- 只有**結構性變更**才需要更新文件（新增欄位、刪除欄位、欄位改名、型別變動）
- 純邏輯修正（bug fix）、樣式調整不需要更新文件
- 不確定時，快速掃一眼對應文件，看是否有明顯的落差

### docs 文件格式說明

`docs/` 下的文件皆為 **HTML 格式**，共用 `docs/_shared/style.css`。更新時保持現有的 HTML 結構，只修改資料內容部分。

---

## 3. 每次 push 前：先確認 build 可以成功

執行 `git push` 之前，必須先跑 build 確認不會壞掉：

```bash
npm run build
```

`npm run build` = `tsc -b && vite build`，同時檢查 TypeScript 型別錯誤與 Vite 打包。

- **build 成功** → 繼續 push
- **build 失敗** → 找出並修正錯誤，修正後重新 commit，再 push

### 正確的 push 流程

```
1. git commit（已包含 siteChangelog 更新 + docs 更新）
2. npm run build   ← 確認無誤
3. git push
```

> **注意：** commit 和 push 是兩個動作。使用者說「幫我 commit」不等於要 push；說「幫我推上去」或「push」才執行第 3 步。

### 新增頂層路由時：同步 Cloudflare Transform Rule 白名單

**只要在 `src/App.tsx` 新增一個頂層路徑段（`/versions`、`/connectivity` 這種層級），就必須到 Cloudflare Dashboard 把它加進 SPA fallback 的白名單，否則該路由一上線就是 HTTP 404。**

`npm run build` 與 `npm test` **都抓不到**這件事——它不是程式碼問題，而是一份只活在 CF Dashboard、不在版控裡的列舉式白名單。本機 dev 與 PR preview 也照樣正常，因為它們不經過那條規則。

#### 為什麼會 404

站台是 GitHub Pages 上的 SPA，origin 只有 `/index.html` 一個實體檔案。深層路徑靠 zone 的
**Transform Rules → URL 改寫**（規則名 `SPA fallback to index.html`）在邊緣改寫成 `/index.html`。
Free 方案不給用 `matches`（regex 需 Business），所以那條規則是**逐條列舉**路徑前綴的白名單——
沒登記的路徑不會被改寫，直接落到 GitHub Pages → 404。

漏掉不會整個壞掉（`public/404.html` 的重導 shim 會把真人救回來），所以**很容易看不出來**。
但代價是：HTTP 狀態碼 404、多一次 `/?/` 中繼跳轉、搜尋引擎不收錄、社群貼連結展開抓到 404。

#### 操作步驟

1. Dashboard → mecharashi.wiki → **規則 → 概觀 → URL 改寫規則**
   （不是「網頁規則 Page Rules」，那是舊版功能、與此無關）
2. 編輯既有那條規則（**不要新建**，改寫規則之間的優先序會讓行為難以預測）
3. 在「當傳入要求符合…」的白名單清單裡加一行：
   ```
   or starts_with(http.request.uri.path, "/你的新路徑")
   ```
   放在 `method eq "GET"` 的括號**內**，與其他 16 條並列；不要接在整條運算式尾巴
   （那會跳過 GET 守衛，而且下一個人會照樣往後接）
4. 部署後複驗：
   ```bash
   for p in /你的新路徑 /你的新路徑/子頁 /notarealpath; do
     echo "$(curl -sS -o /dev/null -w '%{http_code}' https://mecharashi.wiki$p)  $p"; done
   ```
   新路徑應為 200，`/notarealpath` 應維持 404（打錯的網址不該被收錄）

#### ⚠ 絕對不要動的部分

規則尾端有一個 `and not (...)` 區塊，用 **UA 比對**把社群爬蟲
（discordbot / facebookexternalhit / linebot / slackbot / twitterbot / telegrambot / applebot）
從 `/pilots/` `/mechs/` `/weapons/` 的改寫中排除掉。

它存在的理由：**Transform Rule 跑在 Workers Route 之前**。這三條路徑上掛著 PLAN-038 的社群預覽
Worker，路徑一旦被改寫成 `/index.html`，Worker 的 route 就匹配不到，OG 圖與標題全部退回預設值。
2026-08-22 首次部署就是這樣，Worker 收到零個事件。

動過規則後務必補驗一次：
```bash
curl -sS -A "Discordbot/2.0" "https://mecharashi.wiki/pilots/pilot_049_%E6%B5%B7%E8%8E%89%E7%B5%B2" | grep -o 'og:image[^>]*'
```
應看到 `og/entities/pilots/海莉絲/half.jpg`，**不是** `og/default.jpg`。

> **這條規則的由來：** PLAN-050 於 2026-08-19 建了 `/versions/*` 三條路由，白名單是 07-26 設的、
> 沒人回頭補，於是版本情報的分享連結整整 11 天都回 404（真人看得到、但狀態碼與收錄全錯），
> 直到 2026-08-30 才被發現。`App.tsx` 裡其實早有一段註解記下了這個陷阱
> （PLAN-052-B 決定沿用 `/simulator` 就是為了不碰這條規則），但教訓沒有變成流程，所以還是漏了一次。

---

## 4. 暫時性計畫與分析：一律先存進 `_local-notes/`

凡屬「暫時性、沒有直接打算實作」的計畫、分析、評估、提案，一律先存放在專案根目錄的 `_local-notes/`（此資料夾已被 `.gitignore` 忽略，不進版控），**不要**寫進 `docs/`、`src/`，也不要散落各處。

### 適用情境

- 可行性評估、工程量估算（例如「全站 i18n 要多少工」）
- 還沒決定要不要做的提案、架構演進構想
- 探索性的規劃、多方案比較筆記
- 任何「先研究、之後再決定」性質的產出（含驗證截圖、視覺化提案 HTML 等）

### 與正式 PLAN 的區別

| 類型 | 存放位置 | 是否提交 |
|---|---|---|
| 暫時性 / 未決定實作的分析、評估、提案 | `_local-notes/` | 否（本機參考，本規則對象） |
| 已決定執行的階段性開發計畫（PLAN-xxx） | `docs/05_階段性開發計畫/`（由 plan-manager skill 管理） | 是 |

### 規則

1. 預設輸出到 `_local-notes/`，檔名用描述性命名（kebab-case 或中文皆可）
2. 待使用者**明確決定要實作**後，再由 plan-manager 轉成正式 PLAN 寫進 `docs/05_`
3. 不確定一份產出該歸哪類時，**預設先放 `_local-notes/`**；「決定要做」才升級成正式 PLAN

> **注意：** `_local-notes/` 已在 `.gitignore`，無需擔心誤提交；也不要主動把裡面的內容搬進版控，除非使用者要求。

---

## 5. 常用指令

```bash
npm run dev        # 開發伺服器（predev 會先跑 generate-image-manifest + copy-docs）
npm run build      # = generate-image-manifest → copy-docs → tsc -b → vite build
npm run lint       # ESLint
npm test           # node --test，跑 src/**/*.test.ts
node --test src/utils/idSlug.test.ts   # 跑單一測試檔
npm run preview    # 預覽 production build
```

- **Windows + PowerShell 環境**：路徑用反斜線；POSIX 腳本（如 git hook）走 Bash 工具。
- **測試檔也吃型別檢查**：`tsconfig.test.json`（由根 `tsconfig.json` 的 references 帶進 `tsc -b`）專收 `src/**/*.test.ts`。
  它們被 `tsconfig.app.json` `exclude` 在外，先前**沒有任何專案收留**——IDE 因此連 `node:test` 都認不得（`@types/node` 進不來），
  而測試裡的型別錯誤永遠不會被 build 擋下。新增測試檔不必做任何設定，但**改 tsconfig 時三個專案要一起想**。
- `npm run prepare`（postinstall）會把 `core.hooksPath` 設為 `.githooks/`，並安裝 `.gitmessage` commit template。
- 環境變數：Firebase 設定全走 `VITE_FIREBASE_*` + App Check 的 `VITE_FIREBASE_APPCHECK_SITE_KEY` / `VITE_APPCHECK_DEBUG_TOKEN`，放 `.env.local`（不進版控）。

### Git hooks（已透過 `core.hooksPath` 啟用，自動執行）

- **`commit-msg`**：`feat|fix|perf|style|refactor` 類 commit 若未一併修改 `src/data/siteChangelog/` 會**擋下**（呼應規則 1）。`chore/ci/docs/...` 豁免。
- **`pre-push`**：先跑 `npm run build` 把關（失敗中止 push），再自動更新並 commit `CHANGELOG.md`。`CHANGELOG.md` 因此**請勿手動編輯**。

---

## 6. 程式架構速覽（big picture）

技術棧：**React 19 + TypeScript 6 + Vite 8 + Tailwind v4（CSS-first，無 config）+ React Router v7 + Firebase（Auth / Firestore / Storage / App Check）**。部署於 GitHub Pages，故 router 用 `basename={import.meta.env.BASE_URL}`。

### 6.1 三層 Provider（[src/App.tsx](src/App.tsx)）

`AuthProvider` → `GameDataProvider` → `ReferenceProvider`，外層到內層：

- **[AuthContext](src/contexts/AuthContext.tsx)**：Firebase Auth 登入狀態 + 角色（`AdminRoute` 用來 gate `/admin/*` 路由）。
- **[GameDataContext](src/contexts/GameDataContext.tsx)**：**全站遊戲資料的單一快取層**，見 6.2。
- **[ReferenceContext](src/contexts/ReferenceContext.tsx)**：實體引用（`EntityRef`）的 hover 浮窗 / 釘選 / 手機 BottomSheet 互動（PLAN-019 數值引用層）。

### 6.2 遊戲資料載入：版本 gate 的三層快取（最重要的架構）

前台讀資料**永遠**透過 [src/hooks/useFirestore.ts](src/hooks/useFirestore.ts) 的 `useXxx()` hook（`usePilots`、`useMechWithModules`、`useAllGameData`…），**不要**在元件裡直接呼叫 `firestoreApi`。流程：

1. hook 呼叫 `ensureLoaded(keys)`，`GameDataContext` 對每個 `CollectionKey` 做：
2. **記憶體**（本 session 已抓 → 0 read）→ **localStorage**（`mecharashi_gd_*`，版本相符 → 0 Firestore read）→ **Firestore**（真的去抓並寫回快取）。
3. 版本來源：`meta/gameData` 文件，每集合一個版本號 + 全域 fallback（[versions.ts](src/lib/api/versions.ts) 的 `DataVersions`）。整個 session 只讀版本 1 次。
4. 後台存檔後呼叫 `bumpDataVersion(key)` 使**所有 client** 該集合快取失效；編輯者自己則用 `patchCollectionItem` / `patchSingleton` 就地同步、免重讀。

> 用 `data-patch` skill 批次更新資料、或寫 migrate 腳本後，**務必 bump 版本**，否則使用者讀到舊快取。

### 6.3 Firestore API 層（[src/lib/firestoreApi.ts](src/lib/firestoreApi.ts)）

barrel 檔 re-export `./api/` 下按集合拆分的模組。共用基礎在 [firestoreCore.ts](src/lib/api/firestoreCore.ts)：

- `fetchCollection` / `fetchDocument` / `docExists`。
- `stripUndefined`：寫入前遞迴清掉 `undefined`（Firestore 不接受），各 `update*` 共用。
- `getCollectionPage`：**後台分頁查詢**（降低 read 量）。前台整包載入；後台部分集合（backpacks / components）走伺服器分頁。新增集合：`./api/` 建檔 + barrel 補一行 re-export + `GameDataContext` 的 `CollectionKey` 與 switch。

### 6.4 型別（[src/types/index.ts](src/types/index.ts)）

barrel 按領域拆檔（`pilot` / `mech` / `weapon` / `module` / `backpack` / `component` / `research` / `buff` / `common` / `grayOps` / `boss`）。**例外**：`enums.ts`、`mechUpgrade.ts` **不在** barrel 內，沿用各自獨立 import 路徑。修改型別 / enum 時依規則 2 同步 `docs/02_技術文件/`。

### 6.5 資料管線：爬蟲 → Firestore

`scripts/` 下 Playwright 爬蟲（`scrape-pilots-v3.js`、`scrape-mechs.js`、`scrape-weapons.js`…）抓官網 → migrate / patch 腳本寫入 Firestore。一次性腳本放 `scripts/temp_scripts/`。`generate-image-manifest.mjs`（build/dev 前置）掃 `public/images/` 產出可用圖片清單；`copy-docs.mjs` 依白名單把 `docs/` 複製進 `dist/`（route 為 `/documents`）。**官方 API 天賦文本是「滿晶片」污染值**，人工修正存 `PilotTalent.manual` 以防被補丁洗掉。

### 6.6 慣例

- 註解、文件、PLAN 一律繁體中文；程式識別字保留英文。
- `src/components/` **扁平層不放檔案**，新元件一律歸到子資料夾：跨領域重複的視覺元件依 UI 種類（`badges/` `icons/` `cards/` `common/`），只服務單一機制或頁面的依功能領域（`layout/` `auth/` `refs/` `module/` `planner/` `timeline/` `home/` `profile/` `admin/`）。分類表在 `docs/02_技術文件/01_架構設計/系統架構.html`。
- Tailwind v4：用 CSS-first（`@theme` / `index.css`），**不要**寫 v3 的 `tailwind.config.js`。
- Firestore 過濾優先 server-side `where`；靜態資料 `getDocs` 一次抓、需即時才 `onSnapshot`（注意免費額度 read 次數）。
- 階段性開發走 PLAN 制（`docs/05_階段性開發計畫/`，由 `plan-manager` skill 管理）；遊戲改版更新資料走 `data-patch` skill。
