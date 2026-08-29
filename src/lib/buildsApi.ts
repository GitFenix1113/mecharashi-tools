// 雲端書架 —— PLAN-052-E Phase B / B-2
//
// `users/{uid}/builds/{pilotId}`：**一位機師一份文件**，`slots` 是 `'0'`～`'4'` 的 map，
// 每一格就是一串 base64url 分享代碼（總綱決策二：儲存＝分享，沒有第二套序列化）。
//
// ── 三條規矩（比照 localBuilds.ts，違反任何一條都會讓使用者的東西無聲消失）──────
//
//   ① **零 React、零 UI 文案**。失敗一律回結構化的 `reason`，讓呼叫端說出「是哪一種
//      失敗」——「存檔失敗」這四個字對使用者沒有任何用處。
//
//   ② **寫入永遠是局部合併**。整份覆寫會把同一位機師的其他 4 格一起洗掉，
//      而且**不會報錯**。這是本檔最容易寫錯、也最貴的一行，見 `saveCloudBuild`。
//
//   ③ **只存代碼**。不存機師名快照、不存解好的草稿（見 `CloudBuildDoc` 的檔頭）。
//
// 形狀檢查（規則的 client 側對照）在 `src/utils/cloudBuildRules.ts` —— 那邊沒有
// Firebase 相依，所以單測得起來；本檔只負責 I/O 與錯誤翻譯。

import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, deleteField,
} from 'firebase/firestore'
import { db } from './firebase'
import { reportWriteDenied } from './diag/writeGuard'
import type { CloudBuildDoc, CloudSlot } from '../types/loadout'
import {
  CLOUD_BUILD_ID_RE, validateCloudSave, sanitizeSlots,
  type CloudBuildsFailure,
} from '../utils/cloudBuildRules.ts'

export {
  CLOUD_BUILD_ID_RE, validateCloudSave, freeSlots,
  type CloudBuildsFailure,
} from '../utils/cloudBuildRules.ts'

const buildsCol = (uid: string) => collection(db, 'users', uid, 'builds')
const buildDoc = (uid: string, pilotId: string) => doc(db, 'users', uid, 'builds', pilotId)
/** 診斷用的集合路徑（`reportWriteDenied` 只拿它當標籤）。 */
const collLabel = (uid: string) => `users/${uid}/builds`

// ─── 結果型別 ────────────────────────────────────────────────────────────────

export type CloudWriteResult =
  | { ok: true }
  | { ok: false; reason: CloudBuildsFailure }

/** 一位機師的一份文件。`pilotId` 就是 doc id。 */
export interface CloudBuildEntry extends CloudBuildDoc {
  pilotId: string
}

export type CloudListResult =
  | { ok: true; entries: CloudBuildEntry[] }
  | { ok: false; reason: CloudBuildsFailure }

export type CloudDeleteResult =
  | { ok: true; /** 最後一格被刪掉 ⇒ 整份文件也刪了 */ docDeleted: boolean }
  | { ok: false; reason: CloudBuildsFailure }

/**
 * Firestore 的錯誤 → 本檔的 reason。
 *
 * `permission-denied` 在這裡幾乎一定是「規則擋下了形狀」而不是「沒登入」——
 * 未登入根本走不到這裡（呼叫端要有 uid 才叫得動本檔）。
 */
/**
 * 寫入的逾時上限。
 *
 * ⚠ **為什麼需要它**：Firestore 的 JS SDK 離線時**不會讓 `setDoc` 失敗**，而是把這次寫入
 *   排進佇列等連線回來 —— promise 永遠不 settle。少了這一層，UI 會停在「存入中…」
 *   而且永遠不會有下一步（052-E E-3 ④ 在 devtools 離線模式下實測，觀察 12 秒毫無反應）。
 *
 * ⚠ 逾時**不代表寫入失敗**，我們也取消不了它：連線恢復後那次寫入仍可能成功。
 *   所以回的是 `pending` 而不是 `offline`，文案也不可以說「沒有存進去」。
 */
const WRITE_TIMEOUT_MS = 10_000

/** 跑不完就回 `pending`。原本的 promise 繼續跑（我們攔不住它，也不該假裝攔得住）。 */
async function withTimeout(p: Promise<void>, ms = WRITE_TIMEOUT_MS): Promise<'ok' | 'pending'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'pending'>((resolve) => { timer = setTimeout(() => resolve('pending'), ms) })
  try {
    return await Promise.race([p.then(() => 'ok' as const), timeout])
  } finally {
    clearTimeout(timer)
  }
}

function toFailure(err: unknown): CloudBuildsFailure {
  const code = (err as { code?: string } | null)?.code ?? ''
  if (code === 'permission-denied') return 'denied'
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'offline'
  return 'unknown'
}

// ─── 讀 ──────────────────────────────────────────────────────────────────────

/**
 * 這個帳號的整個雲端書架。
 *
 * ⚠ **`getDocs` 一次抓，不用 `onSnapshot`**（計畫書決策七）：跨裝置同步的實際需求是
 *   「換一台裝置打開時看得到」，不是「A 存了 B 立刻跳出來」。`onSnapshot` 會讓每個開著
 *   模擬器的分頁長期佔一條連線並持續計費讀取，換來一個沒有人在等的即時性。
 */
export async function listCloudBuilds(uid: string): Promise<CloudListResult> {
  try {
    const snap = await getDocs(buildsCol(uid))
    const entries: CloudBuildEntry[] = []
    for (const d of snap.docs) {
      const data = d.data() as Partial<CloudBuildDoc>
      const slots = sanitizeSlots(data?.slots)
      // 空文件不該存在（見 deleteCloudBuild）。真的出現就跳過，不渲染一張空白卡片。
      if (Object.keys(slots).length === 0) continue
      entries.push({
        pilotId: d.id,
        slots,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      })
    }
    // 新的在前。`updatedAt` 整份文件一個，所以排的是「這位機師最後一次動過的時間」
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { ok: true, entries }
  } catch (err) {
    return { ok: false, reason: toFailure(err) }
  }
}

/** 單一機師的那一份。沒存過回 `null` —— 那不是錯誤。 */
export async function getCloudBuild(uid: string, pilotId: string): Promise<CloudBuildEntry | null> {
  const snap = await getDoc(buildDoc(uid, pilotId))
  if (!snap.exists()) return null
  const data = snap.data() as Partial<CloudBuildDoc>
  return {
    pilotId: snap.id,
    slots: sanitizeSlots(data?.slots),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  }
}

// ─── 寫 ──────────────────────────────────────────────────────────────────────

/**
 * 把一串代碼存進「某位機師的第 n 格」。已有內容就覆寫那一格（呼叫端負責先問過使用者）。
 *
 * ⚠⚠ **這是本檔最容易寫錯的一行。** 寫入必須是
 *     `setDoc(ref, { slots: { [slot]: code } }, { merge: true })` ——
 *     `merge: true` 會**遞迴合併巢狀 map**，所以同一位機師的其他 4 格原封不動。
 *     不帶 merge 的 `setDoc` 會整份覆寫，把另外 4 格一起洗掉，**而且不會有任何錯誤**：
 *     使用者要到下次打開書架才會發現少了四套。
 *
 * ⚠ 計畫書原本寫「用點路徑 `slots.${slot}`」。**那條在 `setDoc` 上是錯的**：
 *   JS SDK 只有 `updateDoc` 把鍵裡的點解讀成欄位路徑，`setDoc` 一律當**字面欄位名**，
 *   結果會是一個名叫 `slots.0` 的頂層欄位 —— 然後被規則的
 *   `hasOnly(['slots','updatedAt'])` 擋掉，收到一個看不懂的 403。
 *   點路徑留給 `deleteCloudBuild` 的 `updateDoc` 用（那邊它是對的）。
 *
 * ⚠ 用 `setDoc` 而不是 `updateDoc`：第一次存這位機師時文件還不存在，
 *   而 `updateDoc` 對不存在的文件會 `not-found`。
 */
export async function saveCloudBuild(
  uid: string,
  pilotId: string,
  slot: CloudSlot,
  code: string,
  now: Date = new Date(),
): Promise<CloudWriteResult> {
  const bad = validateCloudSave(pilotId, slot, code)
  if (bad) return { ok: false, reason: bad }

  try {
    const r = await withTimeout(setDoc(
      buildDoc(uid, pilotId),
      { slots: { [slot]: code }, updatedAt: now.toISOString() },
      { merge: true },
    ))
    return r === 'ok' ? { ok: true } : { ok: false, reason: 'pending' }
  } catch (err) {
    reportWriteDenied(collLabel(uid), pilotId, err)
    return { ok: false, reason: toFailure(err) }
  }
}

/**
 * 刪掉某位機師的某一格。
 *
 * ⚠ **刪掉最後一格時，整份文件一起刪**。留一份 `slots: {}` 的空文件有兩個代價：
 *   `listCloudBuilds` 每次多讀一筆，而「這位機師我存過東西嗎」會變成兩種都對的答案。
 *
 * ⚠ 這裡用 `updateDoc` ＋ 點路徑 ＋ `deleteField()` —— 那是 JS SDK 裡**唯一**能從 map
 *   拿掉一個 key 的方式（`setDoc` 合併寫不出「刪除」的語意）。
 *
 * 找不到文件、或那一格本來就是空的，一律當成功：刪一個不存在的東西不是錯誤。
 */
export async function deleteCloudBuild(
  uid: string,
  pilotId: string,
  slot: CloudSlot,
  now: Date = new Date(),
): Promise<CloudDeleteResult> {
  if (!CLOUD_BUILD_ID_RE.test(pilotId)) return { ok: false, reason: 'invalid-pilot-id' }

  try {
    const current = await getCloudBuild(uid, pilotId)
    if (!current || current.slots[slot] === undefined) return { ok: true, docDeleted: false }

    const remaining = Object.keys(current.slots).filter((k) => k !== slot)
    if (remaining.length === 0) {
      const r = await withTimeout(deleteDoc(buildDoc(uid, pilotId)))
      return r === 'ok' ? { ok: true, docDeleted: true } : { ok: false, reason: 'pending' }
    }

    const r = await withTimeout(updateDoc(buildDoc(uid, pilotId), {
      [`slots.${slot}`]: deleteField(),
      updatedAt: now.toISOString(),
    }))
    return r === 'ok' ? { ok: true, docDeleted: false } : { ok: false, reason: 'pending' }
  } catch (err) {
    reportWriteDenied(collLabel(uid), pilotId, err)
    return { ok: false, reason: toFailure(err) }
  }
}

/**
 * 刪掉某位機師的**整份**文件（五格一起）。
 *
 * 給「清空這位機師的存檔」用。逐格刪會是 5 次寫入 ＋ 5 次讀，而且中途失敗會留下
 * 一份刪一半的文件。
 */
export async function deleteCloudPilotDoc(uid: string, pilotId: string): Promise<CloudWriteResult> {
  if (!CLOUD_BUILD_ID_RE.test(pilotId)) return { ok: false, reason: 'invalid-pilot-id' }
  try {
    const r = await withTimeout(deleteDoc(buildDoc(uid, pilotId)))
    return r === 'ok' ? { ok: true } : { ok: false, reason: 'pending' }
  } catch (err) {
    reportWriteDenied(collLabel(uid), pilotId, err)
    return { ok: false, reason: toFailure(err) }
  }
}
