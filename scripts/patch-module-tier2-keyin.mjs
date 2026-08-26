/**
 * 修正通用模組 Ⅱ 級（`mod_40XX_2`）的人工輸入錯誤
 *
 * ── 這批資料的建構規則 ──────────────────────────────────────────────────────
 * 40xx 通用模組成對存在：Ⅰ 級（A 級，`mod_40XX`，爬蟲管）與 Ⅱ 級（S 級，
 * `mod_40XX_2`，`managedBy: manual` 人工建的）。比對 31 組後，Ⅱ 級的建構規則是
 * **把 Ⅰ 級逐字複製，只改三個欄位**：
 *
 *     name = Ⅰ級name.replace('Ⅰ','Ⅱ')   ·   rarity = 'S'   ·   moduleAddLevel = 2
 *
 * （S 級一顆佔 2 階，所以兩顆就滿 LV4；A 級一顆 1 階，要四顆。這正是 moduleAddLevel。）
 * 其餘欄位——description、levels[].description、所有數值欄、icon、slot、source——
 * 兩級完全相同。4028／4032 等 22 組是這條規則的乾淨樣本。
 *
 * 手工複製會抓錯行，本腳本修的就是抓錯行的後果。**權威一律是同編號的 Ⅰ 級**。
 *
 * ── 為什麼只改欄位、不改 doc id ────────────────────────────────────────────
 * `mod_4029_2` / `mod_4030_2` 都已在 `src/utils/loadoutCode/shareIdRegistry.json`
 * 領到分享號（1500029 / 1500030）。登錄簿只進不出——號碼發出去就印在別人存下來的
 * 分享碼裡了。改 id 等於作廢已發出的號碼，而改名零成本（這批都是 manual，爬蟲不會洗回）。
 *
 * ── 不在本腳本範圍內的（是遊戲事實問題，腳本不猜）──────────────────────────
 *   · mod_4002_2  moduleAddLevel=1（其餘 30 組 Ⅱ 級都是 2）
 *   · mod_4011    Ⅰ級 rarity=S（其餘 30 組 Ⅰ 級都是 A）
 *   · mod_4008    Ⅰ「防爆模組Ⅰ」vs Ⅱ「防暴模組Ⅱ」用字不一致（且 Ⅰ 級是 auto，改了會被爬蟲洗回）
 *   · mod_4004 / 4026 / 4027 的 Ⅰ 級 levels[] 數值未填（Ⅱ 級已填）
 *
 * 使用方式：
 *   node scripts/patch-module-tier2-keyin.mjs            ← dry-run（唯讀，印出逐欄 diff）
 *   node scripts/patch-module-tier2-keyin.mjs --apply    ← 確認後寫入 + bump modules 版本
 *   node scripts/patch-module-tier2-keyin.mjs --restore <快照> --apply   ← 還原
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

/**
 * 要修的欄位。每一筆都寫明 `from`（現值）——寫入前會先驗證現值相符，
 * 不符就整支中止。避免拿一份過期的認知去覆蓋已經被別人改過的資料。
 */
const FIXES = [
  // ── 抓錯行：4029_2 複製到了 4030（刀劍），4030_2 複製到了 4032（浮游炮）──
  //   icon 是鐵證：兩級一律共用同一張圖，31 組皆然。
  //   mod_4029_2 掛的是 Icon_entry_40291（電鋸的圖）卻叫「刀劍模組Ⅱ」；
  //   mod_4030_2 掛的是 Icon_entry_40301（刀劍的圖）卻叫「浮游炮模組Ⅱ」。
  //   修完「電鋸模組Ⅱ」補回來了，重複的「浮游炮模組Ⅱ」也自然消失。
  { id: 'mod_4029_2', p: 'name',                  from: '刀劍模組Ⅱ',           to: '電鋸模組Ⅱ' },
  { id: 'mod_4029_2', p: 'description',           from: '刀劍的傷害提升10%',   to: '電鋸的傷害提升10%' },
  { id: 'mod_4029_2', p: 'levels[0].description', from: '刀劍的傷害提升3%',    to: '電鋸的傷害提升3%' },
  { id: 'mod_4029_2', p: 'levels[1].description', from: '刀劍的傷害提升5%',    to: '電鋸的傷害提升5%' },
  { id: 'mod_4029_2', p: 'levels[2].description', from: '刀劍的傷害提升7%',    to: '電鋸的傷害提升7%' },
  { id: 'mod_4029_2', p: 'levels[3].description', from: '刀劍的傷害提升10%',   to: '電鋸的傷害提升10%' },

  { id: 'mod_4030_2', p: 'name',                  from: '浮游炮模組Ⅱ',         to: '刀劍模組Ⅱ' },
  { id: 'mod_4030_2', p: 'description',           from: '浮游炮的傷害提升10%', to: '刀劍的傷害提升10%' },
  { id: 'mod_4030_2', p: 'levels[0].description', from: '浮游炮的傷害提升3%',  to: '刀劍的傷害提升3%' },
  { id: 'mod_4030_2', p: 'levels[1].description', from: '浮游炮的傷害提升5%',  to: '刀劍的傷害提升5%' },
  { id: 'mod_4030_2', p: 'levels[2].description', from: '浮游炮的傷害提升7%',  to: '刀劍的傷害提升7%' },
  { id: 'mod_4030_2', p: 'levels[3].description', from: '浮游炮的傷害提升10%', to: '刀劍的傷害提升10%' },

  // ── 增傷模組Ⅱ：頂層鏡像漏填 ──────────────────────────────────────────────
  //   頂層數值欄是 Lv4（滿級）的鏡像。mod_4003_2 的 levels[3].critDmg=10 有值、
  //   Ⅰ 級 mod_4003 的頂層也是 10，唯獨 Ⅱ 級頂層留 0。
  //   讀頂層欄位的地方（列表卡片、比較表）會顯示成「沒有加成」。
  { id: 'mod_4003_2', p: 'critDmg', from: 0, to: 10 },

  // ── 防暴模組Ⅱ：數值填錯欄位 ─────────────────────────────────────────────
  //   四級描述都寫「被暴擊率降低 X%」，數值卻掛在 acc_rate（命中率）且是 -1，
  //   crit_resist_rate 反而全 0。Ⅰ 級 mod_4008 與獨立的 sub_mod_防爆模組
  //   兩個來源都用 crit_resist_rate = 3/5/7/10，數字也與描述吻合，故非臆測。
  //   留著不修的話，模擬器會給這顆模組算出 -1% 命中、0 抗暴。
  { id: 'mod_4008_2', p: 'levels[0].acc_rate',          from: -1, to: 0 },
  { id: 'mod_4008_2', p: 'levels[0].crit_resist_rate',  from: 0,  to: 3 },
  { id: 'mod_4008_2', p: 'levels[1].crit_resist_rate',  from: 0,  to: 5 },
  { id: 'mod_4008_2', p: 'levels[2].crit_resist_rate',  from: 0,  to: 7 },
  { id: 'mod_4008_2', p: 'levels[3].crit_resist_rate',  from: 0,  to: 10 },
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

/** 解析 `levels[0].description` 這種路徑。 */
function parsePath(p) {
  return p.split('.').flatMap(seg => {
    const m = seg.match(/^([^[]+)((\[\d+\])*)$/)
    if (!m) throw new Error(`路徑無法解析：${p}`)
    const keys = [m[1]]
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) keys.push(Number(idx[1]))
    return keys
  })
}
function getPath(obj, p) {
  return parsePath(p).reduce((o, k) => (o == null ? undefined : o[k]), obj)
}
function setPath(obj, p, v) {
  const keys = parsePath(p)
  const last = keys.pop()
  const target = keys.reduce((o, k) => o[k], obj)
  target[last] = v
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
  const v = await bumpModules()
  console.log(`\n✅ 已還原，modules 版本已 bump → ${v}`)
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

  // ── 驗證現值，任何一項對不上就整支中止 ──────────────────────────────────
  const drift = []
  for (const f of FIXES) {
    const cur = getPath(docs.get(f.id), f.p)
    const now = cur === undefined ? 0 : cur   // 數值欄可能根本沒這個 key
    if (now !== f.from) drift.push(`${f.id} · ${f.p}：現值 ${JSON.stringify(cur)}，預期 ${JSON.stringify(f.from)}`)
  }
  if (drift.length) {
    console.log('❌ 現值與預期不符，資料可能已被改過。中止，未寫入任何東西：')
    drift.forEach(s => console.log(`   · ${s}`))
    process.exit(1)
  }

  // ── 印出逐欄 diff ──────────────────────────────────────────────────────
  console.log('── 將修改 ──────────────────────────────────────────────────')
  for (const id of ids) {
    const d = docs.get(id)
    console.log(`\n  modules/${id}   「${d.name}」  managedBy=${d.managedBy}`)
    for (const f of FIXES.filter(x => x.id === id)) {
      console.log(`      ${f.p.padEnd(26)} ${JSON.stringify(f.from)}  →  ${JSON.stringify(f.to)}`)
    }
  }
  console.log(`\n  合計 ${FIXES.length} 個欄位、${ids.length} 份文件。之後 bump modules 版本。`)

  if (!APPLY) {
    console.log('\n（dry-run，未寫入任何東西。確認無誤後加 --apply）')
    return
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(OUT_DIR, `module-tier2-keyin-backup-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({
    docs: ids.map(id => ({ id, data: docs.get(id) })),
  }, null, 2), 'utf-8')
  console.log(`\n💾 還原快照：${path.relative(ROOT, backupFile)}`)
  console.log(`   還原：node scripts/patch-module-tier2-keyin.mjs --restore "${path.relative(ROOT, backupFile)}" --apply`)

  if (!await promptConfirm('\n確認寫入 Firestore？ [y/N] ')) { console.log('已取消。'); return }

  const batch = db.batch()
  for (const id of ids) {
    const next = JSON.parse(JSON.stringify(docs.get(id)))
    for (const f of FIXES.filter(x => x.id === id)) setPath(next, f.p, f.to)
    batch.set(db.collection('modules').doc(id), next)
  }
  await batch.commit()
  console.log(`  …已更新 ${ids.length} 份模組`)

  const version = await bumpModules()
  console.log(`\n✅ 完成。modules 版本已 bump → ${version}`)
  console.log('   下一步：node scripts/export-emulator-slice.mjs --simulator（讓本機種子跟上）')
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1) })
