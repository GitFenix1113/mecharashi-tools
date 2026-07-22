// 快照還原的 I/O 與原子交易層（PLAN-030 F-1 / F-2 / F-3 的 API 面）
//
// 純計算在 utils/restorePatch.ts（可單測、無 Firestore 依賴）；本檔只負責
// 「讀什麼、寫什麼、以什麼順序寫」。結構刻意鏡射 cascadeDelete.ts：
// plan / commit 兩階段，F-3 的預覽對話框吃 plan、使用者確認後才 commit。
//
// ── 與刪除端的兩個不對稱 ─────────────────────────────────────────────────────
// ① log 順序：刪除是「先寫 log 才動資料」（log 承載快照，漏記 = 永久失去救回能力）。
//    還原相反，回到決策十的一般規則：先還原成功、後補 log 且不 await——restore log
//    只承載追溯資訊（restoredFrom），漏記不損失任何能力，不該擋住救回操作。
// ② 讀取範圍：刪除要掃全部 9 個集合（找出「誰引用了它」是開放問題）；
//    還原只讀「修補單指到的文件」——名單已經在快照裡，逐份 getDocFromServer 即可。
//
// ── 為什麼 plan 與 commit 都檢查「目標是否已被重建」────────────────────────
// 管理員可能刪掉後又手動建了同名項目，setDoc 會無聲覆蓋它（F-1 的明文禁止）。
// plan 檢查是給對話框顯示；commit 開頭**再驗一次**是堵 plan/commit 之間的視窗——
// 這正是 Phase C 破壞性測試發現②「commit 不重驗目標存在」在還原端的對稱修正。

import {
  doc,
  getDocFromServer,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import type {
  ChangeHistoryEntry,
  ChangeTargetKind,
  DeleteSnapshot,
} from '../../types/changeHistory'
import { TARGET_COLLECTION } from '../../types/changeHistory'
import {
  buildRestorePlan,
  type RestorePlan,
  type RestoreScanData,
  type RestoreSkip,
} from '../../utils/restorePatch'
import { FIRESTORE_BATCH_LIMIT, BATCH_OVERHEAD_OPS } from '../../utils/cascadePatch'
import { freezeNumRefs, type NumRefSource } from '../../utils/numRefs'
import { stripUndefined } from './firestoreCore'
import { changeHistoryRef, logChange } from './changeHistory'

// ─── 錯誤型別 ────────────────────────────────────────────────────────────────

export type RestoreBlockReason =
  /** 目標 ID 已被重新建立 —— 還原會無聲覆蓋它，中止並提示（F-1） */
  | 'targetExists'
  /** 指定的 log 不存在、不是 delete、或沒有快照 */
  | 'badLog'
  /** batch 操作數超過 Firestore 500 上限 */
  | 'batchLimit'

/** 還原被擋下。**在動任何資料之前拋出**，資料庫毫髮無傷。 */
export class RestoreBlockedError extends Error {
  readonly reason: RestoreBlockReason

  constructor(reason: RestoreBlockReason, detail: string) {
    super(`還原已中止：${detail}`)
    this.name = 'RestoreBlockedError'
    this.reason = reason
  }
}

// ─── 計畫階段 ────────────────────────────────────────────────────────────────

export interface RestorePlanResult {
  /** 來源 delete log 的文件 ID（寫進 restore log 的 restoredFrom） */
  logId: string
  kind: ChangeTargetKind
  /** 目標集合名，如 'buffs' */
  coll: string
  targetId: string
  targetName: string
  snapshot: DeleteSnapshot
  plan: RestorePlan
  /** 非空表示不可提交。commitRestore 會再驗目標存在，不倚賴呼叫端自律 */
  blockers: { reason: RestoreBlockReason; detail: string }[]
}

/**
 * 讀取現況並算出「還原這筆刪除會動到哪些地方」。**不寫入任何資料。**
 *
 * 給 F-3 預覽對話框直接用；使用者確認後把回傳值交給 commitRestore。
 */
export async function planRestore(logId: string): Promise<RestorePlanResult> {
  const logSnap = await getDocFromServer(changeHistoryRef(logId))
  const entry = logSnap.exists() ? ({ ...logSnap.data(), id: logSnap.id } as ChangeHistoryEntry) : null
  if (!entry || entry.action !== 'delete' || !entry.snapshot) {
    throw new RestoreBlockedError('badLog', `記錄 ${logId} 不存在、不是刪除記錄、或沒有快照`)
  }

  const { target: kind, targetId, targetName, snapshot } = entry
  const coll = TARGET_COLLECTION[kind]
  const blockers: RestorePlanResult['blockers'] = []

  // F-1：目標已被重新建立 → 不可無聲覆蓋
  const targetSnap = await getDocFromServer(doc(db, coll, targetId))
  if (targetSnap.exists()) {
    blockers.push({
      reason: 'targetExists',
      detail: `${coll}/${targetId} 已存在（刪除後被重新建立），還原會覆蓋它。請先處理現有文件`,
    })
  }

  // 只讀修補單指到的文件；不存在的文件不進 data → 純函式層記為 docMissing 跳過
  const data = await loadPatchTargets(snapshot)

  // textFreeze 比對需要凍結器；來源就是快照裡的被刪文件，與刪除當下同一份 → 可重現凍結產物
  const freezeText = kind === 'buff'
    ? (text: string) => freezeNumRefs(text, targetId, snapshot.doc as NumRefSource).text
    : undefined

  const plan = buildRestorePlan(snapshot.patches ?? [], data, { freezeText })

  const ops = plan.writeCount + BATCH_OVERHEAD_OPS
  if (ops > FIRESTORE_BATCH_LIMIT) {
    blockers.push({
      reason: 'batchLimit',
      detail: `本次還原需 ${ops} 個寫入操作，超過 Firestore 單一 batch 上限 ${FIRESTORE_BATCH_LIMIT}`,
    })
  }

  return { logId, kind, coll, targetId, targetName, snapshot, plan, blockers }
}

/** 逐份重讀修補單指到的文件（伺服器讀，理由同 cascadeDelete：不可吃陳舊快取）。 */
async function loadPatchTargets(snapshot: DeleteSnapshot): Promise<RestoreScanData> {
  const keys = new Map<string, { coll: string; docId: string }>()
  for (const p of snapshot.patches ?? []) {
    keys.set(`${p.coll} ${p.docId}`, { coll: p.coll, docId: p.docId })
  }
  const data: RestoreScanData = {}
  await Promise.all([...keys.values()].map(async ({ coll, docId }) => {
    const snap = await getDocFromServer(doc(db, coll, docId))
    if (!snap.exists()) return                        // 缺席 → docMissing 由純函式層報告
    ;(data[coll] ??= []).push({ ...(snap.data() as Record<string, unknown>), id: snap.id })
  }))
  return data
}

// ─── 提交階段 ────────────────────────────────────────────────────────────────

export interface RestoreResult {
  targetId: string
  targetName: string
  /** 實際重加的引用處數 */
  restoredRefs: number
  /** 值已在原位、無需重加的處數（冪等命中） */
  alreadyPresent: number
  /** 無法套用而跳過的修補單（含原因），呼叫端應原樣呈現給管理員 */
  skipped: RestoreSkip[]
  /** 受影響集合 → 新版本號（含目標集合自己） */
  versions: Record<string, string>
}

/**
 * 實際執行還原：單一 WriteBatch 原子提交（目標重建 + N 份引用寫回 + 版本 bump），
 * 成功後補一筆 restore log（不 await，失敗只警告——見檔頭不對稱說明）。
 */
export async function commitRestore(planned: RestorePlanResult): Promise<RestoreResult> {
  const { logId, kind, coll, targetId, targetName, snapshot, plan } = planned

  // 最後一道防線，且在任何寫入之前：plan/commit 視窗內目標可能剛被重建
  if (planned.blockers.length) {
    const b = planned.blockers[0]
    throw new RestoreBlockedError(b.reason, b.detail)
  }
  const recheck = await getDocFromServer(doc(db, coll, targetId))
  if (recheck.exists()) {
    throw new RestoreBlockedError(
      'targetExists',
      `${coll}/${targetId} 在確認期間被重新建立，已中止以免覆蓋`,
    )
  }

  // 版本 bump 併入同一 batch（理由同 cascadeDelete：資料改了但版本沒 bump，
  // 其他 client 會繼續供應「已刪除」的舊快取）
  const version = new Date().toISOString()
  const touched = [...new Set([coll, ...plan.mutations.map((m) => m.coll)])]
  const versions = Object.fromEntries(touched.map((c) => [c, version]))

  const batch = writeBatch(db)
  batch.set(doc(db, coll, targetId), stripUndefined(snapshot.doc))
  for (const m of plan.mutations) {
    // update 而非 set：文件剛剛才讀到，若此刻已消失應該失敗（batch 原子回滾）而非重建殘缺文件
    batch.update(doc(db, m.coll, m.docId), stripUndefined(m.set))
  }
  batch.set(
    doc(db, 'meta', 'gameData'),
    { versions, updatedAt: serverTimestamp() },
    { merge: true },
  )
  await batch.commit()

  // 還原本身也是一次資料異動：記 restore log 並以 restoredFrom 指回來源（F-3）
  logChange({
    target: kind,
    action: 'restore',
    targetId,
    targetName,
    restoredFrom: logId,
  })

  return {
    targetId,
    targetName,
    restoredRefs: plan.applied.length,
    alreadyPresent: plan.alreadyPresent.length,
    skipped: plan.skipped,
    versions,
  }
}
