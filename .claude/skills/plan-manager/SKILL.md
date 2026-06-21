---
name: plan-manager
description: 建立、推進、歸檔「階段性開發計畫 PLAN」文件。當使用者要新增一個 PLAN（如「開一個新計畫 PLAN-020」「幫我建戰鬥模擬器的計畫書」）、把完成的計畫移到歷史記錄（「PLAN-017 做完了，歸檔」「把這個計畫移到歷史記錄」）、把開發已收束但仍需長期填值/維護的計畫轉入觀察維護中（「PLAN-005 開發完了只剩填資料，移到觀察中」），或更新進度表狀態時使用。處理 docs/05_階段性開發計畫/ 下的 計畫書.html / 進度表.html 與 執行中 / 觀察維護中 / 歷史記錄 的 index.html。
---

# PLAN 計畫生命週期管理

`docs/05_階段性開發計畫/` 下的計畫文件格式高度固定，但每次開計畫/歸檔都要手動建多個檔案、改兩處 index。這個 skill 把那套流程模板化。

目錄結構：

```
docs/05_階段性開發計畫/
  index.html                  ← 計畫總覽（三個入口卡：執行中 / 觀察維護中 / 歷史記錄）
  執行中/
    index.html                ← 進行中計畫的卡片列表
    PLAN-XXX_<名稱>/
      計畫書.html
      進度表.html
  觀察維護中/
    index.html                ← 開發收束、僅剩長期填值/維護的計畫卡片列表
    PLAN-ZZZ_<名稱>/ ...
  歷史記錄/
    index.html                ← 已完成計畫的卡片列表
    PLAN-YYY_<名稱>/ ...
```

三層生命週期：**執行中**（開發/規劃進行中）→ **觀察維護中**（程式開發已收束，但仍需長期輸入資料或持續觀察）→ **歷史記錄**（整個計畫含資料作業全部完成、歸檔）。觀察維護中是可選的中繼站；若計畫沒有長期資料尾巴，可從執行中直接歸檔。

模板在本 skill 的 `templates/` 下：`計畫書.template.html`、`進度表.template.html`。
共用樣式為 `docs/_shared/style.css`，計畫頁各自帶內嵌 `<style>`（已含在模板）。

---

## 顏色主題對照（{{COLOR}} / {{COLOR_RGB}}）

模板用 `{{COLOR}}`（CSS class 與 `var(--accent-X)` 名稱）與 `{{COLOR_RGB}}`（hero 漸層用的 rgb 三元組）。挑一個尚未被相鄰計畫用到的顏色即可：

| {{COLOR}} | {{COLOR_RGB}} |
|---|---|
| green  | 34,197,94 |
| cyan   | 34,211,238 |
| orange | 249,115,22 |
| purple | 168,85,247 |
| yellow | 234,179,8 |
| red    | 239,68,68 |
| pink   | 236,72,153 |

> 若需確認精確值，查 `docs/_shared/style.css` 的 `--accent-*`。

---

## 操作 A：新建 PLAN

1. **決定編號**：列出 `執行中/` 與 `歷史記錄/` 下所有 `PLAN-XXX_*` 資料夾，取最大編號 +1（三位數，如 `PLAN-020`）。除非使用者指定編號。
2. **決定資料夾名**：`PLAN-XXX_<簡短中文名>`（沿用既有命名風格，名稱不含空白，例：`PLAN-020_戰鬥模擬器`）。
3. **建立兩個檔案**：複製 `templates/計畫書.template.html` 與 `templates/進度表.template.html` 到新資料夾，命名為 `計畫書.html`、`進度表.html`，並替換所有 `{{...}}` 佔位符：
   - `{{PLAN}}` 計畫編號（`PLAN-020`）
   - `{{COLOR}}` / `{{COLOR_RGB}}` 見上表
   - `{{TITLE}}` 計畫主標（中文）
   - `{{TITLE_SUFFIX}}` h1 後方灰字副標（一行關鍵詞，如 `Combat Sim · 隊伍加成 · 傷害計算`）
   - `{{HERO_SUB}}` hero 一句話說明
   - `{{DATE}}` 建立日期（用今天日期）
   - `{{SCOPE}}` 影響範圍（涉及的模組/檔案）
   - `{{PRIORITY}}` 優先級（HIGH / MID / LOW）
   - `{{DEPENDENCY}}` 前置依賴（無則填「無」）
   - `{{STATUS}}` 狀態（新計畫填「規劃中」或「開發中」）
4. **填內容**：依使用者描述補 計畫書 的 Problem / Design / Scope 區塊，與 進度表 的 Phase / task-group。模板各保留一個範例區塊，照樣複製增減即可。新進度表的 summary 數字與進度條從 0 起算。
5. **註冊到 `執行中/index.html`**：在 `<div class="card-grid">` **最前面**插入一張卡片（最新的在前）：

```html
    <div class="card {{COLOR}}">
      <div class="card-icon">◆</div>
      <h3>{{PLAN}} · {{TITLE}}</h3>
      <p>{{一段摘要，與 hero-sub 相近即可}}</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <a class="card-link" href="{{PLAN}}_{{名稱}}/計畫書.html">→ 計畫書</a>
        <a class="card-link" href="{{PLAN}}_{{名稱}}/進度表.html">→ 進度表</a>
      </div>
    </div>
```

---

## 操作 B：歸檔 PLAN（移到歷史記錄）

當一個計畫完成、要從「執行中」移到「歷史記錄」：

1. **移動資料夾**：用 `git mv docs/05_階段性開發計畫/執行中/PLAN-XXX_<名稱> docs/05_階段性開發計畫/歷史記錄/PLAN-XXX_<名稱>`（保留 git 歷史；`執行中` 與 `歷史記錄` 同層，相對路徑深度不變）。
2. **修正移動後檔案內的兩處字面參照**（計畫書.html 與 進度表.html 各一份）：
   - 麵包屑：`<a href="../index.html">執行中</a>` → `<a href="../index.html">歷史記錄</a>`
   - 頁尾：`... — <a href="../index.html" ...>← 執行中</a>` → `← 歷史記錄`
   （`../index.html` 連結本身不用改，移動後它自然指向歷史記錄的 index。）
3. **從 `執行中/index.html` 移除該卡片。**
4. **在 `歷史記錄/index.html` 的 `<div class="card-grid">` 最前面新增卡片**，比執行中多一行完成資訊：

```html
    <div class="card {{COLOR}}">
      <div class="card-icon">◆</div>
      <h3>{{PLAN}} · {{TITLE}}</h3>
      <p>{{摘要}}</p>
      <p style="font-size:12px;color:var(--text-dim);margin-top:8px;">完成日期：{{YYYY-MM-DD}} · {{N}} / {{N}} 任務</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <a class="card-link" href="{{PLAN}}_{{名稱}}/計畫書.html">→ 計畫書</a>
        <a class="card-link" href="{{PLAN}}_{{名稱}}/進度表.html">→ 進度表</a>
      </div>
    </div>
```
5. **更新進度表的狀態**：summary 數字、進度條 width、頂部「✅ 已實作」說明區塊改為完成態（可參考既有歷史記錄計畫的寫法）。

---

## 操作 C：轉入觀察維護中（執行中 → 觀察維護中）

當一個計畫的**程式開發已收束**（型別 / UI / Admin / 遷移皆落地並運作），但**仍需長期輸入資料或持續觀察**（例：管理員逐筆補填數值、等待官網改版回灌、長期跑數據觀察），就把它從「執行中」移到「觀察維護中」。判定準則：

- ✅ 適合：開發者任務（型別 / 元件 / Admin / 腳本）已全數完成，剩下的只有**資料作業**或**觀察等待**，不阻塞其他開發。典型語句：「開發已完成，僅餘管理員長期填值」。
- ❌ 不適合：仍有未寫的程式 / 未做的 Phase（留執行中）；或連資料尾巴都做完了（直接走操作 B 歸檔）；或尚未開工、只是 PENDING 等依賴（留執行中）。

步驟（與操作 B 同構，差在目標資料夾與兩處字面參照）：

1. **移動資料夾**：`git mv docs/05_階段性開發計畫/執行中/PLAN-XXX_<名稱> docs/05_階段性開發計畫/觀察維護中/PLAN-XXX_<名稱>`（執行中／觀察維護中／歷史記錄三者同層，相對路徑深度不變，`../index.html` 自然指向觀察維護中的 index）。
2. **修正移動後檔案內的兩處字面參照**（計畫書.html 與 進度表.html 各一份）：
   - 麵包屑：`<a href="../index.html">執行中</a>` → `<a href="../index.html">觀察維護中</a>`
   - 頁尾：`... — <a href="../index.html" ...>← 執行中</a>` → `← 觀察維護中`
3. **從 `執行中/index.html` 移除該卡片。**
4. **在 `觀察維護中/index.html` 的 `<!--PLANS-START-->` 之後（卡片列表最前面）新增卡片**，比執行中多一行維護說明：

```html
    <div class="card {{COLOR}}">
      <div class="card-icon">◆</div>
      <h3>{{PLAN}} · {{TITLE}}</h3>
      <p>{{摘要}}</p>
      <p style="font-size:12px;color:var(--text-dim);margin-top:8px;">開發收束：{{YYYY-MM-DD}} · 維護內容：{{一句話，如「管理員逐步補填各機師技能數值」}}</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <a class="card-link" href="{{PLAN}}_{{名稱}}/計畫書.html">→ 計畫書</a>
        <a class="card-link" href="{{PLAN}}_{{名稱}}/進度表.html">→ 進度表</a>
      </div>
    </div>
```
5. **更新進度表頂部狀態**：把開發 Phase 標為已完成，並在狀態說明標明「開發收束，餘 XXX 為長期維護任務」（多數此類計畫的進度表已是此寫法，沿用即可）。

> 日後該計畫的長期資料也補完 / 不再需要觀察時，再從「觀察維護中」依**操作 B** 歸檔到「歷史記錄」（操作 B 的字面參照改法同理，來源換成觀察維護中）。

---

## 注意

- 這些是 **docs HTML**，遵守 `CLAUDE.md` 第 2 條：純文件更新；保持現有 HTML 結構，只改資料內容。
- 建立/歸檔 PLAN 屬內部維護，**不需要**寫入 `src/data/siteChangelog/`（除非同一個 commit 也含使用者可見功能）。
- 編號、命名、顏色若使用者已指定，以使用者為準。
