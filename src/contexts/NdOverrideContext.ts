import { createContext, useContext } from 'react'
import { EMPTY_ND_OVERRIDES, type NdBuffOverrides } from '../utils/ndOverrides'

/**
 * PLAN-034 Phase C — 神經驅動算力 BUFF 階覆寫的情境層。
 *
 * 機師詳情頁依當前算力算出一張表包在這裡，底下所有 RefChip（天賦／技能／浮窗）
 * 都問同一張表 → 「天賦說 III、技能說 I」在結構上不可能發生。
 *
 * **預設值是模組級常數**，比照 RefChip.tsx 既有的 RefScopeContext：
 * 沒有 provider 的頁面（武器頁、模組頁、後台…共 19 個 RefText 站點）拿到的是同一個
 * EMPTY_ND_OVERRIDES 物件，`entryOf` 恆回 undefined → effectiveLevel 恆回 ref.level →
 * **行為與今日 byte-identical**，且 identity 穩定不會害 chip 失去 memo。
 *
 * 元件形式的局部關閉器在 components/refs/NdOverrideEmpty.tsx——本檔刻意不放元件，
 * 否則 react-refresh/only-export-components 會擋（context 與元件不可同檔匯出）。
 */
export const NdOverrideContext = createContext<NdBuffOverrides>(EMPTY_ND_OVERRIDES)

export function useNdOverrides(): NdBuffOverrides {
  return useContext(NdOverrideContext)
}
