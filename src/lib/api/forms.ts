// ── 機師形態 forms（PLAN-041）：refType:'form' 的資料源 ────────────────────────

import type { MechForm } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'
import { cascadeDelete, type CascadeDeleteResult } from './cascadeDelete'

/** forms Collection（PLAN-041 機師形態）：調構師的形態實體，100% 手動維護 */
export const getForms = () => fetchCollection<MechForm>('forms')

/** 寫入/更新單一形態文件。走 saveWithHistory → 自動記錄變更歷史並 bump 版本。 */
export const updateForm = (form: MechForm): Promise<string> =>
  saveWithHistory('form', form)

/**
 * 刪除形態並級聯清除全站對它的引用。
 *
 * 形態的 inbound 引用不只 descriptionRefs：帕姆斯陣列（`mod_彌造者_fixed_1`）等 12 處
 * 都會指向形態。少了級聯，刪一筆形態＝製造 12 條靜默懸空引用。
 *
 * 後台 UI 應改用 `planCascadeDelete('form', id)` ＋ `commitCascadeDelete()` 兩段式，
 * 讓確認對話框先顯示影響範圍；本函式是給腳本與測試的便利入口。
 */
export const deleteForm = (id: string): Promise<CascadeDeleteResult | null> =>
  cascadeDelete('form', id)
