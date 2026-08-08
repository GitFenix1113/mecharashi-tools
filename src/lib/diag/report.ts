// ── 事件產生與上報（PLAN-045 Phase A-3）───────────────────────────────────────
//
// 把 sentinel（判成因）、collect（採證據）、queue（存本機）三者串起來，
// 對外只暴露兩個入口：
//
//   captureLogout()  ── 登出當下呼叫。判成因、採證據、入佇列。不寫 Firestore。
//   flushQueue()     ── 登入成功後呼叫。把佇列送上 Firestore。
//
// 這個切分正是決策一的落點：登出當下沒有權限寫 Firestore（currentUser 已為 null，
// 而規則全站 isAdmin()），所以「產生」與「上報」必須是兩個時間點。

import { classifyLogout, probeAll, readSentinel, plantSentinel, type LogoutReason } from './sentinel'
import { collectEnvironment, collectSession, currentRoute, getSessionId } from './collect'
import {
  enqueue, readQueue, writeQueue, alreadyReported, markReported, clearReported,
  type QueuedEvent,
} from './queue'
import { readAuthErrors, readLastSeen, resetTrail, takeSnapshot } from './heartbeat'
import { probeActivePersistence } from './authInternals'
import { writeSystemLogOrThrow } from '../api/systemLog'

/**
 * 登出當下採集證據並入佇列。
 *
 * @param explicit 我方是否呼叫過 signOut()。這是判定的第一順位訊號。
 * @param hadDraft 當下是否有未存檔的草稿（決定橫幅要不要說「你的編輯已保住」）
 * @returns 判定出的成因；`null` 表示這次不值得記錄（匿名訪客載入前台）
 *
 * 回傳成因而不只是寫佇列，是因為呼叫端（AuthContext）要拿它去決定橫幅顯不顯示、
 * 顯示什麼文案 —— 診斷結果對使用者本人也有用，不該只進 OWNER 才看得到的日誌。
 */
export async function captureLogout(
  explicit: boolean,
  hadDraft = false,
): Promise<LogoutReason | null> {
  try {
    // 順序要緊：先讀哨兵（拿 uid 與存活時長），再跑探針。
    // 反過來的話，若探針過程中有任何清除行為，讀到的哨兵就不是登出當下的狀態。
    const sentinel = readSentinel()
    const probes = await probeAll(explicit)
    const reason = classifyLogout(probes)

    // 匿名訪客每次載入前台都會觸發一次 onAuthStateChanged(null)。
    // 照記不誤的話，日誌會被訪客雜訊淹沒到失去用途。
    if (reason === 'neverSignedIn') return null

    // 主動登出是正常操作，不需要留證據。仍回傳成因供呼叫端判斷「不顯示橫幅」。
    if (reason === 'explicit') return reason

    // 同一次登出只記一筆：未登入狀態下每次重新載入頁面都會再觸發一次
    // onAuthStateChanged(null)，不去重的話重整幾次就多幾筆一模一樣的記錄。
    // 仍回傳成因 —— 橫幅該不該顯示與「記不記錄」是兩件事，重整後橫幅仍要出現。
    if (alreadyReported()) return reason

    const event: QueuedEvent = {
      kind: 'logout',
      reason,
      uid: sentinel?.uid ?? '',
      occurredAt: Date.now(),
      env: await collectEnvironment(),
      session: collectSession({ route: currentRoute(), hadDraft }),
      probes: {
        sentinel: probes.sentinel,
        cookie: probes.cookie,
        authRecord: probes.authRecord,
        authLocal: probes.authLocal,
      },
    }
    // 哨兵活了多久才被清掉。吻合 7 天左右就高度指向 Safari ITP 的定時清除，
    // 而非 Chrome 的空間壓力 eviction（後者發生時機是隨機的）。
    if (sentinel) {
      event.sentinelAgeSec = Math.round((Date.now() - sentinel.plantedAt) / 1000)
      // 失效區間的寬度：實際失效落在 (occurredAt - 這個秒數, occurredAt] 之間。
      // 心跳每 60 秒推一次 lastSeenAt，所以「使用中掉的」會是 ≤ 60 秒，
      // 「關著的期間掉的」則是分頁離開到再打開的整段時間。
      event.sinceSentinelSeenSec = Math.round((Date.now() - sentinel.lastSeenAt) / 1000)
    }

    // 本次載入 SDK 實際挑中的儲存層。不是 indexedDB 就等於當場抓到降級——
    // 而 SDK 選定一層後會主動清掉其他層的憑證，那正是不可逆的那一刀。
    const persistence = probeActivePersistence()
    if (persistence !== 'unknown') event.persistence = persistence

    // 登出前的最後一眼：區間的下界，且帶著當時各探針值。
    // 與登出當下的探針逐項對照，就知道這段期間內「是哪一項變了」。
    const lastSeen = readLastSeen()
    if (lastSeen) event.lastSeen = lastSeen

    // 跨 session 累積的 idToken 取得失敗。若登出前正好有一筆 auth/user-token-expired
    // 之類的錯誤，成因就從「推測」變成「有錯誤碼可查」。
    const authErrors = readAuthErrors()
    if (authErrors.length) event.authErrors = authErrors

    enqueue(event)
    markReported()
    return reason
  } catch (err) {
    // 診斷失敗絕不可影響登出流程本身 —— 使用者已經夠困擾了。
    console.warn('[diag] 登出診斷採集失敗:', err)
    return null
  }
}

/**
 * 把佇列送上 Firestore。登入成功且確認角色為 ADMIN / OWNER 後呼叫。
 *
 * 換人登入的處理：事件裡記著當事人 uid，只送 uid 相符或空字串的（空字串表示
 * 哨兵已被清、查不到是誰 —— 那正是 storageCleared 的情況，不能因此丟棄）。
 * 不相符的留在佇列裡等原本的人回來，避免把甲的登出記在乙頭上。
 *
 * 失敗的留在佇列下次再試；全程 fire-and-forget，不擋登入流程。
 */
export async function flushQueue(uid: string): Promise<void> {
  const queued = readQueue()
  if (queued.length === 0) return

  const mine = queued.filter((e) => !e.uid || e.uid === uid)
  const others = queued.filter((e) => e.uid && e.uid !== uid)

  const failed: QueuedEvent[] = []
  for (const event of mine) {
    try {
      await writeSystemLogOrThrow(event)
    } catch (err) {
      console.warn('[diag] 診斷事件上報失敗，留待下次:', err)
      failed.push(event)
    }
  }

  writeQueue([...others, ...failed])
}

/**
 * 登入成功後的例行工作：種哨兵 + 重設心跳軌跡 + flush 佇列。
 *
 * 順序有意義：
 *   ① 種哨兵 —— flush 可能失敗（網路、規則未部署），但哨兵若沒種下，
 *      下一次登出就完全無從判定。先確保診斷能力，再談上報。
 *   ② 重設軌跡並**立刻**拍一張基準快照 —— 上一輪的「最後一眼」屬於上一次登入，
 *      留著會讓下一次登出算出一個橫跨兩次登入的假區間。而 resetTrail 之後必須馬上
 *      takeSnapshot，否則到第一次心跳為止的這 60 秒沒有任何基準點。
 *      （上一次登出的證據不受影響——它在 captureLogout 當下就已凍結進佇列。）
 */
export async function onSignedIn(uid: string): Promise<void> {
  plantSentinel(uid, getSessionId())
  resetTrail()
  await takeSnapshot('signin')
  // 解除去重標記：登入成功後，下一次被登出必須重新記得到
  clearReported()
  await flushQueue(uid)
}
