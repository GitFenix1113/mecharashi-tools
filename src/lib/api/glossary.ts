// ── 詞條庫 glossaryTerms（PLAN-019-C）：refType:'term' 的資料源 ────────────────────

import type { GlossaryTerm } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'
import { cascadeDelete, type CascadeDeleteResult } from './cascadeDelete'

/** glossaryTerms Collection（PLAN-019-C 詞條庫）：無專屬集合的機制關鍵字，refType:'term' 的資料源 */
export const getGlossaryTerms = () =>
  fetchCollection<GlossaryTerm>('glossaryTerms')

/**
 * PLAN-019-C：寫入/更新單一詞條文件（refType:'term' 的單一資料源）
 * PLAN-030：改走 saveWithHistory，記錄變更歷史。簽章與回傳值維持不變。
 */
export const updateGlossaryTerm = (term: GlossaryTerm): Promise<string> =>
  saveWithHistory('glossaryTerm', term)

/**
 * PLAN-030 C-5：刪除詞條並級聯清除全站對它的引用。
 *
 * 一次做完（掃描 → 建計畫 → 安全閘 → 寫 log → 原子提交）。**已不存在時回傳 `null`**，
 * 不寫 log 也不報錯——重複點擊或他人已先刪掉都走這條，不該視為失敗。
 *
 * 後台 UI 應改用 `planCascadeDelete('glossaryTerm', id)` ＋ `commitCascadeDelete()` 兩段式，
 * 讓確認對話框先顯示影響範圍；本函式是給腳本與測試的便利入口。
 *
 * 回傳值含 `versions` 與 `targetCollHasSiblingEdits`，呼叫端據此同步自己的快取——
 * **後者為 `true` 時不可只用 `removeCollectionItem`**（同集合有兄弟文件被改寫，
 * 就地移除會把未同步的舊內容連同新版本號寫進 localStorage 而永不自癒）。
 */
export const deleteGlossaryTerm = (id: string): Promise<CascadeDeleteResult | null> =>
  cascadeDelete('glossaryTerm', id)

