/**
 * 模組庫的大小寫孿生 —— `MOD_折光陣列` / `mod_折光陣列`
 *
 * 242 筆模組裡 id 前綴分佈是 `mod_` × 230、`sub_` × 11、`MOD_` × 1，
 * 就這一筆大寫。兩份 doc 逐欄比對（忽略 id 與欄位順序）**內容完全相同**，
 * 是同一個模組存了兩份，成因與 PLAN-032 follow-up 1a 的技能孿生同一類
 * （後台撞名防呆只查 `makeEntityId` 產出的小寫形式，看不到大寫那批）。
 *
 * ── 為什麼正本取小寫 ────────────────────────────────────────────────────────
 * 技能孿生那支要「逐欄比完整度」挑正本，這裡不必——兩份內容一模一樣，
 * 挑哪份都不損失資料。決定權在**外部已經指過來的東西**：
 *
 *   · `src/utils/loadoutCode/shareIdRegistry.json` 已把分享號 1500034 發給小寫那筆。
 *     登錄簿是只進不出的（號碼發出去就等於印在別人存下來的分享碼裡），
 *     改判大寫當正本＝作廢一個已發出的號碼，代價比改一個 mech 欄位大得多。
 *   · `src/utils/loadoutCode/shareId.ts` 的號碼守門刻意大小寫敏感，本來就不吃大寫。
 *   · 全站 230 : 1 的 id 慣例站在小寫這邊。
 *
 * 唯一指向大寫的是 `mechs/mech_086_棱鏡.module4Id`，改它一個欄位就收工。
 *
 * ⚠ 本腳本**不**做全面 ID 正規化，只處理這一組真重複——理由同技能那支：
 *   剩下的只是「看起來不整齊」，而每次改號都會在熱度統計留下幽靈 key。
 *
 * 使用方式：
 *   node scripts/migrate-module-casing-twin.mjs            ← dry-run（唯讀，印出將要做的事）
 *   node scripts/migrate-module-casing-twin.mjs --apply    ← 互動確認後寫入 + bump 版本
 *   node scripts/migrate-module-casing-twin.mjs --restore <快照> --apply   ← 還原
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const LOSER = 'MOD_折光陣列'
const WINNER = 'mod_折光陣列'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
// 非互動環境（CI、agent shell）沒有 stdin，readline 會直接讀到 EOF。
// --yes 讓確認改由呼叫端負責，語意與其他遷移腳本的 [y/N] 相同。
const ASSUME_YES = args.includes('--yes')
const RESTORE_IDX = args.indexOf('--restore')
const RESTORE_FILE = RESTORE_IDX >= 0 ? args[RESTORE_IDX + 1] : null

const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')

// 掃描引用的集合。模組 id 可能出現在機甲的 moduleNId、機師配裝、元件套裝…
// 漏掉一個就是留下一條指向已刪 doc 的斷鏈，故寧可全掃（總量約 1,100 份，一次 get 不痛）。
const COLLS = [
  'modules', 'mechs', 'pilots', 'weapons', 'backpacks', 'backpackSkills',
  'components', 'forms', 'buffs', 'pilotSkills', 'neuralDriveAbilities', 'glossaryTerms',
]

let db

function loadEnv(filename) {
  const envPath = resolve(ROOT, filename)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const eqIdx = line.indexOf('=')
    if (eqIdx > 0) {
      const k = line.slice(0, eqIdx).trim()
      const v = line.slice(eqIdx + 1).trim()
      if (k && v && !k.startsWith('#')) process.env[k] = v
    }
  })
}

function initFirebase() {
  loadEnv('.env')
  loadEnv('.env.migration')
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定')
  const abs = resolve(ROOT, credPath)
  if (!fs.existsSync(abs)) throw new Error(`找不到服務帳號金鑰：${abs}`)
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(abs, 'utf-8'))) })
  db = admin.firestore()
}

function promptConfirm(q) {
  if (ASSUME_YES) { console.log(`${q}y（--yes）`); return Promise.resolve(true) }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}

/** 遞迴把值裡等於 LOSER 的字串換成 WINNER，回傳 [新值, 換了幾處, 路徑清單]。 */
function replaceDeep(value, prefix = '') {
  if (typeof value === 'string') {
    return value === LOSER ? [WINNER, 1, [prefix]] : [value, 0, []]
  }
  if (Array.isArray(value)) {
    let n = 0
    const paths = []
    const out = value.map((v, i) => {
      const [nv, c, p] = replaceDeep(v, `${prefix}[${i}]`)
      n += c; paths.push(...p)
      return nv
    })
    return [out, n, paths]
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    let n = 0
    const paths = []
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const [nv, c, p] = replaceDeep(v, prefix ? `${prefix}.${k}` : k)
      out[k] = nv; n += c; paths.push(...p)
    }
    return [out, n, paths]
  }
  return [value, 0, []]
}

/** 忽略 id 與欄位順序的深層正規化，用來證明兩份 doc 真的是同一份。 */
function normalize(doc) {
  const sortDeep = v => Array.isArray(v)
    ? v.map(sortDeep)
    : (v && typeof v === 'object' && !(v instanceof Date)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]))
      : v)
  const clone = JSON.parse(JSON.stringify(doc))
  delete clone.id
  return JSON.stringify(sortDeep(clone))
}

async function bumpVersions(colls) {
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: Object.fromEntries(colls.map(c => [c, version])),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return version
}

async function restore() {
  const snap = JSON.parse(fs.readFileSync(resolve(ROOT, RESTORE_FILE), 'utf-8'))
  console.log(`還原快照：${RESTORE_FILE}`)
  console.log(`  · 復原 ${snap.docs.length} 份引用文件`)
  console.log(`  · 復原 ${snap.deleted.length} 份已刪模組`)
  if (!APPLY) { console.log('\n（dry-run。加 --apply 才會寫入）'); return }
  if (!await promptConfirm('確認還原？ [y/N] ')) { console.log('已取消。'); return }

  const batch = db.batch()
  for (const d of snap.docs) batch.set(db.collection(d.coll).doc(d.id), d.data)
  for (const d of snap.deleted) batch.set(db.collection('modules').doc(d.id), d.data)
  await batch.commit()
  const v = await bumpVersions([...new Set([...snap.docs.map(d => d.coll), 'modules'])])
  console.log(`\n✅ 已還原，版本已 bump → ${v}`)
}

async function main() {
  initFirebase()
  if (RESTORE_FILE) return restore()

  // ── 1. 確認兩份 doc 仍在、且內容仍然相同 ────────────────────────────────
  const [loserSnap, winnerSnap] = await Promise.all([
    db.collection('modules').doc(LOSER).get(),
    db.collection('modules').doc(WINNER).get(),
  ])
  if (!loserSnap.exists) {
    console.log(`✅ 找不到 ${LOSER}，看來已經處理過了，無事可做。`)
    return
  }
  if (!winnerSnap.exists) {
    throw new Error(`正本 ${WINNER} 不存在——不能刪掉唯一一份。請先確認資料狀態。`)
  }
  const loser = { id: LOSER, ...loserSnap.data() }
  const winner = { id: WINNER, ...winnerSnap.data() }
  const identical = normalize(loser) === normalize(winner)

  console.log('── 孿生比對 ────────────────────────────────────────────')
  console.log(`  輸家 ${LOSER}  name=${loser.name} rarity=${loser.rarity} managedBy=${loser.managedBy}`)
  console.log(`  正本 ${WINNER}  name=${winner.name} rarity=${winner.rarity} managedBy=${winner.managedBy}`)
  console.log(`  內容是否完全相同（忽略 id 與欄位順序）：${identical ? '是' : '❌ 否'}`)
  if (!identical) {
    // 內容不同＝這不是單純的重複，合併等於替使用者決定哪個版本是對的，腳本猜不得。
    console.log('\n❌ 兩份內容不一致，本腳本只處理「內容相同」的純重複。請人工裁決後再跑。')
    process.exit(1)
  }

  // ── 2. 全站掃引用 ──────────────────────────────────────────────────────
  console.log('\n── 掃描引用 ────────────────────────────────────────────')
  const updates = []
  for (const coll of COLLS) {
    const snap = await db.collection(coll).get()
    for (const doc of snap.docs) {
      if (coll === 'modules' && doc.id === LOSER) continue // 輸家自己等一下要刪
      const before = doc.data()
      const [after, count, paths] = replaceDeep(before)
      if (count > 0) {
        updates.push({ coll, id: doc.id, before, after, paths })
        console.log(`  ${coll}/${doc.id}`)
        paths.forEach(p => console.log(`      └ ${p}`))
      }
    }
  }
  if (!updates.length) console.log('  （沒有任何文件引用它）')

  console.log('\n── 將執行 ──────────────────────────────────────────────')
  console.log(`  1. 改寫 ${updates.length} 份文件的引用：${LOSER} → ${WINNER}`)
  console.log(`  2. 刪除 modules/${LOSER}`)
  const touched = [...new Set([...updates.map(u => u.coll), 'modules'])]
  console.log(`  3. bump 版本：${touched.join(' / ')}`)

  if (!APPLY) {
    console.log('\n（dry-run，未寫入任何東西。確認無誤後加 --apply）')
    return
  }

  // ── 3. 快照 ────────────────────────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(OUT_DIR, `module-casing-twin-backup-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({
    docs: updates.map(u => ({ coll: u.coll, id: u.id, data: u.before })),
    deleted: [{ id: LOSER, data: loserSnap.data() }],
  }, null, 2), 'utf-8')
  console.log(`\n💾 還原快照：${path.relative(ROOT, backupFile)}`)
  console.log(`   還原：node scripts/migrate-module-casing-twin.mjs --restore "${path.relative(ROOT, backupFile)}" --apply`)

  if (!await promptConfirm('\n確認寫入 Firestore？ [y/N] ')) { console.log('已取消。'); return }

  // 順序：先改引用 → 再刪輸家。反過來的話，中途失敗會留下指向不存在 doc 的斷鏈。
  const batch = db.batch()
  for (const u of updates) batch.set(db.collection(u.coll).doc(u.id), u.after)
  await batch.commit()
  console.log(`  …引用已改寫 ${updates.length} 份`)

  await db.collection('modules').doc(LOSER).delete()
  console.log(`  …已刪除 modules/${LOSER}`)

  const version = await bumpVersions(touched)
  console.log(`\n✅ 完成。版本已 bump：${touched.join(' / ')} → ${version}`)
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1) })
