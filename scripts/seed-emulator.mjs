#!/usr/bin/env node
/**
 * 種入本地模擬器（PLAN-030 Phase 0 / 0-3 + 0-4 匯入端）
 *
 * 做兩件事：
 *   ① 建立一個 role: 'OWNER' 的測試帳號（Auth 使用者 + users/{uid}/profile/main）
 *   ② 把 emulator-seed/*.json（由 export-emulator-slice.mjs 產出）灌進模擬器
 *
 * 為什麼「偽造管理員」這麼簡單：本專案的 role 存在 Firestore 文件而非 custom claim，
 * 且 firestore.rules 的 isAdmin() 讀的正是同一份文件 —— 一份 JSON 同時滿足前端 UI 與
 * 安全規則兩邊，規則檔完全不必為了測試而修改。
 *
 * ⚠ 本腳本會寫入 role: 'OWNER'，**絕不可對正式資料庫執行**。
 *   下方有硬性防呆：連線目標不是 127.0.0.1 / localhost 就直接中止。
 *
 *   npm run emu:seed
 *   node scripts/seed-emulator.mjs --email dev@local.test --password devpass
 */

import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const DEFAULTS = {
  email: 'dev-admin@local.test',
  password: 'devadmin',
  name: '模擬器管理員',
}

const args = process.argv.slice(2)
const getArg = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : fallback
}

// ── 硬性防呆：只准打本機模擬器 ────────────────────────────────────────────────
// firebase-admin 會自動識別這兩個環境變數並改指模擬器；沒設就會打正式資料庫。
// 這裡預設幫忙設好，但如果外部已設成非本機位址則中止 —— 寧可跑不動，也不要種錯地方。
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'

const isLocal = (host) => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host ?? '')
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!isLocal(process.env[key])) {
    console.error(`❌ ${key}=${process.env[key]} 不是本機位址。`)
    console.error('   本腳本會建立 OWNER 權限帳號，拒絕對非模擬器環境執行。')
    process.exit(1)
  }
}

// 模擬器不驗憑證，給 projectId 即可（需與 .firebaserc 的 default 一致）
const projectId = JSON.parse(fs.readFileSync(resolve(ROOT, '.firebaserc'), 'utf-8')).projects.default
admin.initializeApp({ projectId })
const db = admin.firestore()
const auth = admin.auth()

// ── ① 管理員帳號 ──────────────────────────────────────────────────────────────

async function seedAdmin(email, password, displayName) {
  // 重跑時先清掉舊的，讓這支腳本可重複執行
  let uid
  try {
    const existing = await auth.getUserByEmail(email)
    uid = existing.uid
    await auth.updateUser(uid, { password, displayName, emailVerified: true })
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    // emailVerified 必須為 true：AuthContext.signInWithEmail 對未驗證信箱會丟
    // auth/email-not-verified 並立刻登出，設 false 會導致完全無法登入。
    const created = await auth.createUser({ email, password, displayName, emailVerified: true })
    uid = created.uid
  }

  const now = new Date().toISOString()
  await db.doc(`users/${uid}/profile/main`).set({
    uid,
    email,
    displayName,
    photoURL: null,
    role: 'OWNER', // ← 這一行就是「偽造管理員」的全部；rules 的 isAdmin() 讀的是同一份文件
    researchLevels: { pilotByClass: {}, mechByType: {}, weaponByType: {} },
    createdAt: now,
    updatedAt: now,
    avatarType: null,
  })

  return uid
}

// ── ② 資料切片 ────────────────────────────────────────────────────────────────

async function seedData() {
  const seedDir = resolve(ROOT, 'emulator-seed')
  if (!fs.existsSync(seedDir)) {
    console.log('⚠ 找不到 emulator-seed/，略過資料匯入。')
    console.log('  要帶入真實資料切片請先執行：npm run emu:slice\n')
    return 0
  }

  const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json'))
  let total = 0

  for (const file of files) {
    const { collection, docs } = JSON.parse(fs.readFileSync(resolve(seedDir, file), 'utf-8'))
    if (!collection || !Array.isArray(docs)) continue

    // Firestore batch 上限 500，切片分批寫入
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch()
      for (const { id, ...data } of docs.slice(i, i + 400)) {
        batch.set(db.collection(collection).doc(id), data)
      }
      await batch.commit()
    }
    total += docs.length
    console.log(`  · ${collection.padEnd(16)} ${String(docs.length).padStart(5)} docs`)
  }
  return total
}

// ── 主程式 ────────────────────────────────────────────────────────────────────

async function main() {
  const email = getArg('--email', DEFAULTS.email)
  const password = getArg('--password', DEFAULTS.password)
  const displayName = getArg('--name', DEFAULTS.name)

  console.log(`🌱 種入模擬器（${process.env.FIRESTORE_EMULATOR_HOST}）\n`)

  console.log('資料切片：')
  const count = await seedData()

  console.log('\n管理員帳號：')
  const uid = await seedAdmin(email, password, displayName)

  console.log('─────────────────────────────────────')
  console.log(`  Email : ${email}`)
  console.log(`  密碼  : ${password}`)
  console.log(`  UID   : ${uid}`)
  console.log(`  Role  : OWNER`)
  console.log('─────────────────────────────────────')
  console.log(`\n✅ 完成（${count} 筆資料 + 1 個管理員）`)
  console.log('   下一步：npm run dev:emu → 用上面的帳密登入 → /admin')
}

main().catch((err) => {
  if (err.code === 'ECONNREFUSED' || /ECONNREFUSED|fetch failed/i.test(err.message)) {
    console.error('\n❌ 連不上模擬器。請先在另一個終端機執行：npm run emu')
  } else {
    console.error('\n❌ 失敗：', err.message)
  }
  process.exit(1)
})
