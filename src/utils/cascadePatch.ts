// 級聯清除的純計算層（PLAN-030 C-2）
//
// 吃 C-1 findReferences 產出的 RefHit[]，產出兩樣東西：
//   ① DocMutation[]  —— 要寫回 Firestore 的內容（C-4 包成 WriteBatch）
//   ② ReversePatch[] —— 存進刪除快照的反向修補單（Phase F 據此還原）
//
// 純函式、無 Firestore 依賴，可單測（npm test）。I/O 與原子交易在 lib/api/cascadeDelete.ts（C-4）。
//
// ── 為什麼寫入策略是「整欄改寫」而非 arrayRemove / deleteField sentinel ──────────
// Firestore 的 FieldPath **不能穿越陣列**：'talents.2.buffIds' 會被當成 map key '2'，
// 不是 talents 的第 3 個元素。而 C-1 的站點裡帶陣列索引的佔多數（talents[] / skills[] /
// neuralDrive[].levels[] / weapons.skills[] / *.levels[]），這些一律只能整欄寫回。
//
// 可以走 sentinel 的少數站點（pilotSkills.buffIds、backpacks.mainSkill.buffIds、buffs.termRef…）
// 刻意**不**特例化：混用兩套機制，Phase F 就得寫兩套逆運算，而分歧會靜默累積。
// 代價是整個頂層欄位 last-write-wins —— 刪除是低頻後台操作，且 C-4 必須用「當下重讀」
// 的文件而非 GameDataContext 快取來建 plan（見 buildCascadePlan 的 data 參數契約）。
//
// ── 兩個會靜默算錯的地方（都有對應單元測試鎖住）────────────────────────────────
// (a) 索引錯位：同一份文件的多個 hit，其 segments 是對「原始」文件算出來的。若邊套用邊
//     解析，先移除 skills[0] 會讓 skills[1] 的 descriptionRefs hit 打到錯的物件。
//     故一律**先解析完所有 hit 拿到容器參照，再統一套用**（resolve/apply 兩階段）。
// (b) arrayRemove 的 segments 有兩種形狀：buffIds 站點指向「陣列本身」（talents.0.buffIds），
//     pilots.skills[] 站點指向「陣列元素」（skills.0）。兩者都要正規化成陣列路徑，
//     否則修補單的 path 不一致，F-2 會找不到要加回哪裡。

import type { DeleteSnapshot, ReversePatch } from '../types/changeHistory'
import { ALL_SCAN_COLLECTIONS, type RefHit, type RefScanData } from './entityRefs.ts'
import { freezeNumRefs, type NumRefSource } from './numRefs.ts'

// ─── 對外型別 ────────────────────────────────────────────────────────────────

/** C-3 注入：把文案內的 <refId.lvN.attr> token 烘焙成常數。 */
export type FreezeText = (text: string, hit: RefHit) => string

/**
 * 單一引用來源文件的寫回內容。
 *
 * 刻意只列「被動到的頂層欄位」而非整份文件：既壓低寫入量，也讓未涉及的欄位
 * 不會被這次刪除的舊快照覆蓋。
 */
export interface DocMutation {
  coll: string
  docId: string
  docName: string
  /** 要覆寫的頂層欄位（值為改寫後的完整內容） */
  set: Record<string, unknown>
  /** 要整個移除的頂層欄位（C-4 轉成 deleteField()）。目前只有 buffs.termRef 會走到 */
  unset: string[]
  /** 本文件實際套用的 effect 數，供報表顯示「這份文件被改了幾處」 */
  appliedCount: number
}

export type CascadeProblemReason =
  /** 引用來源文件不在 data 裡 —— 掃描與套用之間資料變了，或呼叫端漏給集合 */
  | 'docMissing'
  /** segments 指的路徑已不存在 —— 文件在掃描後被改過 */
  | 'pathMissing'
  /** 路徑存在但形狀不對（預期陣列卻是純量等） */
  | 'shapeMismatch'
  /** 路徑與形狀都對，但要移除的值已經不在了 */
  | 'valueMissing'

export interface CascadeProblem {
  hit: RefHit
  reason: CascadeProblemReason
  detail: string
}

export interface CascadePlan {
  mutations: DocMutation[]
  /** 與實際套用的 effect 一一對應。順序即 hits 順序，可重現 */
  patches: ReversePatch[]
  /**
   * 無法套用的 hit。**非空時 C-4 必須中止整次刪除**——
   * 帶著問題硬送出 batch 會留下「文件刪了但某些引用還在」的半殘狀態，
   * 而修補單又漏了那幾處，等於還原也救不回來（決策八的正確性前提）。
   */
  problems: CascadeProblem[]
  /** 被去重掉的 hit 數（同一陣列同一值重複出現）。僅供報表，非錯誤 */
  deduped: number
  /** mutations.length + 1（目標本身的 deleteDoc）。C-4 據此擋 batch 500 上限 */
  writeCount: number
}

// ─── 數值 token 凍結器（C-3）─────────────────────────────────────────────────

export interface NumRefFreezer {
  /** 餵給 buildCascadePlan 的 opts.freezeText */
  freezeText: FreezeText
  /**
   * 取不到值、被寫成 '?' 的 token。**不中止刪除**（這類 token 在刪除前就已顯示為 '?'），
   * 但 C-4/D-1 應把它列給管理員——那代表有文案永久失去了數值。
   */
  unresolved: { hit: RefHit; token: string }[]
}

/**
 * 建立凍結器。趁被刪實體還在，把指向它的數值 token 烘焙成常數。
 *
 * **目前只有 buff 刪除會用到**：NUM_ATTRS 每一筆的 refTypes 都是 ['buff']，而
 * findReferences 產生 numTokenText 命中前會比對 refTypes，故刪除技能／詞條不會有
 * textFreeze 命中。日後若新增 refTypes 含 'skill' 的屬性（registry 註解已預留 cd），
 * 技能刪除就會開始產生 textFreeze——屆時 buildCascadePlan 會**拋錯**提醒補上凍結器，
 * 不會靜默略過。這是刻意設計的失敗模式。
 *
 * @param targetId 即將被刪的實體 ID
 * @param source   該實體本身（GameBuff 結構相容 NumRefSource）。查無傳 undefined
 */
export function createNumRefFreezer(
  targetId: string,
  source: NumRefSource | undefined,
): NumRefFreezer {
  const unresolved: NumRefFreezer['unresolved'] = []
  return {
    unresolved,
    freezeText: (text, hit) => {
      const r = freezeNumRefs(text, targetId, source)
      for (const token of r.unresolved) unresolved.push({ hit, token })
      return r.text
    },
  }
}

// ─── 內部小工具 ──────────────────────────────────────────────────────────────

// Container / isContainer / DocDraft 同時供 restorePatch.ts（F-2）使用——
// 刪除與還原必須共用同一套走訪與 copy-on-write 語意，否則逆運算會靜默偏移。
export type Container = Record<PropertyKey, unknown>

const pathOf = (segments: (string | number)[]): string => segments.join('.')

export const isContainer = (v: unknown): v is Container =>
  typeof v === 'object' && v !== null

const shallowCopy = (v: Container): Container =>
  (Array.isArray(v) ? [...v] : { ...v }) as Container

/**
 * 值相等（比照 Firestore arrayRemove 的真實語意）。
 *
 * ⚠ 這裡**不能**用 `===`（PLAN-032 實測踩過）。原本的參照相等有兩層問題：
 *   (a) Firestore 的 arrayRemove 對 map 型元素本來就是**深層相等**，`===` 是偏離語意；
 *   (b) 更致命的是 DocDraft 的 copy-on-write：`resolveHit` 為了取容器會先
 *       `draft.node(segments)` 走訪到元素本身，沿途把該元素換成私有副本，
 *       於是 `arr[i]` 早已不是 hit.value 的同一個參照 —— 恆 0 命中、恆報 valueMissing。
 *
 * 只有字串元素的站點（buffIds / termRef / pilots.skills[]）感覺不到差別，
 * 所以這個洞在 PLAN-032 加入第一個**物件型**元素站點（weapons.skills[].skillId，
 * 元素是 `{ skillId, activation }`）之前一直沒被觸發：症狀是「刪技能時掃描器找得到引用、
 * 卻在套用階段全部失敗」，而不是靜默錯誤——但一樣讓級聯刪除完全不能用。
 *
 * map 比對 key 集合 + 逐值遞迴（順序無關）；陣列逐元素遞迴（順序有關）。與 Firestore 一致。
 */
function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valueEquals(x, b[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every(k =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    valueEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** 移除陣列中所有等於 value 的元素，回傳移除筆數（比照 Firestore arrayRemove 語意）。 */
function removeAll(arr: unknown[], value: unknown): number {
  let n = 0
  for (let i = arr.length - 1; i >= 0; i--) {
    if (valueEquals(arr[i], value)) {
      arr.splice(i, 1)
      n++
    }
  }
  return n
}

/**
 * 單一文件的改寫草稿，採 copy-on-write。
 *
 * 只複製被走訪到的路徑，其餘節點與原文件共用參照 —— 因此
 *   · 不會動到呼叫端的輸入資料（findReferences 的 K2 契約延伸到這裡）；
 *   · 不需要 structuredClone 整份文件，也就不會把 Timestamp 之類的類別實例拆壞。
 */
export class DocDraft {
  readonly root: Container
  /** 已經是本草稿私有副本的節點。避免同一節點被重複複製而丟失前一次的修改 */
  private readonly copied = new Set<object>()

  constructor(doc: Container) {
    this.root = shallowCopy(doc)
    this.copied.add(this.root)
  }

  /**
   * 走到 segments 指向的節點，沿途（含該節點）copy-on-write。
   * 回傳 undefined 表示中途斷路。純量葉值原樣回傳、不複製。
   */
  node(segments: (string | number)[]): unknown {
    let cur: unknown = this.root
    for (const seg of segments) {
      if (!isContainer(cur)) return undefined
      const child = cur[seg]
      if (isContainer(child) && !this.copied.has(child)) {
        const copy = shallowCopy(child)
        this.copied.add(copy)
        cur[seg] = copy
        cur = copy
      } else {
        cur = child
      }
    }
    return cur
  }

  /** 走到 segments 的父容器（沿途 COW），回傳 { parent, key }。 */
  container(segments: (string | number)[]): { parent: Container; key: string | number } | null {
    const parent = this.node(segments.slice(0, -1))
    if (!isContainer(parent)) return null
    return { parent, key: segments[segments.length - 1] }
  }
}

/**
 * 解析完成、等待套用的一次改動。
 *
 * parent / arr 持有的是 DocDraft 內真實物件的**參照**，因此後續任何陣列增刪
 * 都不會讓它指錯對象——這正是地雷 (a) 的解法。
 */
type Effect =
  | { kind: 'removeFromArray'; arr: unknown[]; value: unknown }
  | { kind: 'deleteKey';       parent: Container; key: string | number }
  | { kind: 'setKey';          parent: Container; key: string | number; value: unknown }

interface Resolved {
  hit: RefHit
  /** 正規化後的權威路徑（arrayRemove 一律指向陣列本身，見地雷 b） */
  segments: (string | number)[]
  effect: Effect
  /** 寫進 ReversePatch 的值 */
  patchValue: unknown
}

function indexDocs(data: RefScanData): Map<string, Container> {
  const out = new Map<string, Container>()
  for (const coll of ALL_SCAN_COLLECTIONS) {
    const docs = data[coll] as ({ id: string } & Container)[] | undefined
    if (!docs) continue
    for (const d of docs) out.set(`${coll} ${d.id}`, d)
  }
  return out
}

// ─── 解析單一 hit ────────────────────────────────────────────────────────────

type ResolveOutcome = Resolved | { problem: CascadeProblemReason; detail: string }

const fail = (problem: CascadeProblemReason, detail: string) => ({ problem, detail })

function resolveHit(draft: DocDraft, hit: RefHit, freezeText?: FreezeText): ResolveOutcome {
  const { segments, op } = hit

  if (op === 'arrayRemove') {
    // 地雷 b：兩種形狀都要吃。先看 segments 本身是不是陣列（buffIds 站點），
    // 不是的話再看父層（pilots.skills[] 站點指向元素）。用「實際型別」判斷而非
    // 「最後一段是不是數字」——後者是命名慣例，前者是資料事實。
    const node = draft.node(segments)
    if (Array.isArray(node)) {
      return { hit, segments, effect: { kind: 'removeFromArray', arr: node, value: hit.value }, patchValue: hit.value }
    }
    const parentSegs = segments.slice(0, -1)
    const parent = draft.node(parentSegs)
    if (Array.isArray(parent)) {
      return { hit, segments: parentSegs, effect: { kind: 'removeFromArray', arr: parent, value: hit.value }, patchValue: hit.value }
    }
    if (node === undefined && parent === undefined) return fail('pathMissing', `路徑不存在：${pathOf(segments)}`)
    return fail('shapeMismatch', `${pathOf(segments)} 及其父層皆非陣列`)
  }

  if (op === 'mapKeyDelete' || op === 'fieldClear') {
    const res = draft.container(segments)
    if (!res) return fail('pathMissing', `路徑不存在：${pathOf(segments)}`)
    if (Array.isArray(res.parent)) return fail('shapeMismatch', `${pathOf(segments)} 的父層是陣列，不可 ${op}`)
    if (!(res.key in res.parent)) return fail('valueMissing', `${pathOf(segments)} 已不存在`)
    return { hit, segments, effect: { kind: 'deleteKey', ...res }, patchValue: hit.value }
  }

  // textFreeze（C-3）
  if (!freezeText) {
    // 刻意拋錯而非略過：略過會讓 token 指向已刪除的實體、且修補單也沒記，
    // 是「靜默壞掉又救不回」的組合。C-3 接上後這條路徑消失。
    throw new Error(
      `[cascadePatch] 遇到 textFreeze 引用（${hit.coll}/${hit.docId} ${pathOf(hit.segments)}）但未提供 freezeText。` +
      ' 這是 PLAN-030 C-3 的職責，未接上前不得執行含數值 token 的刪除。',
    )
  }
  const res = draft.container(segments)
  if (!res) return fail('pathMissing', `路徑不存在：${pathOf(segments)}`)
  const current = res.parent[res.key]
  if (typeof current !== 'string') return fail('shapeMismatch', `${pathOf(segments)} 不是字串`)
  // patchValue 存「凍結前」的原文（= hit.value），不是現值——還原要回到 token 形式
  return { hit, segments, effect: { kind: 'setKey', ...res, value: freezeText(current, hit) }, patchValue: hit.value }
}

// ─── 主函式 ──────────────────────────────────────────────────────────────────

/**
 * 把 findReferences 的 hits 轉成「要寫回什麼」＋「反向修補單」。
 *
 * @param hits findReferences 回傳的 hits（**不含** softWarnings —— 名稱軟引用不自動清除）
 * @param data 引用來源文件。C-4 應餵「當下重讀」的資料而非 GameDataContext 快取：
 *             整欄改寫是 last-write-wins，用陳舊快取會把別人剛存的修改洗掉
 * @param opts.freezeText C-3 的凍結函式。hits 含 textFreeze 卻未提供時**拋錯**
 */
export function buildCascadePlan(
  hits: RefHit[],
  data: RefScanData,
  opts?: { freezeText?: FreezeText },
): CascadePlan {
  const docs = indexDocs(data)
  const problems: CascadeProblem[] = []
  const patches: ReversePatch[] = []
  let deduped = 0

  // 依文件分組，保留首次出現順序（輸出可重現，測試才能 deepEqual）
  const groups = new Map<string, { coll: string; docId: string; docName: string; hits: RefHit[] }>()
  for (const hit of hits) {
    const key = `${hit.coll} ${hit.docId}`
    const g = groups.get(key)
    if (g) g.hits.push(hit)
    else groups.set(key, { coll: hit.coll, docId: hit.docId, docName: hit.docName, hits: [hit] })
  }

  const mutations: DocMutation[] = []

  for (const [key, group] of groups) {
    const doc = docs.get(key)
    if (!doc) {
      for (const hit of group.hits) {
        problems.push({ hit, reason: 'docMissing', detail: `${group.coll}/${group.docId} 不在提供的資料中` })
      }
      continue
    }

    const draft = new DocDraft(doc)

    // ── 階段一：全部解析完，只做 COW 與參照擷取，不改任何值（地雷 a）──────────
    const resolved: Resolved[] = []
    const seen = new Set<string>()
    for (const hit of group.hits) {
      const outcome = resolveHit(draft, hit, opts?.freezeText)
      if ('problem' in outcome) {
        problems.push({ hit, reason: outcome.problem, detail: outcome.detail })
        continue
      }
      // 去重：同一陣列同一值只需移除一次（arrayRemove 移除所有相等元素）。
      // 不去重的話第二筆會回報 valueMissing 假問題，textFreeze 更會把「已凍結」的字串再凍一次。
      const dedupKey = `${outcome.effect.kind}|${pathOf(outcome.segments)}|${JSON.stringify(outcome.patchValue) ?? 'undefined'}`
      if (seen.has(dedupKey)) { deduped++; continue }
      seen.add(dedupKey)
      resolved.push(outcome)
    }

    // ── 階段二：套用。容器參照已擷取，陣列增刪造成的索引位移不影響其他 effect ──
    const applied: Resolved[] = []
    for (const r of resolved) {
      const e = r.effect
      if (e.kind === 'removeFromArray') {
        if (removeAll(e.arr, e.value) === 0) {
          // 物件型元素用 String() 會印成 [object Object]，對排錯毫無幫助
          const shown = typeof e.value === 'object' && e.value !== null ? JSON.stringify(e.value) : String(e.value)
          problems.push({ hit: r.hit, reason: 'valueMissing', detail: `${pathOf(r.segments)} 中找不到 ${shown}` })
          continue
        }
      } else if (e.kind === 'deleteKey') {
        delete e.parent[e.key]
      } else {
        e.parent[e.key] = e.value
      }
      applied.push(r)
    }

    if (!applied.length) continue

    // ── 收攏成頂層欄位。segments[0] 必為頂層欄位名（每個 hit 至少帶一段）──────
    const set: Record<string, unknown> = {}
    const unset: string[] = []
    for (const top of new Set(applied.map((r) => String(r.segments[0])))) {
      if (Object.prototype.hasOwnProperty.call(draft.root, top)) set[top] = draft.root[top]
      else unset.push(top)
    }

    mutations.push({ coll: group.coll, docId: group.docId, docName: group.docName, set, unset, appliedCount: applied.length })
    for (const r of applied) {
      patches.push({
        coll: group.coll, docId: group.docId,
        // segments 是權威形式、path 只供顯示。兩者都存：F-2 用 segments 定位，
        // 快照檢視頁（E-3）直接印 path，免得每次都要 join
        segments: r.segments, path: pathOf(r.segments),
        op: r.hit.op, value: r.patchValue,
        ...(r.hit.anchor ? { anchor: r.hit.anchor } : {}),
      })
    }
  }

  return { mutations, patches, problems, deduped, writeCount: mutations.length + 1 }
}

// ─── 送出前的安全閘（C-4 的純函式部分）──────────────────────────────────────

/** Firestore WriteBatch 的操作硬上限。 */
export const FIRESTORE_BATCH_LIMIT = 500

/**
 * 除了 plan.writeCount（N 份 update + 1 份 deleteDoc）之外，batch 還會多帶的操作數：
 * meta/gameData 的版本 bump 合併成單一次寫入（見 cascadeDelete 的說明）。
 */
export const BATCH_OVERHEAD_OPS = 1

/** Firestore 單一文件大小上限 1 MiB。留 ~15% 餘裕給欄位名與型別編碼開銷。 */
export const FIRESTORE_DOC_LIMIT_BYTES = 1_048_576
export const SNAPSHOT_SIZE_BUDGET_BYTES = 900_000

export type CascadeBlocker =
  | { kind: 'problems'; detail: string; problems: CascadeProblem[] }
  | { kind: 'batchLimit'; detail: string; ops: number; limit: number }
  | { kind: 'snapshotSize'; detail: string; bytes: number; limit: number }
  /**
   * PLAN-043：目標被「不可機械清除」的硬外鍵引用著（前置背包鏈 / 複合武器融合來源）。
   *
   * 不由 checkCascadeSafety 產生 —— 它只看 plan，而硬外鍵刻意不進 plan（進了就會被
   * 自動清成 null）。改由 planCascadeDelete 從 findReferences 的 hardRefs 直接建立。
   */
  | { kind: 'hardRef'; detail: string; refs: { coll: string; docId: string; docName: string; origin: string }[] }

/**
 * 送出前的三道閘。回傳非空 = **必須中止整次刪除**，不可只跳過有問題的部分。
 *
 * 為什麼三道都是「中止」而非「截斷後照做」：
 *  · problems     —— 帶著問題送出會留下「文件刪了但某些引用還在」，而修補單又漏記那幾處，
 *                    等於還原也救不回來。半殘狀態比不做級聯更糟（決策八）。
 *  · batchLimit   —— Firestore 超過 500 直接整批拒絕。自行分批會失去原子性，
 *                    正是決策八要避免的；靜默截斷則會漏清。
 *  · snapshotSize —— 快照塞不進單一文件時 log 寫入會失敗。因為 log 排在 batch 之前，
 *                    這裡擋下等於「還沒動任何資料就中止」，是最安全的失敗點。
 *
 * @param snapshot 省略則跳過大小檢查（例如只想預覽影響範圍時）
 */
export function checkCascadeSafety(plan: CascadePlan, snapshot?: DeleteSnapshot): CascadeBlocker[] {
  const blockers: CascadeBlocker[] = []

  if (plan.problems.length) {
    const sample = plan.problems.slice(0, 3).map((p) => `${p.reason}@${p.hit.coll}/${p.hit.docId}:${p.hit.path}`)
    blockers.push({
      kind: 'problems',
      detail: `有 ${plan.problems.length} 處引用無法套用（資料在掃描後被改動？）：${sample.join('、')}`,
      problems: plan.problems,
    })
  }

  const ops = plan.writeCount + BATCH_OVERHEAD_OPS
  if (ops > FIRESTORE_BATCH_LIMIT) {
    blockers.push({
      kind: 'batchLimit',
      detail: `本次刪除需 ${ops} 個寫入操作，超過 Firestore 單一 batch 上限 ${FIRESTORE_BATCH_LIMIT}`,
      ops,
      limit: FIRESTORE_BATCH_LIMIT,
    })
  }

  if (snapshot) {
    // JSON 位元組數是保守估計：JSON 的引號與逗號開銷高於 Firestore 實際編碼，
    // 故此處偏大、不會低估。用 TextEncoder 取 UTF-8 真實長度（中文 1 字 3 bytes）
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length
    if (bytes > SNAPSHOT_SIZE_BUDGET_BYTES) {
      blockers.push({
        kind: 'snapshotSize',
        detail: `還原快照約 ${Math.round(bytes / 1024)} KB，超過單筆 log 的安全上限 ${Math.round(SNAPSHOT_SIZE_BUDGET_BYTES / 1024)} KB`,
        bytes,
        limit: SNAPSHOT_SIZE_BUDGET_BYTES,
      })
    }
  }

  return blockers
}
