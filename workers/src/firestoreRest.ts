// ── Firestore REST 讀取 + typed value decoder ─────────────────────────────────
// Firestore REST 回的文件欄位是「typed value」格式（{stringValue}/{integerValue}/
// {mapValue}/{arrayValue}…），而前端（Firebase SDK 的 doc.data()）拿到的是普通 JS 物件。
// 這裡把 typed value 遞迴還原成普通物件，讓 Worker 的回應與前端 fetchCollection
// 的 `{ ...doc.data(), id }` 格式一致，前端零改動即可消費。

import type { ServiceAccount } from './gcpAuth'

// Firestore REST 的單一欄位值（只列本專案會用到的型別）
interface FsValue {
  nullValue?: null
  booleanValue?: boolean
  integerValue?: string
  doubleValue?: number
  stringValue?: string
  timestampValue?: string
  arrayValue?: { values?: FsValue[] }
  mapValue?: { fields?: Record<string, FsValue> }
}

interface FsDocument {
  name: string
  fields?: Record<string, FsValue>
}

/** 遞迴把單一 typed value 還原成普通 JS 值。 */
function decodeValue(v: FsValue): unknown {
  if ('nullValue' in v) return null
  if ('booleanValue' in v) return v.booleanValue
  if ('integerValue' in v) return Number(v.integerValue) // REST 以字串傳整數避免精度問題；遊戲資料在安全範圍內
  if ('doubleValue' in v) return v.doubleValue
  if ('stringValue' in v) return v.stringValue
  if ('timestampValue' in v) return v.timestampValue // 保留 ISO 字串（遊戲資料集合少用 Firestore Timestamp）
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(decodeValue)
  if ('mapValue' in v) return decodeFields(v.mapValue?.fields ?? {})
  return null
}

/** 把一份 document 的 fields 還原成普通物件。 */
function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v)
  return out
}

/** 從 document name（projects/…/documents/collection/docId）取出 docId。 */
function extractId(name: string): string {
  const i = name.lastIndexOf('/')
  return i >= 0 ? name.slice(i + 1) : name
}

const FS_BASE = 'https://firestore.googleapis.com/v1'

function docsUrl(sa: ServiceAccount, path: string): string {
  return `${FS_BASE}/projects/${sa.project_id}/databases/(default)/documents/${path}`
}

/**
 * 讀取整個集合（處理分頁 pageToken），回 `{ ...decodedFields, id }[]`。
 * 對應前端 fetchCollection 的輸出格式。用 Admin access token → 繞過安全規則
 * （即使 Phase 3 收成 read:if false，Worker 仍讀得到；這正是本架構的重點）。
 */
export async function listCollection(
  sa: ServiceAccount,
  token: string,
  collection: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  let pageToken: string | undefined
  do {
    const url = new URL(docsUrl(sa, collection))
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Firestore list ${collection} 失敗 ${res.status}: ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as { documents?: FsDocument[]; nextPageToken?: string }
    for (const d of data.documents ?? []) {
      out.push({ ...decodeFields(d.fields ?? {}), id: extractId(d.name) })
    }
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

/**
 * 讀取單一文件（singleton 集合用，如 globalResearch/grayOpsRoster），
 * 回 `{ ...decodedFields, id }` 或 null（不存在）。
 */
export async function getDocument(
  sa: ServiceAccount,
  token: string,
  collection: string,
  docId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(docsUrl(sa, `${collection}/${docId}`), {
    headers: { authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Firestore get ${collection}/${docId} 失敗 ${res.status}: ${text.slice(0, 200)}`)
  }
  const d = (await res.json()) as FsDocument
  return { ...decodeFields(d.fields ?? {}), id: extractId(d.name) }
}
