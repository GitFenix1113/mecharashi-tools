import type { ReactNode } from 'react'
import { NdOverrideContext } from '../contexts/NdOverrideContext'
import { EMPTY_ND_OVERRIDES } from '../utils/ndOverrides'

/**
 * 局部關閉神經驅動算力覆寫的包覆器（PLAN-034 Phase C）。
 *
 * 用在「**宣告規則本身**」的區塊——神經驅動分區卡與能力卡。
 * nd_雙生星芒2 的正文是「[凝勢]可疊加7層」，那句話是**規則的來源**；
 * 若它自己也被自己宣告的規則改寫，就變成「[凝勢Ⅱ]可疊加7層」——
 * 使用者會以為凝勢Ⅱ是這條能力的前提，而不是它的結果。
 */
export function NdOverrideEmpty({ children }: { children: ReactNode }) {
  return <NdOverrideContext.Provider value={EMPTY_ND_OVERRIDES}>{children}</NdOverrideContext.Provider>
}
