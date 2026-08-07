// ── 登出成因判定：三態哨兵（PLAN-045 Phase A-1）───────────────────────────────
//
// 問題：維護者回報「編輯到一半被登出」，但登出當下 `auth.currentUser` 已是 null，
// 而 firestore.rules 全站 `isAdmin()` —— 此刻寫任何 log 必定 permission-denied。
// 所以證據只能先留在本機，等下次登入再上報（見 queue.ts / report.ts）。
//
// 本檔負責「留下什麼證據」與「怎麼從證據反推成因」。判定邏輯刻意寫成無副作用的
// 純函式 classifyLogout()，才能用 node --test 覆蓋全部分支——否則要驗證判定是否正確，
// 就得真的把人登出四次。
//
// ── 為什麼需要「兩顆哨兵」而不是一顆 ──
// 直覺做法是只在 localStorage 種一顆哨兵，「哨兵不見了」就判定儲存被清。但那有個
// 會汙染整份日誌的誤報：**從未登入過的訪客**，onAuthStateChanged 同樣給 null、
// 同樣沒有哨兵，會被判成 storageCleared。而這正是最常見的情境（前台匿名訪客）。
//
// 關鍵在於必須先回答「這台裝置到底登入過沒有」，而這個問題不能問正在被懷疑的
// 那個儲存機制。故種兩顆在**不同存活條件**的位置：
//
//   · localStorage 哨兵 —— quota-managed storage，Chrome 空間壓力下第一個被 evict
//   · cookie 哨兵       —— 不屬於 quota-managed storage，Chrome eviction 清不到它
//
// 兩者同時消失才可能是「從未登入」；只有 localStorage 消失而 cookie 還在，
// 就是「這台裝置確實登入過，但 quota storage 被清了」的鐵證。
//
// 副作用：Safari ITP 會連 cookie 一起清（7 天無互動），所以 Safari 的儲存清除會落到
// neverSignedIn 而非 storageCleared。這是刻意的取捨——寧可漏報也不要誤報，
// 且 Safari 情境可由日誌裡的 UA 分布另行辨識（見 collect.ts）。

/** localStorage 哨兵鍵。與 GameDataContext 的 `mecharashi_gd_*` 快取分屬不同命名空間。 */
export const SENTINEL_KEY = 'mecharashi_diag_sentinel'

/** cookie 哨兵名。刻意極短、極小——它只需要回答「登入過沒有」這一個是非題。 */
export const SENTINEL_COOKIE = 'mr_diag'

/** cookie 存活期（天）。設得比任何 eviction 週期都長，才問得出「曾經登入過」。 */
const COOKIE_MAX_AGE_DAYS = 365

/**
 * localStorage 哨兵內容。
 *
 * ⚠ 不存任何個資：uid 已是不可逆識別子，但仍只在本機留存，且上報時本來就會帶 uid
 *   （寫入規則要求 `uid == request.auth.uid`），故不構成額外暴露。
 */
export interface Sentinel {
  uid: string
  /** 首次種下的時間（ms epoch）——用來算「這顆哨兵活了多久才被清掉」 */
  plantedAt: number
  /** 最後一次確認還活著的時間（ms epoch） */
  lastSeenAt: number
  /** 本次分頁 session 的識別子，用來把同一次瀏覽的多筆事件串起來 */
  sessionId: string
}

/**
 * 探針結果三態。
 *
 * `unknown` 不是湊數的——`indexedDB.databases()` 在部分瀏覽器不存在，
 * 那時必須誠實回報「測不到」，絕不可當成 `absent`。
 */
export type Tri = 'present' | 'absent' | 'unknown'

/**
 * 登出成因。
 *
 * `neverSignedIn` 是**哨兵語意上的「不知道有沒有登入過」**，呼叫端應據此
 * **不產生事件**——匿名訪客載入前台就會觸發一次 onAuthStateChanged(null)，
 * 若照記不誤，日誌會被雜訊淹沒到失去用途。
 */
export type LogoutReason =
  | 'explicit'       // 使用者主動登出（正常操作，不告警）
  | 'storageCleared' // quota-managed storage 被整包清除
  | 'idbEvicted'     // 【已停用】見下方說明，保留僅為讓既有記錄仍顯示得出標籤
  | 'tokenRevoked'   // 儲存完好卻登出了 → 改密碼 / 帳號停用 / 後端撤銷
  | 'neverSignedIn'  // 查無登入痕跡，多半是匿名訪客 → 不產生事件
  | 'unknown'        // 探針殘缺、無法定案

/** classifyLogout 的輸入。兩顆判定用哨兵 + 一顆佐證探針 + 一個我方旗標。 */
export interface ProbeResult {
  /** localStorage 哨兵是否還在 */
  sentinel: Tri
  /** cookie 哨兵是否還在（不屬於 quota-managed storage，eviction 清不到） */
  cookie: Tri
  /**
   * Firebase Auth 的**憑證記錄**是否還在。
   *
   * ⚠ **刻意不參與判定**，只作為記錄上的佐證。見 classifyLogout 的說明。
   */
  authRecord: Tri
  /** 我方是否呼叫過 signOut()。由 AuthContext 設定 */
  explicit: boolean
}

/**
 * 由探針結果反推登出成因。**純函式、無副作用**。
 *
 * ── 為什麼判定只用兩顆哨兵，不碰 IndexedDB ──
 *
 * 初版把「Firebase 的 IndexedDB 還在不在」當成判定依據，實測發現那顆探針**恆為
 * present**：`firebaseLocalStorageDb` 會在 SDK 初始化時**自動重建**，所以等
 * `onAuthStateChanged(null)` 觸發、探針執行時，就算使用者前一秒手動刪光整個
 * database，它也早就回來了。
 *
 * 後果有兩層，都是實測抓到的：
 *   ① `idbEvicted` 這個成因永遠產生不出來（條件是「IDB 不見」，而它不會不見），
 *      該情境全數落到 tokenRevoked；
 *   ② 更嚴重——原本「cookie 沒了但 IDB 還在 → 證明登入過 → storageCleared」這條，
 *      會讓**每個第一次進站的匿名訪客**（哨兵、cookie 都沒有，IDB 由 SDK 剛建好）
 *      被判成 storageCleared 並跳出登出橫幅。
 *
 * 所以判定只採用**不受 Firebase 干擾**的兩顆哨兵。`authRecord` 仍然採集並記錄，
 * 但只作為人工判讀時的佐證（例如「憑證明明還在卻登出了」是值得警覺的異常）。
 *
 * 判定順序不可調換：`explicit` 最優先，它是我方自己設的旗標，
 * 可信度高於任何環境推測。
 */
export function classifyLogout(p: ProbeResult): LogoutReason {
  if (p.explicit) return 'explicit'

  // 哨兵還在 → quota storage 沒被清，於是「登出」必然來自憑證側。
  if (p.sentinel === 'present') return 'tokenRevoked'

  if (p.sentinel === 'absent') {
    // 哨兵沒了。cookie 還在就證明這台裝置登入過 → 確實是 quota storage 被清。
    if (p.cookie === 'present') return 'storageCleared'
    // 查無任何登入痕跡：最可能是匿名訪客。寧可漏報也不要誤報。
    // （代價：Safari ITP 會連 cookie 一起清，故 Safari 的儲存清除會漏報成這條。
    //   已知取捨，可由日誌的 UA 分布另行辨識。）
    return 'neverSignedIn'
  }

  // sentinel === 'unknown'：localStorage 本身讀不到（隱私模式 / 被停用）。
  return 'unknown'
}

// ── 探針實作（有副作用，與上面的純函式分開）────────────────────────────────────

const isBrowser = (): boolean => typeof window !== 'undefined'

/** 讀 localStorage 哨兵。讀不到或格式壞掉都回 null。 */
export function readSentinel(): Sentinel | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(SENTINEL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Sentinel>
    // 欄位不齊視為壞資料——半殘的哨兵拿來判定只會產生假證據
    if (!parsed || typeof parsed.uid !== 'string' || typeof parsed.plantedAt !== 'number') return null
    return {
      uid: parsed.uid,
      plantedAt: parsed.plantedAt,
      lastSeenAt: typeof parsed.lastSeenAt === 'number' ? parsed.lastSeenAt : parsed.plantedAt,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : '',
    }
  } catch {
    // localStorage 在隱私模式可能直接拋 SecurityError
    return null
  }
}

/**
 * 種下 / 更新哨兵。登入成功時呼叫。
 *
 * plantedAt 只在「同一個 uid 的哨兵已存在」時保留原值——換人登入要重新計時，
 * 否則會把前一個帳號的存活時間算到新帳號頭上。
 */
export function plantSentinel(uid: string, sessionId: string): void {
  if (!isBrowser()) return
  const now = Date.now()
  const prev = readSentinel()
  const plantedAt = prev && prev.uid === uid ? prev.plantedAt : now
  try {
    window.localStorage.setItem(
      SENTINEL_KEY,
      JSON.stringify({ uid, plantedAt, lastSeenAt: now, sessionId } satisfies Sentinel),
    )
  } catch {
    // 配額滿或隱私模式：診斷設施不該因為自己寫不進去就影響登入流程
  }
  plantCookie(uid)
}

/**
 * 種 cookie 哨兵。只寫 uid 前 8 碼——它的用途是回答是非題，不需要完整識別子。
 *
 * SameSite=Lax + path=/ 即可；不設 Secure 以免本機 http 開發環境寫不進去
 * （正式站走 HTTPS，瀏覽器仍會照常保護）。
 */
function plantCookie(uid: string): void {
  if (typeof document === 'undefined') return
  try {
    const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60
    document.cookie = `${SENTINEL_COOKIE}=${encodeURIComponent(uid.slice(0, 8))}; path=/; max-age=${maxAge}; SameSite=Lax`
  } catch {
    /* cookie 被停用，忽略 */
  }
}

/** cookie 哨兵是否還在。 */
export function probeCookie(): Tri {
  if (typeof document === 'undefined') return 'unknown'
  try {
    return document.cookie.split('; ').some((c) => c.startsWith(`${SENTINEL_COOKIE}=`))
      ? 'present'
      : 'absent'
  } catch {
    return 'unknown'
  }
}

/** localStorage 哨兵是否還在（含「localStorage 本身不可用」的 unknown 態）。 */
export function probeSentinel(): Tri {
  if (!isBrowser()) return 'unknown'
  try {
    // 先確認 localStorage 真的能用，否則「讀不到」與「沒有」無法區分
    window.localStorage.getItem(SENTINEL_KEY)
  } catch {
    return 'unknown'
  }
  return readSentinel() ? 'present' : 'absent'
}

// ── Firebase Auth 的 IndexedDB 結構（Firebase JS SDK 固定使用這組名稱）──────────
const FIREBASE_AUTH_DB = 'firebaseLocalStorageDb'
const FIREBASE_AUTH_STORE = 'firebaseLocalStorage'
const AUTH_KEY_PREFIX = 'firebase:authUser:'

/** IndexedDB 可能被其他分頁的交易 block 住；探針不值得為此卡住登出流程。 */
const IDB_TIMEOUT_MS = 1000

/**
 * 探測 Firebase Auth 的**憑證記錄**是否還在。
 *
 * ⚠ 檢查的是 object store 裡有沒有 `firebase:authUser:*` 這筆記錄，
 *   **不是** database 存不存在 —— 後者測不出東西：`firebaseLocalStorageDb` 會在
 *   SDK 初始化時自動重建，所以就算使用者前一秒刪光整個 database，探針也一定看到它「在」
 *   （實測確認，初版就是栽在這裡）。
 *
 * 本探針**不參與判定**（見 classifyLogout），只作為記錄上的佐證。
 * 測不到時回 'unknown' 而非 'absent'：Firefox 長年未實作 `indexedDB.databases()`。
 */
export async function probeAuthRecord(): Promise<Tri> {
  if (!isBrowser() || !window.indexedDB) return 'unknown'
  const idb = window.indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }
  if (typeof idb.databases !== 'function') return 'unknown'
  try {
    const dbs = await idb.databases()
    // 先確認 database 存在再開啟 —— indexedDB.open() 對不存在的 database 會「建立」它，
    // 診斷探針絕不該產生副作用。
    if (!dbs.some((d) => d.name === FIREBASE_AUTH_DB)) return 'absent'
  } catch {
    return 'unknown'
  }
  return readAuthRecord()
}

/** 開啟 Firebase 的 auth store，看裡面還有沒有憑證記錄。 */
function readAuthRecord(): Promise<Tri> {
  return new Promise<Tri>((resolve) => {
    let settled = false
    const done = (r: Tri) => { if (!settled) { settled = true; resolve(r) } }
    // 被其他分頁 block 住時不能無限等——診斷是旁觀者，不該拖住登出流程
    setTimeout(() => done('unknown'), IDB_TIMEOUT_MS)

    try {
      const req = window.indexedDB.open(FIREBASE_AUTH_DB)
      // 前面已確認 database 存在；若仍觸發 upgrade，表示它是被這次 open 建出來的
      // → 中止交易避免留下副作用，並回報「沒有記錄」
      req.onupgradeneeded = () => {
        try { req.transaction?.abort() } catch { /* 已無交易可中止 */ }
        done('absent')
      }
      req.onerror = () => done('unknown')
      req.onsuccess = () => {
        const db = req.result
        try {
          if (!db.objectStoreNames.contains(FIREBASE_AUTH_STORE)) {
            db.close(); done('absent'); return
          }
          const keysReq = db
            .transaction(FIREBASE_AUTH_STORE, 'readonly')
            .objectStore(FIREBASE_AUTH_STORE)
            .getAllKeys()
          keysReq.onsuccess = () => {
            const has = keysReq.result.some((k) => String(k).startsWith(AUTH_KEY_PREFIX))
            db.close()
            done(has ? 'present' : 'absent')
          }
          keysReq.onerror = () => { db.close(); done('unknown') }
        } catch {
          try { db.close() } catch { /* 已關閉 */ }
          done('unknown')
        }
      }
    } catch {
      done('unknown')
    }
  })
}

/** 跑完三顆探針，組出 classifyLogout 的輸入。 */
export async function probeAll(explicit: boolean): Promise<ProbeResult> {
  return {
    sentinel: probeSentinel(),
    cookie: probeCookie(),
    authRecord: await probeAuthRecord(),
    explicit,
  }
}
