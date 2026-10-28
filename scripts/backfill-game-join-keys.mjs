#!/usr/bin/env node
/**
 * PLAN-065-A B-3：遊戲身分鍵（gameRef）回填——對照建議檔 → 與站上現值比對 → 報告（＋ --write 寫入）。
 *
 * 本腳本**只負責寫入**：「站上哪一筆對到遊戲設定表哪一筆」由私有 repo（mecharashi-sim/pipeline）
 * 讀本機資料包算好，輸出成 gameref-proposals.json。這裡不知道、也不記載對照怎麼算；
 * 建議檔每筆的分類（唯一／等價／待確認／找不到／不需要）原樣照用。
 *
 * ── 例行流程（站長照抄；不需要開發者）──────────────────────────────────────────
 *   ① 私有 repo 產生建議檔（預設輸出 E:/Github/mecharashi-sim/pipeline/out/gameref-proposals.json）
 *   ② node scripts/backfill-game-join-keys.mjs
 *      預設 dry-run：唯讀讀正式庫、只出報告，不寫任何東西。
 *   ③ 打開報告 _local-notes/<YYYY-MM>/<YYYY-MM-DD>_遊戲身分鍵回填_dry-run.html，照「下一步」清單做（✅ 已完成、⬜ 待處理）。
 *      待確認的逐筆看過，同意的把「集合/文件 ID」寫進 accept 檔（報告底下有現成樣板）。
 *   ④ 第一次寫入前：確認含 PLAN-065-A B-5 的後台已部署（GitHub Actions 的 pages-build-deployment 綠燈）。
 *      新後台存檔時會帶伺服器上的 gameRef；舊後台是整份覆寫，寫入後一存檔就會把 gameRef 蓋掉。
 *   ⑤ 寫入：node scripts/backfill-game-join-keys.mjs --write --accept <accept 檔> [--accept-equivalent]
 *   ⑥ 等約 1 分鐘（Worker 版本快取）後，請管理者重新整理後台分頁，畫面上的「遊戲 ID」才會更新。
 *   ⑦ 重跑 ②，確認清單全 ✅（萬一有 gameRef 被蓋掉，會重新列為「寫入」，再 --write 一次即可）。
 *   建議檔格式不對、統計對不上 → 交給開發者修私有 pipeline（--write 會拒絕執行，不會默默寫進半套資料）。
 *
 * ── 參數 ──────────────────────────────────────────────────────────────
 *   --proposals <檔>      建議檔（schema gameref-proposals/v1；預設見 DEFAULT_PROPOSALS）
 *   --accept <檔>          待確認（needsConfirm）中站長同意的條目：{"accept":["pilots/pilot_049_海莉絲", ...]}
 *   --accept-equivalent   等價記錄（equivalent）一律取建議檔的代表記錄寫入——C14 裁決接受後才加
 *   --write               寫入：寫入前複查 → 備份將被改的文件 → 只 update gameRef 一個欄位 → bump 有變動的集合版本
 *   --from-backup <dir>   不連 Firestore，改讀本機備份（_local-notes/db-backup-*）：離線試跑，不能和 --write 一起用
 *   --rollback <dir>      依 --write 留下的備份夾把 gameRef 還原成寫入前的值（預設只預覽；加 --write 才執行）
 *
 * ── 寫入規則 ────────────────────────────────────────────────────────────
 *   unique → 寫；equivalent → 只有 --accept-equivalent 才寫；needsConfirm → 只有列在 accept 檔才寫；
 *   unmatched／notApplicable → 不寫，只列報告。
 *   站上已是相同 gameRef → 略過（所以寫過的條目重跑時不必再帶 accept）；站上已有不同的 → 衝突，不寫、不覆蓋；
 *   站上找不到文件 → 列報告。陣列（技能候選 ID）視為集合：排序去重後比較與寫入。
 *   只 update `gameRef` 一個欄位（不 set 整份）。這 8 個集合的文件沒有 updatedAt 欄位，所以也不寫 updatedAt
 *   （後台存檔同樣不寫；變更歷史 changeHistory 只有後台存檔會記，腳本寫入不記）。
 *
 * ── 備份與版本 bump：都是本腳本內建 ─────────────────────────────────────────
 *   scripts/temp_scripts/backup-firestore.mjs 與 scripts/bump-data-version.mjs 被 .gitignore 擋著、換電腦會不見，
 *   所以這裡不呼叫它們：
 *   · 備份：只備份這次要改的文件（完整內容），寫到 _local-notes/db-backup-<YYYY-MM-DD>_<HHmm>_gameref/，
 *     格式與 backup-firestore.mjs 相同（{collection, exportedAt, count, docs}），另附 _manifest.json 記錄每筆的寫入前／後值，
 *     --rollback 就是讀它。
 *   · 寫入：update 帶 precondition（備份當下的 updateTime）——備份之後文件又被改過，那一批就整批失敗、不覆蓋。
 *   · bump：meta/gameData 的 versions.<集合> 寫 ISO 時間戳（與 src/lib/api/versions.ts 的 bumpDataVersion 同形），
 *     寫完重讀一次確認真的生效（PLAN-034 踩過「寫錯鍵、輸出照樣印成功」）。集合鍵＝Firestore 集合名＝CollectionKey。
 *
 * ⚠ 文件政策（PLAN-065）：本檔、報告、測試都不寫對照規則；那些只在私有 repo。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARRAY_COLLECTION_KEYS } from '../src/lib/collectionKeys.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_PROPOSALS = 'E:/Github/mecharashi-sim/pipeline/out/gameref-proposals.json'
/** accept 檔的建議放置處（_local-notes 不進版控；決定寫進 Firestore 之後就以站上值為準） */
const SUGGESTED_ACCEPT = path.join(ROOT, '_local-notes', 'gameref-accept.json')
export const PROPOSALS_SCHEMA = 'gameref-proposals/v1'
const BACKUP_SCHEMA = 'gameref-backup/v1'
const BATCH_SIZE = 200
const GET_ALL_CHUNK = 100

/**
 * 8 個集合的 gameRef 欄位（結構正本是 src/types/gameRef.ts；測試會比對兩邊是否一致）。
 * 'int'＝必填正整數、'int?'＝選填正整數、'int[]?'＝選填正整數陣列。
 */
export const GAME_REF_FIELDS = {
  pilots:      { pilotInfoId: 'int' },
  mechs:       { suitId: 'int' },
  weapons:     { weaponInfoId: 'int' },
  modules:     { entryId: 'int', itemId: 'int?' },
  components:  { weaponEntryId: 'int' },
  backpacks:   { backpackInfoId: 'int' },
  pilotSkills: { mainSkillIds: 'int[]?', passiveSkillIds: 'int[]?', activeSkillIds: 'int[]?' },
  forms:       { passiveSkillId: 'int' },
}
/** 集合 → src/types/gameRef.ts 的型別名（測試用） */
export const GAME_REF_TYPE_NAMES = {
  pilots: 'PilotGameRef', mechs: 'MechGameRef', weapons: 'WeaponGameRef', modules: 'ModuleGameRef',
  components: 'ComponentGameRef', backpacks: 'BackpackGameRef', pilotSkills: 'SkillGameRef', forms: 'FormGameRef',
}
export const COLLECTIONS = Object.keys(GAME_REF_FIELDS)
export const STATUSES = ['unique', 'equivalent', 'needsConfirm', 'unmatched', 'notApplicable']
const WRITABLE_STATUSES = new Set(['unique', 'equivalent', 'needsConfirm'])

/** 決定的動作 → 報告用字 */
export const ACTIONS = {
  write:          '寫入',
  same:           '已相同（略過）',
  conflict:       '衝突（不寫）',
  missingDoc:     '站上找不到文件',
  holdEquivalent: '等價・待 C14',
  holdConfirm:    '待確認・未接受',
  unmatched:      '找不到對照',
  notApplicable:  '不需要',
  invalid:        '格式不對',
}
const STATUS_LABEL = { unique: '唯一', equivalent: '等價', needsConfirm: '待確認', unmatched: '找不到', notApplicable: '不需要', invalid: '格式不對' }
const COLLECTION_LABEL = { pilots: '機師', mechs: '機甲', weapons: '武器', modules: '模組', components: '元件', backpacks: '背包', pilotSkills: '技能', forms: '形態' }

// 集合鍵漂移守門：gameRef 寫進的集合必須是前台快取層認得的 CollectionKey，否則 bump 等於沒 bump
for (const c of COLLECTIONS) {
  if (!ARRAY_COLLECTION_KEYS.includes(c)) throw new Error(`集合 ${c} 不在 src/lib/collectionKeys.ts 的 ARRAY_COLLECTION_KEYS`)
}

// ─── 純函式：gameRef 結構 ────────────────────────────────────────────────────

const isPosInt = (v) => Number.isSafeInteger(v) && v > 0
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** null／undefined／{} 都算「沒有 gameRef」 */
export const isEmptyGameRef = (ref) => ref == null || (isPlainObject(ref) && Object.keys(ref).length === 0)

/** gameRef 結構檢查（只看形狀，不看值對不對）。回傳問題清單，空陣列＝沒問題。 */
export function validateGameRef(collection, ref) {
  const spec = GAME_REF_FIELDS[collection]
  if (!spec) return [`不認識的集合 ${collection}`]
  if (!isPlainObject(ref)) return ['gameRef 不是物件']
  const problems = []
  for (const k of Object.keys(ref)) if (!(k in spec)) problems.push(`多出不認識的欄位 ${k}`)
  let arrays = 0
  for (const [k, type] of Object.entries(spec)) {
    const v = ref[k]
    const optional = type.endsWith('?')
    if (v === undefined) {
      if (!optional) problems.push(`缺必填欄位 ${k}`)
      continue
    }
    if (type.startsWith('int[]')) {
      if (!Array.isArray(v) || v.length === 0 || !v.every(isPosInt)) problems.push(`${k} 必須是非空的正整數陣列`)
      else arrays++
    } else if (!isPosInt(v)) problems.push(`${k} 必須是正整數`)
  }
  // 技能文件：三個陣列都是選填，但至少要有一個（全空應標 unmatched／notApplicable，而不是給空物件）
  if (Object.values(spec).every((t) => t.startsWith('int[]')) && arrays === 0 && !problems.length) problems.push('至少要有一個 ID 陣列')
  return problems
}

/** 正規化：鍵排序、陣列排序去重、丟掉 undefined。比較與寫入都用這個形式。 */
export function canonicalGameRef(ref) {
  if (isEmptyGameRef(ref)) return null
  if (!isPlainObject(ref)) return ref
  const out = {}
  for (const k of Object.keys(ref).sort()) {
    const v = ref[k]
    if (v === undefined) continue
    out[k] = Array.isArray(v) ? [...new Set(v)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : v
  }
  return out
}

export const sameGameRef = (a, b) => JSON.stringify(canonicalGameRef(a)) === JSON.stringify(canonicalGameRef(b))

/** 報告用的短格式：pilotInfoId 10103174・itemId 5 */
export function formatGameRef(ref) {
  const c = canonicalGameRef(ref)
  if (c == null) return '（無）'
  if (!isPlainObject(c)) return JSON.stringify(c)
  return Object.entries(c).map(([k, v]) => `${k} ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('・')
}

// ─── 純函式：建議檔與 accept 檔 ───────────────────────────────────────────────

export const itemKey = (collection, docId) => `${collection}/${docId}`

/** 檔案層級檢查：schema 不對、items 不是陣列 → 直接丟錯（整份不能用） */
export function checkProposalsFile(json) {
  if (!isPlainObject(json)) throw new Error('建議檔不是 JSON 物件')
  if (json.schema !== PROPOSALS_SCHEMA) throw new Error(`建議檔 schema 是「${json.schema}」，本腳本只認 ${PROPOSALS_SCHEMA}`)
  if (!Array.isArray(json.items)) throw new Error('建議檔缺 items 陣列')
  const warnings = []
  if (!json.generatedAt) warnings.push('缺 generatedAt')
  if (!json.dataPackage?.buildNum) warnings.push('缺 dataPackage.buildNum')
  if (!json.summary) warnings.push('缺 summary（略過統計核對）')
  return warnings
}

/** 單筆檢查：回傳問題清單（有問題的這筆一律不寫，報告列「格式不對」） */
export function itemProblems(item) {
  if (!isPlainObject(item)) return ['不是物件']
  const problems = []
  if (!COLLECTIONS.includes(item.collection)) problems.push(`collection「${item.collection}」不在 ${COLLECTIONS.join('／')}`)
  if (typeof item.docId !== 'string' || !item.docId || item.docId.includes('/')) problems.push('docId 必須是非空字串、不含 /')
  if (!STATUSES.includes(item.status)) problems.push(`status「${item.status}」不在 ${STATUSES.join('／')}`)
  if (problems.length) return problems
  if (WRITABLE_STATUSES.has(item.status)) {
    if (item.gameRef === undefined) problems.push(`${item.status} 必須帶 gameRef`)
    else problems.push(...validateGameRef(item.collection, item.gameRef).map((p) => `gameRef：${p}`))
  } else if (item.gameRef !== undefined) {
    problems.push(`${item.status} 不應帶 gameRef`)
  }
  if (item.alternatives !== undefined) {
    if (!Array.isArray(item.alternatives)) problems.push('alternatives 必須是陣列')
    else item.alternatives.forEach((alt, i) => {
      if (!isPlainObject(alt)) { problems.push(`alternatives[${i}] 不是物件`); return }
      problems.push(...validateGameRef(item.collection, alt.gameRef).map((p) => `alternatives[${i}].gameRef：${p}`))
    })
  }
  if (item.status === 'equivalent' && !(item.alternatives?.length)) problems.push('equivalent 必須在 alternatives 列出其餘等價記錄')
  return problems
}

/** accept 檔：{"accept":["pilots/pilot_049_海莉絲", ...]} → Set。格式不對直接丟錯。 */
export function parseAcceptFile(json) {
  if (!isPlainObject(json) || !Array.isArray(json.accept)) throw new Error('accept 檔格式應為 {"accept":["集合/文件 ID", ...]}')
  const out = new Set()
  for (const k of json.accept) {
    if (typeof k !== 'string') throw new Error(`accept 檔有非字串條目：${JSON.stringify(k)}`)
    const i = k.indexOf('/')
    if (i <= 0 || !COLLECTIONS.includes(k.slice(0, i)) || !k.slice(i + 1)) throw new Error(`accept 檔條目「${k}」不是「集合/文件 ID」（集合：${COLLECTIONS.join('、')}）`)
    out.add(k)
  }
  return out
}

// ─── 純函式：決定動作 ────────────────────────────────────────────────────────

/**
 * 一筆建議 → 動作。
 * @param {object} item       建議檔的一筆
 * @param {{name?:string, gameRef?:object}|undefined} siteDoc 站上現值（undefined＝站上找不到這份文件）
 * @param {{acceptEquivalent?:boolean, accepted?:Set<string>, problems?:string[]}} opts
 * @returns {{action:string, reason:string, before:object|null, after:object|null}}
 */
export function decideAction(item, siteDoc, { acceptEquivalent = false, accepted = new Set(), problems } = {}) {
  const probs = problems ?? itemProblems(item)
  const before = canonicalGameRef(siteDoc?.gameRef)
  if (probs.length) return { action: 'invalid', reason: probs.join('；'), before, after: null }
  if (!siteDoc) return { action: 'missingDoc', reason: '站上沒有這份文件（改名、刪除，或建議檔用了舊的站上匯出）', before: null, after: null }
  if (item.status === 'unmatched') return { action: 'unmatched', reason: before ? '站上已有 gameRef，但建議檔找不到對照' : '', before, after: null }
  if (item.status === 'notApplicable') return { action: 'notApplicable', reason: before ? '站上已有 gameRef，但建議檔認為不需要' : '', before, after: null }

  const after = canonicalGameRef(item.gameRef)
  // 先看站上現值：已寫過的條目重跑時就算沒帶 accept 也是 ✅，有不同的值一律不覆蓋
  if (before && sameGameRef(before, after)) return { action: 'same', reason: '', before, after }
  if (before) return { action: 'conflict', reason: '站上已有不同的 gameRef', before, after }
  if (item.status === 'equivalent' && !acceptEquivalent) return { action: 'holdEquivalent', reason: '等價記錄：C14 裁決接受後加 --accept-equivalent', before, after }
  if (item.status === 'needsConfirm' && !accepted.has(itemKey(item.collection, item.docId))) return { action: 'holdConfirm', reason: '待確認：同意的話寫進 accept 檔', before, after }
  return { action: 'write', reason: item.status === 'unique' ? '' : item.status === 'equivalent' ? '已依 --accept-equivalent 取代表記錄' : '已列在 accept 檔', before, after }
}

/**
 * 整份建議檔 → 每筆的動作，外加：重複條目、accept 檔沒作用的條目、名稱與站上不同、站上沒列進建議檔的文件。
 * @param {{proposals:object, site:Record<string, Map<string,{name?:string,gameRef?:object}>>, acceptEquivalent?:boolean, accepted?:Set<string>}} a
 */
export function planBackfill({ proposals, site, acceptEquivalent = false, accepted = new Set() }) {
  const items = proposals.items
  const keyCount = new Map()
  for (const it of items) {
    if (isPlainObject(it) && typeof it.collection === 'string' && typeof it.docId === 'string') {
      const k = itemKey(it.collection, it.docId)
      keyCount.set(k, (keyCount.get(k) || 0) + 1)
    }
  }
  const rows = items.map((item, index) => {
    const key = isPlainObject(item) ? itemKey(item.collection, item.docId) : `#${index}`
    const problems = itemProblems(item)
    if ((keyCount.get(key) || 0) > 1) problems.push('同一份文件在建議檔出現不只一次')
    const siteDoc = isPlainObject(item) ? site[item.collection]?.get(item.docId) : undefined
    const decision = decideAction(item, siteDoc, { acceptEquivalent, accepted, problems })
    const nameDiffers = !!(siteDoc && item.siteName && siteDoc.name && item.siteName !== siteDoc.name)
    return { index, key, item, siteName: siteDoc?.name ?? item?.siteName ?? '', nameDiffers, ...decision }
  })

  // accept 檔裡沒作用的條目（打錯字、或那筆不是待確認）——不擋，只提醒
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const unusedAccept = [...accepted].filter((k) => byKey.get(k)?.item?.status !== 'needsConfirm')
    .map((k) => ({ key: k, reason: byKey.has(k) ? `這筆是 ${byKey.get(k).item.status}，accept 檔對它沒有作用` : '建議檔沒有這筆' }))

  // 站上有、建議檔沒列到的文件（之後會顯示「未連結」，B-6 例行檢查也會列）
  const listed = new Set(rows.map((r) => r.key))
  const uncovered = {}
  for (const c of COLLECTIONS) {
    const docs = site[c]
    if (!docs) continue
    const list = []
    for (const [id, d] of docs) {
      if (listed.has(itemKey(c, id))) continue
      list.push({ docId: id, name: d.name ?? '', hasGameRef: !isEmptyGameRef(d.gameRef) })
    }
    if (list.length) uncovered[c] = list
  }
  return { rows, unusedAccept, uncovered }
}

// ─── 純函式：diff 與統計 ──────────────────────────────────────────────────────

/** 要寫入的那些 → 依集合分組（集合照 COLLECTIONS 順序、文件照 docId 排序） */
export function buildDiff(rows) {
  const entries = rows.filter((r) => r.action === 'write')
    .map((r) => ({ collection: r.item.collection, docId: r.item.docId, siteName: r.siteName, status: r.item.status, before: r.before, after: r.after }))
    .sort((a, b) => COLLECTIONS.indexOf(a.collection) - COLLECTIONS.indexOf(b.collection) || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0))
  const byCollection = {}
  for (const e of entries) (byCollection[e.collection] ||= []).push(e)
  return { entries, byCollection, collections: Object.keys(byCollection), total: entries.length }
}

const emptyCounts = () => ({
  total: 0, ...Object.fromEntries(STATUSES.map((s) => [s, 0])), invalid: 0,
  actions: Object.fromEntries(Object.keys(ACTIONS).map((a) => [a, 0])),
})

/** 逐集合統計：建議檔的分類筆數（status）＋本次決定的動作筆數（actions） */
export function summarize(rows) {
  const out = {}
  for (const r of rows) {
    const c = COLLECTIONS.includes(r.item?.collection) ? r.item.collection : '（不明）'
    const s = (out[c] ||= emptyCounts())
    s.total++
    if (STATUSES.includes(r.item?.status)) s[r.item.status]++
    else s.invalid++
    s.actions[r.action]++
  }
  return out
}

/** 加總所有集合 */
export function totals(stats) {
  const t = emptyCounts()
  for (const s of Object.values(stats)) {
    t.total += s.total
    for (const k of [...STATUSES, 'invalid']) t[k] += s[k]
    for (const a of Object.keys(ACTIONS)) t.actions[a] += s.actions[a]
  }
  return t
}

/** 建議檔自己宣告的 summary 與實際內容核對（對不上多半是檔案被截斷或 pipeline 有 bug） */
export function compareDeclaredSummary(declared, stats) {
  if (!declared) return []
  const out = []
  const cols = new Set([...Object.keys(declared), ...Object.keys(stats).filter((c) => c !== '（不明）')])
  for (const c of cols) {
    const d = declared[c] || {}
    const s = stats[c] || emptyCounts()
    for (const k of ['total', ...STATUSES]) {
      const want = d[k] ?? 0
      if (want !== s[k]) out.push(`${c}.${k}：summary 寫 ${want}、實際 ${s[k]}`)
    }
  }
  return out
}

/**
 * --rollback：備份夾的寫入紀錄 × 站上現值 → 每筆要不要還原。
 * 只還原「現值仍是當初寫入的值」的；之後又被改過的不碰（不覆蓋別人的修改）。
 * @param {{collection:string, docId:string, before:object|null, after:object}[]} writes
 * @param {Map<string, {gameRef?:object}|null>} current  key＝集合/文件 ID；null＝文件已不存在
 */
export function planRollback(writes, current) {
  return writes.map((w) => {
    const key = itemKey(w.collection, w.docId)
    const cur = current.get(key)
    const base = { key, collection: w.collection, docId: w.docId, before: canonicalGameRef(w.before), after: canonicalGameRef(w.after), current: canonicalGameRef(cur?.gameRef) }
    if (!cur) return { ...base, action: 'skip', reason: '文件已不存在' }
    if (sameGameRef(cur.gameRef, w.after)) return { ...base, action: 'restore', reason: '' }
    if (sameGameRef(cur.gameRef, w.before)) return { ...base, action: 'skip', reason: '已是寫入前的值' }
    return { ...base, action: 'skip', reason: '寫入後又被改過，不覆蓋' }
  })
}

// ─── 報告 ────────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
/** 指令裡的路徑一律加雙引號：PowerShell 與 Git Bash 照抄都能用（反斜線、空白都不會被吃掉） */
const q = (p) => `"${p}"`

/** 本機時區的 YYYY-MM-DD（同 scripts/lib/gameDump.mjs 的 localDate；不 import 它，那支會連帶載入 sharp） */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const localStamp = (d = new Date()) => `${localDate(d)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
/** ISO 但帶本機時區（+08:00），報告與備份 manifest 用 */
function localIso(d = new Date()) {
  const off = -d.getTimezoneOffset()
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19)
  return `${local}${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`
}

/**
 * 「下一步」照抄清單。每一步依實際狀態標 ✅／⬜；全部 ✅（找不到對照那一項除外）＝這一輪做完。
 * @returns {{ok:boolean|null, text:string, cmd?:string}[]}
 */
export function nextSteps(model) {
  const { tot, mode, writeResult, summaryMismatch, fileWarnings, unusedAccept, uncoveredMissing, nameMismatch, cmd } = model
  const a = tot.actions
  const pendingWrite = writeResult ? 0 : a.write
  const steps = []
  const fileOk = a.invalid === 0 && summaryMismatch.length === 0
  steps.push({ ok: fileOk, text: fileOk
    ? `建議檔格式正確、統計相符${fileWarnings.length ? `（提醒：${fileWarnings.join('、')}）` : ''}`
    : `建議檔有問題：${a.invalid} 筆格式不對、統計不符 ${summaryMismatch.length} 項——交給開發者修私有 pipeline 後重產建議檔（有問題時 --write 會拒絕執行）` })
  steps.push({ ok: a.missingDoc === 0, text: a.missingDoc === 0 ? '建議檔的每一筆站上都找得到'
    : `${a.missingDoc} 筆站上找不到文件（改名、刪除，或建議檔用了舊的站上匯出）——用最新的站上資料重產建議檔` })
  if (nameMismatch) steps.push({ ok: false, text: `${nameMismatch} 筆名稱與站上不同（多半是站上改過名）——不影響寫入（以文件 ID 為準），重產建議檔後會消失` })
  steps.push({ ok: a.conflict === 0, text: a.conflict === 0 ? '沒有衝突'
    : `${a.conflict} 筆衝突：站上已有不同的 gameRef，本腳本不會覆蓋——逐筆看「衝突」：站上值對 → 不用動，回報開發者修 pipeline；建議值對 → 到 Firebase Console 刪掉那份文件的 gameRef 欄位，再重跑` })
  steps.push({ ok: a.holdConfirm === 0, text: a.holdConfirm === 0 ? '待確認的都已處理'
    : `${a.holdConfirm} 筆待確認——逐筆看「待確認」，同意的把「集合/文件 ID」寫進 accept 檔（底下有現成樣板，刪掉不同意的行），存成 ${cmd.acceptPath}；不同意的別寫，回報開發者` })
  steps.push({ ok: a.holdEquivalent === 0, text: a.holdEquivalent === 0 ? '等價記錄都已處理'
    : `${a.holdEquivalent} 筆等價記錄等 C14 裁決——接受取代表記錄，寫入時加 --accept-equivalent；不接受就先不加（它們會一直列在這裡）` })
  if (unusedAccept.length) steps.push({ ok: false, text: `accept 檔有 ${unusedAccept.length} 筆沒作用（打錯字，或那筆不是待確認）——見「accept 檔沒作用的條目」` })
  if (mode === 'backup') {
    steps.push({ ok: false, text: '這份是離線試跑（讀本機備份）：拿掉 --from-backup 重跑一次，確認正式庫的現值', cmd: cmd.dryRun })
  } else if (!writeResult) {
    if (pendingWrite) steps.push({ ok: false, text: '寫入前：確認含 PLAN-065-A B-5 的後台已部署（GitHub Actions 的 pages-build-deployment 綠燈）——舊後台存檔是整份覆寫，會把剛寫進去的 gameRef 蓋掉（這一步沒辦法自動確認，做完請自己打勾）' })
    steps.push({ ok: pendingWrite === 0, text: pendingWrite === 0 ? '沒有要寫入的'
      : `寫入 ${pendingWrite} 筆（${model.diff.collections.map((c) => COLLECTION_LABEL[c]).join('、')}）——會先備份、只改 gameRef、寫完自動 bump 版本`, cmd: pendingWrite ? cmd.write : null })
  } else if (model.diff.total === 0) {
    steps.push({ ok: true, text: '沒有要寫入的' })
  } else {
    const w = writeResult
    steps.push({ ok: !w.error && w.written.length === model.diff.total, text: w.error
      ? `寫入中斷：已寫 ${w.written.length}／${model.diff.total} 筆（${w.error}）——已寫的不受影響，重跑 --write 會接著寫剩下的`
      : `已寫入 ${w.written.length} 筆；備份在 ${w.backupDir ?? '（無）'}${w.skipped.length ? `；${w.skipped.length} 筆在寫入前複查時被擋下（見「寫入紀錄」），重跑 dry-run 會看到它們現在的狀態` : ''}` })
    steps.push({ ok: !w.bump || w.bump.verified, text: !w.bump ? '沒有寫入，不需要 bump'
      : w.bump.verified ? `已 bump 並確認：${w.bump.collections.map((c) => `versions.${c}`).join('、')} → ${w.bump.version}`
      : `bump 沒有生效（${w.bump.failed.join('、')}）——前台會讀到舊快取。用後台任一實體頁存檔一次，或請開發者處理` })
  }
  const willWrite = writeResult ? writeResult.written.length : 0
  if (willWrite || pendingWrite) {
    steps.push({ ok: false, text: `${writeResult ? '' : '寫入之後：'}等約 1 分鐘（Worker 版本快取）後請管理者重新整理後台分頁，「遊戲 ID」才會顯示新值；新後台存檔會保留伺服器上的 gameRef（這一步沒辦法自動確認，做完請自己打勾）` })
  }
  const allOk = steps.every((s) => s.ok)
  steps.push({ ok: allOk && !(willWrite || pendingWrite), text: '重跑 dry-run，確認上面全部 ✅', cmd: cmd.dryRun })
  const unlinked = a.unmatched + uncoveredMissing
  steps.push({ ok: unlinked === 0, text: unlinked === 0 ? '沒有未連結的實體'
    : `（不擋）${a.unmatched} 筆找不到對照、${uncoveredMissing} 份站上文件沒列進建議檔也沒有 gameRef——傷害模擬會顯示「未連結」。補對照交給私有 pipeline（B-6 例行檢查會持續列出），或列入白名單` })
  return steps
}

export function renderReport(model) {
  const { meta, stats, tot, rows, diff, unusedAccept, uncovered, summaryMismatch, fileWarnings, writeResult } = model
  const steps = nextSteps(model)
  const step = (s) => `<li class="${s.ok ? 'ok' : 'todo'}">${s.ok ? '✅' : '⬜'} ${esc(s.text)}${s.cmd ? `<pre>${esc(s.cmd)}</pre>` : ''}</li>`
  const a = tot.actions
  const by = (act) => rows.filter((r) => r.action === act)
  const altText = (r) => (r.item.alternatives || []).map((x) => `${formatGameRef(x.gameRef)}${x.label ? `（${x.label}）` : ''}`).join('<br>')
  const table = (head, body) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${body.join('')}</table>`
  const keyCell = (r) => `<td><code>${esc(r.key)}</code></td><td>${esc(r.siteName)}${r.nameDiffers ? `<div class="warn">建議檔寫「${esc(r.item.siteName)}」</div>` : ''}</td>`
  const section = (title, list, render, open = true) => (list.length ? `<details${open ? ' open' : ''}><summary><h2>${esc(title)}（${list.length}）</h2></summary>${render(list)}</details>` : '')

  const statCols = COLLECTIONS.filter((c) => stats[c] || uncovered[c])
  const statRow = (label, s, unc) => `<tr><td>${esc(label)}</td><td>${s.total}</td>${STATUSES.map((k) => `<td>${s[k] || ''}</td>`).join('')}<td>${s.invalid || ''}</td>`
    + `<td class="hl">${s.actions.write || ''}</td><td>${s.actions.same || ''}</td><td class="${s.actions.conflict ? 'warn' : ''}">${s.actions.conflict || ''}</td>`
    + `<td>${s.actions.holdConfirm || ''}</td><td>${s.actions.holdEquivalent || ''}</td><td class="${s.actions.missingDoc ? 'warn' : ''}">${s.actions.missingDoc || ''}</td><td>${unc ?? ''}</td></tr>`
  const uncMissing = (c) => (uncovered[c] || []).filter((d) => !d.hasGameRef).length
  const statTable = `<table><tr><th>集合</th><th>建議檔</th>${STATUSES.map((k) => `<th>${STATUS_LABEL[k]}</th>`).join('')}<th>格式不對</th><th>→ ${writeResult ? '已寫入' : '將寫入'}</th><th>已相同</th><th>衝突</th><th>待確認未接受</th><th>等價待裁決</th><th>站上找不到</th><th>站上未列入<div class="dim">（無 gameRef）</div></th></tr>`
    + statCols.map((c) => statRow(`${COLLECTION_LABEL[c]} ${c}`, stats[c] || emptyCounts(), uncMissing(c))).join('')
    + (stats['（不明）'] ? statRow('（集合不明）', stats['（不明）'], '') : '')
    + statRow('合計', tot, statCols.reduce((n, c) => n + uncMissing(c), 0)).replace('<tr>', '<tr class="sum">') + '</table>'

  const writtenKeys = new Set((writeResult?.written || []).map((w) => itemKey(w.collection, w.docId)))
  const rowByKey = new Map(rows.map((r) => [r.key, r]))
  const diffHtml = diff.collections.map((c) => `<h3>${COLLECTION_LABEL[c]} ${c}（${diff.byCollection[c].length}）</h3>`
    + table(['文件', '名稱', '分類', '寫入值', '佐證'], diff.byCollection[c].map((e) => {
      const r = rowByKey.get(itemKey(e.collection, e.docId))
      const mark = writeResult ? (writtenKeys.has(r.key) ? '✅ ' : '⬜ ') : ''
      return `<tr><td>${mark}<code>${esc(r.key)}</code></td><td>${esc(r.siteName)}</td><td>${esc(STATUS_LABEL[e.status])}${r.reason ? `<div class="dim">${esc(r.reason)}</div>` : ''}</td><td><code>${esc(formatGameRef(e.after))}</code></td><td class="dim">${esc(r.item.evidence)}</td></tr>`
    }))).join('')

  const confirmRows = rows.filter((r) => r.item?.status === 'needsConfirm' && r.action !== 'invalid')
  const confirmHtml = (list) => table(['文件', '名稱', '狀態', '建議值', '其他候選', '佐證／備註'], list.map((r) => `<tr>${keyCell(r)}<td class="${r.action === 'holdConfirm' ? 'todo' : ''}">${esc(r.action === 'holdConfirm' ? '⬜ 未接受' : r.action === 'write' ? (writeResult ? '✅ 已接受、已寫入' : '已接受、將寫入') : ACTIONS[r.action])}</td>`
    + `<td><code>${esc(formatGameRef(r.item.gameRef))}</code></td><td><code>${altText(r)}</code></td><td>${esc(r.item.evidence)}${r.item.note ? `<div class="dim">${esc(r.item.note)}</div>` : ''}</td></tr>`))
  const pendingConfirmKeys = by('holdConfirm').map((r) => r.key)
  // 樣板＝accept 檔裡有作用的條目（沒作用的多半是打錯字，不沿用）＋這次還沒接受的
  const unusedKeys = new Set(unusedAccept.map((x) => x.key))
  const acceptTemplate = pendingConfirmKeys.length
    ? `<p>accept 檔樣板（同意的留下、不同意的刪掉那一行，存成 <code>${esc(model.cmd.acceptPath)}</code>）：</p><pre>${esc(JSON.stringify({ accept: [...new Set([...model.acceptedList.filter((k) => !unusedKeys.has(k)), ...pendingConfirmKeys])] }, null, 2))}</pre>`
    : ''

  const equivRows = rows.filter((r) => r.item?.status === 'equivalent' && r.action !== 'invalid')
  const equivHtml = (list) => table(['文件', '名稱', '狀態', '代表記錄（將寫入）', '其餘等價記錄', '佐證'], list.map((r) => `<tr>${keyCell(r)}<td>${esc(ACTIONS[r.action])}</td><td><code>${esc(formatGameRef(r.item.gameRef))}</code></td><td><code>${altText(r)}</code></td><td class="dim">${esc(r.item.evidence)}</td></tr>`))
  const conflictHtml = (list) => table(['文件', '名稱', '分類', '站上值', '建議值', '佐證'], list.map((r) => `<tr>${keyCell(r)}<td>${esc(STATUS_LABEL[r.item.status])}</td><td><code>${esc(formatGameRef(r.before))}</code></td><td><code>${esc(formatGameRef(r.after))}</code></td><td class="dim">${esc(r.item.evidence)}</td></tr>`))
  const simpleHtml = (list) => table(['文件', '名稱', '說明'], list.map((r) => `<tr>${keyCell(r)}<td>${esc([r.reason, r.item?.evidence, r.item?.note].filter(Boolean).join('；'))}</td></tr>`))
  const invalidHtml = (list) => table(['#', '文件', '問題'], list.map((r) => `<tr><td>${r.index}</td><td><code>${esc(r.key)}</code></td><td class="warn">${esc(r.reason)}</td></tr>`))
  const uncoveredHtml = Object.entries(uncovered).map(([c, list]) => {
    const missing = list.filter((d) => !d.hasGameRef)
    const has = list.length - missing.length
    return `<h3>${COLLECTION_LABEL[c]} ${c}：無 gameRef ${missing.length}${has ? `、已有 gameRef ${has}` : ''}</h3>`
      + (missing.length ? `<p class="dim">${missing.map((d) => `<code>${esc(d.docId)}</code> ${esc(d.name)}`).join('　')}</p>` : '')
  }).join('')

  const w = writeResult
  const writeLog = w ? `<h2>寫入紀錄</h2><ul>
<li>備份：<code>${esc(w.backupDir)}</code>（還原：<code>${esc(model.cmd.rollback)}</code>，先預覽、加 --write 才執行）</li>
<li>已寫入 ${w.written.length} 筆${w.error ? `；<span class="warn">中斷：${esc(w.error)}</span>` : ''}</li>
<li>bump：${w.bump ? `${esc(w.bump.collections.join('、'))} → ${esc(w.bump.version)}（${w.bump.verified ? '重讀確認生效' : `<span class="warn">未生效：${esc(w.bump.failed.join('、'))}</span>`}）` : '無'}</li>
${w.skipped.map((s) => `<li class="warn">寫入前複查擋下：<code>${esc(itemKey(s.collection, s.docId))}</code>——${esc(s.reason)}</li>`).join('')}
</ul>` : ''

  const headline = model.headline
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>遊戲身分鍵回填 ${esc(meta.today)}</title>
<style>body{font-family:"Segoe UI","Noto Sans TC",sans-serif;background:#0f1117;color:#e4e6ec;max-width:1200px;margin:0 auto;padding:24px;line-height:1.7}
h1{border-bottom:2px solid #a78bfa;padding-bottom:8px}h2{color:#38bdf8;margin-top:36px}h3{color:#a78bfa}
details{margin-top:28px}summary{cursor:pointer}summary h2{display:inline}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}td,th{border:1px solid #2a2e3a;padding:5px 8px;text-align:left;vertical-align:top}th{color:#a78bfa}
tr.sum td{font-weight:700;border-top:2px solid #a78bfa}td.hl{color:#34d399;font-weight:700}
.dim{color:#6b7280;font-size:12px}pre{background:#000;color:#34d399;padding:6px 10px;border-radius:6px;margin:4px 0;white-space:pre-wrap}
code{color:#fcd34d}.box{border:1px solid #a78bfa;border-radius:10px;padding:12px 18px;background:#161a24;font-size:15px}
li.ok{color:#aab0bd}li.todo,.todo{color:#fbbf24}.warn{color:#f87171}</style></head><body>
<h1>遊戲身分鍵回填報告 ${esc(meta.today)}</h1>
<p class="dim">${esc(meta.modeLabel)}・建議檔 ${esc(meta.proposalsPath)}（產生於 ${esc(meta.generatedAt || '?')}，資料包 BuildNum ${esc(meta.buildNum || '?')}，站上來源 ${esc(meta.siteSourceLabel)}）・accept 檔 ${esc(meta.acceptPath || '（未指定）')}・--accept-equivalent ${meta.acceptEquivalent ? '有' : '無'}・報告產生於 ${esc(meta.reportAt)}</p>
<div class="box">${headline.map(esc).join('<br>')}</div>
<h2>下一步</h2><ol>
${steps.map(step).join('\n')}
</ol>
<h2>逐集合統計</h2>
${statTable}
<p class="dim">左半是建議檔的分類，右半是這次決定的動作。「站上未列入」＝站上有、建議檔沒列到、也還沒有 gameRef 的文件。</p>
${writeLog}
${section('待確認', confirmRows, (l) => confirmHtml(l) + acceptTemplate)}
${section('等價記錄（C14 裁決）', equivRows, equivHtml)}
${section('衝突', by('conflict'), conflictHtml)}
${section('站上找不到的文件', by('missingDoc'), simpleHtml)}
${section('建議檔格式不對', by('invalid'), invalidHtml)}
${summaryMismatch.length || fileWarnings.length ? `<h2>建議檔核對</h2><ul>${[...summaryMismatch, ...fileWarnings].map((x) => `<li class="warn">${esc(x)}</li>`).join('')}</ul>` : ''}
${unusedAccept.length ? `<h2>accept 檔沒作用的條目（${unusedAccept.length}）</h2><ul>${unusedAccept.map((x) => `<li><code>${esc(x.key)}</code>：${esc(x.reason)}</li>`).join('')}</ul>` : ''}
${diff.total ? `<details${diff.total <= 80 ? ' open' : ''}><summary><h2>${writeResult ? '寫入內容' : '將寫入'}（${diff.total}）</h2></summary>${diffHtml}</details>` : ''}
${section('找不到對照', by('unmatched'), simpleHtml, false)}
${section('不需要 gameRef', by('notApplicable'), simpleHtml, false)}
${section('已相同（略過）', by('same'), (l) => table(['文件', '名稱', '站上值'], l.map((r) => `<tr>${keyCell(r)}<td><code>${esc(formatGameRef(r.before))}</code></td></tr>`)), false)}
${uncoveredHtml ? `<details><summary><h2>站上未列入建議檔的文件</h2></summary>${uncoveredHtml}</details>` : ''}
<p class="dim" style="margin-top:40px">本報告只列寫入結果；對照怎麼算在私有 repo（mecharashi-sim），不在這裡。動作：${Object.entries(ACTIONS).map(([k, v]) => `${v} ${a[k]}`).join('・')}</p>
</body></html>`
}

/** 報告頂部的結論（幾行字） */
export function headlineOf(model) {
  const { tot, writeResult, mode } = model
  const a = tot.actions
  const lines = []
  const pend = []
  if (model.writeRefused) lines.push('⚠ --write 被拒絕：建議檔有格式問題或統計對不上，沒有寫入任何東西。')
  if (a.holdConfirm) pend.push(`待確認 ${a.holdConfirm}`)
  if (a.holdEquivalent) pend.push(`等價待裁決 ${a.holdEquivalent}`)
  if (a.conflict) pend.push(`衝突 ${a.conflict}`)
  if (a.missingDoc) pend.push(`站上找不到 ${a.missingDoc}`)
  if (a.invalid) pend.push(`格式不對 ${a.invalid}`)
  if (writeResult) lines.push(`已寫入 ${writeResult.written.length} 筆${writeResult.error ? '（中斷）' : ''}；已相同 ${a.same} 筆。`)
  else if (mode === 'backup') lines.push(`離線試跑：以備份推算會寫入 ${a.write} 筆、已相同 ${a.same} 筆（正式庫的現值以不帶 --from-backup 的 dry-run 為準）。`)
  else lines.push(a.write ? `dry-run：會寫入 ${a.write} 筆、已相同 ${a.same} 筆；沒有寫入任何東西。` : `dry-run：沒有要寫入的；已相同 ${a.same} 筆。`)
  lines.push(pend.length ? `待處理：${pend.join('、')}。` : '沒有待處理的分歧。')
  if (a.unmatched || model.uncoveredMissing) lines.push(`未連結：找不到對照 ${a.unmatched}、站上未列入 ${model.uncoveredMissing}（不擋）。`)
  return lines
}

// ─── I/O：參數、讀檔、Firestore ───────────────────────────────────────────────

export function parseArgs(argv) {
  const get = (n) => {
    const i = argv.indexOf(n)
    if (i >= 0) return argv[i + 1]
    const eq = argv.find((x) => x.startsWith(`${n}=`))
    return eq ? eq.slice(n.length + 1) : undefined
  }
  return {
    proposals: get('--proposals') || DEFAULT_PROPOSALS,
    accept: get('--accept'),
    acceptEquivalent: argv.includes('--accept-equivalent'),
    write: argv.includes('--write'),
    fromBackup: get('--from-backup'),
    rollback: get('--rollback'),
  }
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))

/** 正式庫連線：serviceAccountKey.json（同 import-raid-dungeons.mjs）；沒有的話退回 .env／.env.migration 的 GOOGLE_APPLICATION_CREDENTIALS */
async function connectFirestore(writing) {
  let keyPath = path.join(ROOT, 'serviceAccountKey.json')
  if (!fs.existsSync(keyPath)) {
    for (const f of ['.env', '.env.migration']) {
      const p = path.join(ROOT, f)
      if (!fs.existsSync(p)) continue
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = /^\s*GOOGLE_APPLICATION_CREDENTIALS\s*=\s*(.+?)\s*$/.exec(line)
        if (m) keyPath = path.resolve(ROOT, m[1])
      }
    }
  }
  if (!fs.existsSync(keyPath)) {
    console.error('✗ 找不到服務帳號金鑰（serviceAccountKey.json 或 GOOGLE_APPLICATION_CREDENTIALS）；離線試跑可用 --from-backup <備份目錄>')
    process.exit(1)
  }
  const { default: admin } = await import('firebase-admin')
  admin.initializeApp({ credential: admin.credential.cert(readJson(keyPath)) })
  // admin SDK 看到 FIRESTORE_EMULATOR_HOST 會改打模擬器；印出來，免得以為在測試、其實寫進正式庫（或反過來）
  console.log(`  Firestore：${process.env.FIRESTORE_EMULATOR_HOST ? `模擬器 ${process.env.FIRESTORE_EMULATOR_HOST}` : '正式庫'}${writing ? '（--write：會寫入）' : '（唯讀）'}`)
  return { db: admin.firestore(), FieldValue: admin.firestore.FieldValue }
}

/** 站上現值：每集合 Map(docId → {name, gameRef}) */
async function loadSite(args) {
  const docs = {}
  if (args.fromBackup) {
    for (const c of COLLECTIONS) {
      const f = path.join(args.fromBackup, `${c}.json`)
      if (!fs.existsSync(f)) throw new Error(`備份裡沒有 ${c}.json：${f}`)
      docs[c] = new Map(readJson(f).docs.map((d) => [d.id, { name: d.name, gameRef: d.gameRef }]))
    }
    return { mode: 'backup', docs, label: `備份 ${path.basename(path.resolve(args.fromBackup))}` }
  }
  const fb = await connectFirestore(args.write)
  // 只取 name／gameRef 兩欄（讀取次數不變、傳輸量小）；要寫的那幾份在寫入前另外整份讀來備份
  const snaps = await Promise.all(COLLECTIONS.map((c) => fb.db.collection(c).select('name', 'gameRef').get()))
  COLLECTIONS.forEach((c, i) => { docs[c] = new Map(snaps[i].docs.map((d) => [d.id, { name: d.get('name'), gameRef: d.get('gameRef') }])) })
  return { mode: 'firestore', docs, label: process.env.FIRESTORE_EMULATOR_HOST ? '模擬器' : '正式庫', ...fb }
}

async function getAllChunked(db, refs) {
  const out = []
  for (let i = 0; i < refs.length; i += GET_ALL_CHUNK) out.push(...(await db.getAll(...refs.slice(i, i + GET_ALL_CHUNK))))
  return out
}

/** 只備份這次要改的文件（完整內容）＋ manifest（寫入前／後值，--rollback 用） */
function writeBackup(targets, manifestExtra, suffix) {
  let dir = path.join(ROOT, '_local-notes', `db-backup-${localStamp()}_${suffix}`)
  if (fs.existsSync(dir)) dir += `-${String(new Date().getSeconds()).padStart(2, '0')}`
  fs.mkdirSync(dir, { recursive: true })
  const exportedAt = new Date().toISOString()
  const byCol = {}
  for (const t of targets) (byCol[t.collection] ||= []).push({ id: t.snap.id, ...t.snap.data() })
  for (const [c, docs] of Object.entries(byCol)) {
    fs.writeFileSync(path.join(dir, `${c}.json`), JSON.stringify({ collection: c, exportedAt, count: docs.length, docs }, null, 2), 'utf8')
  }
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify({
    schema: BACKUP_SCHEMA, createdAt: localIso(), ...manifestExtra,
    writes: targets.map((t) => ({ collection: t.collection, docId: t.docId, before: t.before ?? null, after: t.after ?? null })),
  }, null, 2), 'utf8')
  return dir
}

/** bump versions.<集合>（與 src/lib/api/versions.ts 同形），再重讀確認真的寫進去 */
async function bumpVersions(db, FieldValue, collections) {
  const ref = db.collection('meta').doc('gameData')
  const version = new Date().toISOString()
  await ref.set({ versions: Object.fromEntries(collections.map((c) => [c, version])), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  const now = (await ref.get()).get('versions') || {}
  const failed = collections.filter((c) => now[c] !== version)
  return { version, collections, verified: failed.length === 0, failed }
}

/**
 * 每筆 target＝{collection, docId, before, after}：把 gameRef 從 before 改成 after（after 為 null＝刪掉欄位）。
 * 依序：寫入前複查（現值必須仍是 before）→ 備份 → 分批 update（precondition＝備份當下的 updateTime）→ bump。
 * 某一批失敗就停（之前的批次已生效）；已生效的集合照樣 bump。
 */
async function applyUpdates({ db, FieldValue }, targets, { manifestExtra, suffix }) {
  const snaps = await getAllChunked(db, targets.map((t) => db.collection(t.collection).doc(t.docId)))
  const ok = []
  const skipped = []
  targets.forEach((t, i) => {
    const s = snaps[i]
    const why = !s.exists ? '寫入前複查：文件已不存在'
      : sameGameRef(s.get('gameRef'), t.before) ? null : `寫入前複查：gameRef 在讀取後被改動（現值 ${formatGameRef(s.get('gameRef'))}）`
    if (why) skipped.push({ ...t, reason: why })
    else ok.push({ ...t, snap: s })
  })
  if (!ok.length) return { backupDir: null, written: [], skipped, bump: null, error: null }
  const backupDir = writeBackup(ok, manifestExtra, suffix)
  console.log(`  備份：${path.relative(ROOT, backupDir)}（${ok.length} 份）`)
  const written = []
  let error = null
  for (let i = 0; i < ok.length; i += BATCH_SIZE) {
    const chunk = ok.slice(i, i + BATCH_SIZE)
    const batch = db.batch()
    // 只 update gameRef 一個欄位；precondition：備份之後文件又被改過 → 這一批整批失敗，不覆蓋
    for (const t of chunk) batch.update(t.snap.ref, { gameRef: t.after ?? FieldValue.delete() }, { lastUpdateTime: t.snap.updateTime })
    try {
      await batch.commit()
      written.push(...chunk)
      console.log(`  寫入 ${written.length}／${ok.length}`)
    } catch (e) {
      error = `${e.code ?? ''} ${e.message}`.trim()
      console.error(`✗ 第 ${i / BATCH_SIZE + 1} 批失敗（整批未生效；之前的批次已生效）：${error}`)
      break
    }
  }
  const cols = COLLECTIONS.filter((c) => written.some((t) => t.collection === c))
  const bump = cols.length ? await bumpVersions(db, FieldValue, cols) : null
  if (bump) console.log(`  bump：${cols.join('、')} → ${bump.version}${bump.verified ? '（已確認）' : `（✗ 未生效：${bump.failed.join('、')}）`}`)
  const strip = ({ snap, ...t }) => t
  return { backupDir: path.relative(ROOT, backupDir), written: written.map(strip), skipped: skipped.map(strip), bump, error }
}

// ─── 主程式 ────────────────────────────────────────────────────────────────

async function runRollback(args) {
  if (args.fromBackup) throw new Error('--rollback 要讀正式庫的現值，不能和 --from-backup 一起用')
  const manifest = readJson(path.join(args.rollback, '_manifest.json'))
  // 還原留下的備份夾也能再還原（＝把還原撤掉）：manifest 記的都是「這次操作的 before → after」
  if (manifest.schema !== BACKUP_SCHEMA || !['gameref-backfill', 'gameref-rollback'].includes(manifest.purpose)) throw new Error(`${args.rollback} 不是本腳本 --write 留下的備份夾（_manifest.json 的 schema／purpose 不符）`)
  const fb = await connectFirestore(args.write)
  const snaps = await getAllChunked(fb.db, manifest.writes.map((w) => fb.db.collection(w.collection).doc(w.docId)))
  const current = new Map(manifest.writes.map((w, i) => [itemKey(w.collection, w.docId), snaps[i].exists ? { gameRef: snaps[i].get('gameRef') } : null]))
  const plan = planRollback(manifest.writes, current)
  const todo = plan.filter((p) => p.action === 'restore')
  console.log(`還原預覽：備份 ${path.basename(path.resolve(args.rollback))}（${manifest.createdAt}）共 ${plan.length} 筆；會還原 ${todo.length}、略過 ${plan.length - todo.length}`)
  for (const p of plan.filter((x) => x.action === 'skip')) console.log(`  略過 ${p.key}：${p.reason}`)
  if (!args.write) { console.log('  （預覽：沒有寫入任何東西；確認後加 --write）'); return }
  // 還原這次操作的方向：現值（＝當初寫入的值）→ 寫入前的值（null＝刪掉欄位）
  const targets = todo.map((p) => ({ collection: p.collection, docId: p.docId, before: p.after, after: p.before }))
  const res = await applyUpdates(fb, targets, {
    manifestExtra: { purpose: 'gameref-rollback', rollbackOf: path.resolve(args.rollback) },
    suffix: 'gameref-rollback',
  })
  for (const s of res.skipped) console.log(`  擋下 ${itemKey(s.collection, s.docId)}：${s.reason}`)
  console.log(`✓ 已還原 ${res.written.length} 筆${res.skipped.length ? `；複查擋下 ${res.skipped.length}` : ''}${res.error ? `；✗ 中斷：${res.error}` : ''}`)
  if (res.error) process.exitCode = 1
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.write && args.fromBackup) {
    console.error('✗ --from-backup 是離線試跑，不能和 --write 一起用')
    process.exit(1)
  }
  if (args.rollback) return runRollback(args)

  // ① 建議檔
  const proposalsPath = path.resolve(args.proposals)
  if (!fs.existsSync(proposalsPath)) {
    console.error(`✗ 找不到建議檔：${proposalsPath}\n  先在私有 repo（mecharashi-sim/pipeline）產生 gameref-proposals.json，或用 --proposals 指定`)
    process.exit(1)
  }
  const proposals = readJson(proposalsPath)
  const fileWarnings = checkProposalsFile(proposals)
  const accepted = args.accept ? parseAcceptFile(readJson(path.resolve(args.accept))) : new Set()

  // ② 站上現值 → ③ 決定動作
  const site = await loadSite(args)
  const plan = planBackfill({ proposals, site: site.docs, acceptEquivalent: args.acceptEquivalent, accepted })
  const diff = buildDiff(plan.rows)
  const stats = summarize(plan.rows)
  const tot = totals(stats)
  const summaryMismatch = compareDeclaredSummary(proposals.summary, stats)

  // ④ 寫入
  let writeResult = null
  let writeRefused = false
  if (args.write) {
    if (tot.invalid || summaryMismatch.length) {
      console.error(`✗ 建議檔有 ${tot.invalid} 筆格式不對、統計不符 ${summaryMismatch.length} 項：拒絕寫入。先看報告，交給開發者修私有 pipeline`)
      writeRefused = true
      process.exitCode = 1
    } else if (diff.total) {
      writeResult = await applyUpdates(site, diff.entries, {
        manifestExtra: { purpose: 'gameref-backfill', proposals: { path: proposalsPath, generatedAt: proposals.generatedAt ?? null, buildNum: proposals.dataPackage?.buildNum ?? null } },
        suffix: 'gameref',
      })
      if (writeResult.error) process.exitCode = 1
    } else {
      writeResult = { backupDir: null, written: [], skipped: [], bump: null, error: null }
    }
  }

  // ⑤ 報告
  const today = localDate()
  const uncoveredMissing = Object.values(plan.uncovered).reduce((n, l) => n + l.filter((d) => !d.hasGameRef).length, 0)
  const acceptPath = args.accept ? path.resolve(args.accept) : SUGGESTED_ACCEPT
  const base = ['node scripts/backfill-game-join-keys.mjs', ...(args.proposals !== DEFAULT_PROPOSALS ? [`--proposals ${q(proposalsPath)}`] : [])].join(' ')
  const model = {
    meta: {
      today, reportAt: localIso(), proposalsPath, generatedAt: proposals.generatedAt, buildNum: proposals.dataPackage?.buildNum,
      siteSourceLabel: proposals.siteSource ? `${proposals.siteSource.kind} ${proposals.siteSource.path ?? ''}`.trim() : '?',
      modeLabel: site.mode === 'backup' ? `離線試跑（${site.label}）` : writeResult ? `寫入（${site.label}）` : `dry-run（${site.label}，唯讀）`,
      acceptPath: args.accept ? acceptPath : null, acceptEquivalent: args.acceptEquivalent,
    },
    mode: site.mode, stats, tot, rows: plan.rows, diff, unusedAccept: plan.unusedAccept, uncovered: plan.uncovered, uncoveredMissing,
    nameMismatch: plan.rows.filter((r) => r.nameDiffers).length,
    summaryMismatch, fileWarnings, writeResult, writeRefused, acceptedList: [...accepted],
    cmd: {
      acceptPath,
      dryRun: `${base}${args.accept || tot.actions.holdConfirm ? ` --accept ${q(acceptPath)}` : ''}${args.acceptEquivalent ? ' --accept-equivalent' : ''}`,
      write: `${base} --write${args.accept || tot.actions.holdConfirm ? ` --accept ${q(acceptPath)}` : ''}${args.acceptEquivalent ? ' --accept-equivalent' : ''}`,
      rollback: writeResult?.backupDir ? `node scripts/backfill-game-join-keys.mjs --rollback ${q(writeResult.backupDir)}` : '',
    },
  }
  model.headline = headlineOf(model)
  const outBase = path.join(ROOT, '_local-notes', today.slice(0, 7), `${today}_遊戲身分鍵回填${writeResult ? '' : '_dry-run'}`)
  fs.mkdirSync(path.dirname(outBase), { recursive: true })
  fs.writeFileSync(`${outBase}.html`, renderReport(model), 'utf8')
  fs.writeFileSync(`${outBase}.json`, JSON.stringify({
    meta: model.meta, stats, summaryMismatch, fileWarnings, unusedAccept: plan.unusedAccept, writeResult,
    rows: plan.rows.map((r) => ({ key: r.key, status: r.item?.status, action: r.action, reason: r.reason || undefined, before: r.before, after: r.after })),
  }, null, 1), 'utf8')

  const a = tot.actions
  console.log(`遊戲身分鍵回填：建議檔 ${tot.total} 筆（${model.meta.modeLabel}）`)
  for (const l of model.headline) console.log(`  ${l}`)
  console.log(`  寫入 ${a.write}・已相同 ${a.same}・衝突 ${a.conflict}・待確認 ${a.holdConfirm}・等價待裁決 ${a.holdEquivalent}・站上找不到 ${a.missingDoc}・找不到對照 ${a.unmatched}・不需要 ${a.notApplicable}・格式不對 ${a.invalid}`)
  console.log(`  報告：${path.relative(ROOT, outBase)}.html`)
  if (!args.write) console.log('  （dry-run：沒有寫入任何東西；確認報告後加 --write）')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  })
}
