import { useEffect, useState } from 'react'

// ─── 版面斷點（PLAN-052-B B-1）────────────────────────────────────────────────
//
// ⚠ **與 `useIsMobile()` 正交，兩者都要、不可互相代用**（計畫書決策一）：
//
//   useLayoutBreakpoint()  問的是「**畫面有多寬**」 → 決定三欄／兩欄／單欄。
//   useIsMobile()          問的是「**手指還是滑鼠**」（`(hover:none) and (pointer:coarse)`）
//                          → 決定挑選器用就地面板還是 BottomSheet、要不要做 hover 預覽。
//
// 平板（寬 1024、粗指標）因此會得到「兩欄版型 ＋ BottomSheet ＋ 無 hover 預覽」——
// 那是**刻意**的組合，不是斷點沒對齊。用 useIsMobile 決定欄數，桌機縮窗會維持三欄擠成一團；
// 用寬度決定互動方式，平板則會拿到一個永遠 hover 不到的預覽。

export type LayoutBreakpoint = 'wide' | 'medium' | 'narrow'

/** 三欄門檻：槽位圖 400 ＋ 情境欄 ＋ 資訊面板 380 —— 低於這個寬度三欄會互相擠壓。 */
export const WIDE_MIN = 1280
/** 兩欄門檻。低於它改單欄 ＋ BottomSheet。 */
export const MEDIUM_MIN = 1024

const queryOf = (): LayoutBreakpoint => {
  if (typeof window === 'undefined') return 'wide'
  if (window.matchMedia(`(min-width: ${WIDE_MIN}px)`).matches) return 'wide'
  if (window.matchMedia(`(min-width: ${MEDIUM_MIN}px)`).matches) return 'medium'
  return 'narrow'
}

export function useLayoutBreakpoint(): LayoutBreakpoint {
  const [bp, setBp] = useState<LayoutBreakpoint>(queryOf)
  useEffect(() => {
    // 監聽兩個門檻而不是 resize：matchMedia 只在真的跨過門檻時觸發，
    // resize 則會在拖曳視窗時每一幀都叫一次 setState
    const wide = window.matchMedia(`(min-width: ${WIDE_MIN}px)`)
    const medium = window.matchMedia(`(min-width: ${MEDIUM_MIN}px)`)
    const handler = () => setBp(queryOf())
    wide.addEventListener('change', handler)
    medium.addEventListener('change', handler)
    return () => {
      wide.removeEventListener('change', handler)
      medium.removeEventListener('change', handler)
    }
  }, [])
  return bp
}
