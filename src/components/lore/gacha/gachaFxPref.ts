import { useCallback, useState } from 'react'

/**
 * 招募插畫要不要播卡池動態（兩館共用；同一個分頁內記住，換台、換人、換館都沿用）。沒選過時：
 * 系統要求減少動態、或開了省流量就預設靜態——使用者自己按「動態」才播。
 */
let pref: boolean | null = null

function defaultOn(): boolean {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return !conn?.saveData
}

export function useGachaFxPref(): [boolean, (on: boolean) => void] {
  const [on, setOnState] = useState(() => pref ?? defaultOn())
  const setOn = useCallback((v: boolean) => { pref = v; setOnState(v) }, [])
  return [on, setOn]
}
