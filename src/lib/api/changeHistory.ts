import {
  addDoc,
  collection,
  doc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import type {
  ChangeAction,
  ChangeHistoryEntry,
  ChangeTargetKind,
  RevisionedTargetKind,
} from '../../types/changeHistory'
import { CHANGE_HISTORY_TTL_YEARS, TARGET_COLLECTION } from '../../types/changeHistory'
import { fetchDocument, stripUndefined, writeDoc, type PageCursor } from './firestoreCore'
import { bumpDataVersion } from './versions'
import { reportWriteDenied } from '../diag/writeGuard'
import { checkRevision, revOf, withoutRevisionMeta } from '../../utils/docRevision'

const COLL = 'changeHistory'

// ─── 寫入 ────────────────────────────────────────────────────────────────────

/** logChange 的輸入：id / actor / 時間戳都由本模組補齊，呼叫端不需要知道。 */
export interface LogChangeInput {
  target: ChangeTargetKind
  action: ChangeAction
  targetId: string
  targetName: string
  changedFields?: string[]
  snapshot?: ChangeHistoryEntry['snapshot']
  restoredFrom?: string
}

/**
 * 組出要寫入的文件。
 *
 * ⚠ 刻意「不」經過 stripUndefined：它會遞迴走物件，把 serverTimestamp() 這種
 *   哨兵值拆成普通物件而失效。改為在組裝時就不放進 undefined 欄位。
 */
function buildEntry(input: LogChangeInput) {
  const user = auth.currentUser
  const expireAt = new Date()
  expireAt.setFullYear(expireAt.getFullYear() + CHANGE_HISTORY_TTL_YEARS)

  const data: Record<string, unknown> = {
    target:     input.target,
    action:     input.action,
    targetId:   input.targetId,
    targetName: input.targetName,
    actorUid:   user?.uid ?? '',
    actorName:  user?.displayName || user?.email || '(未知)',
    at:         serverTimestamp(),
    expireAt,   // 由 Firestore 原生 TTL 政策讀取後自動清除（PLAN-030 決策九）
  }
  if (input.changedFields?.length) data.changedFields = input.changedFields
  if (input.snapshot)              data.snapshot      = input.snapshot
  if (input.restoredFrom)          data.restoredFrom  = input.restoredFrom
  return data
}

/**
 * 寫入一筆變更記錄，**失敗時拋錯**。
 *
 * 給刪除路徑使用：刪除的 log 承載還原用的快照，漏記等於永久失去救回能力，
 * 因此刪除必須「先寫 log 成功、再執行 batch」，log 失敗則中止刪除（決策十）。
 */
export async function logChangeOrThrow(input: LogChangeInput): Promise<string> {
  const ref = await addDoc(collection(db, COLL), buildEntry(input))
  return ref.id
}

/**
 * 寫入一筆變更記錄，**失敗時只警告不拋錯**（fire-and-forget）。
 *
 * 給新增／修改路徑使用。稽核 log 是輔助設施：若因規則未部署、索引缺失或網路瞬斷
 * 導致 log 寫入失敗就讓存檔丟出錯誤，管理員會誤以為資料沒存進去而重複操作。
 * 沿用既有 `bumpDataVersion(...).catch(() => '')` 的慣例。
 */
export function logChange(input: LogChangeInput): void {
  void logChangeOrThrow(input).catch((err) => {
    console.warn('[changeHistory] 寫入變更記錄失敗（不影響主操作）:', err)
  })
}

// ─── 讀取 ────────────────────────────────────────────────────────────────────

export interface ChangeHistoryQuery {
  /** 分類軸一：只看某個集合類型 */
  target?: ChangeTargetKind
  /** 分類軸二：只看某種操作 */
  action?: ChangeAction
  cursor?: PageCursor
  pageSize?: number
}

export interface ChangeHistoryPage {
  items: ChangeHistoryEntry[]
  hasMore: boolean
  cursor: PageCursor
}

/**
 * 分頁查詢變更歷史，固定依時間新到舊。
 *
 * target / action 皆為選填、可任意組合，對應 firestore.indexes.json 的三組複合索引：
 *   (target, at↓) / (action, at↓) / (target, action, at↓)
 *
 * 刻意不沿用 getCollectionPage —— 那支綁定 name 排序模型，與本頁的 at 時間排序不相容。
 */
export async function getChangeHistoryPage({
  target,
  action,
  cursor = null,
  pageSize = 30,
}: ChangeHistoryQuery = {}): Promise<ChangeHistoryPage> {
  const constraints: QueryConstraint[] = []
  if (target) constraints.push(where('target', '==', target))
  if (action) constraints.push(where('action', '==', action))
  constraints.push(orderBy('at', 'desc'))
  if (cursor) constraints.push(startAfter(cursor as QueryDocumentSnapshot))
  constraints.push(limit(pageSize))

  const snap = await getDocs(query(collection(db, COLL), ...constraints))
  return {
    items: snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ChangeHistoryEntry),
    hasMore: snap.docs.length === pageSize,
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
  }
}

/** 取單筆記錄（還原流程需要依 log id 撈回快照）。 */
export const changeHistoryRef = (id: string) => doc(db, COLL, id)

// ─── 帶稽核的寫入 helper ─────────────────────────────────────────────────────

/**
 * 淺層比對兩份文件，回傳有變動的頂層欄位名。
 *
 * 巢狀值用 JSON.stringify 整包比對即可 —— 目的是「知道誰動了哪些欄位」以便定位，
 * 不是產生欄位級 diff（見 PLAN-030 決策五：update 不存 before/after 快照）。
 * 兩邊聯集取 key，才抓得到「新增欄位」與「刪除欄位」。
 */
export function diffKeys(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const changed: string[] = []
  for (const k of keys) {
    if (k === 'id') continue
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) changed.push(k)
  }
  return changed.sort()
}

/**
 * 集合無關的「寫入 + 稽核」helper。三個 update 函式都走這裡。
 *
 * 為什麼要先讀一次 pre-image（PLAN-030 決策四）：
 * 本專案沒有獨立的 create 函式 —— 建立與修改都是同一個 setDoc，UI 只在建立前用
 * docExists() 擋同名。稽核要分辨這兩種操作，只能靠「寫入前舊文件是否存在」判定。
 * 順帶用這份 pre-image 算出 changedFields。成本是每次存檔 +1 read，後台人工操作
 * 頻率下可忽略。
 *
 * 順序固定：讀 pre-image → setDoc → bumpDataVersion → logChange（不 await）。
 * log 排在最後且不 await，失敗只警告不擋主流程（決策十）。
 *
 * ⚠ **沒有衝突檢查、update 不存快照**：後存者整份蓋掉先存者，而且記錄裡沒有被蓋掉的內容。
 *   只有管理者在編的集合可以接受這個；開給協作者同時編的故事館改走下面的 `saveWithRevision()`。
 *
 * @returns bumpDataVersion 的版本字串，供呼叫端餵給 patchCollectionItem
 */
export async function saveWithHistory<T extends { id: string; name?: string }>(
  target: ChangeTargetKind,
  item: T,
): Promise<string> {
  const coll = TARGET_COLLECTION[target]
  const { id, ...data } = item

  // pre-image：null → create；有值 → update（並據此算 changedFields）
  const prev = await fetchDocument<Record<string, unknown>>(coll, id)

  // writeDoc 而非裸 setDoc：寫入被拒（permission-denied）需要有唯一攔截點才記得到
  // （PLAN-045 決策五）。行為完全等價——writeDoc 內部就是 stripUndefined + setDoc，
  // 錯誤原樣重拋，故本函式「log 失敗不擋主流程」的既有語意不受影響。
  await writeDoc(coll, id, data)
  const version = await bumpDataVersion(coll).catch(() => '')

  logChange({
    target,
    action: prev ? 'update' : 'create',
    targetId: id,
    targetName: item.name ?? id,
    changedFields: prev
      ? diffKeys(prev, item as unknown as Record<string, unknown>)
      : undefined,
  })

  return version
}

// ─── 有版本號的寫入：衝突檢查 ＋ 前一版快照（PLAN-042-H 後續）────────────────────

/**
 * 存檔被擋：表單是從舊版改起的（開啟之後有人存過）。**在任何寫入之前拋出**，資料庫毫髮無傷。
 * 編輯面板拿 `latest` 給使用者「載入最新版」；`latest === null` ＝文件已被刪除。
 */
export class SaveConflictError extends Error {
  readonly baseRev: number
  readonly currentRev: number
  /** 伺服器上的最新版（含 id）；文件已不存在時是 null */
  readonly latest: (Record<string, unknown> & { id: string }) | null

  constructor(baseRev: number, currentRev: number, latest: SaveConflictError['latest']) {
    super('這份在你開啟之後被別人存過，為了不蓋掉對方的修改，這次存檔已擋下。')
    this.name = 'SaveConflictError'
    this.baseRev = baseRev
    this.currentRev = currentRev
    this.latest = latest
  }
}

export interface RevisionedSaveResult<T> {
  /** bumpDataVersion 的版本字串（失敗時是 ''），餵給 patchCollectionItem */
  version: string
  /** 實際寫進去的那一份（帶新的 rev／updatedAt）。**快取要用這份**，不是呼叫端傳進來的那份 */
  saved: T
}

/**
 * 有存檔衝突檢查的「寫入 + 稽核」（`REVISIONED_TARGETS`：pilotLore／mechLore）。
 *
 * 與 saveWithHistory 的三個差別：
 *   ① **衝突檢查**：`item.rev`（表單從第幾版改起）在交易內和伺服器現值比對，不一致就拋
 *      `SaveConflictError`、什麼都不寫。比對與寫入在同一個交易，兩人同一瞬間存檔也只會過一個
 *      （交易提交時文件已被別人改過 → SDK 重跑 → 重讀到新版本號 → 擋下）。
 *   ② **update／restore 的 log 帶前一版整份快照**（snapshot.doc），歷史檢視頁可以還原回去。
 *      故事館文件實測最大 7.1 KB（2026-10-17，pilotLore 92 份／mechLore 93 份），離單文件 1 MiB 很遠。
 *   ③ **log 與資料同一個交易原子寫入**，不是 fire-and-forget。PLAN-030 決策十讓一般 log「失敗只警告」，
 *      是因為那時的 log 只是追溯資訊；這裡的 log 承載唯一的前一版內容，漏記＝覆寫後救不回來，
 *      地位等同刪除快照（決策十的例外），所以寧可整筆存不進去。
 *
 * `opts.baseRev` 給「寫回某一版」用（planRevert：基準是預覽當下的現值，不是快照裡的舊 rev）；
 * 一般存檔不傳，取 `item.rev`。
 */
export async function saveWithRevision<T extends { id: string; name?: string; rev?: number; updatedAt?: string }>(
  target: RevisionedTargetKind,
  item: T,
  opts: { baseRev?: number; restoredFrom?: string } = {},
): Promise<RevisionedSaveResult<T>> {
  const coll = TARGET_COLLECTION[target]
  const { id, ...data } = item
  const ref = doc(db, coll, id)
  const logRef = doc(collection(db, COLL))
  const baseRev = opts.baseRev ?? revOf(item)

  let saved: T
  try {
    saved = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const prev = snap.exists() ? (snap.data() as Record<string, unknown>) : null

      const check = checkRevision(baseRev, prev)
      if (!check.ok) {
        throw new SaveConflictError(check.baseRev, check.currentRev, prev ? { ...prev, id } : null)
      }

      const next = stripUndefined({ ...data, rev: check.nextRev, updatedAt: new Date().toISOString() })
      tx.set(ref, next)
      tx.set(logRef, buildEntry({
        target,
        action: opts.restoredFrom ? 'restore' : prev ? 'update' : 'create',
        targetId: id,
        targetName: item.name ?? id,
        changedFields: prev ? diffKeys(withoutRevisionMeta(prev), withoutRevisionMeta(next)) : undefined,
        // 快照存「被這次覆寫掉的那一版」：讀自同一個交易，保證就是被蓋掉的內容
        snapshot: prev ? { doc: prev, patches: [] } : undefined,
        restoredFrom: opts.restoredFrom,
      }))
      return { ...next, id } as T
    })
  } catch (err) {
    // 衝突不是權限問題；其餘照 writeDoc 的慣例過一次診斷攔截（PLAN-045），錯誤原樣重拋
    if (!(err instanceof SaveConflictError)) reportWriteDenied(coll, id, err)
    throw err
  }

  const version = await bumpDataVersion(coll).catch(() => '')
  return { version, saved }
}

/**
 * 直讀伺服器上的現況（不吃本機快取）。編輯面板開啟時拿它和表單的 rev 比，
 * 快取過期（別人存檔後這個分頁還沒重整）就先提示，不必等到存檔才被擋。查無 → null。
 */
export async function getRevisionedDoc(
  target: RevisionedTargetKind,
  id: string,
): Promise<(Record<string, unknown> & { id: string }) | null> {
  const snap = await getDocFromServer(doc(db, TARGET_COLLECTION[target], id))
  return snap.exists() ? { ...(snap.data() as Record<string, unknown>), id } : null
}
