// 配裝方案名稱與備註的正規化（PLAN-052-I E-1 ／ PLAN-052-L C-1）
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

// ─── 方案備註（PLAN-052-L C-1）────────────────────────────────────────────────
//
// 團隊回饋 2：分享一套配裝時，說不出「為什麼這樣配」。備註就是那句話的位置。
//
// **與名稱共用上面那條 `INVISIBLE`**（同一個檔案，不另開一支）：分開寫會讓那條正規式
// 有第二份，而兩份必然漂移 —— 而漂移的症狀是「同一個零寬字元在名稱上被吃掉、
// 在備註上留著」，兩處都不會報錯。
//
// 與名稱的**唯一實質差別是換行**：名稱折成空白（圖上最大的一行，換行會撐開版面），
// 備註**保留換行**（它本來就是一段話，`white-space: pre-line` 印得出來）。

/**
 * 備註長度上限（**碼點**數）。
 *
 * 100 是從兩邊夾出來的：① 匯出圖上備註區約 620px 寬、字級 12px ⇒ 一行約 34 個中文字，
 * 100 字約三行，讀者掃得完；② 分享碼成本約 +4.1 base64 字元／中文字 ⇒ 100 字 ≈ +410，
 * 相對 `LIMITS.codeChars` 的 4096 毫無壓力（今天最壞是「號碼全滿 ＋ 4 套形態」的 1051）。
 */
export const LOADOUT_NOTE_MAX = 100

/**
 * 備註行數上限。
 *
 * ⚠ 有了字數上限**還是需要行數上限**：100 個「\n」也只有 100 個碼點，卻會在圖上
 *   撐出 100 行的空白 —— 而那張圖是固定寬度、高度隨內容長的。
 *   6 行是「100 字排得下的最鬆行距」，再多就只可能是空行。
 */
export const LOADOUT_NOTE_MAX_LINES = 6

/**
 * 把使用者輸入清成可以安全落盤、進分享碼、印在公開圖上的備註。
 *
 * 回傳 `undefined` 而不是空字串，理由與 `sanitizeLoadoutName()` 完全相同
 * （未設定＝欄位不存在；存空字串撞上 `stripUndefined` 會變成「一旦填了就再也清不掉」）。
 *
 * ⚠ 清洗一律放**寫入邊界**（reducer 的 `setNote` ＋ `reconcile`），不放渲染端 ——
 *   渲染端清洗會讓「存進去的」與「看到的」是兩個字串，而落盤的是髒的那一個。
 */
export function sanitizeLoadoutNote(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined

  const lines = raw
    .replace(INVISIBLE, '')
    // 換行正規化。⚠ 必須在切行**之前**：Windows 的 `\r\n` 不處理的話會切出一堆
    //   以 `\r` 結尾的行，而 `\r` 已經被 INVISIBLE 吃掉 ⇒ 行數對、內容也對，
    //   但每一行尾多一個看不見的東西。
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // 行內的空白類（tab、全形空白）折成單一半形空白並去頭尾。
    // ⚠ 用 `[^\S\n]` 而不是 `\s`：`\s` 含 `\n`，會把整段折成一行 —— 那就是名稱的做法。
    .map((l) => l.replace(/[^\S\n]+/gu, ' ').trim())

  // 去頭尾空行，再把「連續空行」壓成一行 —— 三個 Enter 與十個 Enter 在圖上
  // 只是兩塊不同大小的空白，而使用者的本意都是「這裡分段」
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const packed: string[] = []
  for (const l of lines) {
    if (l === '' && packed[packed.length - 1] === '') continue
    packed.push(l)
  }
  if (packed.length === 0) return undefined

  const text = packed.slice(0, LOADOUT_NOTE_MAX_LINES).join('\n')
  // ⚠ 用碼點切，不用 `slice()`：`slice()` 會把 emoji／罕用字的代理對從中間切開，
  //   留下一個孤立代理字（渲染成 �，而且在分享碼裡是不合法的 UTF-8）
  const points = [...text]
  const cut = points.length > LOADOUT_NOTE_MAX ? points.slice(0, LOADOUT_NOTE_MAX).join('') : text
  // 截斷可能剛好切在換行或空白上，尾端再清一次
  return cut.replace(/[\s\n]+$/u, '') || undefined
}
