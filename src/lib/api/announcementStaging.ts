import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import type {
  AnnouncementDraft,
  MergeReceipt,
  PendingActivity,
  PendingStatus,
} from '../../types/announcementStaging'
import { DRAFTS_COLLECTION, PENDING_COLLECTION } from '../../types/announcementStaging'
import type { PatchVersion, TimedActivity } from '../../data/patchVersions/types'
import { bumpDataVersion } from './versions'

// ─── 讀取 ────────────────────────────────────────────────────────────────────

/**
 * 撈待審活動。
 *
 * 刻意**不加 orderBy**：`where + orderBy` 會要求複合索引，而 staging 的量體很小
 * （實測 buffer 流量每月 2～4 筆新名稱），前端排序零成本卻省下一條要維護的索引。
 */
export async function fetchPendingActivities(
  statuses: PendingStatus[] = ['needsReview', 'parsed'],
): Promise<PendingActivity[]> {
  if (statuses.length === 0) return []
  const snap = await getDocs(
    query(collection(db, PENDING_COLLECTION), where('status', 'in', statuses.slice(0, 30))),
  )
  const rows = snap.docs.map(d => ({ ...(d.data() as PendingActivity), id: d.id }))
  return rows.sort((a, b) => {
    const da = a.extracted?.startDate ?? ''
    const dbb = b.extracted?.startDate ?? ''
    if (da !== dbb) return dbb.localeCompare(da)   // 新的檔期排前面
    if (a.draftId !== b.draftId) return a.draftId.localeCompare(b.draftId)
    return (a.seq ?? 0) - (b.seq ?? 0)
  })
}

export async function fetchDraft(draftId: string): Promise<AnnouncementDraft | null> {
  const snap = await getDoc(doc(db, DRAFTS_COLLECTION, draftId))
  return snap.exists() ? ({ ...(snap.data() as AnnouncementDraft), id: snap.id }) : null
}

// ─── 寫入 ────────────────────────────────────────────────────────────────────

function actor() {
  const u = auth.currentUser
  return { uid: u?.uid ?? '', name: u?.displayName || u?.email || '(未知)' }
}

/**
 * 穩定識別子。與 AdminTimedActivityEditor 的產生規則一致 ——
 * 甘特↔卡片連動與 React key 都靠它，純 index 在陣列重排後會讓選取狀態跳到別的活動身上。
 */
function makeActivityId(): string {
  return `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 人工編修後的暫存（不改 extracted，兩份並存才做得出 diff） */
export async function saveReviewed(id: string, reviewed: Partial<TimedActivity>): Promise<void> {
  const { uid, name } = actor()
  await runTransaction(db, async tx => {
    const ref = doc(db, PENDING_COLLECTION, id)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('待審活動已不存在')
    tx.update(ref, { reviewed, reviewerUid: uid, reviewerName: name, reviewedAt: serverTimestamp() })
  })
}

export async function rejectPending(id: string, reason?: string): Promise<void> {
  const { uid, name } = actor()
  await runTransaction(db, async tx => {
    const ref = doc(db, PENDING_COLLECTION, id)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('待審活動已不存在')
    tx.update(ref, {
      status: 'rejected' satisfies PendingStatus,
      rejectReason: reason ?? '',
      reviewerUid: uid,
      reviewerName: name,
      reviewedAt: serverTimestamp(),
    })
  })
}

export interface MergeTarget {
  versionId: string
  half: 'upper' | 'lower'
}

export type MergeResult =
  | { ok: true; receipt: MergeReceipt }
  | { ok: false; reason: 'conflict'; existing: TimedActivity }

/** anchor 比對：名稱 + 起始日。陣列會重排，index 不是穩定識別子。 */
function sameAnchor(a: TimedActivity, anchor: { name: string; startDate: string }): boolean {
  return a.name === anchor.name && a.startDate === anchor.startDate
}

/**
 * 把一筆待審活動合併進 patchVersions，並讓所有 client 的快取失效。
 *
 * ⚠ 為什麼必須是 runTransaction 而不是 read → modify → setDoc：
 * `AdminVersionEditorPage` 的存檔是整份 `setDoc`、**沒有 `merge: true`**。
 * 若這裡先讀出整份版本、改完陣列再寫回去，中間管理員在版本編輯頁按下存檔，
 * 合併的內容就會被那份較舊的表單狀態整份蓋掉、而且不留痕跡。
 * 交易會偵測到版本文件在讀取後被改動並自動重試，這是唯一擋得住的做法。
 * 同型事故已有前例（scrape-pilots-v3.js:117 少了 merge:true，--force 洗掉人工修正）。
 *
 * ⚠ 為什麼寫完一定要 bumpDataVersion('patchVersions')：
 * patchVersions 走 Cloudflare Worker 邊緣快取（workers/src/index.ts 以集合版本號當
 * cache key、max-age=86400）。不 bump 就是「資料寫進去了、前台看不到、硬重整也沒用」，
 * 最長 24 小時 —— 快取在邊緣不在瀏覽器。
 *
 * 本地那層 module-level 快取（usePatchVersions）刻意**不**在這裡清：那是 React 端的
 * 狀態，而 hook 模組會連帶拉進讀 import.meta.env 的 workerData —— api 層一旦相依於它，
 * 就再也不能在 Vite 以外的環境（如模擬器整合測試）載入。呼叫端自行接
 * invalidatePatchVersionsCache()，與 AdminVersionEditorPage.handleSave 同樣做法。
 */
export async function mergeIntoVersion(
  pendingId: string,
  activity: TimedActivity,
  target: MergeTarget,
  opts: { overwrite?: boolean } = {},
): Promise<MergeResult> {
  const { uid, name } = actor()
  const anchor = { name: activity.name, startDate: activity.startDate }

  const outcome = await runTransaction(db, async tx => {
    const versionRef = doc(db, 'patchVersions', target.versionId)
    const pendingRef = doc(db, PENDING_COLLECTION, pendingId)

    // Firestore 交易要求所有讀取都排在寫入之前
    const [versionSnap, pendingSnap] = [await tx.get(versionRef), await tx.get(pendingRef)]
    if (!versionSnap.exists()) throw new Error(`找不到版本 ${target.versionId}`)
    if (!pendingSnap.exists()) throw new Error('待審活動已不存在')

    const version = versionSnap.data() as PatchVersion
    const half = version[target.half] ?? { cnDate: '' }
    const list: TimedActivity[] = Array.isArray(half.twActivities) ? [...half.twActivities] : []

    const dupIdx = list.findIndex(a => sameAnchor(a, anchor))
    if (dupIdx >= 0 && !opts.overwrite) {
      return { ok: false as const, reason: 'conflict' as const, existing: list[dupIdx] }
    }

    const withId: TimedActivity = { ...activity, id: activity.id ?? makeActivityId() }
    if (dupIdx >= 0) list[dupIdx] = { ...withId, id: list[dupIdx].id ?? withId.id }
    else list.push(withId)

    // 只寫「該半期的 twActivities」這一條路徑，不整份覆寫版本文件 ——
    // 否則會把管理員在其他欄位的並行編輯一起回捲。
    tx.update(versionRef, { [`${target.half}.twActivities`]: list })

    const receipt: MergeReceipt = {
      versionId: target.versionId,
      half: target.half,
      field: 'twActivities',
      anchor,
      at: new Date(),
      actorUid: uid,
      actorName: name,
    }
    tx.update(pendingRef, {
      status: 'merged' satisfies PendingStatus,
      mergedInto: receipt,
      reviewerUid: uid,
      reviewerName: name,
      reviewedAt: serverTimestamp(),
    })
    return { ok: true as const, receipt }
  })

  if (outcome.ok) {
    // 失敗不擋合併結果（資料已經寫進去了），沿用各 api 模組的 .catch(() => '')
    await bumpDataVersion('patchVersions').catch(() => '')
  }
  return outcome
}
