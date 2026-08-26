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
