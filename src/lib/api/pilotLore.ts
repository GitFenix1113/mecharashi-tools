// ── 機師故事館逸聞 pilotLore（PLAN-042-A）─────────────────────────────────────
//
// 文件 ID ＝ **機師的文件 ID**（`pilot_049_海莉絲`），比照 pilotResearch 的既有慣例。
// 不另造 slug：故事與機師是一對一，多一層對照表只會多一個對不上的地方。
//
// ⚠ 型別（`LoreDoc`）與 042-B 的 mechLore 共用，集合分家 —— 總綱決策三。
//   要加欄位請改 `src/types/lore.ts`，不要在這裡就地擴充某一館專用的形狀。

import type { LoreDoc } from '../../types'
import { fetchCollection, fetchDocument } from './firestoreCore'
import { saveWithHistory } from './changeHistory'

const COLL = 'pilotLore'

/** pilotLore Collection（PLAN-042-A）：機師逸聞章節，100% 人工輸入（OCR 輔助） */
export const getPilotLore = () => fetchCollection<LoreDoc>(COLL)

/** 單一機師的逸聞。查無 → null（多數機師今天就是沒有，這不是錯誤） */
export const getPilotLoreDoc = (pilotId: string) =>
  fetchDocument<LoreDoc>(COLL, pilotId)

/**
 * 寫入 / 更新一份機師逸聞。
 *
 * **一定走 saveWithHistory。** 本集合的內容是人工逐字打進去的長文——它是全站
 * 唯一「一次誤存就再也生不回來」的資料（其餘集合重跑爬蟲就有）。changeHistory 的
 * 底層 helper 是集合無關設計，接上去的成本只有這一行，不接的話寫壞一章無從查起。
 * saveWithHistory 同時負責 bumpDataVersion，呼叫端拿回版本號去 patchCollectionItem。
 */
export const updatePilotLore = (doc: LoreDoc): Promise<string> =>
  saveWithHistory('pilotLore', doc)

// ⚠ 刻意**沒有** deletePilotLore：
//   本集合不是任何 [xxx] 引用的目標（entityRefs 的 REF_TYPE_OF['pilotLore'] 是 null），
//   所以沒有級聯要跑；但「刪掉一整份人工長文」也不該是一顆按鈕。
//   要清空某位機師的逸聞，正確做法是在編輯台把 chapters 存成 []——
//   那條路徑會留下 update 記錄，內容也還在前一版的 changeHistory 裡。
