/**
 * 鋼嵐工具站 — Firestore 圖片路徑改指 WebP
 *
 * convert-images-to-webp.mjs 產出 .webp 之後，Firestore 裡存的仍是 .png 路徑。
 * 本腳本深掃所有集合的每個字串欄位，找出形如 /images/**\/*.png 且磁碟上已有同名
 * .webp 的路徑，改寫成 .webp，最後 bump 受影響集合的版本讓前台快取失效。
 *
 * 為什麼要深掃而不是列舉欄位：圖片路徑散在 Pilot.portrait、Mech.portrait /
 * halfPortrait / parts[].icon、各種 icon 欄位…，列舉一定會漏。深掃無視結構，
 * 只認「值長得像圖片路徑」，新增欄位也不必回來改這支腳本。
 *
 * 預設 dry-run，要實際寫入必須加 --apply。
 *
 * 使用方式：
 *   node scripts/patch-image-paths.mjs                    ← 預覽全部集合
 *   node scripts/patch-image-paths.mjs pilots             ← 只看 pilots
 *   node scripts/patch-image-paths.mjs pilots --apply     ← 實際寫入並 bump 版本
 *   node scripts/patch-image-paths.mjs --apply --auto     ← 略過互動確認
 *   node scripts/patch-image-paths.mjs --missing          ← 反向檢查：路徑指向磁碟上不存在的檔（破圖）
 */

import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PUBLIC_DIR = resolve(ROOT, 'public')

// ⚠ 與 scripts/bump-data-version.mjs 的 KNOWN_KEYS 一致（也就是 GameDataContext 的 ALL_COLLECTION_KEYS）。
// 只有這些集合走版本 gate 快取，因此也只有這些需要 bump。
const BUMPABLE_KEYS = [
  'pilots', 'mechs', 'modules', 'weapons', 'backpacks', 'backpackSkills', 'components',
  'buffs', 'pilotSkills', 'neuralDriveAbilities', 'glossaryTerms', 'globalResearch', 'grayOpsRoster',
]

/**
 * 版本 key ≠ Firestore 集合名的例外。
 *
 * 這份清單裡的字串一直是**版本 key**（meta/gameData.versions 的欄位名），只是絕大多數剛好
 * 與集合名同字，於是 `db.collection(key)` 一路都對——唯獨 grayOpsRoster 的真實集合叫
 * `grayOps`（見 src/lib/api/grayOps.ts）。Firestore 查一個不存在的集合不會報錯，只回空
 * snapshot，所以症狀是靜默的一行「grayOpsRoster：0 筆（略過）」：--apply 不會把它的圖片
 * 路徑改寫成 .webp、--missing 也照樣回報「沒有破圖路徑」。
 *
 * 灰燼行動名單開始存 icon 路徑後這才有實害，否則該集合根本沒有 /images/ 值可掃。
 */
const COLLECTION_OF = { grayOpsRoster: 'grayOps' }
const collectionOf = (key) => COLLECTION_OF[key] ?? key

// patchVersions 不在 GameDataContext 的快取層（AdminVersionEditorPage 直接 getDoc），
// 但它的 bannerImage 與 iconUrls.{pilots,mechs,weapons,backpacks} 存了大量 /images/ 路徑。
// 漏掉它的後果是版本時間軸整排破圖，而前台其他頁面看起來一切正常，很難聯想到這裡。
const EXTRA_KEYS = ['patchVersions']

const KNOWN_KEYS = [...BUMPABLE_KEYS, ...EXTRA_KEYS]

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const AUTO = args.includes('--auto')
const MISSING = args.includes('--missing')
const TARGETS = args.filter((a) => !a.startsWith('--'))

for (const k of TARGETS) {
  if (!KNOWN_KEYS.includes(k)) {
    console.error(`❌ 不認識的集合「${k}」。可用：${KNOWN_KEYS.join(', ')}`)
    process.exit(1)
  }
}
const COLLECTIONS = TARGETS.length ? TARGETS : KNOWN_KEYS

// 只認站內相對路徑；http(s) 開頭的外部圖（例如 portraitUrl 指向官方 CDN）一律不動。
const IMG_PATH_RE = /^\/?images\/.+\.(png|jpe?g)$/i

// ── Firebase 初始化（比照 bump-data-version.mjs） ────────────────────────────
function loadEnv(filename) {
  const envPath = resolve(ROOT, filename)
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
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

function promptConfirm(question) {
  if (AUTO) return Promise.resolve(true)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(/^y(es)?$/i.test(a.trim())) }))
}

// ── 路徑處理 ─────────────────────────────────────────────────────────────────

// ⚠ 必須與 src/utils/assets.ts 的 SKILL_PREFIX_FOLDERS / normalizeSkillPath 對齊。
// 技能圖示實體放在 skills/<子資料夾>/，但 DB 內大量存的是扁平的 /images/skills/<檔名>，
// 前台靠 normalizeSkillPath 在 runtime 推回子資料夾。本腳本若不照做，會把上千個
// 其實正常的技能圖示誤判成「檔案不存在」。
const SKILL_PREFIX_FOLDERS = [
  ['Icon_skill_main', '主動技能'],
  ['Icon_skill_order', '指令技能'],
  ['Icon_skill_passive', '被動技能'],
  ['Icon_skill_pp', 'pp技能'],
  ['Icon_skill_talent', '天賦技能'],
]

function normalizeSkillPath(p) {
  const m = p.match(/(^|\/)images\/skills\/(.+)$/)
  if (!m) return p
  const file = m[2].split('/').pop() ?? ''
  const sub = SKILL_PREFIX_FOLDERS.find(([prefix]) => file.startsWith(prefix))?.[1]
  return sub ? `${m[1]}images/skills/${sub}/${file}` : p
}

const diskPath = (webPath) => resolve(PUBLIC_DIR, normalizeSkillPath(webPath).replace(/^\//, ''))
const toWebp = (p) => p.replace(/\.(png|jpe?g)$/i, '.webp')

/**
 * 遞迴改寫物件內的圖片路徑，回傳 { value, hits }。
 * value 是新的（結構相同的）值；hits 記錄每一處改動供報告用。
 */
function rewrite(value, trail, hits) {
  if (typeof value === 'string') {
    if (!IMG_PATH_RE.test(value)) return value
    const next = toWebp(value)
    if (!fs.existsSync(diskPath(next))) return value
    hits.push({ field: trail, from: value, to: next })
    return next
  }
  if (Array.isArray(value)) return value.map((v, i) => rewrite(v, `${trail}[${i}]`, hits))
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, trail ? `${trail}.${k}` : k, hits)
    return out
  }
  return value // Timestamp / DocumentReference / number / boolean / null 等原樣保留
}

/** --missing 模式：找出指向磁碟上不存在檔案的圖片路徑（破圖來源） */
function scanMissing(value, trail, hits) {
  if (typeof value === 'string') {
    if (IMG_PATH_RE.test(value) || /^\/?images\/.+\.webp$/i.test(value)) {
      if (!fs.existsSync(diskPath(value))) hits.push({ field: trail, from: value })
    }
    return
  }
  if (Array.isArray(value)) { value.forEach((v, i) => scanMissing(v, `${trail}[${i}]`, hits)); return }
  if (value && typeof value === 'object' && value.constructor === Object) {
    for (const [k, v] of Object.entries(value)) scanMissing(v, trail ? `${trail}.${k}` : k, hits)
  }
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  const db = initFirebase()

  console.log(`模式：${MISSING ? '破圖檢查' : APPLY ? '實際寫入' : 'DRY-RUN（不寫入）'}`)
  console.log(`集合：${COLLECTIONS.join(', ')}\n`)

  const plan = []   // { key, id, topFields, hits }
  let missingCount = 0

  for (const key of COLLECTIONS) {
    const snap = await db.collection(collectionOf(key)).get()
    if (snap.empty) { console.log(`${key}：0 筆（略過）`); continue }

    let docHits = 0
    for (const doc of snap.docs) {
      const data = doc.data()

      if (MISSING) {
        const hits = []
        scanMissing(data, '', hits)
        if (hits.length) {
          console.log(`  ❌ ${key}/${doc.id}`)
          for (const h of hits) console.log(`       ${h.field} = ${h.from}`)
          missingCount += hits.length
        }
        continue
      }

      const hits = []
      const next = rewrite(data, '', hits)
      if (!hits.length) continue

      // 只送出「含有改動」的最上層欄位，避免整份 overwrite 動到不相干的資料
      const topFields = [...new Set(hits.map((h) => h.field.split(/[.[]/)[0]))]
      const payload = Object.fromEntries(topFields.map((f) => [f, next[f]]))
      plan.push({ key, id: doc.id, payload, hits })
      docHits++

      console.log(`  ${key}/${doc.id}`)
      for (const h of hits) console.log(`       ${h.field}: ${h.from} → ${h.to}`)
    }
    if (!MISSING) console.log(`${key}：${snap.size} 筆掃描，${docHits} 筆需改寫\n`)
  }

  if (MISSING) {
    console.log(missingCount ? `\n共 ${missingCount} 處路徑在 public/ 底下找不到對應檔案。` : '\n✅ 沒有破圖路徑。')
    return
  }

  const totalHits = plan.reduce((n, p) => n + p.hits.length, 0)
  if (!plan.length) { console.log('✅ 沒有可改寫的路徑（找不到對應的 .webp，或早已改完）。'); return }

  console.log(`合計 ${plan.length} 份文件、${totalHits} 處路徑可改寫。`)
  if (!APPLY) { console.log('以上為預覽。確認無誤後加上 --apply 實際寫入。'); return }

  const affected = [...new Set(plan.map((p) => p.key))]
  const toBump = affected.filter((k) => BUMPABLE_KEYS.includes(k))
  if (!(await promptConfirm(`確定寫入 ${affected.join(', ')}${toBump.length ? ` 並 bump ${toBump.join(', ')}` : ''}？(y/N) `))) {
    console.log('已取消。')
    return
  }

  // 寫入：merge 只覆蓋列出的最上層欄位（陣列欄位整段換掉，正是我們要的）
  let batch = db.batch()
  let n = 0
  for (const p of plan) {
    batch.set(db.collection(collectionOf(p.key)).doc(p.id), p.payload, { merge: true })
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch() }
  }
  await batch.commit()
  console.log(`✅ 已寫入 ${plan.length} 份文件`)

  // bump 版本：不做的話使用者會繼續讀 localStorage 舊快取，看到的仍是舊 .png 路徑
  if (!toBump.length) { console.log('（無需 bump：受影響的集合都不走版本 gate 快取）'); return }
  const metaRef = db.collection('meta').doc('gameData')
  const cur = (await metaRef.get()).data() ?? {}
  const now = new Date().toISOString()
  const versions = { ...(cur.versions ?? {}) }
  for (const k of toBump) versions[k] = now
  await metaRef.set({ versions, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  console.log(`✅ 已 bump：${toBump.join(', ')} → ${now}`)
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1) })
