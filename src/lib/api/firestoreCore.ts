import {
  collection,
  doc,
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

const PREFIX_END = ''

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
