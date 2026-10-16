// ── 機甲故事館 mechLore（PLAN-042-B）──────────────────────────────────────────
//
// 文件 ID ＝ **機甲的文件 ID**（`mech_001_都卜勒` 這類帶流水號的 ID），比照 pilotLore。
// 型別底座與 pilotLore 共用、集合分家（總綱決策三）；機甲專屬欄位（型號、廠商、系譜）見 `MechLoreDoc`。
//
// ⚠ **還沒登記 entityRefs SPECS**（042-B H-6）：章節正文開始出現 [xxx] 引用時才登記。
//   一登記就連動級聯刪除與「影響 N 處引用」的全集合掃描，rules 晚一步部署的話
//   全站既有的後台刪除會 permission-denied（PLAN-042-A 踩過）。
//   在那之前 entityRefs 的 SPEC_COLL_OF['mechLore'] 是 null，稽核記錄照樣寫得進去。

import type { MechLoreDoc } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'

const COLL = 'mechLore'

/** mechLore Collection（PLAN-042-B）：機甲的介紹、型號、廠商、系譜、塗裝名稱與逸聞章節 */
export const getMechLore = () => fetchCollection<MechLoreDoc>(COLL)

/**
 * 寫入／更新一份機甲逸聞（整份覆寫）。
 *
 * **一定走 saveWithHistory**，理由同 pilotLore：人工逐字輸入的長文，寫壞一章沒有稽核記錄就永久失去。
 * saveWithHistory 同時負責 bumpDataVersion，呼叫端拿回版本號去 patchCollectionItem。
 */
export const updateMechLore = (doc: MechLoreDoc): Promise<string> =>
  saveWithHistory('mechLore', doc)

// ⚠ 刻意**沒有** deleteMechLore，理由同 pilotLore：「刪掉一整份人工長文」不該是一顆按鈕。
