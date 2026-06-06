# Changelog

所有重要變更將記錄於此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased] - 2026-06-06

### ⚠ 重大變更

- 資料層遷移至 Firestore，整合 Firebase 認證 (`eac6e87`)

### ✨ 新功能

- PLAN-004 技能庫抽離 Phase 1+2 — pilotSkills 集合與技能引用解析 (`9a5d998`)
- PLAN-019 引用層互動 + descriptionMax 吃引用 + PLAN-017 跨 session 版本快取 (`ff66ec8`)
- 機師後台技能分頁支援手動新增技能 + 描述可編輯 (`c0abc7a`)
- 版本時間線改為焦點輪播 + 詳情頁台陸版切換 + 甘特圖雙表格版面 (`143b296`)
- PLAN-019 Layer 1-3 型別基礎建設（EntityRef / Boss / Stage）+ 修正圖示 URL 解析 (`196c8c5`)
- PLAN-018 彩甲升級規劃器工具頁完成（規劃器 UI、計算結果展示與路由整合） (`79e3051`)
- **ui**: 新增 Email 密碼重設功能 (`3a6bb24`)
- PLAN-018 彩甲升級規劃器核心算法、型別定義與圖片資源 (`1b5efe0`)
- 首頁新增 Discord 社群連結 (`1175f35`)
- 首頁新增網站更新履歷區塊，調整站點團隊頭像尺寸 (`5884132`)
- 首頁站點團隊區塊 + 頭像錯誤 fallback + Firestore ADMIN/OWNER 查詢 (`42f95b1`)
- 頭像上傳改用 Cloudinary，移除 Firebase Storage 依賴 (`0e3580d`)
- 武裝生產支援專武機師欄位 + 版本表匯出圖片 + 首頁版面展開切換 (`6a58515`)
- 優化time line甘特圖顯示 (`0ebf3c1`)
- 按需載入資料 + 各頁分頁功能 + 背包管理 (`4eca044`)
- admin page 新增 gray ops panel (`54a5f58`)
- 優化page對firebase的讀取頻率，降低流量 (`e4d7f63`)
- 新增 PLAN-017 計畫、精細化 Firestore 權限、調整管理後台導覽 (`521b586`)
- 新增快取層，降低firebase用量 (`9320f1f`)
- 重構首頁為全螢幕 snap-scroll 設計，完成 PLAN-013/PLAN-015 (`f1edb3d`)
- PLAN-013 首頁版本時間線 + PLAN-014 後台管理基礎建設 (`158a478`)
- 新增元件關卡掉落資訊和篩選條件 (`bb3d7a6`)
- 新增 PLAN-012 元件圖鑑頁面與相關元件 (`dd05ab4`)
- 新增機師故事顯示 (`7d02f3f`)
- 新增機師品質篩選、稀有度標籤與圖片資源 (`14f0068`)
- 更新profile 功能頁 (`41c9b4b`)
- 擴充profile功能 (`65d81d0`)
- 調整用戶註冊，現在可以不用第三方登入，只用mail註冊 (`8b4f253`)
- 優化機師detail頁面，新增專武二階段資訊 (`9ec55ff`)
- 因應元件欄位調整，更新types ts (`c16ca37`)
- 因應元件功能，調整列舉 (`8856bfc`)
- 管理者解面新增元件管理 (`bebd7f6`)
- 因應元件欄位名稱更動，模擬頁調整名稱 (`b2889cc`)
- 更新背包顯示方式 (`6ef3cf1`)
- 新增元件擷取腳本與資料 (`13367fc`)
- 優化部分手機頁面使用體驗 (`5dbc497`)
- 新增bottom sheet，優化手機版體驗 (`56f6778`)
- 調整layout與手機toolbar導航 (`6a9ab42`)
- 排版調整適應手機 (`34d92f2`)
- 調整手機排版 (`d278b4a`)
- PilotsPage新增專武顯示 (`f33fcbe`)
- **weapons**: PLAN-007 武器 API 欄位映射修正；武器詳情頁 UI 優化 (`ca6477f`)
- **weapons**: 武器詳情頁（PLAN-006）完成；新增全模組 Badge 元件重構 (`d6e2485`)
- **weapons**: 武器資料模型全面重構（PLAN-003）；新增 PLAN-004 計畫文件 (`37cbee7`)
- **weapons/admin**: 武器需求結構化模型（PLAN-003）；新增機師編輯面板；移除科研設定 (`bea0e73`)
- **pilot/mech**: 機師/機甲詳情頁改版；新增專屬模組/武器、模組等級 Tooltip、技能 Buff 型別系統 (`7064fc4`)
- **layout**: 新增全域字體大小切換（小/中/大），以 localStorage 持久化；模組描述與等級彈窗數字 % 紅色標示 (`65813ae`)
- **home**: 改版首頁為吉祥物歡迎頁，移除快速入口 (`fdc7614`)
- **page**: 詳情頁新增剩餘出力顯示、重構部件卡片佈局 (`75a9471`)
- **mech**: 爬蟲 v3 — 圖片改分資料夾、修正部件圖 URL、機體詳情頁駕駛艙排版 (`42b4d7f`)
- v1.5 Phase 3 — 模組圖鑑 + 配裝模擬器 + html2canvas 匯出 (`a7fff68`)
- v1.4 模組系統 — Module 資料結構、爬蟲與管理介面 (`89ac717`)

### 🐛 修復

- 更新首頁 Discord 社群邀請連結 (`3171c83`)
- 強化密碼重設流程，避免揭露帳號是否存在並移除無效 UI (`8a6a9a3`)
- 修正以 Email 註冊時 photoURL undefined 導致 Firestore setDoc 失敗 (`b2d5c64`)
- 修正無法用MAIL註冊的BUG (`fad6dfe`)
- 新增 Cloudinary 環境變數至 GitHub Actions deploy workflow (`6bd9269`)
- 修正無法上傳頭像的BUG (`95204f4`)
- 修正Build bug (`2b6c079`)
- 修正武器管理頁BUG (`760024b`)
- 修正build失敗 (`bf787a6`)
- 使用 BASE_URL 修正預覽部署的路由 basename 不匹配問題 (`59e65b5`)
- 修正build錯誤 (`c1b44c1`)
- 移除 VersionGanttPanel 未使用的 tooltip 變數 (`1fa7846`)
- 修復主站 404 — 改回 peaceiris 部署架構 (`0b223d7`)
- 修正頭像選擇 (`bd469d1`)
- 修正用戶控制異常 (`78356c6`)
- 修正因discriminant 導致的build失敗 (`0d98878`)
- **admin**: 修正武器表單 attack 欄位型別不符導致 build 失敗 (`05dc704`)
- 修正build因Weapon 的資料型別調整失敗的bug (`f863548`)
- **admin**: 移除 AdminPage 未使用的 WeaponRequirement import (`6cf5528`)
- **mech**: module4Id/module8Id 改為選填；修正部件卡佈局及左右臂順序 (`5399367`)
- **deploy**: 修正 GitHub Pages SPA 直連子路徑 404 問題 (`9ac987c`)
- **scripts**: 修正爬蟲腳本模組 schema 與文件規範不符 (`0cad3a9`)
- **page**: 機甲屬性火力與剩餘出力改從部件累加計算 (`958991d`)
- **scraper**: 修正 CHANGELOG 自動 commit 過濾 regex 支援中文訊息 (`f0145d0`)

### ⚡ 效能優化

- 消除首頁 Quick Table 的 Firestore 全集合讀取 (`067ee4e`)
- 啟用 Firestore IndexedDB 離線持久化，降低重複讀取 (`e9021a4`)

### ♻️ 重構

- 後台改為伺服器端分頁查詢與延遲載入閘門 (`351b9f4`)
- 圖片上傳抽出共用模組 imageUpload + 版本前瞻圖改用 Cloudinary (`d41fe4e`)
- AdminPage 拆分為子模組，修正活動日期計算與灰燼行動資料 (`806c09a`)
- 重構頁面目錄結構並新增背包功能 (`e4845db`)

### 📊 資料更新

- **mech**: 新增機體圖片資源與更新機體/飛行員資料，重構爬蟲腳本 (`71c4860`)

### 📚 文件

- PLAN-014 版本甘特圖與後台管理 移至歷史記錄 (`4a54369`)
- 將已完成的文件轉移目錄 (`7003c97`)
- 新增武器圖片 (`fe33ab6`)
- 更新README文件 (`805c834`)
- 將 PLAN-013 首頁版本時間線移至歷史記錄，更新狀態為 DONE (`a1e4af6`)
- 更新文件 (`6f7dd6a`)
- 更新文件 (`c977a59`)
- 更新enum文件 (`4bf813f`)
- 更新開發進度文件 (`be2d378`)
- 新增手機排版計畫書 (`9373aa1`)

### 🎨 樣式

- 調整home page樣式 (`7a1a145`)
- 放大頭像 (`42895bb`)
- 調整首頁說明文字 (`ec8855c`)
- 更新所有容器的樣式，並新增背景 (`6b7fabd`)
- 更新首頁文字 (`e8a42e2`)
- 調整機師頭像比例置中 (`0473986`)

### 🔧 維護

- PLAN-004 技能庫抽離 Phase 3 — pilots 改引用 pilotSkills 單一資料源 (`d3be774`)
- 版控開發者 skill 與 git hooks 防呆 (`ed5fa22`)
- 觸發重新部署以套用 Cloudinary upload preset (`267911c`)
- 觸發重新部署以修復頭像上傳問題 (`8b2a838`)
- **layout**: 更新頁尾免責聲明文字 (`2a6abe7`)
- 更新 .gitignore 並修正 pre-push hook CI 跳過問題 (`8dcddc6`)

### 🚀 CI/CD

- 新增 workflow_dispatch 觸發方式至 preview workflow (`f354195`)
- 重新觸發 preview 部署 (`af8e9fc`)
- 同步 workflow 設定，防止 gh-pages 競爭條件 (`4ede30e`)
- add preview deployment workflow and dynamic base path (`954413a`)

### 其他

- 更新元件定義 (`4155274`)
- **components**: 新增武器外框和稀有度字體外框渲染效果 (`01017a8`)

---
## [0.1.0] - 2026-05-14

### ✨ 新功能

- 新增機體/機師詳情頁與完整資料 (`f0d43a3`)
- 初始化專案架構與開發進度表 (`77359ff`)

### 🚀 CI/CD

- 新增 GitHub Pages 自動部署工作流程 (`c172247`)
- trigger GitHub Pages deployment (`996a35e`)
