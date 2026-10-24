import { createContext, useContext } from 'react'
import type { RaidTermView } from '../../utils/raidDraft'

// ─── 後台預覽的「點字修改」（PLAN-064 H-3）──────────────────────────────────────
//
// 只有 /admin/raids 的預覽會提供這個 context；前台沒有 provider，Tx 原樣輸出、零成本。
// resolve：畫面上的一段字（整串）→ 這一期的哪一筆譯名；對不到＝不是譯名（數字、組出來的句子），不給點。

export interface RaidEditApi {
  resolve: (text: string) => RaidTermView | undefined
  open: (term: RaidTermView) => void
}

export const RaidEditContext = createContext<RaidEditApi | null>(null)

export const useRaidEdit = () => useContext(RaidEditContext)
