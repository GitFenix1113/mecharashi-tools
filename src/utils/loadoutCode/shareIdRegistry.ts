// 分享碼登錄簿的讀取層 —— PLAN-052-C Phase A / A-1
//
// `shareIdRegistry.json` 是「決定」：人工指派的永久別名 ＋ 各集合的號碼水位。
// 它由 `scripts/check-share-ids.mjs --accept` 維護（別名區除外，那是純人工）。
//
// ⚠ **不要 import 根目錄的 `share-id.lock.json`**。那一份是完整的線上快照（≈35KB），
//   只給對帳腳本用；把它拉進 bundle 等於為了 3 個數字扛 34KB 的推導表。
//   兩個檔的分工寫在 `scripts/check-share-ids.mjs` 的 `LOCK_PATH` 註解。

import registryJson from './shareIdRegistry.json'
import type { ShareIdKind, ShareIdAliases } from './shareId.ts'

interface RegistryKind {
  /** 這個集合**歷來發出過的最大號碼**（只增不減，見下方 `shareIdFloor`） */
  maxAssigned: number
  /** docId → 手工指派的永久號碼 */
  aliases: Record<string, number>
}

const KINDS = registryJson.kinds as Record<string, RegistryKind>

/**
 * 後台續號的**地板**：新實體的流水號一律取 `max(這個值, 目前線上最大值) + 1`。
 *
 * 為什麼不能只看線上最大值（`maxEntitySeq()` 的做法）：那是「掃現有 ID 取 max」，
 * 刪掉 weapon_182 之後最大值退回 181，下一次新增就會**再次發出 182**——
 * 而所有已經流出、含有 182 的分享碼會就此指向一把完全不同的武器，沒有任何徵兆。
 *
 * 登錄簿記的是「發過」而不是「還在」，所以號碼只會往前走。
 * 代價是刪掉的號碼永遠是空洞（號碼空間有 209 萬個，不痛）。
 */
export function shareIdFloor(kind: ShareIdKind): number {
  return KINDS[kind]?.maxAssigned ?? 0
}

/**
 * 某個集合的永久別名表，給 `buildShareIndex(kind, docIds, aliases)` 用。
 *
 * 目前只有 modules 有內容（41 筆：`mod_4001_2` 這種第二型，以及 `mod_凌嘯框架`
 * 這種純名稱 id），其餘集合的 doc id 都推得出號碼。
 */
export function shareIdAliases(kind: ShareIdKind): ShareIdAliases {
  return KINDS[kind]?.aliases ?? {}
}

/**
 * 登錄簿裡**有號碼的所有 doc id**（PLAN-052-L D-2）。
 *
 * ── 為什麼要這一支 ──────────────────────────────────────────────────────────
 * `buildShareIndex(kind, docIds, aliases)` 的 `docIds` 是拿來**推導**號碼的。
 * 但 `pilotSkill` 一個號碼都推不出來（doc id 是 `skill_槍林彈雨` 這種純名稱），
 * 它的 853 個號碼 100% 住在別名區 ⇒ 這時傳線上 docIds 的唯一作用是
 * **把別名表過濾成「目前還在的那些」**，而那個過濾正是危險的來源：
 *
 *   · `pilotSkills` **不在** `LOADOUT_STAGE_KEYS` 裡（見 `useFirestore.ts`），
 *     所以「集合還沒到」是常態而不是例外；
 *   · 空清單 ⇒ 空索引 ⇒ `toShareId()` 全回 null ⇒ **技能被靜默濾出分享碼**，
 *     玩家配好、複製連結、貼給別人，對方收到一套沒有技能的配裝，
 *     而兩邊的畫面都不會說任何話。那正是 052-D 元件漏接索引時的症狀。
 *
 * ⇒ 這一種 kind 改用**登錄簿本身**當來源：它是靜態 JSON，永遠在，於是 encode／decode
 *   都不必等任何集合，那一整類 bug 消失。代價是「這個技能已經被刪掉了」不再由索引反映
 *   —— 但那本來就由名稱查不到來表達（同「已下架裝備 #n」），
 *   而 `scripts/check-share-ids.mjs` 的 `staleAliases` 會在 CI 把它報出來。
 *
 * ⚠ **推得出號碼的 kind 不可以用這一支**：它們的別名只是少數形狀例外的補丁
 *   （modules 那 41 筆），拿別名當全集會漏掉其餘 203 顆。
 */
export function shareIdRegisteredIds(kind: ShareIdKind): string[] {
  return Object.keys(KINDS[kind]?.aliases ?? {})
}
