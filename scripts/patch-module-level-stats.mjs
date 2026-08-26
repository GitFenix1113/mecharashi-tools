/**
 * 補齊 levels[] 未填數值 ／ 修正填錯欄位（模組資料盤點的第三批，也是最後一批）
 *
 * 「頂層數值欄 = 最高級 levels[last] 的鏡像」在 237 筆有 levels 的模組裡 229 筆成立。
 * 前兩支腳本處理掉通用模組那批之後，剩這 5 筆例外，逐一查證後全部可推導。
 *
 * ── 推導依據 ──────────────────────────────────────────────────────────────
 * 每一級的 `description` 本身就逐字寫明數字（「護甲值提升25%」），
 * 所以填值是**從既有文本推導**，不是編造。三個獨立佐證：
 *
 *   ① 同族對照：sub_mod_ 系列其餘 6 筆的頂層與最高級一律填同一個欄位。
 *   ② 通用版對照：sub_mod_火力模組 的通用版 mod_4027「火力模組Ⅰ」
 *      描述逐字相同（「火力值提升 X%」），用的是 firepower_rate 而非 dmg。
 *   ③ 8 級模組的疊加慣例：mod_乘勢模組 每一級都精確等於「基礎值＋最大疊加值」
 *      （2+2=4、3+3=6、4+4=8、5+5=10、7+7=14、8+8=16、9+9=18、12+12=24），
 *      而 mod_獵群模組 依同規則推出的 Lv8＝12+12＝24 正好等於它**現有的頂層 24**
 *      —— 當初填頂層的人用的就是這條規則，等於資料自己交叉驗證了一次。
 *
 * ── 不在範圍內 ────────────────────────────────────────────────────────────
 * 「條件式效果怎麼進傷害模型」（緩衝裝置的 70% 機率、獵群的每台敵機疊加）
 * 是 052-G 的建模題，不是資料題。本腳本只負責讓 levels[] 與 description
 * 及頂層鏡像對得起來；要不要打折、怎麼打折，由模擬器那層決定。
 *
 * 使用方式：
 *   node scripts/patch-module-level-stats.mjs            ← dry-run（唯讀，逐欄 diff）
 *   node scripts/patch-module-level-stats.mjs --apply    ← 確認後寫入 + bump modules 版本
 *   node scripts/patch-module-level-stats.mjs --restore <快照> --apply   ← 還原
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ASSUME_YES = args.includes('--yes')
const RESTORE_IDX = args.indexOf('--restore')
const RESTORE_FILE = RESTORE_IDX >= 0 ? args[RESTORE_IDX + 1] : null
const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')

/** 小工具：把一個欄位在各級展開成 FIXES 條目。 */
const levelSeries = (id, field, values, from = 0) =>
  values.map((to, i) => ({ id, p: `levels[${i}].${field}`, from, to }))

const FIXES = [
  // ── ① sub_mod_火力模組：levels 填到了 dmg，該是 firepower_rate ────────────
  //   描述四級都寫「火力值提升 X%」，頂層也已是 firepower_rate=10。
  //   通用版 mod_4027 描述逐字相同、用的正是 firepower_rate 3/5/7/10。
  //   留著的話，模擬器會把它算成「傷害 +10%」而不是「火力值 +10%」——兩個完全不同的量。
  ...levelSeries('sub_mod_火力模組', 'dmg', [0, 0, 0, 0]).map((f, i) =>
    ({ ...f, from: [3, 5, 7, 10][i] })),
  ...levelSeries('sub_mod_火力模組', 'firepower_rate', [3, 5, 7, 10]),

  // ── ② mod_2003 撕裂框架：頂層漏了兩個效果中的一個 ────────────────────────
  //   描述是「造成暴擊後使回避率提升15%，完全回避後使暴擊率提升15%」，兩個效果。
  //   levels[] 兩個欄位都填了（3/6/10/15），頂層卻只有 crit_rate=15、缺 dodge_rate。
  { id: 'mod_2003', p: 'dodge_rate', from: 0, to: 15 },

  // ── ③ mod_1008 緩衝裝置：levels[] 未填 ──────────────────────────────────
  //   「遭受傷害時有 N% 的概率發動，護甲值提升 X%」——X 為 25/30/35/45，頂層已是 45。
  //   （發動機率是條件層，屬 052-G 的建模題，不入數值欄。）
  ...levelSeries('mod_1008', 'armor_rate', [25, 30, 35, 45]),

  // ── ④ mod_凌嘯框架：levels[] 未填，且頂層也漏了兩效果中的一個 ────────────
  //   「最大耐久值提升 A%,主動攻擊前若未移動過,傷害提升 B%」
  //   A = 3/6/10/15、B = 5/10/15/25。頂層已有 dmg=25，缺 durable_rate=15。
  ...levelSeries('mod_凌嘯框架', 'durable_rate', [3, 6, 10, 15]),
  ...levelSeries('mod_凌嘯框架', 'dmg', [5, 10, 15, 25]),
  { id: 'mod_凌嘯框架', p: 'durable_rate', from: 0, to: 15 },

  // ── ⑤ mod_獵群模組：8 級模組，levels[] 全未填 ───────────────────────────
  //   依 8 級模組的疊加慣例（基礎值＋最大疊加值），逐級為
  //   3+3、4+4、5+5、6+6、7+7、8+8、9+9、12+12 = 6/8/10/12/14/16/18/24。
  //   Lv8 的 24 與現有頂層 24 吻合，互為佐證。
  ...levelSeries('mod_獵群模組', 'dmg', [6, 8, 10, 12, 14, 16, 18, 24]),
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

function parsePath(p) {
  return p.split('.').flatMap(seg => {
    const m = seg.match(/^([^[]+)((\[\d+\])*)$/)
    if (!m) throw new Error(`路徑無法解析：${p}`)
    const keys = [m[1]]
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) keys.push(Number(idx[1]))
    return keys
  })
}
const getPath = (obj, p) => parsePath(p).reduce((o, k) => (o == null ? undefined : o[k]), obj)
function setPath(obj, p, v) {
  const keys = parsePath(p)
  const last = keys.pop()
  keys.reduce((o, k) => o[k], obj)[last] = v
}

async function bumpModules() {
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: { modules: version },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return version
}

async function restore() {
  const snap = JSON.parse(fs.readFileSync(resolve(ROOT, RESTORE_FILE), 'utf-8'))
  console.log(`還原快照：${RESTORE_FILE}（${snap.docs.length} 份模組）`)
  if (!APPLY) { console.log('（dry-run。加 --apply 才會寫入）'); return }
  if (!await promptConfirm('確認還原？ [y/N] ')) { console.log('已取消。'); return }
  const batch = db.batch()
  for (const d of snap.docs) batch.set(db.collection('modules').doc(d.id), d.data)
  await batch.commit()
  console.log(`\n✅ 已還原，modules 版本已 bump → ${await bumpModules()}`)
}

async function main() {
  initFirebase()
  if (RESTORE_FILE) return restore()

  const ids = [...new Set(FIXES.map(f => f.id))]
  const snaps = await Promise.all(ids.map(id => db.collection('modules').doc(id).get()))
  const docs = new Map()
  for (let i = 0; i < ids.length; i++) {
    if (!snaps[i].exists) throw new Error(`找不到 modules/${ids[i]}`)
    docs.set(ids[i], snaps[i].data())
  }

  const drift = []
  for (const f of FIXES) {
    const cur = getPath(docs.get(f.id), f.p)
    const now = cur === undefined ? 0 : cur
    if (now !== f.from) drift.push(`${f.id} · ${f.p}：現值 ${JSON.stringify(cur)}，預期 ${JSON.stringify(f.from)}`)
  }
  if (drift.length) {
    console.log('❌ 現值與預期不符，資料可能已被改過。中止，未寫入任何東西：')
    drift.forEach(s => console.log(`   · ${s}`))
    process.exit(1)
  }

  console.log('── 將修改 ──────────────────────────────────────────────────')
  for (const id of ids) {
    const d = docs.get(id)
    console.log(`\n  modules/${id}   「${d.name}」  ${d.slot}  managedBy=${d.managedBy}`)
    console.log(`     「${d.description}」`)
    for (const f of FIXES.filter(x => x.id === id)) {
      console.log(`      ${f.p.padEnd(30)} ${JSON.stringify(f.from)}  →  ${JSON.stringify(f.to)}`)
    }
  }
  console.log(`\n  合計 ${FIXES.length} 個欄位、${ids.length} 份文件。之後 bump modules 版本。`)

  if (!APPLY) { console.log('\n（dry-run，未寫入任何東西。確認無誤後加 --apply）'); return }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(OUT_DIR, `module-level-stats-backup-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({ docs: ids.map(id => ({ id, data: docs.get(id) })) }, null, 2), 'utf-8')
  console.log(`\n💾 還原快照：${path.relative(ROOT, backupFile)}`)
  console.log(`   還原：node scripts/patch-module-level-stats.mjs --restore "${path.relative(ROOT, backupFile)}" --apply`)

  if (!await promptConfirm('\n確認寫入 Firestore？ [y/N] ')) { console.log('已取消。'); return }

  const batch = db.batch()
  for (const id of ids) {
    const next = JSON.parse(JSON.stringify(docs.get(id)))
    for (const f of FIXES.filter(x => x.id === id)) setPath(next, f.p, f.to)
    batch.set(db.collection('modules').doc(id), next)
  }
  await batch.commit()
  console.log(`  …已更新 ${ids.length} 份模組`)

  console.log(`\n✅ 完成。modules 版本已 bump → ${await bumpModules()}`)
  console.log('   下一步：node scripts/export-emulator-slice.mjs --simulator（讓本機種子跟上）')
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1) })
