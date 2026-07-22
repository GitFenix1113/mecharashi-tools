// 快照還原的純計算層（PLAN-030 F-2）
//
// 吃刪除快照裡的 ReversePatch[]，對「當下重讀」的引用來源文件反向套用，
// 產出與 cascadePatch 同形的 DocMutation[]（I/O 層包成 WriteBatch）。
// 純函式、無 Firestore 依賴，可單測（npm test）。I/O 在 lib/api/restore.ts。
//
// ── 冪等重加（決策七）────────────────────────────────────────────────────────
// arrayRemove / mapKeyDelete / fieldClear 的還原都是「把值加回集合」：
// 只檢查「該欄位現在還缺不缺這個值」——缺就補、已有就跳過，**不比對整份文件**
// （那等於做時光機）。textFreeze 是唯一非冪等的：現值必須仍等於「凍結後」的文字
// 才能還原成 token 形式，被編輯過就跳過並報告，不可硬蓋。
//
// ── 錨點重定位（C-2 埋下的契約，這裡兌現）────────────────────────────────────
// 索引式路徑（talents.2.buffIds）不是穩定識別子：刪除與還原之間陣列可能被重排。
// 規則是「先按 index 找、對不上則按 anchor 重新定位」——anchor 錨定的是
// segments 中**最後一個數字索引**指向的元素（talents[2] 的 name / levels[j] 的
// level / ndVariants[k] 的 minSum，與 entityRefs 產生端一致）。
// 找不到或有多個同錨元素時跳過並報告，絕不寫到錯的地方。

import type { ReversePatch } from '../types/changeHistory'
import { DocDraft, isContainer, type DocMutation } from './cascadePatch.ts'

// ─── 對外型別 ────────────────────────────────────────────────────────────────

export type RestoreSkipReason =
  /** 引用來源文件已不存在（如整個機師被刪）→ 跳過並報告 */
  | 'docMissing'
  /** segments 指的路徑已不存在（欄位被整個移除） */
  | 'pathMissing'
  /** 路徑存在但形狀不對（預期陣列卻是純量等） */
  | 'shapeMismatch'
  /** 索引與錨點都定位不到（元素被刪 / 改名 / 同錨多個） */
  | 'anchorMismatch'
  /** 位置上已有**不同的**值（期間被編輯過）→ 不硬蓋 */
  | 'conflict'
  /** 修補單本身缺欄位（舊格式 log 無 segments 等），無法安全定位 */
  | 'badPatch'

export interface RestoreSkip {
  patch: ReversePatch
  reason: RestoreSkipReason
  detail: string
}

export interface RestorePlan {
  /** 要寫回的引用來源文件（與 cascadePatch.DocMutation 同形，unset 恆為空） */
  mutations: DocMutation[]
  /** 實際重加的修補單 */
  applied: ReversePatch[]
  /** 值已在原位、無需重加（冪等命中）。屬成功語意，與 skipped 分開報告 */
  alreadyPresent: ReversePatch[]
  /** 無法套用的修補單與原因。**不阻擋其餘修補單**——還原是盡力而為 + 誠實報告 */
  skipped: RestoreSkip[]
  /** mutations.length + 1（目標文件本身的 setDoc）。I/O 層據此擋 batch 500 上限 */
  writeCount: number
}

/** 還原端的資料形狀：只需給「修補單有指到」的集合／文件，缺者記為 docMissing。 */
export type RestoreScanData = Record<string, ({ id: string } & Record<string, unknown>)[]>

// ─── 內部小工具 ──────────────────────────────────────────────────────────────

const pathOf = (segments: (string | number)[]): string => segments.join('.')

/** 值相等：primitive 用嚴格相等，物件退回 JSON 比對（EntityRef 等小物件，夠用）。 */
const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || (
    typeof a === 'object' && a !== null && typeof b === 'object' && b !== null &&
    JSON.stringify(a) === JSON.stringify(b)
  )

const ANCHOR_FIELD = { name: 'name', level: 'level', minSum: 'minSum' } as const

type Located = { segments: (string | number)[] } | { reason: RestoreSkipReason; detail: string }

/**
 * 錨點重定位：回傳修正後的 segments（read-only 走訪原文件，不做 COW）。
 *
 * 只校正**最後一個數字索引**——那正是 anchor 錨定的元素（見檔頭）。外層索引
 * （neuralDrive[i]）沒有自己的錨，維持原樣；套用階段的形狀檢查會攔下斷路。
 */
function relocate(root: Record<string, unknown>, patch: ReversePatch): Located {
  const segments = patch.segments
  const anchor = patch.anchor
  const lastIdx = segments.reduce<number>((acc, s, i) => (typeof s === 'number' ? i : acc), -1)
  if (!anchor || lastIdx === -1) return { segments }

  let cur: unknown = root
  for (const seg of segments.slice(0, lastIdx)) {
    if (!isContainer(cur)) return { segments }        // 斷路交給套用階段回報 pathMissing
    cur = cur[seg]
  }
  if (!Array.isArray(cur)) return { segments }

  const field = ANCHOR_FIELD[anchor.by]
  const matches = (el: unknown) => isContainer(el) && el[field] === anchor.value

  if (matches(cur[segments[lastIdx] as number])) return { segments }   // index 仍正確

  const found = cur.flatMap((el, i) => (matches(el) ? [i] : []))
  if (found.length === 1) {
    const fixed = [...segments]
    fixed[lastIdx] = found[0]
    return { segments: fixed }
  }
  return {
    reason: 'anchorMismatch',
    detail: found.length === 0
      ? `${pathOf(segments)}：index 已失效，且找不到 ${field}=${String(anchor.value)} 的元素`
      : `${pathOf(segments)}：有 ${found.length} 個 ${field}=${String(anchor.value)} 的元素，無法唯一定位`,
  }
}

// ─── 單筆套用 ────────────────────────────────────────────────────────────────

type ApplyOutcome =
  | { status: 'applied'; topField: string }
  | { status: 'alreadyPresent' }
  | { status: 'skip'; reason: RestoreSkipReason; detail: string }

function applyPatch(
  draft: DocDraft,
  patch: ReversePatch,
  freezeText?: (originalText: string) => string,
): ApplyOutcome {
  // 防禦舊格式：讀 Firestore 回來的舊快照無型別保障（types/changeHistory 明言）
  if (!Array.isArray(patch.segments) || patch.segments.length === 0) {
    return { status: 'skip', reason: 'badPatch', detail: `修補單缺 segments（path=${patch.path ?? '?'}），無法安全定位` }
  }

  const located = relocate(draft.root, patch)
  if ('reason' in located) return { status: 'skip', ...located }
  const segments = located.segments
  const topField = String(segments[0])
  const skip = (reason: RestoreSkipReason, detail: string): ApplyOutcome => ({ status: 'skip', reason, detail })

  if (patch.op === 'arrayRemove') {
    // C-2 已把 arrayRemove 的 segments 正規化為「陣列本身」
    const node = draft.node(segments)
    if (node === undefined) return skip('pathMissing', `路徑不存在：${pathOf(segments)}`)
    if (!Array.isArray(node)) return skip('shapeMismatch', `${pathOf(segments)} 不是陣列`)
    if (node.some((el) => sameValue(el, patch.value))) return { status: 'alreadyPresent' }
    node.push(patch.value)                             // 原始索引已失去意義，加回尾端
    return { status: 'applied', topField }
  }

  if (patch.op === 'mapKeyDelete' || patch.op === 'fieldClear') {
    const res = draft.container(segments)
    if (!res) return skip('pathMissing', `路徑不存在：${pathOf(segments)}`)
    if (Array.isArray(res.parent)) return skip('shapeMismatch', `${pathOf(segments)} 的父層是陣列，不可 ${patch.op}`)
    const current = res.parent[res.key]
    if (current !== undefined) {
      return sameValue(current, patch.value)
        ? { status: 'alreadyPresent' }
        : skip('conflict', `${pathOf(segments)} 已有不同的值，不覆蓋`)
    }
    res.parent[res.key] = patch.value
    return { status: 'applied', topField }
  }

  // textFreeze：value 存「凍結前」的原始文字（含 token）
  const original = patch.value
  if (typeof original !== 'string') {
    return skip('badPatch', `textFreeze 的 value 不是字串：${pathOf(segments)}`)
  }
  const res = draft.container(segments)
  if (!res) return skip('pathMissing', `路徑不存在：${pathOf(segments)}`)
  const current = res.parent[res.key]
  if (typeof current !== 'string') return skip('shapeMismatch', `${pathOf(segments)} 不是字串`)
  if (current === original) return { status: 'alreadyPresent' }
  if (!freezeText) {
    // 比照 cascadePatch 的失敗模式：缺凍結器就拋錯，不靜默跳過——
    // 靜默會把「凍結後文字 = 現值」誤判成 conflict，還原永遠救不回這些文案
    throw new Error(
      `[restorePatch] 遇到 textFreeze 修補單（${patch.coll}/${patch.docId} ${pathOf(segments)}）` +
      '但未提供 freezeText。還原 BUFF 時必須以快照文件重建凍結器。',
    )
  }
  if (current === freezeText(original)) {
    res.parent[res.key] = original                     // 現值仍是凍結產物 → 還原成 token 形式
    return { status: 'applied', topField }
  }
  return skip('conflict', `${pathOf(segments)} 的文字在刪除後被編輯過，不覆蓋`)
}

// ─── 主函式 ──────────────────────────────────────────────────────────────────

/**
 * 把刪除快照的修補單轉成「要寫回什麼」。
 *
 * @param patches  snapshot.patches（順序即刪除當下的記錄順序）
 * @param data     引用來源文件的**當下重讀**內容。與刪除端同理：整欄改寫是
 *                 last-write-wins，餵快取會把別人剛存的修改洗掉
 * @param opts.freezeText 還原 BUFF 時必給：以快照文件重建的凍結函式
 *                 （original → frozen），用於比對 textFreeze 現值。
 *                 有 textFreeze 修補單卻未提供時**拋錯**
 */
export function buildRestorePlan(
  patches: ReversePatch[],
  data: RestoreScanData,
  opts?: { freezeText?: (originalText: string) => string },
): RestorePlan {
  const docs = new Map<string, Record<string, unknown>>()
  for (const [coll, list] of Object.entries(data)) {
    for (const d of list ?? []) docs.set(`${coll} ${d.id}`, d)
  }

  const applied: ReversePatch[] = []
  const alreadyPresent: ReversePatch[] = []
  const skipped: RestoreSkip[] = []
  const mutations: DocMutation[] = []

  // 依文件分組，保留首次出現順序（輸出可重現）
  const groups = new Map<string, ReversePatch[]>()
  for (const p of patches) {
    const key = `${p.coll} ${p.docId}`
    const g = groups.get(key)
    if (g) g.push(p)
    else groups.set(key, [p])
  }

  for (const [key, group] of groups) {
    const docData = docs.get(key)
    if (!docData) {
      for (const patch of group) {
        skipped.push({ patch, reason: 'docMissing', detail: `${patch.coll}/${patch.docId} 已不存在` })
      }
      continue
    }

    const draft = new DocDraft(docData)
    const touchedTop = new Set<string>()
    let groupApplied = 0

    for (const patch of group) {
      const outcome = applyPatch(draft, patch, opts?.freezeText)
      if (outcome.status === 'applied') {
        applied.push(patch)
        touchedTop.add(outcome.topField)
        groupApplied++
      } else if (outcome.status === 'alreadyPresent') {
        alreadyPresent.push(patch)
      } else {
        skipped.push({ patch, reason: outcome.reason, detail: outcome.detail })
      }
    }

    if (!touchedTop.size) continue
    const set: Record<string, unknown> = {}
    for (const top of touchedTop) set[top] = draft.root[top]
    mutations.push({
      coll: group[0].coll, docId: group[0].docId, docName: group[0].docId,
      set, unset: [], appliedCount: groupApplied,
    })
  }

  return { mutations, applied, alreadyPresent, skipped, writeCount: mutations.length + 1 }
}
