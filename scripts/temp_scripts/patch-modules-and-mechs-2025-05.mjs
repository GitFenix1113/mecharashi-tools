/**
 * 米赫瑪超吉情豹站 — 2025-05 模組與機甲資料修正
 *
 * 執行內容：
 *   [modules] 新增 sub_mod_護理模組（機甲副模組，無綁定機甲）
 *   [modules] 新增 sub_mod_迴避模組（機甲副模組，無綁定機甲）
 *   [mechs]   mech_013_吉爾萊斯  moduleFixedIds → ["sub_mod_護理模組"]
 *   [mechs]   mech_001_都卜勒    moduleFixedIds → ["sub_mod_迴避模組"]
 *   [mechs]   mech_020_光暉      module4Id      → ""（移除錯誤引用）
 *   [mechs]   mech_031_銜尾蛇    module4Id      → ""（移除錯誤引用）
 *   [mechs]   mech_042_雪鴞      module4Id      → ""（移除錯誤引用）
 *   [mechs]   mech_046_赫克托爾  moduleFixedIds → []（移除錯誤引用）
 *
 * 用法：
 *   node scripts/patch-modules-and-mechs-2025-05.mjs            （dry-run）
 *   node scripts/patch-modules-and-mechs-2025-05.mjs --confirm  （實際寫入）
 *
 * 前置條件：serviceAccountKey.json 存在於專案根目錄
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '..')
const CONFIRM   = process.argv.includes('--confirm')

console.log(`\n🔥 米赫瑪超吉情豹站 — 2025-05 模組/機甲修正 ${CONFIRM ? '[實際寫入]' : '[DRY RUN]'}\n`)

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

const keyPath = resolve(ROOT, 'serviceAccountKey.json')
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

// ── 新模組資料（使用 v1.9 之後的欄位 schema）────────────────────────────────
const NEW_MODULES = [
  {
    id:            'sub_mod_護理模組',
    name:          '護理模組',
    slot:          '機甲副模組',
    boundMechId:   null,
    boundPart:     null,
    available:     false,
    source:        '未知',
    managedBy:     'manual',
    dmg:           0,
    critDmg:       0,
    crit_rate:     0,
    acc_rate:      0,
    firepower_rate: 0,
    armor_rate:    0,
    crit_resist_rate: 0,
    output_bonus:  0,
    dodge_rate:    0,
    durable_rate:  0,
    dmg_resist_rate: 0,
    levels:        [],
    description:   '',
    rarity:        '',
    icon:          '',
  },
  {
    id:            'sub_mod_迴避模組',
    name:          '迴避模組',
    slot:          '機甲副模組',
    boundMechId:   null,
    boundPart:     null,
    available:     false,
    source:        '未知',
    managedBy:     'manual',
    dmg:           0,
    critDmg:       0,
    crit_rate:     0,
    acc_rate:      0,
    firepower_rate: 0,
    armor_rate:    0,
    crit_resist_rate: 0,
    output_bonus:  0,
    dodge_rate:    0,
    durable_rate:  0,
    dmg_resist_rate: 0,
    levels:        [],
    description:   '',
    rarity:        '',
    icon:          '',
  },
]

// ── 機甲欄位修正 ──────────────────────────────────────────────────────────────
const MECH_PATCHES = [
  { id: 'mech_013_吉爾萊斯', field: 'moduleFixedIds', value: ['sub_mod_護理模組'] },
  { id: 'mech_001_都卜勒',   field: 'moduleFixedIds', value: ['sub_mod_迴避模組'] },
  { id: 'mech_020_光暉',     field: 'module4Id',      value: '' },
  { id: 'mech_031_銜尾蛇',   field: 'module4Id',      value: '' },
  { id: 'mech_042_雪鴞',     field: 'module4Id',      value: '' },
  { id: 'mech_046_赫克托爾', field: 'moduleFixedIds', value: [] },
]

// ── 主流程 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📋 變更清單：\n')

  // 1. 新增模組
  console.log('【modules 集合】新增文件：')
  for (const mod of NEW_MODULES) {
    console.log(`  + ${mod.id}  (${mod.name})  slot=${mod.slot}`)
  }

  // 2. 機甲修正
  console.log('\n【mechs 集合】欄位修正：')
  for (const p of MECH_PATCHES) {
    const valStr = Array.isArray(p.value) ? `[${p.value.join(', ')}]` : `"${p.value}"`
    console.log(`  ~ ${p.id}  .${p.field} → ${valStr}`)
  }

  if (!CONFIRM) {
    console.log('\n⚠  Dry-run 完成，未實際寫入。加上 --confirm 參數以執行。\n')
    process.exit(0)
  }

  console.log('\n寫入中...\n')
  const batch = db.batch()

  // 新增模組
  for (const mod of NEW_MODULES) {
    const { id, ...data } = mod
    batch.set(db.collection('modules').doc(id), data, { merge: true })
    console.log(`  ✅ modules/${id}`)
  }

  // 機甲修正
  for (const p of MECH_PATCHES) {
    batch.update(db.collection('mechs').doc(p.id), { [p.field]: p.value })
    console.log(`  ✅ mechs/${p.id}  .${p.field}`)
  }

  await batch.commit()
  console.log('\n✅ 全部寫入完成。\n')
  process.exit(0)
}

main().catch(err => {
  console.error('\n❌ 執行失敗：', err.message)
  process.exit(1)
})
