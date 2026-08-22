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

// ── 寫入（PLAN-046 A-4）──────────────────────────────────────────────────────
// 本檔原本純唯讀。使用統計需要把計數累加進 Firestore，故新增 commit 能力。
//
// ⚠ 這讓 Worker 從「100% 唯讀」變成「有一條匿名可觸發的寫入路徑」。service account
//   本來就有完整寫入權限（PLAN-029 的設計前提），新增的不是**權限**而是**觸發它的
//   路徑** —— 在此之前 Worker 有漏洞最壞是資料外洩，之後最壞是資料被寫壞。
//   因此呼叫端（collect.ts）必須遵守兩條鐵律：文件路徑由伺服器時間算出、
//   欄位路徑一律由程式碼組出，payload 只准提供數字。本檔不做那層把關，只負責送出。

/** 單一欄位轉換。只開放本專案用得到的兩種，不做通用封裝以縮小誤用面。 */
export type FieldTransform =
  | { fieldPath: string; increment: { integerValue: string } }
  | { fieldPath: string; setToServerValue: 'REQUEST_TIME' }

export interface IncrementWrite {
  /** 集合名（不含 project 前綴） */
  collection: string
  /** 文件 ID */
  docId: string
  /** 文件不存在時要一併寫入的識別欄位（如 date / month），值為字串 */
  seed: Record<string, string>
  transforms: FieldTransform[]
}

/**
 * 送出一批 increment 寫入。
 *
 * 關鍵在 `update` + `updateMask` + `updateTransforms` 的組合：
 * 單獨的 transform 在文件不存在時會失敗，但帶 updateMask 的 update 會「不存在就建立」，
 * transform 隨之生效。updateMask 只列 seed 欄位 → 既有計數欄位不會被覆蓋。
 *
 * 多份文件放同一個 commit：Firestore 單次 commit 上限 500 個 write，遠遠夠用，
 * 而這樣一整場 session 只算**一次**寫入操作。
 */
export async function commitIncrements(
  sa: ServiceAccount,
  token: string,
  writes: IncrementWrite[],
): Promise<void> {
  if (writes.length === 0) return
  const body = {
    writes: writes.map((w) => ({
      update: {
        name: `projects/${sa.project_id}/databases/(default)/documents/${w.collection}/${w.docId}`,
        fields: Object.fromEntries(
          Object.entries(w.seed).map(([k, v]) => [k, { stringValue: v }]),
        ),
      },
      updateMask: { fieldPaths: Object.keys(w.seed) },
      updateTransforms: w.transforms,
    })),
  }
  const res = await fetch(`${FS_BASE}/projects/${sa.project_id}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Firestore commit 失敗 ${res.status}: ${text.slice(0, 200)}`)
  }
}

/**
 * 只讀一份文件的單一數值欄位（給寫入預算熔斷器用）。
 *
 * 用 `mask.fieldPaths` 讓 Firestore 只回那一個欄位：仍算 1 次 read，但傳輸量極小，
 * 而熔斷器是每個 isolate 定期輪詢的，省下的頻寬會累積。
 * 文件不存在或欄位缺漏一律回 0 —— 對熔斷器而言「還沒開始寫」就是 0。
 */
export async function readCounterField(
  sa: ServiceAccount,
  token: string,
  collection: string,
  docId: string,
  field: string,
): Promise<number> {
  const url = new URL(docsUrl(sa, `${collection}/${docId}`))
  url.searchParams.set('mask.fieldPaths', field)
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${token}` } })
  if (res.status === 404) return 0
  if (!res.ok) throw new Error(`Firestore get counter 失敗 ${res.status}`)
  const d = (await res.json()) as FsDocument
  const v = d.fields?.[field]
  return v?.integerValue !== undefined ? Number(v.integerValue) : 0
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

// ── 查詢（PLAN-051 A-1）──────────────────────────────────────────────────────
// listCollection 只能打「單一集合」，撈不到 users/{uid}/profile/main 這種子集合。
// 跨父路徑要用 collectionGroup —— REST 對應的是 documents:runQuery + structuredQuery
// 的 from[].allDescendants。做成通用函式（而非寫死 profile 查詢），之後其他跨集合
// 端點都用得上。

/** 只開放本專案會用到的運算子；要更多時再補，縮小誤用面。 */
export type FilterOp = 'EQUAL' | 'NOT_EQUAL' | 'IN' | 'ARRAY_CONTAINS' | 'ARRAY_CONTAINS_ANY'

export interface FieldFilterSpec {
  /** 欄位路徑（巢狀用 `a.b`） */
  field: string
  op: FilterOp
  /** 普通 JS 值，內部會轉成 typed value；`IN` 請傳陣列 */
  value: unknown
}

export interface RunQuerySpec {
  collectionId: string
  /** true＝collectionGroup 查詢（跨所有父路徑）；false／省略＝只查根層同名集合 */
  allDescendants?: boolean
  where?: FieldFilterSpec
  limit?: number
}

/**
 * 查詢結果。刻意**不**沿用 listCollection 的 `{ ...data, id }`：
 * collectionGroup 查詢下 id 是末段（profile 查詢時每一筆都是 'main'），本身沒有識別力，
 * 真正的識別資訊在完整 name（含父文件 ID）裡。故把 name / id / data 三者分開交給呼叫端。
 */
export interface QueriedDoc {
  /** 完整 document name：projects/…/documents/users/{uid}/profile/main */
  name: string
  /** name 的末段 */
  id: string
  data: Record<string, unknown>
}

/** decodeValue 的反向：普通 JS 值 → Firestore typed value（供查詢條件用）。 */
function encodeValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } }
  if (typeof v === 'object') {
    const fields: Record<string, FsValue> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) fields[k] = encodeValue(x)
    return { mapValue: { fields } }
  }
  throw new Error(`runQuery：不支援的查詢值型別 ${typeof v}`)
}

/**
 * 執行 structuredQuery。用 Admin access token → 繞過安全規則
 * （PLAN-051 把 profile 讀取收回 isAdmin() 之後，這是唯一撈得到團隊名單的路徑）。
 *
 * ⚠ 回應是 `[{ document?, readTime, skippedResults? }, …]` 陣列：查無結果時仍會回一個
 *   **沒有 document 的項目**（只帶 readTime），故必須濾掉再 map，否則會產生 undefined 項。
 */
export async function runQuery(
  sa: ServiceAccount,
  token: string,
  spec: RunQuerySpec,
): Promise<QueriedDoc[]> {
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: spec.collectionId, allDescendants: spec.allDescendants ?? false }],
  }
  if (spec.where) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: spec.where.field },
        op: spec.where.op,
        value: encodeValue(spec.where.value),
      },
    }
  }
  if (spec.limit !== undefined) structuredQuery.limit = spec.limit

  const res = await fetch(`${FS_BASE}/projects/${sa.project_id}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Firestore runQuery ${spec.collectionId} 失敗 ${res.status}: ${text.slice(0, 200)}`)
  }
  const rows = (await res.json()) as Array<{ document?: FsDocument }>
  const out: QueriedDoc[] = []
  for (const r of rows) {
    if (!r.document) continue
    out.push({
      name: r.document.name,
      id: extractId(r.document.name),
      data: decodeFields(r.document.fields ?? {}),
    })
  }
  return out
}
