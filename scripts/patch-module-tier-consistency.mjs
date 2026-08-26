/**
 * 通用模組的分級一致性修正（承 patch-module-tier2-keyin.mjs 之後）
 *
 * 前一支修的是「Ⅱ 級複製 Ⅰ 級時抓錯行」；這一支修的是盤點時一併查出、
 * 且已由使用者逐項確認過的四類偏離。
 *
 * ── 依據的兩條不變量 ──────────────────────────────────────────────────────
 * ① Ⅰ 級 = A 級 / moduleAddLevel 1；Ⅱ 級 = S 級 / moduleAddLevel 2。
 *   （S 級一顆佔 2 階，兩顆滿 LV4；A 級一顆 1 階，要四顆。）31 組裡 29 組符合。
 * ② 頂層數值欄 = 最高級 `levels[last]` 的鏡像。237 筆有 levels 的模組裡 229 筆符合。
 *
 * ── 爬蟲會不會洗回 ────────────────────────────────────────────────────────
 * scrape-modules.js 對 `moduleAddLevel` / `rarity` / 各數值欄都是 `prev?.x ?? 預設`，
 * **保留 Firestore 現值**，故 ①②③ 的修正安全。唯獨 `name` 是 displayName 直接覆寫。
 *
 * ── 關於「防爆」→「防暴」（本腳本唯一覆寫官方用字之處）────────────────────
 * mod_4008 是 managedBy=auto，也就是**官方 API 給的就是「防爆模組」**；
 * 手工建的 mod_4008_2 才寫「防暴模組Ⅱ」。四級描述一致寫「被暴擊率降低 X%」，
 * 語意上「防暴（擊）」才對，使用者已確認以「防暴」為準。
 *
 * 這不是修我們自己的錯，是覆寫官方用字，所以：
 *   · **不**塞進 lib/textFixes.mjs——那張表明著只收 OpenCC 過度轉換（「迴避」→「回避」），
 *     防爆／防暴 在簡體本來就是兩個不同的字，不是轉換造成的，混進去會汙染該表的語意。
 *   · 改把 mod_4008 的 managedBy 翻成 'manual'。爬蟲遇到 manual 直接整份跳過，
 *     名稱就不會被洗回。代價是這份文件從此不吃官方更新——官方已半年未更新，
 *     且使用者已表明後續走手動維護，接受此代價。
 *   · sub_mod_防爆模組 的 **doc id 不動**（改 id 會在熱度統計留幽靈 key），只改 name。
 *
 * 使用方式：
 *   node scripts/patch-module-tier-consistency.mjs            ← dry-run（唯讀，逐欄 diff）
 *   node scripts/patch-module-tier-consistency.mjs --apply    ← 確認後寫入 + bump modules 版本
 *   node scripts/patch-module-tier-consistency.mjs --restore <快照> --apply   ← 還原
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

const FIXES = [
  // ── ① 分級欄位打錯 ──────────────────────────────────────────────────────
  // mod_4002_2 是 S 級、名稱作 Ⅱ，其餘 30 組 Ⅱ 級的 moduleAddLevel 都是 2。
  // 留著 1 的話，模擬器會要四顆暴擊模組Ⅱ 才滿階，而遊戲裡兩顆就滿。
  { id: 'mod_4002_2', p: 'moduleAddLevel', from: 1, to: 2 },

  // mod_4011 名稱作 Ⅰ 且 moduleAddLevel=1，其 Ⅱ 級 mod_4011_2 已存在（S/2）。
  // 其餘 30 組 Ⅰ 級都是 A，這筆掛 S 會讓稀有度篩選把它歸錯邊。
  { id: 'mod_4011', p: 'rarity', from: 'S', to: 'A' },

  // ── ② 用字：防爆 → 防暴（覆寫官方用字，理由見檔頭）──────────────────────
  { id: 'mod_4008',        p: 'name',      from: '防爆模組Ⅰ', to: '防暴模組Ⅰ' },
  { id: 'mod_4008',        p: 'managedBy', from: 'auto',      to: 'manual' },
  { id: 'sub_mod_防爆模組', p: 'name',      from: '防爆模組',   to: '防暴模組' },

  // ── ③ Ⅰ 級 levels[] 數值未填，照同編號 Ⅱ 級對照補上 ──────────────────────
  // 這三組的 Ⅱ 級都已填好，且兩級的每級數值本來就相同（規則見前一支腳本）。
  // 描述文字本身也逐級寫明數字，故屬推導而非編造。
  { id: 'mod_4004', p: 'levels[0].dodge_rate', from: 0, to: 3 },   // 「回避率提升3%」
  { id: 'mod_4004', p: 'levels[1].dodge_rate', from: 0, to: 5 },
  { id: 'mod_4004', p: 'levels[2].dodge_rate', from: 0, to: 7 },
  { id: 'mod_4004', p: 'levels[3].dodge_rate', from: 0, to: 10 },
  // mod_4004 頂層 dodge_rate 已是 10，不動。

  { id: 'mod_4026', p: 'levels[0].output_bonus', from: 0, to: 25 },  // 「機兵整體出力增加25」
  { id: 'mod_4026', p: 'levels[1].output_bonus', from: 0, to: 50 },
  { id: 'mod_4026', p: 'levels[2].output_bonus', from: 0, to: 75 },
  { id: 'mod_4026', p: 'levels[3].output_bonus', from: 0, to: 100 },
  { id: 'mod_4026', p: 'output_bonus',           from: 0, to: 100 }, // 不變量②：頂層＝Lv4

  { id: 'mod_4027', p: 'levels[0].firepower_rate', from: 0, to: 3 }, // 「火力值提升3%」
  { id: 'mod_4027', p: 'levels[1].firepower_rate', from: 0, to: 5 },
  { id: 'mod_4027', p: 'levels[2].firepower_rate', from: 0, to: 7 },
  { id: 'mod_4027', p: 'levels[3].firepower_rate', from: 0, to: 10 },
  { id: 'mod_4027', p: 'firepower_rate',           from: 0, to: 10 }, // 不變量②

  // ── ④ 防暴模組兩級的頂層鏡像漏填 ────────────────────────────────────────
  // 兩級的 levels[3].crit_resist_rate 都是 10（Ⅱ 級是前一支腳本補的），
  // 頂層卻都留 0。讀頂層的列表卡片會顯示成「沒有抗暴加成」。
  { id: 'mod_4008',   p: 'crit_resist_rate', from: 0, to: 10 },
  { id: 'mod_4008_2', p: 'crit_resist_rate', from: 0, to: 10 },
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

  // 現值守門：任何一項對不上就整支中止，不做部分寫入
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
    console.log(`\n  modules/${id}   「${d.name}」  ${d.rarity}  managedBy=${d.managedBy}`)
    for (const f of FIXES.filter(x => x.id === id)) {
      console.log(`      ${f.p.padEnd(28)} ${JSON.stringify(f.from)}  →  ${JSON.stringify(f.to)}`)
    }
  }
  console.log(`\n  合計 ${FIXES.length} 個欄位、${ids.length} 份文件。之後 bump modules 版本。`)

  if (!APPLY) { console.log('\n（dry-run，未寫入任何東西。確認無誤後加 --apply）'); return }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(OUT_DIR, `module-tier-consistency-backup-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({ docs: ids.map(id => ({ id, data: docs.get(id) })) }, null, 2), 'utf-8')
  console.log(`\n💾 還原快照：${path.relative(ROOT, backupFile)}`)
  console.log(`   還原：node scripts/patch-module-tier-consistency.mjs --restore "${path.relative(ROOT, backupFile)}" --apply`)

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
