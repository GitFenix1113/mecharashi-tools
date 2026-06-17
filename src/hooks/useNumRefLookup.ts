import { useEffect, useMemo } from 'react'
import { useGameData } from '../contexts/GameDataContext'
import type { GameBuff } from '../types'

/**
 * 數值引用層 (PLAN-022) 的取值來源：以 refId 查 buff，供 numRefs 的 resolveNumRefs / NUM_ATTRS.get 使用。
 *
 * 回傳 (refId) => GameBuff | undefined（GameBuff 結構上即 NumRefSource，可直接餵給 resolveNumRefs）。
 * active 時才 ensureLoaded(['buffs'])：描述真的含 <refId.attr> token 才懶載 buffs，不破壞 PLAN-016/017
 * 的懶載模型；ensureLoaded 本身冪等（已載 / 載入中即 no-op），多個 RefText 同時呼叫無妨。
 * buffs 未就緒時 lookup 回 undefined → 上層優雅降級為暗色 ?，載入完成後 re-render 自動顯示真值。
 */
export function useNumRefLookup(active: boolean): (refId: string) => GameBuff | undefined {
  const { buffs, ensureLoaded } = useGameData()

  useEffect(() => {
    if (active) ensureLoaded(['buffs'])
  }, [active, ensureLoaded])

  return useMemo(() => {
    const map = new Map(buffs.map((b) => [b.id, b]))
    return (refId: string) => map.get(refId)
  }, [buffs])
}
