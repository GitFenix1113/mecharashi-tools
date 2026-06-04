---
name: data-patch
description: 遊戲改版後更新 Firestore 遊戲資料的標準管線。當使用者要重抓/補丁/更新機師(pilots)、機甲(mechs)、武器(weapons)、模組(modules)、元件(components)、背包(backpacks)資料（如「官網更新了，重抓機師」「補一下葉夫根尼的資料」「把新武器抓進來」「更新遊戲資料後記得 bump 版本」）時使用。封裝 scrape → 預覽 diff → 人工確認技能效果 → 寫入 Firestore → bump 版本 → 更新履歷 的流程。
---

# 遊戲改版資料上架管線

每次官網改版後把資料同步進 Firestore 的步驟是固定的；**唯一需要人腦的是「技能效果（effects / buffIds）抽象化」那一步**——這部分仍會高頻變動，這個 skill 刻意把它留成人工確認點，不自動填值。

## 黃金原則

1. **永遠先預覽，再寫入。** 先用 dry/dump 模式看 diff，確認無誤才正式寫 Firestore。
2. **不要自動填技能 effects / buffIds。** 新技能的效果建模交給使用者判斷，agent 只負責把新技能呈現出來、提示哪些需要補。
3. **執行任何 scraper 前，先讀它檔頭的註解區塊**確認該腳本「實際支援的旗標」——各腳本不一致（見下表）。
4. **寫入後一定 bump 版本**，否則前台 localStorage 快取不會失效（PLAN-016/017）。

## 各實體 ↔ 腳本 ↔ 旗標對照

| 實體 | 腳本 | 預覽（不寫入） | 寫入 | 備註 |
|---|---|---|---|---|
| 機師 pilots | `scripts/scrape-pilots-v3.js` | `--patch --dump-json` | `--patch` | **補丁模式會保護後台手動編輯的 `effects`/`buffIds` 與 `manual:true` 技能**。單一：`--pilot=<繁中名>` |
| 武器 weapons | `scripts/scrape-weapons.js` | `--dry-run --limit=3` | （預設＝只新增）/ `--force` 重抓 | 無 patch 合併模式 |
| 背包 backpacks | `scripts/scrape-backpacks.js` | `--dry-run --limit=3` | （預設＝只新增）/ `--force` | |
| 元件 components | `scripts/scrape-components.js` | `--dry-run --limit=3` | （預設＝只新增）/ `--force` | |
| 模組 modules | `scripts/scrape-modules.js` | （無 dry-run，先讀檔頭）| （預設）/ `--force` | 謹慎，可先 `--limit` 試跑 |
| 機甲 mechs | `scripts/scrape-mechs.js` | （無 dry-run，先讀檔頭）| `--force` / `--clear-mechs --force` 全量重建 | `--clear-mechs` 會清空集合，高風險 |

> 只有 pilots 有保護手動欄位的 `--patch` 合併模式。其他腳本預設是「只新增缺漏」，`--force` 才覆蓋——若該實體有後台手動編輯過的欄位，用 `--force` 前先跟使用者確認會不會被蓋掉。

## 標準流程

以「機師改版」為例（其他實體把指令換成上表對應的）：

1. **預覽差異（不寫 Firestore）**
   ```bash
   node scripts/scrape-pilots-v3.js --patch --dump-json
   # 只補單一：node scripts/scrape-pilots-v3.js --patch --dump-json --pilot=葉夫根尼
   ```
   讀輸出的暫存比對 JSON，整理出：新增了哪些實體 / 哪些欄位有變 / **哪些是新技能（需要建模 effects/buffIds）**。

2. **回報並停下來等使用者**
   把 diff 摘要給使用者，特別標出**新技能 / 技能描述有變動者**。問使用者這些技能的 `effects` / `buffIds` 要怎麼填，或是否先以空陣列寫入、之後到後台補。**不要自己臆測效果數值。**

3. **正式寫入 Firestore**（使用者確認後）
   ```bash
   node scripts/scrape-pilots-v3.js --patch
   ```
   （其他實體：預設執行，或視情況加 `--force`。）

4. **Bump 資料版本**（讓全站快取失效）
   ```bash
   node scripts/bump-data-version.mjs
   # 查目前版本不寫入：node scripts/bump-data-version.mjs --show
   ```

5. **更新網站履歷**（依 CLAUDE.md 第 1 條）
   若這次更新是使用者可見的（新角色/新武器上架等），在 `src/data/siteChangelog/` 對應月份檔最前面加一筆 `feat`，用使用者視角描述（例：「新增 X 版本機師葉夫根尼資料」）。純資料修補、使用者無感者可略。

6. **圖片資產**
   scraper 會把立繪/圖示下載到 `public/images/...`（pilots / skills 等）。記得這些新檔要一起 `git add` 進 commit。

## 收尾檢查

- [ ] diff 已預覽且使用者確認過
- [ ] 新技能的 effects/buffIds 已處理（填值或明確標記待後台補）
- [ ] Firestore 已寫入
- [ ] `bump-data-version.mjs` 已執行
- [ ] siteChangelog 已更新（若使用者可見）
- [ ] `public/images/...` 新增圖片已納入 commit

## 環境前提

scraper 與 bump 腳本需要 Firebase Admin 金鑰：`.env` / `.env.migration` 內的 `GOOGLE_APPLICATION_CREDENTIALS` 指向服務帳號 JSON。若報「未設定 / 找不到金鑰」，先確認該環境變數。
