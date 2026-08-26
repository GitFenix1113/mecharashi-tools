// 分享連結：網址讀寫與舊快取防護 —— PLAN-052-C Phase C / C-1
//
// ── 為什麼 UI 只給「複製分享連結」，不給裸碼 ─────────────────────────────────
// base64url 的字元集含 `_`，而 Discord 的 `_斜體_` 語法會把裸碼中間的底線吃掉 ——
// 對方複製到的是一串**看起來正常但解不開**的碼。網址則會被當成連結、不套用 markdown，
// 因此是安全的。這不是偏好問題：給了裸碼按鈕，就一定有人用它。
//
// ⚠ 路徑固定用 `/simulator`（不是新開頂層路由）：那條路徑已在 SPA fallback 白名單內，
//   新開一個等於在 Cloudflare Dashboard 多一個只存在於介面上的例外條件（PLAN-038 踩過）。
//
// 本檔**零 React／零 Firebase**，所以 `staleCacheKeys()` 收的是「已經抓好的版本表」
// 而不是自己去抓 —— 抓的動作要 import firebase，那會讓這一層不能單測。

import type { DataVersions } from '../../lib/api/versions'

/** 網址參數名。改它會讓所有已流出的連結失效，等同升 FMT。 */
export const SHARE_PARAM = 'b'

/** GameDataContext 的 localStorage 快取前綴。**必須與那邊一致**（見下方 `cachedCollectionVersion`）。 */
const CACHE_PREFIX = 'mecharashi_gd_'

/**
 * 從網址或使用者貼上的整串文字裡抓出分享碼。
 *
 * 刻意吃得很寬（`?b=`／完整網址／裸碼／夾帶其他參數），因為使用者會貼進來的東西
 * 形狀完全不受控。真正的清洗與驗證在 `decodeLoadout()`，這裡只負責定位。
 */
export function readShareCode(input: string | null | undefined): string | null {
  if (!input) return null
  const s = String(input)
  const m = new RegExp(`[?&]${SHARE_PARAM}=([^&#\\s]+)`).exec(s)
  if (m) return m[1]
  // 沒有參數形式 ⇒ 可能是裸碼。只在「整串看起來就是 base64url」時才當成碼，
  // 否則使用者貼了一段閒聊文字也會被當成壞碼，錯誤訊息會很莫名其妙
  const bare = s.trim()
  return bare && /^[A-Za-z0-9\-_\s]+$/.test(bare) ? bare.replace(/\s+/g, '') : null
}

/**
 * 組出可以直接貼給別人的絕對網址。
 *
 * `base` 傳 `import.meta.env.BASE_URL`（GitHub Pages 的子路徑），`origin` 傳
 * `window.location.origin`。兩者都當參數收而不在這裡讀全域，是為了可單測。
 */
export function buildShareUrl(code: string, origin: string, base = '/'): string {
  const b = base.endsWith('/') ? base : `${base}/`
  return `${origin.replace(/\/$/, '')}${b}simulator?${SHARE_PARAM}=${code}`
}

/**
 * 讀某個集合在本機快取裡的版本號。快取形狀是 `{ v, d }`（GameDataContext 的 `writeCache`）。
 *
 * ⚠ 這裡**刻意直接讀 localStorage 而不是向 GameDataContext 要**：Context 沒有對外
 *   暴露「這一份是哪個版本」，而為了一個只在解碼失敗時才走到的路徑去擴充它的公開介面，
 *   會讓每一個消費者都多看到一個他們用不到的欄位。代價是這裡與那邊共用一個前綴常數，
 *   已用測試釘住（見 shareLink.test.ts）。
 */
export function cachedCollectionVersion(
  key: string,
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): string | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { v?: string }
    return typeof parsed?.v === 'string' ? parsed.v : null
  } catch {
    return null
  }
}

/**
 * 哪些集合的本機快取落後於伺服器。
 *
 * **這是「已下架裝備 #181」誤判的唯一防線**（決策四的舊快取防護）：本週剛上線的武器，
 * 在快取還沒失效的瀏覽器上會查不到號碼，於是解碼結果會把它標成「已下架」——
 * 語意剛好相反。判定「已下架」之前一定要先問這一支。
 *
 * 回空陣列 ＝ 快取是最新的，那就真的是查無此物。
 *
 * ⚠ 沒有快取（`null`）**不算落後**：那代表本 session 是直接抓的，資料本來就是新的。
 */
export function staleCacheKeys(
  server: DataVersions,
  keys: readonly string[],
  readCached: (key: string) => string | null = (k) => cachedCollectionVersion(k),
): string[] {
  return keys.filter((key) => {
    const expected = server.byKey[key] ?? server.global
    if (!expected) return false          // 伺服器沒有版本資訊 ⇒ 快取層本來就退化成直接讀
    const local = readCached(key)
    return local !== null && local !== expected
  })
}
