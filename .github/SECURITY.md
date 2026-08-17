# 安全性政策 Security Policy

感謝你願意負責任地回報安全性問題。本專案是個人非營利的同好工具站，沒有 bug bounty、沒有獎金，但我會認真看待每一則有效回報。

## 回報管道

**請不要開公開 issue 回報安全性問題**——公開的重現步驟等同於把攻擊方式直接教給所有人。

請改用以下任一管道（由上而下優先）：

1. **GitHub 私密回報**：本 repo 的 [Security → Report a vulnerability](https://github.com/GitFenix1113/mecharashi-tools/security/advisories/new)（僅你與我看得到）
2. **Discord**：`fenix_nkodpm`（我最常看的管道）
3. Email：<fenix1113@gmail.com>（我很少看，急件請走上面兩項）

回報時請盡量附上：受影響的網址或檔案、重現步驟、你觀察到的實際影響，以及（若有）PoC。

## 適用範圍

| 範圍 | 是否適用 |
|---|---|
| 正式站 <https://mecharashi.wiki> | ✅ |
| 本 repo `main` 分支的程式碼（含 `workers/`、`firestore.rules`） | ✅ |
| 他人 fork 出去的站台或衍生版本 | ❌ 請找該 fork 的維護者 |
| 《鋼嵐 Mecharashi》官方網站與官方 API | ❌ **請勿測試**，那不是我的系統 |

### 我特別關心的問題類型

- Firestore 安全規則可被繞過（未授權讀取或寫入遊戲資料、使用者資料）
- Cloudflare Worker `/api/*` 代理的問題：繞過來源白名單、被當成開放代理、service account 權限溢出
- `/api/collect` 統計端點被濫用（繞過每日寫入預算或 kill switch）
- 管理後台 `/admin/*` 的權限提升或驗證繞過
- 任何真正的憑證外洩（service account 金鑰、Cloudflare token 等）
- 儲存型 XSS、帳號接管

### 以下情況**不**視為漏洞

- **`VITE_FIREBASE_*` 出現在前端 bundle 裡**——Firebase Web 設定（含 apiKey）依設計就是公開識別字，不是密鑰；實際防線在 Firestore 規則與 Worker 代理。單純「我在 JS 裡找到 API key」的回報會被關閉。
- 自動化掃描器的原始輸出、缺少某個 HTTP security header、SPF/DMARC 設定等無實際影響的評分項
- 需要受害者安裝惡意擴充功能、或攻擊者已實體接觸裝置的情境
- 社交工程、釣魚
- **純流量灌爆 / DoS 壓測**——本站跑在免費額度上，這類測試只會讓其他玩家用不了站，也不算漏洞回報。請不要做。

## 測試時的界線

歡迎在不影響他人的前提下研究本站。請**不要**：刪改不屬於你的資料、大量自動化打 `/api/*`、對官方遊戲網站施壓，或在修復前公開細節。

## 我的回應方式

這是業餘時間維護的專案，無法承諾 SLA。實務上我通常會在**數日內**回覆確認，並視嚴重程度盡快修復。修好之後若你願意，我很樂意在 release note 或 [CHANGELOG.md](../CHANGELOG.md) 致謝（也可以匿名）。
