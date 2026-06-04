---
name: plan-manager
description: 建立、推進、歸檔「階段性開發計畫 PLAN」文件。當使用者要新增一個 PLAN（如「開一個新計畫 PLAN-020」「幫我建戰鬥模擬器的計畫書」）、把完成的計畫移到歷史記錄（「PLAN-017 做完了，歸檔」「把這個計畫移到歷史記錄」），或更新進度表狀態時使用。處理 docs/05_階段性開發計畫/ 下的 計畫書.html / 進度表.html 與 執行中 / 歷史記錄 的 index.html。
---

# PLAN 計畫生命週期管理

`docs/05_階段性開發計畫/` 下的計畫文件格式高度固定，但每次開計畫/歸檔都要手動建多個檔案、改兩處 index。這個 skill 把那套流程模板化。

目錄結構：

```
docs/05_階段性開發計畫/
  index.html                  ← 計畫總覽（一般不動）
  執行中/
    index.html                ← 進行中計畫的卡片列表
    PLAN-XXX_<名稱>/
      計畫書.html
      進度表.html
  歷史記錄/
    index.html                ← 已完成計畫的卡片列表
    PLAN-YYY_<名稱>/ ...
```

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

## 注意

- 這些是 **docs HTML**，遵守 `CLAUDE.md` 第 2 條：純文件更新；保持現有 HTML 結構，只改資料內容。
- 建立/歸檔 PLAN 屬內部維護，**不需要**寫入 `src/data/siteChangelog/`（除非同一個 commit 也含使用者可見功能）。
- 編號、命名、顏色若使用者已指定，以使用者為準。
