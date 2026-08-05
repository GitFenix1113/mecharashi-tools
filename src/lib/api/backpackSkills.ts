// ── 背包技能庫 backpackSkills（PLAN-043）──────────────────────────────────────
// 可共用、可等級化的背包技能定義庫（單一資料源；編輯技能會影響所有掛載它的背包）。
//
// 與 pilotSkills 刻意分開的理由見 src/types/backpackSkill.ts 檔頭。

import type { BackpackSkillDoc } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'
import { cascadeDelete, type CascadeDeleteResult } from './cascadeDelete'

/** backpackSkills Collection：可共用、可被背包引用的技能定義庫 */
export const getBackpackSkills = () =>
  fetchCollection<BackpackSkillDoc>('backpackSkills')

/** 寫入/更新單一背包技能文件。走 saveWithHistory 記錄變更歷史（同 pilotSkills）。 */
export const updateBackpackSkill = (skill: BackpackSkillDoc): Promise<string> =>
  saveWithHistory('backpackSkill', skill)

/**
 * 刪除背包技能並級聯清除全站對它的引用（backpacks.skillIds[] 是唯一引用來源）。
 *
 * **已不存在時回傳 `null`**，不寫 log 也不報錯——重複點擊或他人已先刪掉都走這條。
 * 後台 UI 應改用 `planCascadeDelete` ＋ `commitCascadeDelete` 兩段式，讓確認對話框
 * 先顯示影響範圍；本函式是給腳本與測試的便利入口。
 */
export const deleteBackpackSkill = (id: string): Promise<CascadeDeleteResult | null> =>
  cascadeDelete('backpackSkill', id)
