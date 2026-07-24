/**
 * PLAN-035 背包分類階層 — A-1b 分類 audit 腳本（佐證義務）
 *
 * 純唯讀：讀 live 全部 backpacks，驗證「name-derive 分類够用」這個核心聲稱。輸出：
 *   ① rarity / tier 直方圖 —— 核對 A/B=37 · S=23 · S+=98 · SS=22（合 180）。
 *   ② unresolved 報告 —— 列出「無法乾淨套入文法」的名字，供人工判斷是否要改文法／改走結構化欄位：
 *        - S+_no_line       ：S+ 複合背包卻 parse 不出 強化/干擾 線（文法期待複合階必有線）
 *        - line_no_variant  ：有線卻無變體（線名照理帶 ·變體）
 *        - bare_line_word   ：名字含裸『強化/干擾』二字，但用『強化背包/干擾背包』token 沒解析出線
 *                             → 可能是 token 漏抓（false negative）或別的概念誤含（需人看）
 *        - variant_no_line_nonfunc：有 ·變體 但無線，且非純功能/特種（結構異常）
 *
 * unresolved 非 0 時：先修 parseBackpackName 文法或改走結構化欄位，勿硬上線。
 *
 * ⚠ import 真正的 parser（src/utils/backpackClassify.ts），確保 audit 的是實際上線的分類邏輯。
 * ⚠ 純唯讀，不寫 Firestore、不 bump 版本。
 *
 * 使用方式（需 .env.migration 的 GOOGLE_APPLICATION_CREDENTIALS 服務帳號，同 PLAN-031 derive 腳本）：
 *   node scripts/audit-backpack-classify.mjs
 *
 * 產物（gitignored）：scripts/temp_scripts/plan035-backpack-audit.json
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'
import { tierFromRarity, parseBackpackName, TIER_LABELS } from '../src/utils/backpackClassify.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')
const OUT_FILE = resolve(OUT_DIR, 'plan035-backpack-audit.json')

// 期望分佈（2026-07-24 盤點）；改版數量變動時更新此基準。
const EXPECTED = { A_B: 37, S: 23, 'S+': 98, SS: 22, total: 180 }

// ── Firebase 初始化（同 derive-weapon-upgrade.mjs）─────────────────────────────
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
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定（需 .env.migration 服務帳號）')
  const absCredPath = resolve(ROOT, credPath)
  if (!fs.existsSync(absCredPath)) throw new Error(`找不到服務帳號金鑰：${absCredPath}`)
  const serviceAccount = JSON.parse(fs.readFileSync(absCredPath, 'utf-8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  db = admin.firestore()
}

const norm = (s) => (s ?? '').toString().trim()
const hasBareLineWord = (name) => name.includes('強化') || name.includes('干擾')

async function main() {
  initFirebase()
  const snap = await db.collection('backpacks').get()
  const backpacks = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`\n讀取 backpacks：${backpacks.length} 件\n`)

  // ── ① 直方圖 ──
  const rarityHist = {}
  const tierHist = {}
  for (const bp of backpacks) {
    const r = norm(bp.rarity) || '(空)'
    rarityHist[r] = (rarityHist[r] ?? 0) + 1
    const tier = tierFromRarity(r) ?? '(未知階層)'
    tierHist[tier] = (tierHist[tier] ?? 0) + 1
  }

  console.log('── rarity 直方圖 ──')
  for (const [r, n] of Object.entries(rarityHist).sort()) console.log(`  ${r.padEnd(4)} ${n}`)
  console.log('── tier 直方圖 ──')
  for (const [t, n] of Object.entries(tierHist)) console.log(`  ${(TIER_LABELS[t] ?? t).padEnd(4)} ${n}`)

  const ab = (rarityHist['A'] ?? 0) + (rarityHist['B'] ?? 0)
  const distOk =
    ab === EXPECTED.A_B &&
    (rarityHist['S'] ?? 0) === EXPECTED.S &&
    (rarityHist['S+'] ?? 0) === EXPECTED['S+'] &&
    (rarityHist['SS'] ?? 0) === EXPECTED.SS &&
    backpacks.length === EXPECTED.total
  console.log(`\n分佈核對（期望 A/B=${EXPECTED.A_B} S=${EXPECTED.S} S+=${EXPECTED['S+']} SS=${EXPECTED.SS} 合 ${EXPECTED.total}）：${distOk ? '✅ 相符' : '⚠ 不符（官方可能改版，請更新 EXPECTED 基準）'}`)

  // ── ② unresolved 報告 ──
  const unresolved = []
  for (const bp of backpacks) {
    const name = norm(bp.name)
    const tier = tierFromRarity(norm(bp.rarity))
    const parts = parseBackpackName(name)
    const reasons = []

    if (tier === 'composite' && parts.line === null) reasons.push('S+_no_line')
    if (parts.line !== null && parts.variant === null) reasons.push('line_no_variant')
    if (parts.line === null && hasBareLineWord(name)) reasons.push('bare_line_word')
    if (parts.variant !== null && parts.line === null && tier !== 'special' && tier !== 'base')
      reasons.push('variant_no_line_nonfunc')

    if (reasons.length > 0) unresolved.push({ id: bp.id, name, rarity: bp.rarity, tier, parts, reasons })
  }

  console.log(`\n── unresolved（無法乾淨套入文法）：${unresolved.length} 件 ──`)
  for (const u of unresolved) console.log(`  [${u.reasons.join(',')}] ${u.rarity} ${u.name} → ${JSON.stringify(u.parts)}`)
  if (unresolved.length === 0) console.log('  （無，全 180 名字乾淨可解析）')

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({ rarityHist, tierHist, distOk, expected: EXPECTED, unresolved }, null, 2))
  console.log(`\n報告已寫入：${path.relative(ROOT, OUT_FILE)}`)
  console.log(`\n結論：${distOk && unresolved.length === 0 ? '✅ name-derive 分類够用，可上線' : '⚠ 有異常，先修文法或評估結構化欄位再上線'}\n`)

  process.exit(0)
}

main().catch(err => { console.error('\n❌ audit 失敗：', err.message, '\n'); process.exit(1) })
