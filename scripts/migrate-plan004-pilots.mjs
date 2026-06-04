/**
 * PLAN-004 技能庫抽離 — 遷移 Stage 2
 *
 * 把每位機師的 skills 欄位從「嵌入技能物件」換成「pilotSkills 文件 ID 陣列」。
 * 讀取 Stage 1 產生的對照檔 scripts/temp_scripts/plan004-skill-map.json。
 *
 * **執行前提**：Stage 1（migrate-plan004-skills.mjs --apply）已寫入 pilotSkills 集合，
 *   且前端已部署「雙格式相容」版本（避免活站讀到新格式而空白）。
 *
 * 使用方式：
 *   node scripts/migrate-plan004-pilots.mjs            ← dry-run：只比對、印報告，不寫入
 *   node scripts/migrate-plan004-pilots.mjs --apply    ← 互動確認後，把 pilots.skills 換成 ID 陣列
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

const MAP_FILE = resolve(ROOT, 'scripts/temp_scripts/plan004-skill-map.json')

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
  const absCredPath = resolve(ROOT, credPath)
  if (!fs.existsSync(absCredPath)) throw new Error(`找不到服務帳號金鑰：${absCredPath}`)
  const serviceAccount = JSON.parse(fs.readFileSync(absCredPath, 'utf-8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  db = admin.firestore()
}
function promptConfirm(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}

async function main() {
  console.log(`🔧 PLAN-004 Stage 2 機師 skills flip（${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}）\n`)

  if (!fs.existsSync(MAP_FILE)) {
    console.log(`❌ 找不到對照檔：${path.relative(ROOT, MAP_FILE)}`)
    console.log('   請先執行：node scripts/migrate-plan004-skills.mjs --apply')
    process.exit(1)
  }
  const { skills, pilotSkillIds } = JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8'))
  const validIds = new Set(skills.map(s => s.id))
  console.log(`📝 對照檔：${skills.length} 筆技能、${Object.keys(pilotSkillIds).length} 位機師\n`)

  initFirebase()
  const snap = await db.collection('pilots').get()

  let alreadyFlipped = 0, toFlip = 0, missingInMap = 0, danglingRefs = 0
  const samples = []
  for (const doc of snap.docs) {
    const pilot = doc.data()
    const ids = pilotSkillIds[doc.id]
    if (!ids) {
      // 對照檔沒有此機師（Stage 1 之後新增的機師）→ 需重跑 Stage 1
      if (Array.isArray(pilot.skills) && pilot.skills.length > 0) {
        missingInMap++
        console.log(`  ⚠ ${doc.id}（${pilot.name}）不在對照檔中 → 請重跑 Stage 1`)
      }
      continue
    }
    const isStr = Array.isArray(pilot.skills) && pilot.skills.every(s => typeof s === 'string')
    if (isStr) { alreadyFlipped++; continue }
    // 檢查 ID 都存在於 pilotSkills
    for (const id of ids) if (!validIds.has(id)) danglingRefs++
    toFlip++
    if (samples.length < 3) samples.push({ id: doc.id, name: pilot.name, count: ids.length })
  }

  console.log('── 比對結果 ──────────────────────────────')
  console.log(`  待 flip（嵌入 → ID）：${toFlip}`)
  console.log(`  已是新格式：         ${alreadyFlipped}`)
  console.log(`  不在對照檔（需重跑 Stage 1）：${missingInMap}`)
  console.log(`  指向不存在技能的引用：${danglingRefs}`)
  if (samples.length) {
    console.log('\n  範例：')
    samples.forEach(s => console.log(`    ${s.id}（${s.name}）→ ${s.count} 個技能 ID`))
  }

  if (missingInMap > 0) {
    console.log('\n❌ 有機師不在對照檔中，請先重跑 Stage 1 再來。中止。')
    process.exit(1)
  }
  if (toFlip === 0) {
    console.log('\n✅ 沒有需要 flip 的機師（全部已是新格式）。')
    return
  }
  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入。確認前端已部署「雙格式相容」版本後，加 --apply 正式 flip。')
    return
  }

  console.log(`\n⚠ 將把 ${toFlip} 位機師的 skills 改為 ID 陣列（只動 skills 欄位）。`)
  console.log('  請確認前端「雙格式相容」版本已部署上線，否則活站會讀到新格式而空白。')
  const ok = await promptConfirm('確認 flip？ [y/N] ')
  if (!ok) { console.log('已取消。'); process.exit(0) }

  let done = 0
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch()
    let batchCount = 0
    for (const doc of snap.docs.slice(i, i + 400)) {
      const ids = pilotSkillIds[doc.id]
      if (!ids) continue
      const pilot = doc.data()
      const isStr = Array.isArray(pilot.skills) && pilot.skills.every(s => typeof s === 'string')
      if (isStr) continue
      batch.update(doc.ref, { skills: ids })
      batchCount++
    }
    if (batchCount > 0) { await batch.commit(); done += batchCount; console.log(`  …已 flip ${done}/${toFlip}`) }
  }
  console.log(`\n✅ 完成。${done} 位機師 skills 已改為 ID 陣列。`)
  console.log('   下一步：node scripts/bump-data-version.mjs，再到前台驗證技能照常顯示。')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
