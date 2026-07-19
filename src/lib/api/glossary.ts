// ── 詞條庫 glossaryTerms（PLAN-019-C）：refType:'term' 的資料源 ────────────────────

import type { GlossaryTerm } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'

/** glossaryTerms Collection（PLAN-019-C 詞條庫）：無專屬集合的機制關鍵字，refType:'term' 的資料源 */
export const getGlossaryTerms = () =>
  fetchCollection<GlossaryTerm>('glossaryTerms')

/**
 * PLAN-019-C：寫入/更新單一詞條文件（refType:'term' 的單一資料源）
 * PLAN-030：改走 saveWithHistory，記錄變更歷史。簽章與回傳值維持不變。
 */
export const updateGlossaryTerm = (term: GlossaryTerm): Promise<string> =>
  saveWithHistory('glossaryTerm', term)
