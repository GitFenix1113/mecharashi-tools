// 級聯刪除的 I/O 與原子交易層（PLAN-030 C-4）
//
// 純計算在 utils/cascadePatch.ts（可單測、無 Firestore 依賴）；本檔只負責
// 「讀什麼、寫什麼、以什麼順序寫」。
//
// ── 刻意拆成 plan / commit 兩階段 ─────────────────────────────────────────────
// 計畫書把 C-4 寫成單一函式，但刪除確認對話框（D-1）必須在使用者按下確認**之前**
// 就顯示影響範圍——「這會動到 3 個機師、5 個 BUFF」。若讀取與寫入綁在同一次呼叫，
// 對話框只能自己再掃一次，兩次掃描之間的結果還可能不一致。
// 拆開後：planCascadeDelete() 給對話框看，使用者確認後才 commitCascadeDelete()。
//
// ── 寫入順序（決策十，與其他操作相反）──────────────────────────────────────
// 一般寫入是「先存資料、後補 log，log 失敗只警告」。刪除相反：**先寫 log 成功才動資料**。
// 因為刪除的 log 承載還原用的快照，漏記等於永久失去救回能力；而多一筆「記了但沒刪成」
// 的 log 只是雜訊，可以查、可以忽略。兩種失敗模式不對等，所以順序不對稱。
//
// ── 為什麼每次刪除都重讀全部 9 個集合 ───────────────────────────────────────
// C-2 的寫入策略是「整欄改寫」（Firestore FieldPath 不能穿越陣列），屬 last-write-wins。
// 拿 GameDataContext 的快取去算，會把別人在快取之後存的修改一併洗掉。
// 而且只重讀「快取顯示有命中」的文件也不夠——那樣會漏掉「快取之後才新增的引用」，
// 刪完留下斷鏈。要確定掃得全，就得對全部集合讀新的。
// 成本約兩千次 read／次刪除，但刪除是低頻人工操作，正確性優先（計畫書決策八）。

import {
  collection,
  deleteField,
  doc,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import type {
  ChangeTargetKind,
  DeleteSnapshot,
  ReversePatch,
} from '../../types/changeHistory'
import { TARGET_COLLECTION } from '../../types/changeHistory'
import {
  ALL_SCAN_COLLECTIONS,
  findReferences,
  type RefHit,
  type RefScanData,
  type ScanCollection,
} from '../../utils/entityRefs'
import {
  buildCascadePlan,
  checkCascadeSafety,
  createNumRefFreezer,
  type CascadeBlocker,
  type CascadePlan,
  type NumRefFreezer,
} from '../../utils/cascadePatch'
import type { NumRefSource } from '../../utils/numRefs'
import { stripUndefined } from './firestoreCore'
import { logChangeOrThrow } from './changeHistory'

// ─── 錯誤型別 ────────────────────────────────────────────────────────────────

/**
 * 安全閘擋下的刪除。**在動任何資料之前拋出**，所以拋了就代表資料庫毫髮無傷。
 */
export class CascadeBlockedError extends Error {
  // 明寫欄位而非建構子參數屬性：專案啟用 erasableSyntaxOnly（型別語法必須可直接抹除）
  readonly blockers: CascadeBlocker[]

  constructor(blockers: CascadeBlocker[]) {
    super(`刪除已中止：${blockers.map((b) => b.detail).join('；')}`)
    this.name = 'CascadeBlockedError'
    this.blockers = blockers
  }
}

/**
 * log 已寫入、但資料 batch 提交失敗。
 *
 * 這是唯一會留下不一致的失敗模式：有一筆 delete log，但目標其實還在。
 * 資料本身是完整的（batch 原子失敗 = 全部沒寫），故**不需要修資料**，
 * 只是歷史頁會多一筆與事實不符的記錄。訊息帶出 logId 供人工核對。
 */
export class CascadeCommitError extends Error {
  readonly logId: string

  constructor(logId: string, cause: unknown) {
    super(
      `變更記錄已寫入（log ${logId}）但資料提交失敗，資料未被改動。` +
      `該筆 log 與實際狀態不符，請人工核對：${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'CascadeCommitError'
    this.cause = cause
    this.logId = logId
  }
}

// ─── 計畫階段 ────────────────────────────────────────────────────────────────

export interface CascadePlanResult {
  kind: ChangeTargetKind
  /** 目標集合名，如 'buffs' */
  coll: string
  targetId: string
  targetName: string
  /** 被刪文件的當下內容（不含 id）。commit 時原樣存進快照 */
  preImage: Record<string, unknown>
  plan: CascadePlan
  /** 要存進 log 的完整快照（文件本體 + 反向修補單） */
  snapshot: DeleteSnapshot
  /** 非空表示不可提交。commitCascadeDelete 會再檢一次，不倚賴呼叫端自律 */
  blockers: CascadeBlocker[]
  /** 名稱軟引用（hasBuff）：**不自動清除**，只列給管理員自行處理 */
  softWarnings: RefHit[]
  /** 凍結時取不到值、被寫成 '?' 的 token。不阻擋，但該提示 */
  unresolvedTokens: NumRefFreezer['unresolved']
  /** 未掃描到的集合。正常路徑恆為空；非空代表載入出錯，不可當成「無引用」 */
  missingColls: string[]
}

/** 目標不存在（已被別人刪掉）→ 回傳 null，不視為錯誤。 */
export type CascadePlanOutcome = CascadePlanResult | null

/**
 * 讀取現況並算出「刪除這個實體會動到哪些地方」。**不寫入任何資料。**
 *
 * 給 D-1 對話框直接用；使用者確認後把回傳值原封不動交給 commitCascadeDelete。
 */
export async function planCascadeDelete(
  kind: ChangeTargetKind,
  id: string,
): Promise<CascadePlanOutcome> {
  const coll = TARGET_COLLECTION[kind]

  // pre-image 兼三個用途：確認目標存在、供快照存檔、buff 的凍結取值來源
  const snap = await getDocFromServer(doc(db, coll, id))
  if (!snap.exists()) return null                     // 已不存在 → 靜默跳過（C-5 契約）
  const preImageWithId = snap.data() as Record<string, unknown>

  // snap.data() 本來就不含 id（它在 snap.id），此處 shallow copy 只為取得可變物件
  const preImage: Record<string, unknown> = { ...preImageWithId }
  const targetName = typeof preImage.name === 'string' ? preImage.name : id

  const data = await loadScanData()

  const refs = findReferences(kind, id, data, { name: targetName })

  // 只有 BUFF 刪除會產生 textFreeze 命中（NUM_ATTRS 的 refTypes 皆為 ['buff']）。
  // 其他 kind 不給凍結器；萬一日後 registry 擴充而真的產生了 textFreeze，
  // buildCascadePlan 會拋錯提醒，不會靜默略過——這是刻意的失敗模式。
  const freezer = kind === 'buff'
    ? createNumRefFreezer(id, preImage as NumRefSource)
    : undefined

  const plan = buildCascadePlan(refs.hits, data, { freezeText: freezer?.freezeText })
  const snapshot: DeleteSnapshot = { doc: preImage, patches: plan.patches }

  const blockers = checkCascadeSafety(plan, snapshot)

  // PLAN-043：硬外鍵擋門。這類引用（前置背包鏈 / 複合武器融合來源）刻意不進 plan，
  // 所以 checkCascadeSafety 看不到它們——必須在這裡自己建 blocker，否則等於放行。
  if (refs.hardRefs.length) {
    const sample = refs.hardRefs.slice(0, 5).map((h) => `${h.docName || h.docId}（${h.origin}）`)
    const more = refs.hardRefs.length > 5 ? ` 等 ${refs.hardRefs.length} 處` : ''
    blockers.push({
      kind: 'hardRef',
      detail: `仍被以下項目引用，請先解除關聯再刪除：${sample.join('、')}${more}`,
      refs: refs.hardRefs.map((h) => ({ coll: h.coll, docId: h.docId, docName: h.docName, origin: h.origin })),
    })
  }

  // 掃描不完整時不可放行：可能有沒掃到的引用，刪了就是斷鏈且修補單也沒記
  if (refs.missingColls.length) {
    blockers.push({
      kind: 'problems',
      detail: `以下集合未載入，無法確認是否有引用：${refs.missingColls.join('、')}`,
      problems: [],
    })
  }

  return {
    kind, coll, targetId: id, targetName, preImage, plan, snapshot, blockers,
    softWarnings: refs.softWarnings,
    unresolvedTokens: freezer?.unresolved ?? [],
    missingColls: refs.missingColls,
  }
}

/**
 * 重讀全部掃描集合。任何一個失敗都會讓 Promise.all 拒絕——寧可整個中止也不要掃一半。
 *
 * **必須用 getDocsFromServer 而非 getDocs。** 正式環境啟用了 persistentLocalCache
 * （firebase.ts:63-70，跨 session 的 IndexedDB 快取），而預設來源的 getDocs 在伺服器
 * 不可達時會**靜默改用本機快取並正常 resolve**，不拋錯也不外露任何旗標。
 * 那會讓這裡拿到好幾天前的世界快照，於是：
 *   · 這段期間新增的引用掃不到 → 刪完留下斷鏈，且修補單也沒記，Phase F 救不回；
 *   · 整欄改寫用陳舊內容寫回去 → 把這段期間別人對該欄位的編輯一次洗掉。
 * 正是本檔開頭「要確定掃得全，就得對全部集合讀新的」要防的事，只是快取層換成了 SDK 自己那層。
 * FromServer 版在伺服器不可達時直接拒絕，失敗發生在寫任何東西之前，是最安全的失敗點。
 */
async function loadScanData(): Promise<RefScanData> {
  const entries = await Promise.all(
    ALL_SCAN_COLLECTIONS.map(async (name) => {
      const snap = await getDocsFromServer(collection(db, name))
      return [name, snap.docs.map((d) => ({ ...d.data(), id: d.id }))] as const
    }),
  )
  return Object.fromEntries(entries) as RefScanData
}

// ─── 提交階段 ────────────────────────────────────────────────────────────────

export interface CascadeDeleteResult {
  /** 剛寫入的 changeHistory 文件 ID（Phase F 還原時的來源） */
  logId: string
  targetId: string
  targetName: string
  /** 被改寫的引用來源文件數 */
  patchedDocs: number
  /** 被移除的引用處數 */
  patchCount: number
  /** 受影響集合 → 新版本號（含目標集合自己）。 */
  versions: Record<string, string>
  /**
   * 目標集合內「目標以外」是否也有文件被級聯改寫。
   *
   * · false → 呼叫端可用 `removeCollectionItem(coll, targetId, version)` 就地移除，省一次重抓。
   * · true  → **removeCollectionItem 不夠用**，必須整包失效重抓。
   *
   * 為什麼：`removeCollectionItem` 只把目標 id 從記憶體陣列 filter 掉，然後把該陣列
   * 連同新版本號寫進 localStorage。若同集合的兄弟文件在伺服器端也被改寫了
   * （刪 BUFF 時另一個 BUFF 的 descriptionRefs 指向它、詞條互指…），
   * 那些文件在記憶體裡仍是舊內容，卻被貼上與伺服器相同的新版本號 →
   * 下次 readCache 版本相符即命中，**該 client 的快取從此恆命中且永不自癒**，
   * 而其他 client 讀到的是正確資料，只有他自己壞掉。
   */
  targetCollHasSiblingEdits: boolean
}

/**
 * 實際執行刪除：先寫 log，再以單一 WriteBatch 原子提交所有資料變更。
 *
 * @param planned planCascadeDelete 的回傳值。**不會重新掃描** —— 若對話框停留很久，
 *                期間的資料變動不會被看見。刪除是低頻操作，重掃的成本與複雜度
 *                （要再跑一次安全閘、可能結果與使用者剛才看到的不同）不划算。
 */
export async function commitCascadeDelete(
  planned: CascadePlanResult,
): Promise<CascadeDeleteResult> {
  const { kind, coll, targetId, targetName, plan, snapshot } = planned

  // 不倚賴呼叫端有沒有看 blockers —— 這裡是最後一道，且在任何寫入之前。
  //
  // 兩個來源都要：
  //  · 重跑 checkCascadeSafety —— 抓「呼叫端在 plan 之後竄改了 plan/snapshot」；
  //  · 併入 planned.blockers —— plan 端對 missingColls 追加的 blocker（見
  //    planCascadeDelete）不在 plan.problems 裡，checkCascadeSafety 從 plan 重建不出來。
  //    漏掉就等於「帶著掃描不完整的計畫照樣提交」，違反 CascadePlanResult.blockers 契約。
  //
  // 去重用 kind+detail 組合鍵，不可只用 kind：missingColls blocker 的 kind 也是
  // 'problems'，只比 kind 會被 checkCascadeSafety 的 problems 撞掉而漏失。commit 不
  // 重新掃描，plan 未變時重算的同類 blocker detail 相同，能正確去重。
  const rechecked = checkCascadeSafety(plan, snapshot)
  const seen = new Set(rechecked.map((b) => `${b.kind}|${b.detail}`))
  const blockers = [...rechecked, ...planned.blockers.filter((b) => !seen.has(`${b.kind}|${b.detail}`))]
  if (blockers.length) throw new CascadeBlockedError(blockers)

  // ── ① 先寫 log（決策十）。失敗直接拋，資料完全沒動 ──────────────────────
  const logId = await logChangeOrThrow({
    target: kind,
    action: 'delete',
    targetId,
    targetName,
    snapshot,
  })

  // ── ② 版本號：所有受影響集合合併成單一次 meta/gameData 寫入 ───────────────
  // 計畫書寫「對所有被觸及的集合呼叫 bumpDataVersion」，那會是 N 次寫入同一份文件。
  // 併成一次不只省寫入，更重要的是**納入同一個 batch**：若資料改了但版本沒 bump，
  // 其他 client 會繼續從 localStorage 供應已刪除的資料，直到有別的操作碰巧 bump。
  const version = new Date().toISOString()
  const touched = [...new Set([coll, ...plan.mutations.map((m) => m.coll)])]
  const versions = Object.fromEntries(touched.map((c) => [c, version]))

  // ── ③ 單一 batch：N 份 update + 1 份 delete + 1 份版本 bump ────────────────
  const batch = writeBatch(db)

  for (const m of plan.mutations) {
    // stripUndefined 只作用於 set，且必須在放入 deleteField() 之前——
    // 它會遞迴走物件，把 sentinel 拆成普通物件而失效（同 changeHistory.buildEntry 的坑）
    const payload: Record<string, unknown> = stripUndefined(m.set)
    for (const field of m.unset) payload[field] = deleteField()
    // 用 update 而非 set：文件剛剛才讀到，若此刻已不存在應該失敗而非重建成殘缺文件
    batch.update(doc(db, m.coll, m.docId), payload)
  }

  batch.delete(doc(db, coll, targetId))
  batch.set(
    doc(db, 'meta', 'gameData'),
    { versions, updatedAt: serverTimestamp() },
    { merge: true },
  )

  try {
    await batch.commit()
  } catch (err) {
    // batch 是原子的：失敗 = 一筆都沒寫。資料完整，只有 log 多了一筆不符事實的記錄
    throw new CascadeCommitError(logId, err)
  }

  return {
    logId,
    targetId,
    targetName,
    patchedDocs: plan.mutations.length,
    patchCount: plan.patches.length,
    versions,
    // findReferences 已排除目標自身，故落在目標集合的 mutation 一定是「兄弟文件」
    targetCollHasSiblingEdits: plan.mutations.some((m) => m.coll === coll),
  }
}

// ─── 便利包裝 ────────────────────────────────────────────────────────────────

/**
 * plan → commit 一次做完。目標不存在時回傳 null。
 *
 * 給不需要確認對話框的呼叫端（腳本、測試）。正式後台路徑應該分兩段走，
 * 讓使用者看過影響範圍再確認。
 */
export async function cascadeDelete(
  kind: ChangeTargetKind,
  id: string,
): Promise<CascadeDeleteResult | null> {
  const planned = await planCascadeDelete(kind, id)
  if (!planned) return null
  if (planned.blockers.length) throw new CascadeBlockedError(planned.blockers)
  return commitCascadeDelete(planned)
}

export type { CascadeBlocker, ReversePatch, ScanCollection }
