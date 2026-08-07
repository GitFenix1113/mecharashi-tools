// ── 寫入被拒攔截（PLAN-045 Phase C-2）─────────────────────────────────────────
//
// 追的是計畫書「症狀 B」：**使用者仍登入著，但存檔收到 permission-denied**。
// 對使用者而言這和被登出無法區分——按下儲存、沒反應、編輯內容還在畫面上但存不進去，
// 他們回報時說的還是「我被登出了」。只記真正的登出會漏掉這一整類。
//
// 為什麼獨立一個模組而不直接寫在 firestoreCore：firestoreCore 是最底層，
// 讓它 import systemLog（後者又 import firestoreCore 的型別）會形成循環。
// 中間隔一層，依賴方向就單純了：firestoreCore → writeGuard → systemLog。

import { collectEnvironment, collectSession, currentRoute } from './collect'
import { enqueue, type QueuedEvent } from './queue'
import { writeSystemLogOrThrow } from '../api/systemLog'

/** 同一個目標的重複失敗在此時間窗內只記一次（毫秒）。 */
const DEDUPE_WINDOW_MS = 60_000

/**
 * 最近記錄過的目標 → 時間戳。
 *
 * 為什麼需要：存檔失敗時使用者的直覺反應是連點好幾次。沒有節流的話，
 * 一次故障會灌進十幾筆一模一樣的記錄，把日誌洗到看不出其他事件。
 */
const recent = new Map<string, number>()

/** 是否為 Firestore 的權限錯誤。code 不存在時退回訊息比對（模擬器的錯誤形狀略有不同）。 */
function isPermissionDenied(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string') return code === 'permission-denied' || code === 'auth/user-token-expired'
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.toLowerCase().includes('permission')
}

/**
 * 記錄一次寫入被拒。**非 permission 類的錯誤直接忽略**——
 * 網路瞬斷、欄位格式錯誤等有各自的處理路徑，混進來只會稀釋訊號。
 *
 * 本函式**不重新拋出**也不回傳任何東西：呼叫端的職責是原樣往上拋原始錯誤，
 * 診斷只是順路搭一程，絕不可讓它改變既有的錯誤處理行為。
 */
export function reportWriteDenied(coll: string, docId: string, err: unknown): void {
  // 非瀏覽器環境一律跳過：模擬器整合測試與 scripts/ 的 migrate 腳本都會走到 writeDoc，
  // 其中破壞性測試更是**刻意**製造 permission-denied。讓診斷在那裡開火只會產生
  // 無人閱讀的雜訊記錄，還可能干擾計算寫入次數的測試。
  if (typeof window === 'undefined') return

  if (!isPermissionDenied(err)) return

  const key = `${coll}/${docId}`
  const now = Date.now()
  const last = recent.get(key)
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return
  recent.set(key, now)

  void (async () => {
    try {
      const event: QueuedEvent = {
        kind: 'writeDenied',
        reason: (err as { code?: string })?.code ?? 'permission-denied',
        uid: '',   // 由 systemLog 的 buildEntry 以當下登入者填入
        occurredAt: now,
        env: await collectEnvironment(),
        session: collectSession({ route: currentRoute() }),
        coll,
        docId,
      }
      // 這條路徑當下**通常**仍登入著，可以直接寫。但「寫入被拒」本身就可能
      // 意味著憑證已失效——那樣連診斷記錄也會被拒。故失敗時退回佇列，
      // 等下次成功登入再補送，證據不會因此丟失。
      await writeSystemLogOrThrow(event).catch(() => enqueue(event))
    } catch (e) {
      console.warn('[diag] 寫入被拒記錄失敗:', e)
    }
  })()
}
