/**
 * 台版公告放行：firebase-admin 版（排程自動放行／一次性腳本用）
 *
 * 與後台的 src/lib/api/announcementStaging.ts mergeIntoVersion 是**同一件事的兩種 SDK**：
 * 交易形狀、收據欄位、bump 方式都一致。真正的規則（衝突判定、id、隱藏不變式、正規化）
 * 不在這裡 —— 兩邊都 import src/utils/announcementMerge.ts，所以不會漂開。
 *
 * ⚠ 本檔 import .ts：需要 Node 的型別剝除（Node 22.18+ 預設開啟；排程用 Node 22）。
 *   build 腳本（generate-image-manifest 等）要能在 Node 20 跑，**不要**從那邊引用本檔。
 */

import { applyActivityToList } from '../../src/utils/announcementMerge.ts'

export const PENDING = 'pendingActivities'

/** 排程放行時寫進收據的身分。後台看「已合併」就分得出是人按的還是排程放的。 */
export const AUTO_ACTOR = { uid: 'scheduler', name: '排程自動放行' }

/** Firestore 不接受 undefined；遞迴清掉（同 firestoreCore.stripUndefined 的作用） */
export function stripUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(stripUndefined)
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue
      out[k] = stripUndefined(v)
    }
    return out
  }
  return obj
}

/**
 * 把一筆待審活動寫進 patchVersions 的某半期，並在待審文件上留收據。
 *
 * ⚠ 必須是交易：版本編輯頁存檔是整份 setDoc（沒有 merge），讀改寫之間被插隊，
 *   這裡寫進去的東西會被較舊的表單狀態整份蓋掉。交易會偵測到並重試。
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {typeof import('firebase-admin').firestore.FieldValue} FieldValue
 * @param {object} p
 * @param {string} p.pendingId
 * @param {object} p.activity        toMergeableActivity 的輸出
 * @param {{versionId: string, half: 'upper'|'lower'}} p.target
 * @param {{uid: string, name: string}} p.actor
 * @param {boolean} [p.overwrite]    同名同日已存在時覆蓋（預設不覆蓋、回 conflict）
 * @param {string[]} [p.expectStatus] 待審文件必須處於這些狀態才寫（防排程與人同時處理同一筆）
 * @returns {Promise<{ok: true, receipt: object} | {ok: false, reason: 'conflict'|'stale', existing?: object, status?: string}>}
 */
export async function mergeIntoVersionAdmin(db, FieldValue, { pendingId, activity, target, actor, overwrite = false, expectStatus }) {
  const clean = stripUndefined(activity)
  return db.runTransaction(async tx => {
    const versionRef = db.collection('patchVersions').doc(target.versionId)
    const pendingRef = db.collection(PENDING).doc(pendingId)
    // 交易內所有讀取必須排在寫入之前
    const [versionSnap, pendingSnap] = await tx.getAll(versionRef, pendingRef)
    if (!versionSnap.exists) throw new Error(`找不到版本 ${target.versionId}`)
    if (!pendingSnap.exists) throw new Error(`待審活動 ${pendingId} 已不存在`)

    const status = pendingSnap.get('status')
    if (expectStatus && !expectStatus.includes(status)) return { ok: false, reason: 'stale', status }

    const applied = applyActivityToList(versionSnap.get(target.half)?.twActivities, clean, { overwrite })
    if (!applied.ok) return { ok: false, reason: 'conflict', existing: applied.existing }

    // 只寫該半期的 twActivities 這條路徑，不整份覆寫 —— 免得回捲其他欄位的並行編輯
    tx.update(versionRef, { [`${target.half}.twActivities`]: applied.list })

    const receipt = {
      versionId: target.versionId,
      half: target.half,
      field: 'twActivities',
      anchor: { name: clean.name, startDate: clean.startDate },
      at: new Date(),
      actorUid: actor.uid,
      actorName: actor.name,
    }
    tx.update(pendingRef, {
      status: 'merged',
      mergedInto: receipt,
      // 實際寫進去的版本要回存（含推估出來的 weeks／predicted）——
      // 否則收據只剩 extracted，重開「已合併」那筆會對不上當初寫進去的內容
      reviewed: applied.written,
      reviewerUid: actor.uid,
      reviewerName: actor.name,
      reviewedAt: FieldValue.serverTimestamp(),
    })
    return { ok: true, receipt }
  })
}

/**
 * 讓所有 client 的 patchVersions 快取失效（同 src/lib/api/versions.ts 的 bumpDataVersion）。
 *
 * ⚠ 寫了 patchVersions 卻不 bump：Worker 邊緣快取以集合版本號當 cache key、max-age=86400，
 *   資料寫進去了、前台看不到、硬重整也沒用，最長 24 小時。
 * 一整批只 bump 一次 —— 版本號的用途是「有變動」，不是「變動了幾次」。
 */
export async function bumpPatchVersions(db, FieldValue) {
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set(
    { versions: { patchVersions: version }, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  return version
}
