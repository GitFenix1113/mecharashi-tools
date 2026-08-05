/**
 * PLAN-043 背包技能集合 — 遷移 Stage 2（flip）
 *
 * 把 `Backpack.mainSkill` 從 Firestore 永久刪除。Stage 1（migrate-plan043-extract.mjs）
 * 已把 22 筆抽成 backpackSkills 獨立 doc 並寫回 skillIds。
 *
 * ⚠ **這是本計畫唯一不可逆的一步。** 執行前的四項閘門（計畫書 E-2）：
 *   ① Phase C／D 已部署上線
 *   ② 線上背包圖鑑技能顯示正常
 *   ③ 模擬器 buff 池正常
 *   ④ skillIds 覆蓋所有原有 mainSkill —— **本腳本會自動檢查，有落差即中止**
 *
 * 使用方式：
 *   node scripts/migrate-plan043-flip.mjs            ← dry-run：只檢查與印報告
 *   node scripts/migrate-plan043-flip.mjs --apply    ← 互動確認後刪除欄位並 bump 版本
 *
 * 備援：刪除前會把所有 mainSkill 內容寫成本機 JSON 快照（gitignored），
 * 萬一日後需要對照官方原文仍查得到。Firestore 端刪掉就是刪掉了。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const APPLY = process.argv.includes('--apply')
const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')
const SNAPSHOT = resolve(OUT_DIR, 'plan043-mainSkill-snapshot.json')

// ── Firebase 初始化（同 migrate-plan043-extract.mjs）───────────────────────────
let db
function loadEnv(filename) {
  const envPath = resolve(ROOT, filename)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const i = line.indexOf('=')
    if (i > 0) {
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim()
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
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}

const norm = (s) => (s ?? '').toString().trim()

async function main() {
  console.log(`🔧 PLAN-043 Stage 2 flip — 刪除 Backpack.mainSkill（${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}）\n`)
  initFirebase()

  const [bpSnap, skSnap] = await Promise.all([
    db.collection('backpacks').get(),
    db.collection('backpackSkills').get(),
  ])
  const backpacks = bpSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id))
  const skills = skSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const byId = Object.fromEntries(skills.map((s) => [s.id, s]))

  const withMainSkill = backpacks.filter((b) => b.mainSkill)
  console.log(`📦 背包 ${backpacks.length} 筆、背包技能 ${skills.length} 筆`)
  console.log(`   仍帶 mainSkill：${withMainSkill.length} 筆\n`)

  if (withMainSkill.length === 0) {
    console.log('✅ 已無 mainSkill，無需執行（本腳本可重複執行）。')
    return
  }

  // ── 閘門④：逐筆比對，任何落差都中止 ───────────────────────────────────────
  console.log('── 閘門④：skillIds 是否完整覆蓋 mainSkill ──────────')
  const problems = []
  for (const b of withMainSkill) {
    const ids = b.skillIds ?? []
    if (!ids.length) { problems.push(`${b.id}（${b.name}）有 mainSkill 但 skillIds 為空`); continue }
    const s = byId[ids[0].split('@')[0]]
    if (!s) { problems.push(`${b.id} 的 skillIds[0]=${ids[0]} 在 backpackSkills 找不到（斷鏈）`); continue }
    if (s.name !== norm(b.mainSkill.name)) problems.push(`${b.id} name 不符：「${s.name}」vs「${norm(b.mainSkill.name)}」`)
    if (s.description !== norm(b.mainSkill.description)) problems.push(`${b.id} description 不符`)
    const a1 = JSON.stringify(s.buffIds ?? [])
    const a2 = JSON.stringify((b.mainSkill.buffIds ?? []).filter(Boolean))
    if (a1 !== a2) problems.push(`${b.id} buffIds 不符：${a1} vs ${a2}`)
  }
  if (problems.length) {
    console.error(`\n❌ 閘門④未通過（${problems.length} 項）：`)
    problems.forEach((p) => console.error('   · ' + p))
    console.error('\n刪除已中止 —— 資料毫髮無傷。請先修正落差（或重跑 Stage 1）再試。')
    process.exit(1)
  }
  console.log(`   ✅ ${withMainSkill.length} 筆全數對得上（name / description / buffIds 逐欄位比對）\n`)

  // ── 快照（Firestore 端刪掉就沒了）───────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const snapshot = withMainSkill.map((b) => ({ backpackId: b.id, backpackName: b.name, mainSkill: b.mainSkill }))
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2), 'utf-8')
  console.log(`📝 刪除前快照已寫出：${path.relative(ROOT, SNAPSHOT)}（${snapshot.length} 筆）`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入 Firestore。')
    console.log('確認線上背包圖鑑與模擬器皆正常後，加 --apply 執行。')
    return
  }

  console.log(`\n⚠ 將從 ${withMainSkill.length} 個背包文件永久刪除 mainSkill 欄位。此操作不可逆。`)
  if (!(await promptConfirm('確認執行？ [y/N] '))) { console.log('已取消。'); process.exit(0) }

  let done = 0
  for (let i = 0; i < withMainSkill.length; i += 400) {
    const batch = db.batch()
    for (const b of withMainSkill.slice(i, i + 400)) {
      batch.update(db.collection('backpacks').doc(b.id), { mainSkill: admin.firestore.FieldValue.delete() })
    }
    await batch.commit()
    done += Math.min(400, withMainSkill.length - i)
    console.log(`  …已處理 ${done}/${withMainSkill.length}`)
  }

  const version = new Date().toISOString()
  await db.doc('meta/gameData').set(
    { versions: { backpacks: version }, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  )

  console.log(`\n✅ 完成：${done} 筆 mainSkill 已刪除，backpacks 版本已 bump → ${version}`)
  console.log('   下一步：E-3 從 src/types/backpack.ts 移除 mainSkill 型別定義，跑 npm run build 掃清殘留。')
}

main().catch((err) => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
