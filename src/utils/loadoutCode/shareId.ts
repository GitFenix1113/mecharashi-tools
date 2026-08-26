// 分享碼的身分層：doc id ↔ shareId —— PLAN-052-C Phase A / A-1
//
// ── 這一層為什麼獨立成檔 ────────────────────────────────────────────────────
// 總綱決策二讓分享碼同時是**儲存格式**，所以「數字 178 代表哪一把武器」這件事
// 一旦錯掉，就不是「分享失敗」而是**別人的配裝解成另一把武器**，而且沒有任何徵兆。
// codec（B-1）只負責把數字塞進 bytes；「數字是誰」全部由本檔回答。
//
// ── 映射規則（總綱決策八／本計畫決策三）────────────────────────────────────
//   pilots / mechs / weapons / components → doc id 的流水號
//   backpacks                             → 官方 8 位數字 − 60,000,000
//   modules                               → `mod_<純數字>` 的數字
// **不新增 Firestore 欄位**：流水號已經印在 doc id 上，再開一個 shareId 欄位
// 就是同一件事的第二個真相源（改一邊忘了改另一邊，症狀同樣是解成別人）。
//
// 核心不變式：**流水號是身分不是位置** —— 新增 weapon_183 不會讓 weapon_182 位移。
// ⚠ 唯一破口是**流水號被回收**（`idSlug.ts` 的 `maxEntitySeq()` 是「掃現有 ID 取 max」，
//   刪掉 178 再新增會再次產生 178）⇒ 由 `share-id.lock.json` ＋ `scripts/check-share-ids.mjs`
//   守門，本檔只負責推導與撞號偵測。
//
// ── 別名區（A-1 第二列，2026-08-26 裁決）──────────────────────────────────
// 推導規則有 doc id 形狀的前提，全庫有 80 筆模組不合形狀（`mod_4001_2` 這種第二型、
// 以及 `mod_凌嘯框架` 這種純名稱 id）。其中落在 052-G 挑選器候選池的有 42 筆
// ＝ 可見池 188 筆的 22%，「配得出來卻分享不了」的比例太高，故開別名區手工指派。
//
// 別名是 **`docId → 號碼` 的人工指派**，寫進 `share-id.lock.json` 的 `aliases` 區後永久不動
// （英文 WIKI 的同名機制註解逐字寫 "never changes once assigned"）。
// 它同時是比推導**更強**的一層保護：推導區改掉 doc id 的號碼那一段會讓既有分享碼全指錯，
// 別名區則只要把 lock 裡那個號碼指向新的 docId，已流出的碼照樣解得開。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

/** 可進分享碼的六種實體。與 `CollectionKey` 刻意分開：能被分享的只有這六個。 */
export type ShareIdKind = 'pilot' | 'mech' | 'weapon' | 'component' | 'backpack' | 'module'

/**
 * shareId 的上限。codec 的 varint 一律 LEB128 且**超過 3 bytes 視為 bug**（本計畫 B-1），
 * 3 bytes 能表達 0–2,097,151。超出的一律當「今天不可分享」而不是硬塞 —— 塞進去會產生
 * 一串解得開卻指向錯誤實體的代碼。
 *
 * 實測（2026-08-25）最大值是背包的 1,002,705（官方 id 61002705），距上限還有一半空間。
 */
export const SHARE_ID_MAX = 2_097_151

/** 背包沒有流水號，用官方 8 位數字扣掉這個基底 —— 全庫 180/181 筆都是 601xxxxx 起跳。 */
export const BACKPACK_ID_OFFSET = 60_000_000

/**
 * 別名區的起點：**手工指派的號碼一律 ≥ 這個值**，推導出來的一律在它以下。
 *
 * 為什麼是 1,500,000 而不是更小的數：號碼空間是**每個 kind 各自獨立**的，
 * 所以這個門檻必須高過**所有** kind 的推導上限，而背包的推導值就落在百萬級
 * （官方 8 位數 − 60,000,000，實測最大 1,002,705）。取 1.5M 之後，
 * 背包要再發 497,295 個新品才可能碰到別名區 —— 不會發生，
 * 而且真的接近時 `scripts/check-share-ids.mjs` 會在上線前就擋下來（撞號即 exit 1）。
 *
 * 上限側還剩 597,151 個位置（到 `SHARE_ID_MAX`），指派 41 筆只用掉 0.007%。
 *
 * ⚠ 代價是**別名一律吃滿 3 bytes 的 varint**（推導區的模組號碼只要 2 bytes）。
 *   一套配裝最多 4 個模組槽 ⇒ 最壞多 4 bytes，對 ≈70 bytes 的典型碼是可接受的交換。
 */
export const ALIAS_BASE = 1_500_000

/**
 * 別名表：`docId → 手工指派的號碼`。來源是 `share-id.lock.json` 的 `aliases` 區（反轉後）。
 *
 * 刻意用 docId 當 key（而不是號碼當 key）：呼叫端手上有的是 doc id，
 * 而反向查詢由 `buildShareIndex()` 自己建表 —— 一份資料兩個方向，不要讓呼叫端各建各的。
 */
export type ShareIdAliases = Readonly<Record<string, number>>

/**
 * 各實體的 doc id 形狀。
 *
 * ⚠ 三個容易寫錯的地方，都是實測（2026-08-25）逼出來的：
 *   ① 元件的前綴是 `comp_` **不是** `component_`（208/208 筆皆為 `comp_0001_應元件W_蓬勃` 這種）。
 *   ② 模組必須**全字匹配** `^mod_(\d+)$`：全庫有 31 筆 `mod_4001_2`（「校準模組Ⅱ」這種第二型），
 *      若寫成前綴匹配，`mod_4001` 與 `mod_4001_2` 會推出同一個號碼 —— 那正是「解成另一個模組」。
 *   ③ 大小寫敏感，刻意的：大小寫不敏感只會讓撞號更難發現。發現本規則時庫裡確實有一筆
 *      `MOD_折光陣列`（與 `mod_折光陣列` 內容完全相同的孿生），已於 2026-08-26 由
 *      `scripts/migrate-module-casing-twin.mjs` 合併刪除 —— 但守門仍維持大小寫敏感，
 *      因為擋的是「下次又冒出一筆」，不是那一筆本身。
 */
const ID_PATTERNS: Record<Exclude<ShareIdKind, 'backpack'>, RegExp> = {
  pilot:     /^pilot_(\d+)(?:_|$)/,
  mech:      /^mech_(\d+)(?:_|$)/,
  weapon:    /^weapon_(\d+)(?:_|$)/,
  component: /^comp_(\d+)(?:_|$)/,
  module:    /^mod_(\d+)$/,
}

/**
 * doc id → shareId。**推導不出來時回 `null`，永不 throw。**
 *
 * `null` 的語意是「這份文件**今天**不可分享」，呼叫端應該把該選項渲染成停用狀態並說明，
 * 而不是當成錯誤 —— 資料側隨時可能新增形狀例外（實測：背包 `backpack_威能者背包` 1 筆、
 * 模組 53 筆候選推導不出號碼），為了一筆例外讓整頁 throw 是不成比例的。
 */
export function toShareId(kind: ShareIdKind, docId: string | null | undefined): number | null {
  if (!docId) return null

  if (kind === 'backpack') {
    // 官方 id 是 8 位純數字；`backpack_*` 這種站內 slug id 不吃（回 null 讓呼叫端停用）
    if (!/^\d{8}$/.test(docId)) return null
    const n = Number(docId) - BACKPACK_ID_OFFSET
    return n > 0 && n <= SHARE_ID_MAX ? n : null
  }

  const m = ID_PATTERNS[kind].exec(docId)
  if (!m) return null
  const n = Number(m[1])                       // 前導零直接被 Number 吃掉：pilot_001 → 1
  if (!Number.isInteger(n) || n <= 0) return null   // 0 保留給「無此欄位」，不發給任何實體
  return n <= SHARE_ID_MAX ? n : null
}

/** 一個集合的雙向索引。`shareId → docId` 只能查表，因為推導是單向的（號碼不含名字）。 */
export interface ShareIndex {
  kind: ShareIdKind
  /** shareId → doc id；查不到回 `null`（呼叫端顯示「已下架裝備 #n」） */
  toDocId(shareId: number): string | null
  /** doc id → shareId；推導不出來或因撞號被剔除時回 `null` */
  toShareId(docId: string | null | undefined): number | null
  /** 推導不出號碼**且沒有別名**的 doc id（今天不可分享，UI 停用） */
  unshareable: readonly string[]
  /** 撞號：同一個 shareId 被兩份以上文件推出來。**兩邊都會被剔除**，見下方註解 */
  collisions: readonly ShareIdCollision[]
  /**
   * 指向不存在文件的別名（該 docId 已被刪或改名）。
   *
   * 前台**不必理會**——那個號碼查不到就是「已下架裝備 #n」，本來就是預期行為。
   * 但 CI 要看：一筆 stale 別名代表某個已流出的分享碼從此解不開，
   * 該由人決定是「把別名改指到新 docId」（救回舊碼）還是「確認這東西真的沒了」。
   */
  staleAliases: readonly string[]
  /** 可分享的筆數（＝索引大小），給 CI 報表用 */
  size: number
}

export interface ShareIdCollision {
  shareId: number
  docIds: readonly string[]
}

/**
 * 建索引。
 *
 * ⚠ **撞號的處理是「兩邊都剔除」，不是「先到先贏」，也不是 throw。**
 *   · 不 throw：解碼器永不 throw 是本計畫決策四（一個壞碼讓整頁白畫面，比解不開更糟），
 *     而這支會在瀏覽器裡跑。
 *   · 不先到先贏：那會讓其中一份文件**靜默**取得另一份的身分 —— 正是我們最怕的失敗模式。
 *   · 兩邊都剔除 ⇒ 該號碼解成「已下架裝備 #n」，是一個**看得見**的錯，而且不會指向錯的實體。
 *   同時把撞號記進 `collisions`，由 `assertNoCollisions()`（CI／腳本用）大聲失敗。
 */
export function buildShareIndex(
  kind: ShareIdKind,
  docIds: readonly string[],
  aliases: ShareIdAliases = {},
): ShareIndex {
  const byShareId = new Map<number, string>()
  const dupes = new Map<number, string[]>()
  const unshareable: string[] = []

  for (const docId of docIds) {
    // 推導優先於別名：推得出來就用推的，別名只補推導的缺口。
    // 反過來（別名蓋過推導）會讓「改 doc id 的號碼」這件事被別名默默吸收掉，
    // 於是 lock 檔再也抓不到回收 —— 那正是這一層要防的事。
    const n = toShareId(kind, docId) ?? aliases[docId] ?? null
    if (n === null || !Number.isInteger(n) || n <= 0 || n > SHARE_ID_MAX) { unshareable.push(docId); continue }
    const prev = byShareId.get(n)
    if (prev === undefined) { byShareId.set(n, docId); continue }
    if (prev !== docId) {
      const list = dupes.get(n) ?? [prev]
      if (!list.includes(docId)) list.push(docId)
      dupes.set(n, list)
    }
  }

  // 撞號的號碼整個拿掉 —— 留著就等於在兩份文件之間隨機挑一份給玩家
  for (const n of dupes.keys()) byShareId.delete(n)

  const byDocId = new Map<string, number>()
  for (const [n, docId] of byShareId) byDocId.set(docId, n)

  // 別名指向的文件已經不在集合裡 ⇒ 那個號碼從此解不開。不影響前台，但 CI 要知道。
  const present = new Set(docIds)
  const staleAliases = Object.keys(aliases).filter((docId) => !present.has(docId))

  return {
    kind,
    toDocId: (shareId) => byShareId.get(shareId) ?? null,
    toShareId: (docId) => (docId ? byDocId.get(docId) ?? null : null),
    unshareable,
    collisions: [...dupes.entries()].map(([shareId, ids]) => ({ shareId, docIds: ids })),
    staleAliases,
    size: byShareId.size,
  }
}

/**
 * 撞號時 throw。**只給腳本／CI 用**（`scripts/check-share-ids.mjs`、seed 前檢查），
 * 前台一律讀 `index.collisions` 自己決定怎麼呈現 —— 見 `buildShareIndex()` 的註解。
 */
export function assertNoCollisions(index: ShareIndex): void {
  if (index.collisions.length === 0) return
  const detail = index.collisions
    .map((c) => `  #${c.shareId} ← ${c.docIds.join(' / ')}`)
    .join('\n')
  throw new Error(
    `[shareId] ${index.kind} 有 ${index.collisions.length} 組撞號，分享碼會解成錯誤的實體：\n${detail}`,
  )
}
