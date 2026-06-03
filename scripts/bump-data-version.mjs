/**
 * PLAN-017 — 遊戲資料版本 bump（初始化 / 手動失效快取）
 *
 * 寫入 meta/gameData = { version: <ISO 時間戳>, updatedAt }。
 * 前台 GameDataContext 啟動時讀此版本；版本不同 → 重抓並更新 localStorage。
 *
 * 使用：
 *   node scripts/bump-data-version.mjs        ← bump（建立 meta/gameData，若不存在）
 *   node scripts/bump-data-version.mjs --show ← 只顯示目前版本，不寫入
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SHOW = process.argv.slice(2).includes('--show')

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
  return admin.firestore()
}

async function main() {
  const db = initFirebase()
  const ref = db.collection('meta').doc('gameData')

  const snap = await ref.get()
  console.log(`目前版本：${snap.exists ? snap.data().version : '(無 meta/gameData 文件)'}`)
  if (SHOW) return

  const version = new Date().toISOString()
  await ref.set({ version, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  console.log(`✅ 已 bump → ${version}`)
}

main().catch(err => { console.error('❌ 失敗：', err.message); process.exit(1) })
