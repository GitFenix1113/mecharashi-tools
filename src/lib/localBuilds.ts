// 訪客本機書架 —— PLAN-052-C Phase D / D-1
//
// 全面公開（總綱決策九）之下，**未登入者唯一的存檔方式**，直到 052-E 的雲端存檔上線。
//
// ── 三條規則，違反任何一條都會讓使用者的東西無聲消失 ───────────────────────
//
//   ① **只存代碼字串**（決策二：codec 同時是儲存格式）。不存解好的草稿、不存
//      機師名快照——那些都是第二個真相源，而第二個真相源遲早會與第一個對不上。
//      卡片上要顯示的一切（名稱、機師、機甲、幾把武器）都由代碼**當場解**出來。
//
//   ② **永不自動刪除**。書架滿了就拒絕存入並請使用者自己刪一套，不淘汰最舊的那一筆
//      ——「我明明存過」是這個功能最不能出現的一句話。解不開的舊代碼同樣留著
//      （見 `buildStatus.ts` 的 `classifyBuild`）：它可能只是這個瀏覽器的遊戲資料太舊。
//
//   ③ **永不自動修復**。裝備下架就讓那一格空著並說出來，不要「順手」換一把相近的。
//
// ⚠ 與登入者的「每機師 5 套」（052-E）**語意不同，UI 文案要分開寫**：
//   訪客是「本機書架 7/10」（全站共用一個配額），登入者是「海莉絲 3/5」。
//
// ⚠ 本檔零 React、零 Firebase，storage 一律當參數收 —— 這樣才單測得起來。
//   自動草稿（`mecharashi_loadout_draft`）**不在這裡**：那一份存的是結構化草稿而非
//   代碼，因為它必須無損（推導不出號碼的裝備編碼會變成 0 ⇒ 存成代碼會在下一次
//   重整時靜默弄丟玩家自己配上去的背包）。書架是「我要留著的成品」，代價換得起。

/** localStorage 鍵。改它等同清空所有人的書架，改之前先想好遷移。 */
export const SHELF_KEY = 'mecharashi_loadout_shelf'

/** 訪客配額（不分機師，全站共用）。 */
export const SHELF_LIMIT = 10

/** 書架上的一筆。**除了代碼本身，只多存「什麼時候存的」**——那不是配裝的一部分。 */
export interface LocalBuild {
  id: string
  code: string
  /** epoch ms */
  savedAt: number
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** 隱私模式／停用 cookie 時連取用 `localStorage` 都會丟，所以這裡也包在 try 裡。 */
function defaultStore(): Store | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** 形狀檢查。**壞掉的那一筆丟掉、其餘留著** —— 一筆壞資料不該讓整個書架消失。 */
function isEntry(x: unknown): x is LocalBuild {
  if (!x || typeof x !== 'object') return false
  const e = x as Partial<LocalBuild>
  return typeof e.id === 'string' && e.id !== ''
    && typeof e.code === 'string' && e.code !== ''
    && typeof e.savedAt === 'number' && Number.isFinite(e.savedAt)
}

/**
 * 讀出書架，**新的在前**（存入順序即顯示順序）。
 *
 * 任何異常一律回空陣列：沒有書架是可以理解的狀態，整頁掛掉不是。
 */
export function readShelf(store: Store | undefined = defaultStore()): LocalBuild[] {
  if (!store) return []
  try {
    const raw = store.getItem(SHELF_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEntry).slice(0, SHELF_LIMIT)
  } catch {
    return []
  }
}

function writeShelf(shelf: LocalBuild[], store: Store): boolean {
  try {
    store.setItem(SHELF_KEY, JSON.stringify(shelf))
    return true
  } catch {
    return false   // 配額用盡／隱私模式 —— 呼叫端要說出來，不可以假裝存好了
  }
}

export type SaveFailure = 'full' | 'storage' | 'empty'

export type SaveResult =
  | { ok: true; shelf: LocalBuild[]; id: string; /** 同一串代碼已在架上，就地更新時間而非新增一筆 */ deduped: boolean }
  | { ok: false; reason: SaveFailure }

/**
 * 把一串代碼存進書架。
 *
 * **同一串代碼不會存成兩筆**：連按兩下、或把剛套用的那一套原封不動再存一次，
 * 都只是把它移到最前面並更新時間。不去重的話，配額會被同一套配裝的複本吃光，
 * 而使用者看到的是十張長得一模一樣的卡片。
 *
 * 滿了**一律拒絕**，不淘汰最舊的（規則②）。
 */
export function saveBuild(
  code: string,
  opts: { now: number; store?: Store | undefined } ,
): SaveResult {
  const store = opts.store === undefined ? defaultStore() : opts.store
  if (!code) return { ok: false, reason: 'empty' }
  if (!store) return { ok: false, reason: 'storage' }

  const shelf = readShelf(store)
  const hit = shelf.find((e) => e.code === code)
  if (hit) {
    const next = [{ ...hit, savedAt: opts.now }, ...shelf.filter((e) => e.id !== hit.id)]
    return writeShelf(next, store)
      ? { ok: true, shelf: next, id: hit.id, deduped: true }
      : { ok: false, reason: 'storage' }
  }

  if (shelf.length >= SHELF_LIMIT) return { ok: false, reason: 'full' }

  const entry: LocalBuild = { id: newId(opts.now), code, savedAt: opts.now }
  const next = [entry, ...shelf]
  return writeShelf(next, store)
    ? { ok: true, shelf: next, id: entry.id, deduped: false }
    : { ok: false, reason: 'storage' }
}

/** 刪除一筆。找不到就原樣回傳 —— 刪一個不存在的東西不是錯誤。 */
export function deleteBuild(id: string, store: Store | undefined = defaultStore()): LocalBuild[] {
  if (!store) return []
  const next = readShelf(store).filter((e) => e.id !== id)
  writeShelf(next, store)
  return next
}

/**
 * 產生一筆的 id。時間戳 ＋ 亂數尾巴 —— 時間戳讓它在 devtools 裡看得懂，
 * 亂數尾巴擋住「同一毫秒內存兩筆」（連點會發生）。
 */
function newId(now: number): string {
  const tail = Math.random().toString(36).slice(2, 8)
  return `${now.toString(36)}-${tail}`
}
