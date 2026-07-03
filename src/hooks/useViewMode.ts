import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { patchUserProfile } from '../lib/userApi'
import type { ViewMode, ViewPrefsKey } from '../types'

// 圖鑑列表「緊湊 / 詳細」檢視偏好。
//
// 三層策略：
// 1. localStorage 為即時層 —— 未登入也能記住，並避免首次 render 閃爍。
// 2. 登入後以 UserProfile.viewPrefs 為準（跨裝置一致），覆蓋本地並回寫 localStorage。
// 3. 每次切換同步寫 localStorage；若已登入再 patchUserProfile 存回帳戶。
//    Firestore setDoc({ merge: true }) 對巢狀 map 做深層合併，只寫單一 key
//    不會清掉另一頁的偏好。

const LS_PREFIX = 'mecharashi_viewmode_'

function loadLocal(key: ViewPrefsKey): ViewMode | null {
  try {
    const v = localStorage.getItem(LS_PREFIX + key)
    return v === 'compact' || v === 'detailed' ? v : null
  } catch {
    return null
  }
}

export function useViewMode(
  key: ViewPrefsKey,
  fallback: ViewMode = 'compact'
): readonly [ViewMode, (next: ViewMode) => void] {
  const { user, userProfile } = useAuth()
  const [mode, setModeState] = useState<ViewMode>(() => loadLocal(key) ?? fallback)

  // 登入 / profile 載入後，以帳戶偏好為準
  useEffect(() => {
    const remote = userProfile?.viewPrefs?.[key]
    if (remote && remote !== mode) {
      setModeState(remote)
      try {
        localStorage.setItem(LS_PREFIX + key, remote)
      } catch {
        // ignore
      }
    }
    // 僅在 profile 或 key 改變時比對；mode 變動不需重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile, key])

  const setMode = useCallback(
    (next: ViewMode) => {
      setModeState(next)
      try {
        localStorage.setItem(LS_PREFIX + key, next)
      } catch {
        // ignore
      }
      if (user) {
        // merge:true 深層合併，只更新本頁 key
        patchUserProfile(user.uid, { viewPrefs: { [key]: next } }).catch(() => {
          // 存回帳戶失敗不影響本地體驗
        })
      }
    },
    [key, user]
  )

  return [mode, setMode] as const
}
