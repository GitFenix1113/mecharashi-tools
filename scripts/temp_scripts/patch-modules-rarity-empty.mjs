/**
 * 米赫瑪超吉情豹站 — 修正 modules rarity 空值
 *
 * 執行內容：
 *   將 modules 集合中所有 rarity 為空字串、null、或 undefined 的文件
 *   統一設為 'S'
 *
 * 用法：
 *   node scripts/temp_scripts/patch-modules-rarity-empty.mjs            （dry-run，只列出不寫入）
 *   node scripts/temp_scripts/patch-modules-rarity-empty.mjs --confirm  （實際寫入 Firestore）
 *
 * 前置條件：
 *   1. 專案根目錄有 .env.migration 和 serviceAccountKey.json
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '../..')   // scripts/temp_scripts → project root
const CONFIRM   = process.argv.includes('--confirm')

console.log(`\n🔥 modules rarity 空值修正 ${CONFIRM ? '[實際寫入]' : '[DRY RUN]'}\n`)

// ── 載入環境變數 ──────────────────────────────────────────────────────────────
const envPath = resolve(ROOT, '.env.migration')
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const [k, ...rest] = line.split('=')
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim()
  })
}

// ── 初始化 Firebase Admin ─────────────────────────────────────────────────────
let admin, db
try {
  const adminModule = await import('firebase-admin')
  admin = adminModule.default
} catch {
  console.error('❌ 請先安裝 firebase-admin：npm install firebase-admin')
  process.exit(1)
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? resolve(ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : resolve(ROOT, 'serviceAccountKey.json')

if (!existsSync(keyPath)) {
  console.error(`❌ 找不到服務帳號金鑰：${keyPath}`)
  process.exit(1)
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, 'utf-8'))),
    projectId: process.env.FIREBASE_PROJECT_ID,
  })
}
db = admin.firestore()

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  const snap = await db.collection('modules').get()
  console.log(`📦 讀取到 ${snap.docs.length} 筆 module 文件\n`)

  const targets = snap.docs.filter(doc => {
    const data = doc.data()
    return data.rarity === '' || data.rarity === null || data.rarity === undefined
  })

  if (targets.length === 0) {
    console.log('✅ 沒有需要修正的文件（所有模組 rarity 均有值）')
    process.exit(0)
  }

  console.log(`🔍 找到 ${targets.length} 筆 rarity 為空的文件：\n`)
  for (const doc of targets) {
    const cur = doc.data().rarity
    console.log(`  ${doc.id}  (rarity: ${JSON.stringify(cur)} → "S")`)
  }

  if (!CONFIRM) {
    console.log('\n⚠  Dry-run 完成，未實際寫入。加上 --confirm 參數以執行。\n')
    process.exit(0)
  }

  console.log('\n寫入中...\n')

  const BATCH_SIZE = 400
  let batch = db.batch()
  let count = 0
  let totalCommit = 0

  for (const doc of targets) {
    batch.update(doc.ref, { rarity: 'S' })
    count++

    if (count >= BATCH_SIZE) {
      await batch.commit()
      totalCommit += count
      console.log(`  ✅ 提交 batch (${count} 筆)`)
      batch = db.batch()
      count = 0
    }
  }

  if (count > 0) {
    await batch.commit()
    totalCommit += count
    console.log(`  ✅ 提交最後一批 (${count} 筆)`)
  }

  console.log(`\n✅ 完成：共更新 ${totalCommit} 筆 module 文件的 rarity → "S"\n`)
  process.exit(0)
}

main().catch(err => {
  console.error('\n❌ 執行失敗：', err.message)
  process.exit(1)
})
