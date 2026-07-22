// ── 技能庫 pilotSkills（PLAN-004 技能庫抽離）────────────────────────────────────
// 可共用、可被引用的技能定義庫（單一資料源；編輯共用技能會影響所有持有它的機師）。

import type { PilotSkillDoc } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'
import { cascadeDelete, type CascadeDeleteResult } from './cascadeDelete'

/** pilotSkills Collection（PLAN-004 技能庫抽離）：可共用、可被引用的技能定義庫 */
export const getPilotSkills = () =>
  fetchCollection<PilotSkillDoc>('pilotSkills')

/**
 * PLAN-004：寫入/更新單一技能文件（單一資料源；編輯共用技能會影響所有持有它的機師）
 * PLAN-030：改走 saveWithHistory，記錄變更歷史。簽章與回傳值維持不變。
 */
export const updatePilotSkill = (skill: PilotSkillDoc): Promise<string> =>
  saveWithHistory('pilotSkill', skill)

/**
 * PLAN-030 C-5：刪除技能並級聯清除全站對它的引用。
 *
 * 一次做完（掃描 → 建計畫 → 安全閘 → 寫 log → 原子提交）。**已不存在時回傳 `null`**，
 * 不寫 log 也不報錯——重複點擊或他人已先刪掉都走這條，不該視為失敗。
 *
 * 後台 UI 應改用 `planCascadeDelete('pilotSkill', id)` ＋ `commitCascadeDelete()` 兩段式，
 * 讓確認對話框先顯示影響範圍；本函式是給腳本與測試的便利入口。
 *
 * 回傳值含 `versions` 與 `targetCollHasSiblingEdits`，呼叫端據此同步自己的快取——
 * **後者為 `true` 時不可只用 `removeCollectionItem`**（同集合有兄弟文件被改寫，
 * 就地移除會把未同步的舊內容連同新版本號寫進 localStorage 而永不自癒）。
 */
export const deletePilotSkill = (id: string): Promise<CascadeDeleteResult | null> =>
  cascadeDelete('pilotSkill', id)

