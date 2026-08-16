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

/**
 * 撈全部公告草稿，供「規則待擴充」彙總。
 *
 * 沒有分頁：staging 的 TTL 是 6 個月，量級是每週 1～3 則 ≈ 上限 80 份、
 * 單份 rawText 實測 p50 3 KB。一次撈完換到「句型統計不會因為分頁而失真」——
 * 只看最近一頁的話，出現次數的排序就沒有意義了。
 */
export async function fetchAllDrafts(): Promise<AnnouncementDraft[]> {
  const snap = await getDocs(collection(db, DRAFTS_COLLECTION))
  return snap.docs.map(d => ({ ...(d.data() as AnnouncementDraft), id: d.id }))
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

/** 缺長度時填進 note 的預設待辦。單筆審核與批次放行共用同一句。 */
export const DEFAULT_MISSING_WEEKS_NOTE = '官方公告只寫「起」、未寫結束時刻，待確認檔期長度'

/**
 * 解析結果／表單 → 可寫入的 `TimedActivity`。回傳 `null` ＝ 必要欄位不齊，不該寫入。
 *
 * 抽出來是為了讓**逐筆放行與批次放行走同一份規則**。這個專案已經被
 * 「兩份同樣的規則遲早會漂開」咬過（見 defaultTarget 的註解），而這裡漂開的症狀
 * 特別難查：同一筆資料，用逐筆放行與用批次放行寫進去的內容不一樣。
 */
export function toMergeableActivity(src: Partial<TimedActivity>): TimedActivity | null {
  const name = src.name?.trim()
  if (!name || !src.startDate || !src.type) return null

  const a: TimedActivity = { ...src, name, startDate: src.startDate, type: src.type }

  // 不變式：沒有長度就畫不出甘特長條 → 一律隱藏，並且要留下「為什麼藏起來」
  const willHide = a.weeks === undefined || src.hidden === true
  if (a.weeks === undefined) delete a.weeks
  if (willHide) {
    a.hidden = true
    a.note = (src.note ?? '').trim() || DEFAULT_MISSING_WEEKS_NOTE
  } else {
    delete a.hidden
  }

  // 空字串不要寫進去，免得前台把 '' 當成「有值但空」
  for (const k of ['description', 'sourceUrl', 'typeLabel', 'note', 'editorNote'] as const) {
    if (!a[k]?.trim()) delete a[k]
  }
  if (!a.pilots?.length) delete a.pilots
  if (!a.mechs?.length) delete a.mechs
  if (!a.rewards?.length) delete a.rewards
  return a
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
  opts: { overwrite?: boolean; skipBump?: boolean } = {},
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

    // 不變式：沒有長度就畫不出甘特長條 → 一律隱藏。
    // 在寫入端強制，而不是信任呼叫端有記得帶 hidden —— 漏帶的後果是首頁多一條
    // 長度是猜的長條，看起來完全正常卻是假資料。前台讀取口（activitiesOfHalf）
    // 另有一道獨立防線，兩道都在。
    const withId: TimedActivity = {
      ...activity,
      id: activity.id ?? makeActivityId(),
      ...(activity.weeks === undefined ? { hidden: true } : {}),
    }
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
      // 人工編修的版本要回存 —— 否則收據只剩 extracted（解析器原始產出），
      // 重開「已合併」那筆會看到一片空白，跟當初放行的內容對不起來，
      // 也做不出 reviewed vs extracted 的 diff（announcementStaging.html 04 的前提）。
      reviewed: withId,
      reviewerUid: uid,
      reviewerName: name,
      reviewedAt: serverTimestamp(),
    })
    return { ok: true as const, receipt }
  })

  if (outcome.ok && !opts.skipBump) {
    // 失敗不擋合併結果（資料已經寫進去了），沿用各 api 模組的 .catch(() => '')
    await bumpDataVersion('patchVersions').catch(() => '')
  }
  return outcome
}

export interface BulkMergeEntry {
  pendingId: string
  activity: TimedActivity
  target: MergeTarget
  /** 顯示用；失敗清單要能指出是哪一筆 */
  label: string
}

export interface BulkMergeResult {
  merged: number
  /** 目標半期已有同名同起始日的活動 —— 批次一律跳過，不猜維護者想不想覆蓋 */
  conflicts: string[]
  failed: { label: string; message: string }[]
}

/**
 * 批次放行：把多筆待審一次寫進各自的目標版本。
 *
 * **序列執行，不並行。** 這批活動多半落在同一個版本半期，而 mergeIntoVersion 是
 * 「讀 twActivities → 改陣列 → 寫回」的交易；並行送出會互相撞版本、觸發大量重試，
 * 甚至可能有人拿到過期的陣列。序列慢一點，但每一筆都疊在前一筆的結果上。
 *
 * **衝突一律跳過而不覆蓋。** 逐筆放行時會問「要覆蓋嗎」，批次沒有那個對話框；
 * 靜默覆蓋別人已經寫好的資料是這裡最不該做的事，留給維護者逐筆處理。
 *
 * **bump 只做一次。** 每筆都 bump 等於讓所有使用者的邊緣快取連續失效 N 次，
 * 白白浪費頻寬 —— 版本號的用途是「有變動」而不是「變動了幾次」。
 */
export async function mergeManyIntoVersion(
  entries: BulkMergeEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<BulkMergeResult> {
  const result: BulkMergeResult = { merged: 0, conflicts: [], failed: [] }

  for (const [i, e] of entries.entries()) {
    try {
      const res = await mergeIntoVersion(e.pendingId, e.activity, e.target, { skipBump: true })
      if (res.ok) result.merged++
      else result.conflicts.push(e.label)
    } catch (err) {
      // 單筆失敗不中止整批 —— 停在中間會讓維護者搞不清楚哪些進去了
      result.failed.push({ label: e.label, message: err instanceof Error ? err.message : String(err) })
    }
    onProgress?.(i + 1, entries.length)
  }

  if (result.merged > 0) {
    await bumpDataVersion('patchVersions').catch(() => '')
  }
  return result
}
