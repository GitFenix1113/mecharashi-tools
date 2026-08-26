/**
 * 分享碼身分守門 —— PLAN-052-C Phase A / A-1
 *
 * ── 這支腳本在防什麼 ────────────────────────────────────────────────────────
 * 分享碼裡存的是**號碼**（`mod_4001` → 4001），不是名字。號碼由 doc id 推導而來，
 * 所以「doc id 的號碼那一段被改掉」＝**所有已流出的分享碼靜默指向另一個實體**。
 * 而本專案確實會改 doc id（2026-08-17 的備份裡 mechs／pilots 各有 6 筆無流水號，
 * 08-23 才補號）；`src/utils/idSlug.ts` 的 `maxEntitySeq()` 又是「掃現有 ID 取 max」，
 * 刪掉 178 再新增就會再次產生 178。
 *
 * `share-id.lock.json` 是**已核可的號碼對照快照**（人工指派的別名在
 * `src/utils/loadoutCode/shareIdRegistry.json`，兩者的分工見下方 LOCK_PATH 註解），
 * 這支腳本拿線上資料跟它對帳：
 *   · 改指（同一個號碼指到不同文件）→ exit 1
 *   · 消失（號碼不見了，舊碼從此解成「已下架」）→ exit 1
 *   · 撞號 / 別名越界 / 別名指向不存在的文件 → exit 1
 *   · 純新增 → exit 0（但會提示 lock 落後，請跑 --accept）
 *
 * 純新增刻意不擋：每次改版都會新增實體，讓它每次都紅會訓練出「無視這支腳本」的習慣。
 * 而 lock 落後的降級是溫和的 —— 只有**新增的那幾筆**沒被保護，既有的照樣擋得住。
 *
 * ⚠ **這支必須寫進 data-patch skill 的流程**（與 bump 版本同一時機）。
 *   否則哪天有人「順手整理流水號」，炸掉的是全部存檔與已流出的分享碼。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *   node scripts/check-share-ids.mjs            驗證（唯讀，CI／改資料後跑）
 *   node scripts/check-share-ids.mjs --accept   人工確認後把觀測結果寫回 lock
 *   node scripts/check-share-ids.mjs --init     首次建立 lock（已存在則需 --force）
 *   node scripts/check-share-ids.mjs --json     機器可讀輸出
 *
 * 讀線上資料用專案根目錄的 `serviceAccountKey.json`（不進版控）。
 * 只呼叫 `listDocuments()`（取 id、不取內容），六個集合合計約 990 份文件。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildShareIndex, assertNoCollisions, ALIAS_BASE, SHARE_ID_MAX } from '../src/utils/loadoutCode/shareId.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 兩個檔案，按**擁有權**拆，內容不重疊：
 *
 *   · `shareIdRegistry.json`（在 src 內）＝ **決定**。人工指派的別名 ＋ 號碼水位。
 *     只有這一份會進 bundle（≈2KB），因為只有它是執行期需要的：
 *     codec 要 aliases、後台續號要 maxAssigned。
 *
 *   · `share-id.lock.json`（專案根目錄）＝ **觀測**。線上號碼的完整快照（≈34KB），
 *     純粹給這支腳本對帳用，**前端永遠不 import**。
 *
 * 為什麼不合成一個檔：合起來就得二選一 —— 放 src 讓 34KB 的推導快照進 bundle，
 * 或放根目錄讓前端 import 不到（`tsconfig.app.json` 的 include 只有 `src`）。
 * 兩者的生命週期本來就不同：別名是永久承諾、快照每次改資料都會變。
 */
export const LOCK_PATH = path.resolve(__dirname, '../share-id.lock.json')
export const REGISTRY_PATH = path.resolve(__dirname, '../src/utils/loadoutCode/shareIdRegistry.json')

/** kind → Firestore 集合名。與 `ShareIdKind` 一一對應，六個都要在。 */
export const KIND_COLLECTIONS = Object.freeze({
  pilot: 'pilots',
  mech: 'mechs',
  weapon: 'weapons',
  component: 'components',
  backpack: 'backpacks',
  module: 'modules',
})

// ─── 純邏輯（可單測，不碰 Firestore／檔案系統）────────────────────────────────

/**
 * 把一個 kind 的線上 doc id 清單整理成 lock 檔的「觀測區」形狀。
 *
 * ⚠ `maxAssigned` 是**歷史最高水位，只增不減**：呼叫端要傳入 lock 裡的舊值。
 *   若改成「重算目前最大值」，刪掉最後一筆就會讓水位倒退，
 *   後台續號於是重新發出那個號碼 —— 正是這整套機制要防的回收。
 */
export function observeKind(kind, docIds, aliases = {}, prevMaxAssigned = 0) {
  const index = buildShareIndex(kind, docIds, aliases)
  const derived = {}
  let max = prevMaxAssigned
  for (const docId of [...docIds].sort()) {
    const n = index.toShareId(docId)
    if (n === null) continue
    if (aliases[docId] !== undefined && n === aliases[docId]) continue // 別名區不進 derived
    derived[n] = docId
    if (n > max) max = n
  }
  return {
    collection: KIND_COLLECTIONS[kind],
    maxAssigned: max,
    derived,
    unshareable: [...index.unshareable].sort(),
    _index: index,
  }
}

/**
 * 觀測值 vs lock 的差異。**分類本身就是嚴重度**：
 * `repointed` / `removed` 會讓既有分享碼指錯或解不開，`added` 不會影響任何舊碼。
 */
export function diffKind(observed, locked) {
  const prev = locked?.derived ?? {}
  const next = observed.derived
  const added = [], removed = [], repointed = []
  for (const [n, docId] of Object.entries(next)) {
    if (prev[n] === undefined) added.push({ shareId: Number(n), docId })
    else if (prev[n] !== docId) repointed.push({ shareId: Number(n), from: prev[n], to: docId })
  }
  for (const [n, docId] of Object.entries(prev)) {
    if (next[n] === undefined) removed.push({ shareId: Number(n), docId })
  }
  const cmp = (a, b) => a.shareId - b.shareId
  return { added: added.sort(cmp), removed: removed.sort(cmp), repointed: repointed.sort(cmp) }
}

/**
 * 別名區的健全性檢查。別名是人工寫進 lock 的，所以錯法跟推導區不同：
 * 寫錯號碼段（掉進推導區）會撞號、指向已刪文件會讓舊碼解不開。
 */
export function checkAliases(aliases, index) {
  const outOfBand = Object.entries(aliases)
    .filter(([, n]) => !Number.isInteger(n) || n < ALIAS_BASE || n > SHARE_ID_MAX)
    .map(([docId, n]) => ({ docId, shareId: n }))
  const dupes = new Map()
  for (const [docId, n] of Object.entries(aliases)) {
    if (!dupes.has(n)) dupes.set(n, [])
    dupes.get(n).push(docId)
  }
  const reused = [...dupes.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([shareId, docIds]) => ({ shareId, docIds: docIds.sort() }))
  return { outOfBand, reused, stale: [...(index?.staleAliases ?? [])].sort() }
}

/** 有沒有致命問題（＝會讓既有分享碼指錯或解不開）。 */
export function isFatal(report) {
  return Object.values(report.kinds).some(
    (k) =>
      k.diff.repointed.length ||
      k.diff.removed.length ||
      k.collisions.length ||
      k.aliasIssues.outOfBand.length ||
      k.aliasIssues.reused.length ||
      k.aliasIssues.stale.length,
  )
}

// ─── Firestore ───────────────────────────────────────────────────────────────

async function readLiveDocIds() {
  const keyPath = path.resolve(__dirname, '../serviceAccountKey.json')
  if (!fs.existsSync(keyPath)) {
    console.error('✗ 找不到 serviceAccountKey.json（專案根目錄）。')
    console.error('  Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰。')
    process.exit(1)
  }
  const { default: admin } = await import('firebase-admin')
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) })
  const db = admin.firestore()
  const out = {}
  for (const [kind, coll] of Object.entries(KIND_COLLECTIONS)) {
    // listDocuments()：只取 DocumentReference，不讀文件內容
    out[kind] = (await db.collection(coll).listDocuments()).map((r) => r.id)
  }
  return out
}

// ─── 報表 ────────────────────────────────────────────────────────────────────

function buildReport(live, lock, registry) {
  const kinds = {}
  for (const kind of Object.keys(KIND_COLLECTIONS)) {
    const locked = lock?.kinds?.[kind]
    const reg = registry?.kinds?.[kind]
    const aliases = reg?.aliases ?? {}
    const observed = observeKind(kind, live[kind], aliases, reg?.maxAssigned ?? 0)
    kinds[kind] = {
      observed,
      aliases,
      diff: diffKind(observed, locked),
      collisions: observed._index.collisions,
      aliasIssues: checkAliases(aliases, observed._index),
    }
  }
  return { kinds }
}

function printReport(report, { hasLock }) {
  const pad = (s, n) => String(s).padEnd(n)
  console.log('\n  kind        線上   可分享   別名   最高水位   不可分享')
  console.log('  ' + '─'.repeat(58))
  for (const [kind, k] of Object.entries(report.kinds)) {
    const idx = k.observed._index
    console.log(
      `  ${pad(kind, 11)} ${pad(Object.keys(k.observed.derived).length + Object.keys(k.aliases).length + k.observed.unshareable.length, 6)} ` +
      `${pad(idx.size, 8)} ${pad(Object.keys(k.aliases).length, 6)} ${pad(k.observed.maxAssigned, 10)} ${k.observed.unshareable.length}`,
    )
  }

  let fatal = 0, additions = 0
  for (const [kind, k] of Object.entries(report.kinds)) {
    const { added, removed, repointed } = k.diff
    const ai = k.aliasIssues
    additions += added.length
    if (!hasLock) continue

    for (const r of repointed) {
      fatal++
      console.log(`\n  ‼ [${kind}] 號碼 #${r.shareId} 改指了`)
      console.log(`      lock: ${r.from}`)
      console.log(`      線上: ${r.to}`)
      console.log('      ⇒ 所有含這個號碼的既有分享碼都會解成另一個實體。')
      console.log('        改名（號碼那段沒動）請跑 --accept 核可；改號請把 doc id 改回去。')
    }
    for (const r of removed) {
      fatal++
      console.log(`\n  ‼ [${kind}] 號碼 #${r.shareId}（${r.docId}）消失了`)
      console.log('      ⇒ 含這個號碼的既有分享碼會解成「已下架裝備」。')
      console.log('        確認是刻意刪除／改號後才跑 --accept。')
    }
    for (const c of k.collisions) {
      fatal++
      console.log(`\n  ‼ [${kind}] 號碼 #${c.shareId} 撞號：${c.docIds.join(' / ')}`)
      console.log('      ⇒ 該號碼已被整個剔除（不會指向錯的實體），但這兩份文件都變成不可分享。')
    }
    for (const a of ai.outOfBand) {
      fatal++
      console.log(`\n  ‼ [${kind}] 別名 ${a.docId} = ${a.shareId} 不在別名區（${ALIAS_BASE}‥${SHARE_ID_MAX}）`)
      console.log('      ⇒ 落進推導區就可能與未來的新實體撞號。')
    }
    for (const a of ai.reused) {
      fatal++
      console.log(`\n  ‼ [${kind}] 別名號碼 #${a.shareId} 被指派給多份文件：${a.docIds.join(' / ')}`)
    }
    for (const docId of ai.stale) {
      fatal++
      console.log(`\n  ‼ [${kind}] 別名指向不存在的文件：${docId}`)
      console.log('      ⇒ 那個號碼從此解不開。把別名改指到新 doc id 可以救回舊碼。')
    }
    if (added.length) {
      const head = added.slice(0, 6).map((a) => `#${a.shareId} ${a.docId}`).join('、')
      console.log(`\n  + [${kind}] 新增 ${added.length} 筆：${head}${added.length > 6 ? ' …' : ''}`)
    }
  }
  return { fatal, additions }
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const MODE = { init: args.includes('--init'), accept: args.includes('--accept'), json: args.includes('--json'), force: args.includes('--force') }

  const hasLock = fs.existsSync(LOCK_PATH)
  if (MODE.init && hasLock && !MODE.force) {
    console.error('✗ share-id.lock.json 已存在。要重建請加 --force（會丟掉既有的號碼核可紀錄）。')
    process.exit(1)
  }
  if (!MODE.init && !hasLock) {
    console.error('✗ 找不到 share-id.lock.json。首次建立請跑：node scripts/check-share-ids.mjs --init')
    process.exit(1)
  }

  const lock = hasLock && !(MODE.init && MODE.force) ? JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')) : null
  // registry 是人工區：即使 --init --force 重建觀測快照，別名也絕不能被沖掉
  const registry = fs.existsSync(REGISTRY_PATH) ? JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) : null
  const live = await readLiveDocIds()
  const report = buildReport(live, lock, registry)

  if (MODE.json) {
    const out = {}
    for (const [kind, k] of Object.entries(report.kinds)) {
      out[kind] = { diff: k.diff, collisions: k.collisions, aliasIssues: k.aliasIssues, size: k.observed._index.size }
    }
    console.log(JSON.stringify({ fatal: isFatal(report), kinds: out }, null, 2))
    process.exit(isFatal(report) ? 1 : 0)
  }

  console.log('分享碼身分對帳 —— share-id.lock.json vs 線上 Firestore')
  const { fatal, additions } = printReport(report, { hasLock: hasLock && !MODE.init })

  if (MODE.init || MODE.accept) {
    if (fatal && !MODE.force && MODE.accept) {
      // --accept 的意思就是「我確認過這些變動」，所以致命項也照收；只是要講清楚收了什麼
      console.log(`\n  ⚠ 連同 ${fatal} 項致命變動一起核可 —— 既有分享碼會受影響，確認這是你要的。`)
    }
    const today = new Date().toISOString().slice(0, 10)

    // ① 決定（進 bundle）：別名原樣搬過去 —— 腳本永不改寫人工指派的號碼
    const nextRegistry = {
      fmt: 1,
      note: '分享碼的「決定」：人工指派的永久別名 ＋ 號碼水位。別名一旦寫下就不再更動（見 PLAN-052-C 決策三）。maxAssigned 由 scripts/check-share-ids.mjs --accept 維護，只增不減。',
      aliasBase: ALIAS_BASE,
      shareIdMax: SHARE_ID_MAX,
      kinds: {},
    }
    // ② 觀測（CI 用，不進 bundle）
    const nextLock = {
      fmt: 1,
      note: '線上號碼的已核可快照，供 scripts/check-share-ids.mjs 對帳。前端不 import 這個檔；人工指派的別名在 src/utils/loadoutCode/shareIdRegistry.json。',
      updatedAt: today,
      kinds: {},
    }
    for (const [kind, k] of Object.entries(report.kinds)) {
      nextRegistry.kinds[kind] = { maxAssigned: k.observed.maxAssigned, aliases: k.aliases }
      nextLock.kinds[kind] = {
        collection: k.observed.collection,
        derived: k.observed.derived,
        unshareable: k.observed.unshareable,
      }
    }
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(nextRegistry, null, 2) + '\n', 'utf8')
    fs.writeFileSync(LOCK_PATH, JSON.stringify(nextLock, null, 2) + '\n', 'utf8')
    console.log(`\n  ✓ 已寫入 ${path.relative(process.cwd(), REGISTRY_PATH)}（決定）`)
    console.log(`  ✓ 已寫入 ${path.relative(process.cwd(), LOCK_PATH)}（觀測）`)
    process.exit(0)
  }

  if (fatal) {
    console.log(`\n✗ ${fatal} 項致命變動 —— 既有分享碼會指錯或解不開。`)
    console.log('  確認過後跑：node scripts/check-share-ids.mjs --accept')
    process.exit(1)
  }
  if (additions) {
    console.log(`\n✓ 沒有改指或消失。lock 落後 ${additions} 筆新增，請跑 --accept 更新。`)
    process.exit(0)
  }
  console.log('\n✓ 完全一致。')
  process.exit(0)
}

// 被 import 時（單測）不要跑 CLI，也不要碰 Firestore
if (import.meta.main) await main()
