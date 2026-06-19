#!/usr/bin/env node
/**
 * Firestore 靜態全量備份（唯讀匯出）— 等級化遷移等高風險操作前的回滾安全網
 *
 * 把所有頂層 collection 逐一匯出成 JSON，存到 _local-notes/db-backup-<時間戳>/。
 *   · 唯讀：只 .get()，絕不寫 Firestore。
 *   · 一個 collection 一個檔（buffs.json / pilots.json …）+ _manifest.json 總表。
 *   · 偵測子集合（本腳本只備份頂層、不遞迴），若有會在結尾警告。
 *
 * ⚠ 備份含 users 等個資；輸出在 _local-notes/（已被 .gitignore），**切勿提交版控、勿外傳**。
 * ⚠ Firestore Timestamp / GeoPoint 等型別會序列化成普通物件（{_seconds,…}）；作為可讀/可程式還原的快照足夠。
 *
 *   node scripts/backup-firestore.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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

let db
function initFirebase() {
  loadEnv('.env')
  loadEnv('.env.migration')
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定（請於 .env / .env.migration 指定服務帳號金鑰）')
  const absCredPath = resolve(ROOT, credPath)
  if (!fs.existsSync(absCredPath)) throw new Error(`找不到服務帳號金鑰：${absCredPath}`)
  const serviceAccount = JSON.parse(fs.readFileSync(absCredPath, 'utf-8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  db = admin.firestore()
}

async function main() {
  console.log('💾 Firestore 靜態全量備份（唯讀）\n')
  initFirebase()

  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')  // 2026-06-20_1530
  const outDir = resolve(ROOT, '_local-notes', `db-backup-${stamp}`)
  fs.mkdirSync(outDir, { recursive: true })

  const cols = await db.listCollections()
  console.log(`匯出 ${cols.length} 個頂層 collection → ${outDir}\n`)

  let totalDocs = 0
  const manifest = []
  const subColWarn = []

  for (const col of cols) {
    const snap = await col.get()
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    const file = resolve(outDir, `${col.id}.json`)
    fs.writeFileSync(
      file,
      JSON.stringify({ collection: col.id, exportedAt: new Date().toISOString(), count: docs.length, docs }, null, 2),
      'utf-8',
    )
    totalDocs += docs.length
    manifest.push({ collection: col.id, count: docs.length })
    console.log(`  · ${col.id.padEnd(22)} ${String(docs.length).padStart(5)} docs`)

    // 抽樣第一個 doc 偵測子集合（只警告，不遞迴備份）
    if (snap.docs.length) {
      const sub = await snap.docs[0].ref.listCollections()
      if (sub.length) subColWarn.push(`${col.id}（子集合：${sub.map(s => s.id).join(', ')}）`)
    }
  }

  fs.writeFileSync(
    resolve(outDir, '_manifest.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), totalCollections: cols.length, totalDocs, collections: manifest }, null, 2),
    'utf-8',
  )

  console.log(`\n✅ 完成：${cols.length} collections / ${totalDocs} docs`)
  console.log(`   → ${outDir}`)
  if (subColWarn.length) {
    console.log(`\n⚠ 偵測到子集合（本腳本只備份頂層、未遞迴；如該遷移涉及這些子集合請另行處理）：`)
    subColWarn.forEach(w => console.log(`   · ${w}`))
  }
  console.log('\n⚠ 此備份含 users 等個資，存於 _local-notes/（.gitignore）；切勿提交版控或外傳。')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
