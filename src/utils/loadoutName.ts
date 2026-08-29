// 配裝方案名稱的正規化（PLAN-052-I E-1）
//
// 這個字串有三個出口，每一個都會放大輸入的問題：
//   ① 匯出長圖最大的一行（44px）——換行會把版面撐開、控制字元會渲染成豆腐格
//   ② 052-C 的分享碼 ——「別人的字串」會經過解碼路徑回到本站的 DOM
//   ③ 052-E 的雲端保存 —— 落盤之後就洗不掉了
//
// 052-I E-1 曾預告「命名需登入，gate 掛 052-E」——**該預告已於 052-E A-2 撤銷（2026-08-29）**：
// 名稱對訪客維持開放，只有「存到雲端」需要登入。理由是名稱早已編進分享碼的 §NAME 段、
// 也印在匯出圖上，回頭 gate 會讓訪客既有的分享碼與匯出圖失去名稱，而名稱不佔 Firestore、
// 不是特權、也不是配額。⇒ 這裡不會有登入判斷，別再等它。
//
// 所以清洗放在**寫入邊界**（reducer 的 setName ＋ reconcile），不放在渲染端：
// 渲染端清洗會讓「存進去的」與「看到的」是兩個字串，而落盤的是髒的那一個。
//
// 純函式、無 React 依賴，可單測（npm test）。

/**
 * 名稱長度上限（**碼點**數，不是 UTF-16 長度）。
 *
 * 24 是從匯出圖倒推的：banner 的名稱區約 550px 寬、字級 44px ⇒ 一行約 12 個中文字，
 * 24 剛好是「最多兩行」。再長就得縮字級，而縮到讀不出來的方案名等於沒有方案名。
 */
export const LOADOUT_NAME_MAX = 24

/**
 * 會讓「看到的字」與「存起來的字」不一致的字元，一律移除。
 *
 * ⚠ 不是為了防 XSS（React 會轉義），而是為了**視覺一致性**：雙向覆寫字元（U+202E 這類）
 *   能讓一段字在圖上倒著顯示、在輸入框裡正著顯示；零寬字元則能讓兩個看起來一樣的名稱
 *   其實是不同字串。兩者在匯出圖與分享碼上都會變成「查不出原因」的怪事。
 *   C0／C1 控制字元同理（渲染成豆腐格）。
 *
 * ⚠ **刻意排除 `	` `
` `
`**：它們由下一步折成單一空白，而不是在這裡被吃掉。
 *   兩者的差別是「星芒
雙持」變成「星芒 雙持」還是「星芒雙持」—— 後者把兩個詞黏在一起，
 *   而使用者按 Enter 的本意是分隔。
 */
// eslint-disable-next-line no-control-regex -- 本規則要抓的就是控制字元（見上方註解）
const INVISIBLE = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g

/**
 * 把使用者輸入清成可以安全落盤與印在圖上的方案名。
 *
 * **回傳 `undefined` 而不是空字串**：`LoadoutDraft.name` 與 `backpackId` / `ndLevels` 同一條
 * 規則 —— 未設定＝欄位不存在。存空字串會讓「清掉名字」與「從沒取過名字」在型別上
 * 分不出來，而 `stripUndefined`（firestoreCore.ts）又會讓其中一種再也寫不回去。
 */
export function sanitizeLoadoutName(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const flat = raw
    // 順序有意義：先拿掉「看不見卻會改變顯示」的字元（含 U+FEFF，否則它會在下一步變成空白），
    // 再把剩下的空白類（含換行、tab、全形空白）折成單一半形空白
    .replace(INVISIBLE, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!flat) return undefined
  // ⚠ 用碼點切，不用 `slice()`：`slice()` 會把 emoji／罕用字的代理對從中間切開，
  //   留下一個孤立代理字（渲染成 �，而且在分享碼裡是不合法的 UTF-8）
  const points = [...flat]
  const cut = points.length > LOADOUT_NAME_MAX ? points.slice(0, LOADOUT_NAME_MAX).join('') : flat
  return cut.trim() || undefined
}
