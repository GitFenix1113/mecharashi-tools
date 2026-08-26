import {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'
import { db } from '../firebase'
import { reportWriteDenied } from '../diag/writeGuard'

// ── 通用輔助 ──────────────────────────────────────────────────────────────────

export async function fetchCollection<T>(collectionName: string, constraints: QueryConstraint[] = []): Promise<T[]> {
  const ref = collection(db, collectionName)
  const q   = constraints.length > 0 ? query(ref, ...constraints) : query(ref)
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ ...d.data(), id: d.id }) as T)
}

export async function fetchDocument<T>(collectionName: string, id: string): Promise<T | null> {
  const snap = await getDoc(doc(db, collectionName, id))
  return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null
}

/** 後台某 ID 是否已存在（建立前防呆，避免分頁載入時 setDoc 覆蓋未載入的既有文件）。 */
export const docExists = async (collectionName: string, id: string): Promise<boolean> => {
  const snap = await getDoc(doc(db, collectionName, id))
  return snap.exists()
}

/**
 * 寫入前清掉 undefined 欄位（Firestore 不接受 undefined）。
 * 遞迴處理物件 / 陣列；保留 null。各集合 update* 共用。
 */
export function stripUndefined<T>(val: T): T {
  if (Array.isArray(val)) return val.map(stripUndefined) as unknown as T
  if (val !== null && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    ) as T
  }
  return val
}

/**
 * 帶診斷攔截的 setDoc（PLAN-045 Phase C-2）。
 *
 * ⚠ 錯誤**原樣重新拋出**。診斷是順路搭一程的旁觀者，絕不可吞掉或改寫既有的
 *   錯誤處理行為——後台的存檔失敗提示、cascade 的中止邏輯都依賴原始錯誤。
 */
async function guardedSet(collectionName: string, id: string, payload: DocumentData): Promise<void> {
  try {
    await setDoc(doc(db, collectionName, id), payload)
  } catch (err) {
    reportWriteDenied(collectionName, id, err)
    throw err
  }
}

/**
 * 統一的文件寫入入口。
 *
 * 各集合的 `update*` 原本各自 `setDoc(doc(db, coll, id), stripUndefined(data))`，
 * 行為完全一致、只差集合名。收攏成單一入口有兩個好處：
 *   · 寫入被拒（permission-denied）有唯一的攔截點，不必在 12 個模組各接一次；
 *   · `stripUndefined` 不會再有人漏掉。
 */
export const writeDoc = (collectionName: string, id: string, data: unknown): Promise<void> =>
  guardedSet(collectionName, id, stripUndefined(data) as DocumentData)

/**
 * 同 writeDoc，但**不做 stripUndefined**。
 *
 * 給 payload 內含 `serverTimestamp()` 之類哨兵值的呼叫端使用：stripUndefined 會遞迴
 * 走物件、把哨兵拆成普通物件而失效（changeHistory.buildEntry 早有同樣的註記）。
 * 這類呼叫端必須自己確保沒有 undefined 欄位——Firestore 不接受。
 */
export const writeDocRaw = (collectionName: string, id: string, data: DocumentData): Promise<void> =>
  guardedSet(collectionName, id, data)

// ── 後台分頁查詢（PLAN：降低查詢量）─────────────────────────────────────────────
// 後台列表不再整包載入；改成依條件分頁查詢，只抓符合的文件。
//  • 有 namePrefix → 以 name 開頭比對（orderBy name + 範圍查詢；單欄位索引，免複合索引）
//  • 無 namePrefix → 以下拉條件做等值查詢（equality-only；免複合索引）
//  • cursor 為前一頁最後一筆 snapshot，傳回給 startAfter 接續下一頁
export type PageCursor = unknown
export interface CollectionPage<T> {
  items: T[]
  hasMore: boolean
  cursor: PageCursor
}
export interface PageQuery {
  namePrefix?: string
  equals?: Record<string, string | number | boolean | null>
  cursor?: PageCursor
  pageSize?: number
}

/**
 * 前綴查詢的終點哨兵（PLAN-052-D D-3）。
 *
 * Firestore 沒有 `startsWith`，前綴查詢的慣用寫法是
 * `name >= term` 且 `name < term + <排在所有字元之後的哨兵>`。
 *
 * ⚠ **這裡原本是空字串**，於是後半退化成 `name < term`——
 *   與前半 `name >= term` 交集恆為空集合，**後台的名稱搜尋一直是 0 筆**。
 *   受害的是走伺服器分頁的那兩個後台頁（components 208 筆、backpacks 181 筆），
 *   而症狀看起來像「查無此資料」而不是「查詢寫錯了」。
 *
 * ⚠ **必須用跳脫序列寫**（`\uf8ff`，六個 ASCII 字元），
 *   不要貼那個字元本身：它是 Unicode 私用區的碼位，複製貼上的過程
 *   （文件、聊天視窗、剪貼簿）很容易把它吃掉，而吃掉之後就退回成空字串
 *   —— 也就是這個 bug 原本的樣子。
 */
const PREFIX_END = '\uf8ff'

export const getCollectionPage = async <T extends { id: string }>(
  collectionName: string,
  { namePrefix = '', equals = {}, cursor = null, pageSize = 30 }: PageQuery = {},
): Promise<CollectionPage<T>> => {
  const term = namePrefix.trim()
  const constraints: QueryConstraint[] = []

  if (term) {
    constraints.push(orderBy('name'))
    constraints.push(where('name', '>=', term))
    constraints.push(where('name', '<', term + PREFIX_END))
  } else {
    for (const [field, value] of Object.entries(equals)) {
      constraints.push(where(field, '==', value))
    }
  }
  if (cursor) constraints.push(startAfter(cursor as QueryDocumentSnapshot<DocumentData>))
  constraints.push(limit(pageSize))

  const snap = await getDocs(query(collection(db, collectionName), ...constraints))
  const items = snap.docs.map(d => ({ ...d.data(), id: d.id }) as T)
  return {
    items,
    hasMore: snap.docs.length === pageSize,
    cursor: snap.docs[snap.docs.length - 1] ?? null,
  }
}
