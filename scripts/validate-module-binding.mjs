#!/usr/bin/env node
/**
 * 模組綁定一致性檢查（唯讀）— PLAN-040 A-3
 *
 * ── 為什麼需要這支 ────────────────────────────────────────────────────────
 * 「哪台機甲搭載哪個專屬模組」這件事在資料庫裡有**兩份記載**：
 *
 *     modules.boundMechId  （模組 → 機甲）   ← 前台機甲詳情頁用這個 derive
 *     mechs.moduleFixedIds （機甲 → 模組[]） ← 模擬器用這個判定可選模組
 *
 * 兩者沒有任何機制保證同步，而 scrape-mechs.js 只寫「新增機甲」
 * （:736-738 的 filter(m => !existingMechs.has(...))，連 --force 也一樣），
 * 所以既有機甲的 moduleFixedIds **爬蟲既不會洗掉、也不會修復**。
 *
 * 實際後果（PLAN-040 動工前實測）：3 台機甲共 6 筆專屬模組只存在於模組端，
 * 結果就是「圖鑑看得到帕姆斯陣列、模擬器看不到」——而且沒有任何錯誤訊息。
 * 在 ModuleAdmin 新增專屬模組、設好 boundMechId 卻沒回 MechAdmin 補陣列時，
 * 就會靜默地掉進這個狀態。這支腳本就是把那個沉默補上。
 *
 * ── 判準：一律用 slot === '機甲專屬模組'，禁止用 doc id 前綴 ──────────────
 * 曾有人想用「排除 mod_2xxx / mod_3xxx」這種前綴規則來縮小掃描範圍。
 * 盲點實例：mod_2064（AI火控單元，霸王）的 slot 就是「機甲專屬模組」，
 * 但 id 是 mod_2xxx 形式 → 前綴法會**靜默漏檢它**。
 * 兩種定義在 2026-08-09 恰好同分，但那是巧合，未來新增同型 id 就失效。
 *
 * ⚠ 本腳本刻意**不輸出**「naive 全掃會產生幾筆誤報」這類對照數字：
 *    該數字會隨 modules 資料量漂移、且無法重現，寫進輸出只會誤導。
 *    驗收只認一件事——下列各項皆為 0 筆。
 *
 * ⚠ 唯讀：只用 .get()，不做任何寫入、不 bump 任何版本。
 *
 *   node scripts/validate-module-binding.mjs                    # 完整報告（讀正式庫）
 *   node scripts/validate-module-binding.mjs --quiet            # 只輸出結論與問題（CI 用）
 *   node scripts/validate-module-binding.mjs --fixture=x.json   # 改讀本機 JSON，不連 Firestore
 *
 * --fixture 的格式：{ "mechs": [ {id, moduleFixedIds, ...}, ... ],
 *                     "modules": [ {id, slot, boundMechId, boundPart, ...}, ... ] }
 * 用途有二：① 離線驗證備份／匯出切片；② 對這支腳本自己做負向測試——
 * 一個只會回報 PASS 的校驗器等於沒被驗證過，故附 tests/module-binding.bad.json，
 * 內含刻意造壞的八類問題各一筆，跑它應該讓八類檢查全部觸發、以離開碼 1 結束
 * （實際回報 9 筆：其中一筆資料同時構成「斷鏈」與「反向不符」，屬正確行為）。
 *
 * 離開碼：有任何問題 → 1（可直接串進 CI / data-patch 收尾檢查）；全部乾淨 → 0
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const ROOT = resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUIET = process.argv.includes('--quiet')

// ⚠ 必須與 src/types/enums.ts 的 ModuleSlot / MechPartPosition 同步。
//   .mjs 無法 import TS，故在此複寫；改 enum 時請一併改這裡。
const SLOT_EXCLUSIVE = '機甲專屬模組'
const VALID_PARTS = ['torso', 'leftArm', 'rightArm', 'legs']

function loadEnv(filename) {
  const p = resolve(ROOT, filename)
  if (!fs.existsSync(p)) return
  fs.readFileSync(p, 'utf-8').split('\n').forEach((line) => {
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
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定（見 .env.migration.example）')
  const abs = resolve(ROOT, credPath)
  if (!fs.existsSync(abs)) throw new Error(`找不到服務帳號金鑰：${abs}`)
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(abs, 'utf-8'))) })
  return admin.firestore()
}

const log = (...a) => { if (!QUIET) console.log(...a) }

const fixtureArg = process.argv.find((a) => a.startsWith('--fixture='))

let mechs, mods
if (fixtureArg) {
  const p = resolve(ROOT, fixtureArg.slice('--fixture='.length))
  if (!fs.existsSync(p)) throw new Error(`找不到 fixture：${p}`)
  const fx = JSON.parse(fs.readFileSync(p, 'utf-8'))
  mechs = new Map((fx.mechs ?? []).map((d) => [d.id, d]))
  mods = new Map((fx.modules ?? []).map((d) => [d.id, d]))
  log(`⚙ fixture 模式：${p}（未連線 Firestore）`)
} else {
  const db = initFirebase()
  const [mechSnap, modSnap] = await Promise.all([
    db.collection('mechs').get(),
    db.collection('modules').get(),
  ])
  mechs = new Map(mechSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]))
  mods = new Map(modSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]))
}

log(`mechs ${mechs.size} 筆｜modules ${mods.size} 筆\n`)

/** 每項檢查一個 bucket，最後統一結算 */
const findings = {
  斷鏈: [],            // 專屬模組存在於模組端，但機甲端的 moduleFixedIds 沒收
  懸空: [],            // moduleFixedIds 指向不存在的模組
  孤兒綁定: [],        // boundMechId 指向不存在的機甲
  專屬模組無綁定: [],  // slot=專屬模組 卻沒有 boundMechId
  反向不符: [],        // moduleFixedIds 收了某專屬模組，但該模組的 boundMechId 指向別台
  boundPart型別: [],   // boundPart 不是陣列也不是 null
  boundPart值域: [],   // boundPart 陣列內有不認識的部位
  boundPart空陣列: [], // [] 語意曖昧，應為 null
}

// ── ① 專屬模組：module → mech 的反向索引是否收齊 ──────────────────────────
const exclusiveByMech = new Map()
for (const mod of mods.values()) {
  if (mod.slot !== SLOT_EXCLUSIVE) continue
  if (!mod.boundMechId) { findings.專屬模組無綁定.push(`${mod.id}（${mod.name ?? '?'}）`); continue }
  if (!mechs.has(mod.boundMechId)) { findings.孤兒綁定.push(`${mod.id} → ${mod.boundMechId}（機甲不存在）`); continue }
  if (!exclusiveByMech.has(mod.boundMechId)) exclusiveByMech.set(mod.boundMechId, [])
  exclusiveByMech.get(mod.boundMechId).push(mod)
}

log('── ① 專屬模組 ↔ moduleFixedIds 一致性（slot-scoped）──')
for (const [mechId, list] of [...exclusiveByMech.entries()].sort()) {
  const fixedIds = mechs.get(mechId).moduleFixedIds ?? []
  const missing = list.filter((m) => !fixedIds.includes(m.id))
  if (missing.length) {
    missing.forEach((m) => findings.斷鏈.push(`${mechId} 未收 ${m.id}（${m.name ?? '?'}）`))
    log(`  ❌ ${mechId}  ${list.length} 筆中缺 ${missing.length}：${missing.map((m) => m.id).join(', ')}`)
  } else {
    log(`  ✅ ${mechId}  ${list.length} 筆全數收錄`)
  }
}
if (!exclusiveByMech.size) log('  （沒有任何專屬模組）')

// ── ② moduleFixedIds 的反向健全性 ────────────────────────────────────────
for (const mech of mechs.values()) {
  for (const id of mech.moduleFixedIds ?? []) {
    const mod = mods.get(id)
    if (!mod) { findings.懸空.push(`${mech.id} → ${id}（模組不存在）`); continue }
    if (mod.slot === SLOT_EXCLUSIVE && mod.boundMechId && mod.boundMechId !== mech.id) {
      findings.反向不符.push(`${mech.id} 收了 ${id}，但該模組的 boundMechId 是 ${mod.boundMechId}`)
    }
  }
}

// ── ③ boundPart 型別與值域（呼應 A-2）────────────────────────────────────
log('\n── ② boundPart 型別與值域 ──')
const partKinds = {}
for (const mod of mods.values()) {
  const v = mod.boundPart
  const kind = v === undefined ? '(欄位不存在)' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
  partKinds[kind] = (partKinds[kind] ?? 0) + 1
  if (v === undefined || v === null) continue
  if (!Array.isArray(v)) {
    findings.boundPart型別.push(`${mod.id}（${mod.name ?? '?'}）= ${JSON.stringify(v)}（${typeof v}，應為陣列）`)
    continue
  }
  if (v.length === 0) findings.boundPart空陣列.push(`${mod.id}（${mod.name ?? '?'}）`)
  for (const p of v) {
    if (!VALID_PARTS.includes(p)) findings.boundPart值域.push(`${mod.id} 的部位 ${JSON.stringify(p)} 不在 ${VALID_PARTS.join(' / ')} 內`)
  }
}
log(`  型別分布：${JSON.stringify(partKinds)}`)
log(`  合法值域：${VALID_PARTS.join(', ')}`)

// ── 結算 ─────────────────────────────────────────────────────────────────
const LABELS = {
  斷鏈:            '專屬模組未被機甲的 moduleFixedIds 收錄',
  懸空:            'moduleFixedIds 指向不存在的模組',
  孤兒綁定:        'boundMechId 指向不存在的機甲',
  專屬模組無綁定:  'slot 為專屬模組卻沒有 boundMechId',
  反向不符:        'moduleFixedIds 與 boundMechId 互指不一致',
  boundPart型別:   'boundPart 不是陣列（型別宣告為 string[] | null）',
  boundPart值域:   'boundPart 含不認識的部位值',
  boundPart空陣列: 'boundPart 是空陣列（語意曖昧，應改為 null）',
}

console.log('\n═══ 結算 ═══')
let total = 0
for (const [key, items] of Object.entries(findings)) {
  total += items.length
  const mark = items.length === 0 ? '✅' : '❌'
  console.log(`${mark} ${LABELS[key]}：${items.length} 筆`)
  items.forEach((x) => console.log(`     · ${x}`))
}

if (total === 0) {
  console.log('\n✅ 全部通過。')
  process.exit(0)
}
console.log(`\n❌ 共 ${total} 個問題。`)
console.log('   修法提示：專屬模組的搭載關係以 modules.boundMechId 為準，')
console.log('   於後台「機甲管理 → 固定模組」把缺的 id 補進 moduleFixedIds，或跑一次性補丁腳本，完成後 bump mechs / modules 版本。')
process.exit(1)
