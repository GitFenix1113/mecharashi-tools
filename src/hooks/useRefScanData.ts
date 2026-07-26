import { useEffect, useMemo } from 'react'
import { useGameData, type CollectionKey } from '../contexts/GameDataContext'
import { ALL_SCAN_COLLECTIONS, type RefScanData } from '../utils/entityRefs'

/**
 * 把 GameDataContext 的既有快取包成 findReferences 吃的 RefScanData（PLAN-034 Phase E）。
 *
 * **未載入的集合一律給 undefined，不給空陣列。** RefScanData 的註解已寫明兩者語意不同：
 * undefined = 沒掃過（必須警示），[] = 掃過且真的沒有。後台的「影響 N 處引用」提示若把
 * 未載入當成「零引用」，管理員會在完全沒有依據的情況下按下儲存——這比不顯示提示更糟。
 *
 * 刻意用已載入的前台快取而非 getDocsFromServer：這是**編輯時的即時提示**，
 * 每次改下拉就打一輪全集合伺服器讀取不切實際。真正要求「掃得全」的是刪除級聯
 * （cascadeDelete.loadScanData），那裡本來就走 FromServer，兩者定位不同。
 */
export function useRefScanData(): { data: RefScanData; missingColls: string[] } {
  const gd = useGameData()
  // 主動把九個掃描集合都載進來。不載的話「影響 N 處引用」只會是一個帶著免責聲明的
  // 低估值，而 BuffAdmin 的刪級守門更會因為掃不到而放行。這些集合是靜態資料、
  // 有 localStorage 版本 gate，後台一個 session 只付一次成本。
  useEffect(() => { gd.ensureLoaded(ALL_SCAN_COLLECTIONS as CollectionKey[]) }, [gd])

  return useMemo(() => {
    const data: RefScanData = {}
    const missing: string[] = []
    for (const key of ALL_SCAN_COLLECTIONS) {
      if (gd.loadedKeys.has(key)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data as any)[key] = (gd as any)[key]
      } else {
        missing.push(key)
      }
    }
    return { data, missingColls: missing }
  }, [gd])
}
