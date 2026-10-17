import { useEffect, useState } from 'react'
import { getRevisionedDoc } from '../lib/firestoreApi'
import type { RevisionedTargetKind } from '../types/changeHistory'

/** 伺服器上的現況：`undefined`＝還沒讀到（或讀取失敗），`null`＝文件不存在 */
export type LatestRevision = (Record<string, unknown> & { id: string }) | null | undefined

/**
 * 故事館編輯面板的「伺服器現況」（PLAN-042-H 後續：存檔衝突檢查）。
 *
 * 面板內容來自 GameDataContext 的快取，而快取一個 session 只對一次版本號：別人存檔之後，
 * 這個分頁照樣拿舊內容開面板，要到按下儲存才會被 saveWithRevision 擋下——那時可能已經改了半小時。
 * 所以開面板時先直讀一次伺服器，**切回這個分頁時再讀一次**（另一個分頁剛存完、切回來繼續編，
 * 正是兩分頁撞車的典型路徑）。成本是每次開啟／切回 +1 read，人工編輯的頻率下可忽略。
 *
 * 讀取失敗只警告：這是提早提示，真正的防線是存檔時的交易比對。
 * 回傳的 setter 給存檔撞到 `SaveConflictError` 時把錯誤帶回來的最新版塞進來。
 */
export function useLatestRevision(target: RevisionedTargetKind, id: string) {
  const [latest, setLatest] = useState<LatestRevision>(undefined)

  useEffect(() => {
    let alive = true
    // 切分頁會同時觸發 visibilitychange 與 focus（相隔幾毫秒）：一秒內只讀一次
    let last = 0
    const check = () => {
      const now = Date.now()
      if (now - last < 1000) return
      last = now
      getRevisionedDoc(target, id)
        .then((d) => { if (alive) setLatest(d) })
        .catch((err) => console.warn('[useLatestRevision] 讀取最新版失敗（存檔時仍會檢查）:', err))
    }
    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
    }
  }, [target, id])

  return [latest, setLatest] as const
}
