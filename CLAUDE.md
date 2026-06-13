# CLAUDE.md — 鋼嵐工具站 專案規則

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
