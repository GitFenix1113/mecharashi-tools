// ── 遊戲資料版本（PLAN-017 跨 session localStorage 快取）───────────────────────

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

/** meta/gameData 的版本資訊：每集合各一個版本號 + 全域 fallback。 */
export interface DataVersions {
  /** 舊版全域版本號；未被單獨 bump 過的集合沿用此值（向後相容、部署零衝擊）。 */
  global: string | null
  /** 每集合版本號（key = CollectionKey）；只有被編輯過的集合才有條目。 */
  byKey: Record<string, string>
}

/**
 * 讀取 meta/gameData 的版本資訊（1 次 read）。
 * 文件不存在或讀取失敗 → global:null / byKey:{}（快取層退化為直接讀取，不影響功能）。
 */
export const getDataVersions = async (): Promise<DataVersions> => {
  try {
    const snap = await getDoc(doc(db, 'meta', 'gameData'))
    if (!snap.exists()) return { global: null, byKey: {} }
    const d = snap.data()
    return {
      global: (d.version as string) ?? null,
      byKey: (d.versions as Record<string, string>) ?? {},
    }
  } catch {
    return { global: null, byKey: {} }
  }
}

/**
 * 更新某集合的版本號（時間戳），只使該集合在所有 client 的 localStorage 快取失效。
 * 對應集合寫入後呼叫；merge 深層寫入 versions.<key>，不影響其他集合與全域版本。
 * 回傳新版本號，供編輯者就地同步自己的快取（GameDataContext.patchCollectionItem）。
 */
export const bumpDataVersion = async (key: string): Promise<string> => {
  const version = new Date().toISOString()
  await setDoc(
    doc(db, 'meta', 'gameData'),
    { versions: { [key]: version }, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return version
}
