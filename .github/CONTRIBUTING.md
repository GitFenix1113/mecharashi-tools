# 參與方式 Contributing

先講清楚定位：**這是一個人維護的非營利同好專案**，原始碼公開主要是為了透明與供人學習，不是在招募協作者。所以這份文件的重點，是告訴你哪種參與方式對我最有幫助、哪種可能白費你的時間。

## 最有幫助的貢獻：回報資料錯誤

站上的遊戲資料由爬蟲從官方來源蒐集後整理，難免有落差（尤其改版後）。**發現數值、文字或圖片跟遊戲內不符時，開一個 [資料錯誤回報](https://github.com/GitFenix1113/mecharashi-tools/issues/new?template=data-error.yml) issue 是最有價值的貢獻**，比送 PR 還實用——因為資料存在 Firestore，不在這個 repo 裡，我需要的是「哪裡錯、正確值是什麼」，改資料本身反而是最快的一步。

回報前請先確認兩件事，可以省下我們雙方的時間：

- **不是快取造成的**：站上資料有本機快取層，請先重新整理（Ctrl + F5）看看是否已經更新
- **不是條件差異**：機師天賦、武器數值會隨等級／突破／晶片狀態變動，比對時請確認條件一致（官方 API 給的天賦文本本身就是滿晶片狀態，我們另有人工修正）

## 網站功能異常

按鈕壞掉、頁面白畫面、模擬器算錯 → [網站功能異常](https://github.com/GitFenix1113/mecharashi-tools/issues/new?template=bug-report.yml)。附上瀏覽器 Console 的錯誤訊息會快很多。

## 功能建議與一般討論

走 **Discord：`fenix_nkodpm`**。我在那邊回得最快，討論也比 issue 順。

## 安全性問題

**不要開公開 issue**，請看 [SECURITY.md](./SECURITY.md)。

## 關於 Pull Request

- **小修正**（錯字、失效連結、明顯的一行 bug）：直接送 PR，我會看。
- **功能、重構、樣式大改**：**請先開 issue 或在 Discord 找我討論**。這個站有不少決策寫在 `docs/05_階段性開發計畫/` 的 PLAN 裡，未經討論的大 PR 很可能跟既有規劃衝突，我不想讓你白做工。
- **不會合併的 PR**：整批格式化／重排、更換技術棧、加入廣告或任何營利相關功能、把資料匯出到其他站台。

### 若你要送 PR

```bash
npm install     # postinstall 會設定 git hooks 與 commit template
npm run lint
npm test
npm run build   # push 前 pre-push hook 也會跑，失敗會擋下
```

專案有幾條 hook 強制的約定，先知道可以少踩雷：

- **commit 訊息**用 `feat|fix|perf|style|refactor|chore|docs|ci` 前綴
- **`feat|fix|perf|style|refactor` 類的 commit 必須一併更新 `src/data/siteChangelog/`**（使用者可見的更新履歷），否則 `commit-msg` hook 會擋下
- **`CHANGELOG.md` 請勿手動編輯**，由 `pre-push` hook 自動維護

程式碼慣例（完整版見 [CLAUDE.md](../CLAUDE.md)）：

- 註解與文件用繁體中文，程式識別字用英文
- `src/components/` 扁平層不放檔案，新元件一律歸到子資料夾
- Tailwind v4 走 CSS-first（`@theme`），不要新增 `tailwind.config.js`
- 前台取資料一律用 `src/hooks/useFirestore.ts` 的 `useXxx()` hook，不要在元件裡直接呼叫 `firestoreApi`

## 授權

送出 PR 即表示你同意你的貢獻以本專案的授權釋出：程式碼為 [PolyForm Noncommercial 1.0.0](../LICENSE)，文件與資料為 CC BY-NC-SA 4.0。
