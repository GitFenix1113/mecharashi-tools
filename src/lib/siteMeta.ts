// 站名與站台識別的單一來源 —— PLAN-052-C Phase E / E-1
//
// 為什麼要有這個檔案：2026-08-13 全站正名時，站名在**五個地方各寫各的**
// （分頁標題、頁尾、首頁、連線診斷、配裝分享圖），改名那一次就漏了其中兩處，
// 症狀是同一個站在不同畫面叫不同名字。這種漏不會有任何工具抓得到——
// tsc 看到的是五串合法字串，eslint 看到的也是。
//
// ⚠ **仍有兩份無法 import 這裡**，只能用測試綁住（見 siteMeta.test.ts）：
//   ① `index.html`：爬蟲讀的是原始 HTML，og:* 必須寫死在那裡（PLAN-038 Tier 1）。
//   ② `workers/src/socialPreview.ts`：Cloudflare Worker 是獨立 bundle，
//      import 不到前端模組（同 collectionKeys.test.ts 的處境）。
//   改站名時這兩份要一起改，測試會在漏改時失敗並指名是哪一份。

/** 中文站名。單獨出現時（抬頭 wordmark、診斷報告標題）用這個。 */
export const SITE_NAME = '米赫瑪超吉情豹站'

/** 英文站名。⚠ 是 Milkhama 不是 Milhama —— 舊名拼字錯過一次。 */
export const SITE_NAME_EN = 'Milkhama PawInfo Station'

/** 完整標題（中文 — 英文）。頁尾、分頁標題、分享圖浮水印用這個。 */
export const SITE_TITLE = `${SITE_NAME} — ${SITE_NAME_EN}`

/** 正式站 origin。⚠ 與 Worker 的 `SITE_ORIGIN` 是同一個值，測試綁住。 */
export const SITE_ORIGIN = 'https://mecharashi.wiki'

/** 顯示用網域（不含協定）。分享圖浮水印印的是這一串，因為它要能被人「照著打進網址列」。 */
export const SITE_DOMAIN = SITE_ORIGIN.replace(/^https?:\/\//, '')
