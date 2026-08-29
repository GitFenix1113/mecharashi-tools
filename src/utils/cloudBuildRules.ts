// 雲端書架的純規則 —— PLAN-052-E Phase B / B-2
//
// 這裡放的是 `firestore.rules` 在 **client 側的對照**：規則會拒絕的形狀，先在這裡擋下來
// 並說得出原因。少了它，違規的寫入會以 `permission-denied` 收場，而使用者看到的是
// 「權限不足」——與真正的原因（代碼太長／格位不對／機師 id 形狀不對）毫無關係。
//
// ⚠ **規則才是權威**：這裡放行的，規則仍可能拒絕；反過來不成立。
//   兩邊的數字（5 格、4096 字元、doc id 正規式）都是手抄的第二份，
//   因為規則語言讀不到 TS 常數。改一邊就要改另一邊，並補一條 emulator 測試（B-5）。
//
// ⚠ 與 `buildsApi.ts` 分家的理由很實際：`buildsApi` 要 import `./firebase`，
//   而那個檔在載入時就讀 `import.meta.env` —— `node --test` 跑不起來。
//   純規則放這裡才單測得到，而它們正是最需要被釘住的部分。

import { CLOUD_CODE_MAX_CHARS, CLOUD_SLOTS, isCloudSlot, type CloudSlot } from '../types/loadout.ts'
import { sameLoadout } from './loadoutCode/codec.ts'

/**
 * doc id 的形狀。**`firestore.rules` 裡有第二份**（`buildId.matches('^pilot_[0-9]{3}_.*')`）。
 *
 * 它擋的不是攻擊而是**面**：規則沒有 `count()`、也驗不了「`{pilotId}` 真的是一位機師」，
 * 所以文件份數無界（052-E A-3 已裁決接受這個殘餘風險）。正規式至少讓亂開的文件
 * 不能是任意字串。全庫 89 位機師的 doc id 全數符合（A-1 實測）。
 */
export const CLOUD_BUILD_ID_RE = /^pilot_[0-9]{3}_/

/**
 * base64url 的字元集。
 *
 * ⚠ 這一條不只是潔癖：規則用 `size() <= 4096` 當上限，而規則語言的 `size()` 回的是
 *   **字元數**。「字元數 == 位元組數」只在全 ASCII 時成立 —— 一旦有人往那一格塞中文，
 *   4096 字元就是 16 KB，規則守的東西默默變成原來的四倍。
 */
export const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

/**
 * 失敗的原因。**前五種是 client 自己擋下來的**（連 Firestore 都沒去打），
 * 後三種來自 Firestore。呼叫端要分得出來：前者是「這一套配裝有問題」，
 * 後者是「現在存不了，等一下再試」。
 */
export type CloudBuildsFailure =
  | 'invalid-pilot-id'
  | 'invalid-slot'
  | 'code-empty'
  | 'code-too-long'
  | 'code-charset'
  | 'denied'
  | 'offline'
  /**
   * **送出了，但等不到伺服器確認**（052-E E-3 ④ 實測發現）。
   *
   * ⚠ 這一種與 `offline` 語意不同，不可以合併：Firestore 的 JS SDK 在離線時
   *   **不會讓 `setDoc` 失敗**，而是把這次寫入排進佇列、等連線回來再送 ——
   *   於是 promise 永遠不 settle，UI 停在「存入中…」而使用者完全不知道發生什麼事。
   *   逾時之後我們**取消不了那次寫入**，所以文案不能說「沒有存進去」（它可能之後才成功），
   *   只能誠實說「還沒送達，重整或關掉這一頁就會取消」。
   */
  | 'pending'
  | 'unknown'

/**
 * 寫入前的形狀檢查。**回 `null` 代表「規則不會因為形狀拒絕它」**。
 *
 * ⚠ 順序有意義：先驗身分（pilotId／slot）再驗內容（code）。反過來的話，
 *   一串空代碼配一個壞 pilotId 會回報成「代碼是空的」，而使用者改了代碼還是存不進去。
 */
export function validateCloudSave(
  pilotId: string,
  slot: string,
  code: string,
): CloudBuildsFailure | null {
  if (!CLOUD_BUILD_ID_RE.test(pilotId)) return 'invalid-pilot-id'
  if (!isCloudSlot(slot)) return 'invalid-slot'
  if (code === '') return 'code-empty'
  if (code.length > CLOUD_CODE_MAX_CHARS) return 'code-too-long'
  if (!BASE64URL_RE.test(code)) return 'code-charset'
  return null
}

/**
 * 這位機師還空著的格子（依 `CLOUD_SLOTS` 順序）。
 *
 * ⚠ 回的是**空格清單**而不是「還剩幾格」：UI 要的是「存到第幾格」，
 *   而一個數字答不出「哪一格是空的」—— 第 0、2 格有東西而 1、3、4 空著是常態。
 */
export function freeSlots(slots: Partial<Record<CloudSlot, string>> | null | undefined): CloudSlot[] {
  if (!slots) return [...CLOUD_SLOTS]
  return CLOUD_SLOTS.filter((s) => slots[s] === undefined)
}

/**
 * 從 Firestore 讀回來的 `slots` 欄位清洗成乾淨的 map。
 *
 * **壞掉的那一格丟掉、其餘留著**（同 `localBuilds.readShelf`）：一格壞資料不該讓
 * 整位機師的存檔消失。空字串一律當成「沒有這一格」—— 空字串會通過「有沒有這一格」
 * 的檢查卻解不出任何東西，UI 會渲染出一張空白卡片。
 */
export function sanitizeSlots(raw: unknown): Partial<Record<CloudSlot, string>> {
  const out: Partial<Record<CloudSlot, string>> = {}
  if (!raw || typeof raw !== 'object') return out
  const src = raw as Record<string, unknown>
  for (const s of CLOUD_SLOTS) {
    const v = src[s]
    if (typeof v === 'string' && v !== '') out[s] = v
  }
  return out
}

// ─── 訪客書架匯入的規劃（PLAN-052-E Phase D / D-2・D-5）──────────────────────
//
// **規劃與執行分開**：這裡只算「哪一筆該進哪一格、哪一筆進不去以及為什麼」，
// 一次寫入都不做。理由與 B-2 相同 —— `buildsApi` 要 import `./firebase`，那個檔
// 在載入時就讀 `import.meta.env`，`node --test` 進不來；而這段邏輯正是最需要被
// 釘住的部分（配額、去重、跳過已佔用的格子，錯一條就是使用者的存檔被蓋掉或消失）。

/** 一筆本機存檔在匯入計畫裡的下場。 */
export type ImportOutcome =
  /** 會被寫進雲端的第 `slot` 格 */
  | { kind: 'import'; slot: CloudSlot }
  /**
   * 同一套配裝已經在這位機師的第 `slot` 格 ⇒ **跳過**，不重複佔格。
   * 這條就是「匯入是 idempotent」的全部：連按兩次不會佔掉兩格（D-5）。
   *
   * ⚠ 判定走 `sameLoadout()` 而不是字串相等（PLAN-052-L C-6）——
   *   「同一套但備註改過一次」是同一套，不該佔第二格。
   */
  | { kind: 'duplicate'; slot: CloudSlot }
  /** 這位機師的 5 格已經滿了（含這次批次裡較前面的那幾筆佔走的） */
  | { kind: 'full' }
  /** 解不開，或解得開但沒有機師 —— 沒有可以存進去的文件 */
  | { kind: 'broken' }
  /** 使用者沒有勾選 */
  | { kind: 'unselected' }

export interface ImportItem {
  /** 本機書架那一筆的 id（回報時對得回去） */
  id: string
  code: string
  /** 解碼後的機師。解不開或沒選機師時為 `null` ⇒ 一律 `broken` */
  pilotId: string | null
  /** 使用者有沒有勾 */
  selected: boolean
}

export interface ImportPlanRow {
  id: string
  code: string
  pilotId: string | null
  outcome: ImportOutcome
}

/**
 * 算出整批的匯入計畫。
 *
 * ⚠ **必須整批一起算，不能逐筆各算各的**：同一位機師的第二筆要知道第一筆已經佔走了
 *   哪一格。逐筆算的結果是兩筆都挑到同一格，後寫的把先寫的蓋掉 —— 而且不會報錯。
 *
 * ⚠ **雲端已佔用的格子一律跳過，不覆寫**：匯入不該蓋掉使用者手動存進去的東西。
 *
 * ⚠ 順序＝傳進來的順序，而呼叫端傳的是**書架的顯示順序（新的在前）**。
 *   所以同一位機師若超過 5 套，留在本機的是**最舊的那幾套**。
 *   計畫書原文寫「依存入時間順序填 0..4」，這裡刻意改成與畫面一致的順序：
 *   ① 使用者看到的清單就是由上而下填進 1..5，不需要在心裡做第二種排序；
 *   ② 塞不下時被留下的如果是最新的那一套，那才是真的難以解釋。
 *
 * @param items 依顯示順序（新的在前）
 * @param cloud 目前雲端的狀態：`pilotId → slots`
 */
export function planCloudImport(
  items: readonly ImportItem[],
  cloud: ReadonlyMap<string, Partial<Record<CloudSlot, string>>>,
): ImportPlanRow[] {
  // 這一批寫入之後各機師的佔用狀況（含本批次先前幾筆佔走的格子）
  const taken = new Map<string, Partial<Record<CloudSlot, string>>>()
  const slotsOf = (pilotId: string) => {
    let s = taken.get(pilotId)
    if (!s) { s = { ...(cloud.get(pilotId) ?? {}) }; taken.set(pilotId, s) }
    return s
  }

  return items.map((it): ImportPlanRow => {
    const base = { id: it.id, code: it.code, pilotId: it.pilotId }
    if (!it.pilotId) return { ...base, outcome: { kind: 'broken' } }
    if (!it.selected) return { ...base, outcome: { kind: 'unselected' } }

    const slots = slotsOf(it.pilotId)
    // 去重先於配額：五格滿了但這一套本來就在裡面時，答案是「已經有了」而不是「滿了」
    const dup = CLOUD_SLOTS.find((s) => { const c = slots[s]; return c !== undefined && sameLoadout(c, it.code) })
    if (dup) return { ...base, outcome: { kind: 'duplicate', slot: dup } }

    const free = CLOUD_SLOTS.find((s) => slots[s] === undefined)
    if (!free) return { ...base, outcome: { kind: 'full' } }

    slots[free] = it.code
    return { ...base, outcome: { kind: 'import', slot: free } }
  })
}

/** 計畫的統計。UI 逐筆回報時的抬頭數字（D-4）。 */
export function summarizeImportPlan(rows: readonly ImportPlanRow[]) {
  const count = (k: ImportOutcome['kind']) => rows.filter((r) => r.outcome.kind === k).length
  return {
    willImport: count('import'),
    duplicate: count('duplicate'),
    full: count('full'),
    broken: count('broken'),
    unselected: count('unselected'),
  }
}
