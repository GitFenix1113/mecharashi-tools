/**
 * PLAN-004 技能庫抽離 — 遷移 Stage 1
 *
 * 讀取所有 pilots，攤平 skills[]，以 name+description 去重，
 * 產出 pilotSkills 集合文件（id = skill_<技能名>，同名不同效時加 _<pilotId> 後綴），
 * 並輸出每位機師的 skillId 陣列（供 Stage 2 用）。
 *
 * **本腳本不修改 pilots**（單一資料源的 flip 由 Stage 2 migrate-plan004-pilots.mjs 執行）。
 *
 * 使用方式：
 *   node scripts/migrate-plan004-skills.mjs            ← dry-run：只算、印報告、寫對照檔，不碰 Firestore
 *   node scripts/migrate-plan004-skills.mjs --apply    ← 互動確認後，寫入 pilotSkills 集合
 *
 * 產物（gitignored）：scripts/temp_scripts/plan004-skill-map.json
 *   { skills: PilotSkillDoc[], pilotSkillIds: { [pilotId]: string[] } }
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

const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')
const OUT_FILE = resolve(OUT_DIR, 'plan004-skill-map.json')

// ── Firebase 初始化（同 seed-plan019-demo.mjs）─────────────────────────────────
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

// ── 工具 ──────────────────────────────────────────────────────────────────────
const norm = (s) => (s ?? '').toString().trim()
// Firestore 文件 ID 不可含 '/'；技能名極少含之，仍保險替換
const slugName = (name) => norm(name).replace(/\//g, '_')

/** 由嵌入技能物件挑出要存進 pilotSkills 的欄位（省略 undefined） */
function buildDoc(id, skill) {
  const doc = {
    id,
    name: norm(skill.name),
    type: norm(skill.type),
    description: norm(skill.description),
    icon: skill.icon ?? '',
    iconLocal: skill.iconLocal ?? '',
    effects: Array.isArray(skill.effects) ? skill.effects : [],
    buffIds: Array.isArray(skill.buffIds) ? skill.buffIds : [],
  }
  if (skill.unitType !== undefined) doc.unitType = skill.unitType
  if (skill.ap !== undefined) doc.ap = skill.ap
  if (skill.cd !== undefined) doc.cd = skill.cd
  if (skill.weapon !== undefined) doc.weapon = skill.weapon
  if (skill.descriptionRefs !== undefined) doc.descriptionRefs = skill.descriptionRefs
  if (skill.manual === true) doc.manual = true
  return doc
}

/** 「較豐富者勝」：把後遇到副本的手動資料補進共用 doc，避免被先遇到的空殼蓋掉 */
function mergeRicher(doc, skill) {
  if ((doc.effects?.length ?? 0) === 0 && Array.isArray(skill.effects) && skill.effects.length > 0) {
    doc.effects = skill.effects
  }
  if ((doc.buffIds?.length ?? 0) === 0 && Array.isArray(skill.buffIds) && skill.buffIds.length > 0) {
    doc.buffIds = skill.buffIds
  }
  if (!doc.descriptionRefs && skill.descriptionRefs) doc.descriptionRefs = skill.descriptionRefs
  if (skill.manual === true) doc.manual = true
}

async function main() {
  console.log(`🔧 PLAN-004 Stage 1 技能抽離（${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}）\n`)
  initFirebase()

  const snap = await db.collection('pilots').get()
  // 以 doc id 排序確保去重的「base 名稱歸屬」具決定性
  const pilots = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.id.localeCompare(b.id))
  console.log(`📦 讀到 ${pilots.length} 位機師\n`)

  // name -> [{ desc, id, pilotIds:Set, doc }]
  const byName = new Map()
  const skills = []           // 去重後的 doc 陣列
  const pilotSkillIds = {}    // pilotId -> [skillId,...]（原順序）
  let totalInstances = 0

  for (const pilot of pilots) {
    const arr = Array.isArray(pilot.skills) ? pilot.skills : []
    const ids = []
    for (const skill of arr) {
      totalInstances++
      const name = norm(skill.name)
      const desc = norm(skill.description)
      let entry = byName.get(name)
      if (!entry) { entry = []; byName.set(name, entry) }
      let found = entry.find(e => e.desc === desc)
      if (!found) {
        const isFirst = entry.length === 0
        const id = isFirst ? `skill_${slugName(name)}` : `skill_${slugName(name)}_${pilot.id}`
        const doc = buildDoc(id, skill)
        found = { desc, id, pilotIds: new Set(), doc }
        entry.push(found)
        skills.push(doc)
      } else {
        mergeRicher(found.doc, skill)
      }
      found.pilotIds.add(pilot.id)
      ids.push(found.id)
    }
    pilotSkillIds[pilot.id] = ids
  }

  // ── 報告 ──────────────────────────────────────────────────────────────────
  const shared = []
  const collisions = []
  let emptyEffects = 0
  for (const [name, entry] of byName) {
    if (entry.length > 1) {
      collisions.push({ name, ids: entry.map(e => e.id) })
    }
    for (const e of entry) {
      if (e.pilotIds.size > 1) shared.push({ id: e.id, count: e.pilotIds.size })
      if ((e.doc.effects?.length ?? 0) === 0) emptyEffects++
    }
  }

  console.log('── 去重結果 ──────────────────────────────')
  console.log(`  嵌入技能實例總數：${totalInstances}`)
  console.log(`  去重後唯一技能：  ${skills.length}`)
  console.log(`  跨機師共用（>1）：${shared.length}`)
  console.log(`  同名不同效碰撞：  ${collisions.length}`)
  console.log(`  effects 仍為空：  ${emptyEffects}（待後台補）`)

  if (shared.length) {
    console.log('\n── 共用技能（多位機師指向同一 doc）──')
    shared.sort((a, b) => b.count - a.count).slice(0, 30)
      .forEach(s => console.log(`  ×${s.count}  ${s.id}`))
    if (shared.length > 30) console.log(`  …其餘 ${shared.length - 30} 筆`)
  }
  if (collisions.length) {
    console.log('\n── 同名不同效（已用 _<pilotId> 後綴區分，請人工確認是否真的不同技能）──')
    collisions.forEach(c => console.log(`  「${c.name}」→ ${c.ids.join(' , ')}`))
  }

  // 標出已 seed 的引用目標，確認可解析
  const seedTargets = ['skill_粒子爆發']
  console.log('\n── 已 seed 引用目標檢查 ──')
  for (const t of seedTargets) {
    const hit = skills.find(s => s.id === t)
    console.log(`  ${hit ? '✓' : '✗'} ${t}${hit ? `（${hit.name} / ${hit.type}）` : '（找不到，引用將不解析）'}`)
  }

  // ── 寫對照檔（gitignored）────────────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({ skills, pilotSkillIds }, null, 2), 'utf-8')
  console.log(`\n📝 對照檔已寫出：${path.relative(ROOT, OUT_FILE)}`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入 Firestore。審閱無誤後加 --apply 正式寫入。')
    return
  }

  // ── 寫入 pilotSkills（互動確認，不盲寫）──────────────────────────────────
  console.log(`\n將寫入 pilotSkills 集合 ${skills.length} 筆文件（覆寫同 id；不動 pilots）。`)
  const ok = await promptConfirm('確認寫入 Firestore？ [y/N] ')
  if (!ok) { console.log('已取消。'); process.exit(0) }

  let written = 0
  for (let i = 0; i < skills.length; i += 400) {
    const batch = db.batch()
    for (const doc of skills.slice(i, i + 400)) {
      batch.set(db.collection('pilotSkills').doc(doc.id), doc, { merge: true })
    }
    await batch.commit()
    written += Math.min(400, skills.length - i)
    console.log(`  …已寫入 ${written}/${skills.length}`)
  }
  console.log(`\n✅ 完成。pilotSkills 寫入 ${skills.length} 筆。`)
  console.log('   下一步：node scripts/bump-data-version.mjs（讓前台快取失效），再驗證引用解析。')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
