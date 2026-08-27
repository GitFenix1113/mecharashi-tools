/**
 * 修正通用模組的「武器增傷」數值欄位（`dmg_blade` 等 21 欄）
 *
 * ── 這是 `patch-module-tier2-keyin.mjs` 的後半 ─────────────────────────────
 * 那一支把 `mod_4029_2` / `mod_4030_2` 的**名稱與敘述**改對了（兩者當初抄錯行：
 * 4029_2 抄成刀劍、4030_2 抄成浮游炮，icon 是鐵證），但**數值欄位留在原地**——
 * 於是今天資料庫裡是：
 *
 *     mod_4029_2「電鋸模組Ⅱ」  敘述「電鋸的傷害提升N%」  數值落在 dmg_blade   ← 舊名的欄位
 *     mod_4030_2「刀劍模組Ⅱ」  敘述「刀劍的傷害提升N%」  數值落在 dmg_funnel  ← 舊名的欄位
 *
 * 站上因此把「刀劍模組Ⅱ」的加成印成「浮游炮傷害 +5%」（2026-08-27 使用者實機回報）。
 * 這不是渲染錯誤，是 Firestore 裡那一欄真的放錯位置。
 *
 * ── 權威是「該階的敘述文字」，不是同編號的 Ⅰ 級 ────────────────────────────
 * `patch-module-tier2-keyin.mjs` 的權威是 Ⅰ 級（Ⅱ 級＝Ⅰ 級逐字複製，只改三欄）。
 * 這裡**不能**沿用那條：刀劍／拳套／浮游炮三顆 Ⅰ 級的數值欄根本是空的（見 D 類），
 * 拿空的去覆蓋反而會把 Ⅱ 級僅存的正確值洗掉。
 * 敘述文字則是官方原文、兩級一致、且格式固定（「X的傷害提升N%」），
 * 由它推 `(欄位, 數值)` 是零歧義的——這正是腳本該做而人工不該一格一格點的事。
 *
 * ── 為什麼補進 `managedBy: auto` 的三顆 Ⅰ 級是安全的 ───────────────────────
 * `scrape-modules.js` 對這 21 個武器增傷欄的處理是**只從 Firestore 帶前值**
 * （`if (p?.[f] != null) base[f] = p[f]`，頂層同理），官方來源根本沒有這些欄位。
 * 也就是說它們一直是人工維護的，補上去不會被下次爬蟲洗回。
 *
 * ── 四類缺陷（2026-08-27 全庫 241 筆掃描，逐階比對敘述與數值）──────────────
 *   A 欄位放錯（改名的後遺症）    2 顆 × 4 階＋頂層
 *   B 數值打錯                    4 處
 *   C 多出一個不該存在的欄位      1 處（mod_4011_2 Lv1 的 dmg_pile = -5）
 *   D Ⅰ 級整族沒填數值            3 顆 × 4 階＋頂層
 *
 * ⚠ 修完要把 `src/utils/moduleRules.test.ts` 的 `KNOWN_TIER_MISMATCH` 白名單清乾淨
 *   （刀劍／電鋸／拳套／浮游炮四行）——那張表的用途是讓下一筆抄錯立刻被看見，
 *   留著已修好的行會讓它失去意義。
 *
 * 使用方式：
 *   node scripts/patch-module-weapon-dmg-fields.mjs            ← dry-run（唯讀，印出逐欄 diff）
 *   node scripts/patch-module-weapon-dmg-fields.mjs --apply    ← 確認後寫入 + bump modules 版本
 *   node scripts/patch-module-weapon-dmg-fields.mjs --restore <快照> --apply   ← 還原
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
const ASSUME_YES = args.includes('--yes')
const RESTORE_IDX = args.indexOf('--restore')
const RESTORE_FILE = RESTORE_IDX >= 0 ? args[RESTORE_IDX + 1] : null
const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')

/**
 * 21 個武器增傷欄位（`src/types/module.ts` 的「武器類別／種類／特殊情境增傷」三段）。
 *
 * ⚠ 本腳本**只碰這 21 欄**。`dmg` / `crit_rate` / `armor_rate` 那些通用欄位不在範圍內：
 *   它們的敘述不是「X的傷害提升N%」這種可反推的固定格式（多半帶條件與機率），
 *   由敘述推欄位在那邊會變成猜。
 */
const WEAPON_DMG_FIELDS = [
  'dmg_assault', 'dmg_melee', 'dmg_shooting', 'dmg_tactical',
  'dmg_blade', 'dmg_polearm', 'dmg_missile', 'dmg_rocket',
  'dmg_shotgun', 'dmg_machinegun', 'dmg_heavy_machinegun',
  'dmg_railgun', 'dmg_funnel', 'dmg_sniper_light', 'dmg_sniper',
  'dmg_fist', 'dmg_pile', 'dmg_chainsaw', 'dmg_flamethrower',
  'dmg_counter', 'dmg_enemy_phase',
]

/**
 * 敘述開頭的詞 → 欄位。**長詞必須排在短詞前面**（「重機槍」先於「機槍」、
 * 「輕型狙擊步槍」先於「狙擊步槍」），否則會比對到錯的那一個。
 */
const TERM_TO_FIELD = [
  ['重機槍', 'dmg_heavy_machinegun'], ['輕型狙擊步槍', 'dmg_sniper_light'],
  ['狙擊步槍', 'dmg_sniper'], ['機槍', 'dmg_machinegun'],
  ['刀劍', 'dmg_blade'], ['長柄', 'dmg_polearm'], ['導彈', 'dmg_missile'], ['火箭', 'dmg_rocket'],
  ['霰彈槍', 'dmg_shotgun'], ['電磁炮', 'dmg_railgun'], ['浮游炮', 'dmg_funnel'],
  ['拳套', 'dmg_fist'], ['打樁機', 'dmg_pile'], ['電鋸', 'dmg_chainsaw'], ['噴火器', 'dmg_flamethrower'],
  ['突擊', 'dmg_assault'], ['格鬥', 'dmg_melee'], ['射擊', 'dmg_shooting'], ['戰術', 'dmg_tactical'],
]

/**
 * 要修的模組。**具名清單而不是「掃到什麼修什麼」**：後者會在官方日後新增一批
 * 敘述格式相近的模組時，靜默地把它們一起改掉。這七顆是 2026-08-27 全庫掃描的結果，
 * 每一顆都人工看過。
 */
const TARGETS = [
  // A：改名後數值欄留在舊名上
  'mod_4029_2',  // 電鋸模組Ⅱ  · dmg_blade  → dmg_chainsaw（順帶修 Lv2 的 9 → 5）
  'mod_4030_2',  // 刀劍模組Ⅱ  · dmg_funnel → dmg_blade
  // B：數值打錯（欄位是對的）
  'mod_4010_2',  // 打樁機模組Ⅱ · Lv2 dmg_pile    3 → 5
  'mod_4013_2',  // 霰彈槍模組Ⅱ · Lv2 dmg_shotgun 7 → 5
  'mod_4016_2',  // 狙擊步槍模組Ⅱ · Lv3 dmg_sniper 3 → 7
  // C：多出一個不該有的欄位
  'mod_4011_2',  // 拳套模組Ⅱ  · Lv1 有一個 dmg_pile = -5
  // D：Ⅰ 級整族沒填
  'mod_4011',    // 拳套模組Ⅰ
  'mod_4030',    // 刀劍模組Ⅰ
  'mod_4032',    // 浮游炮模組Ⅰ
]

/** `「刀劍的傷害提升5%」` → `{ field: 'dmg_blade', value: 5 }`；認不出來回 null。 */
function expectedFrom(description) {
  const m = /^(.+?)的傷害提升(\d+(?:\.\d+)?)%/.exec((description ?? '').trim())
  if (!m) return null
  for (const [term, field] of TERM_TO_FIELD) {
    if (m[1].startsWith(term)) return { field, value: Number(m[2]) }
  }
  return null
}

let db

function loadEnv(file) {
  const p = resolve(ROOT, file)
  if (!fs.existsSync(p)) return
  fs.readFileSync(p, 'utf-8').split(/\r?\n/).forEach(line => {
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
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? 'serviceAccountKey.json'
  const abs = resolve(ROOT, credPath)
  if (!fs.existsSync(abs)) throw new Error(`找不到服務帳號金鑰：${abs}`)
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(abs, 'utf-8'))) })
  db = admin.firestore()
}

function promptConfirm(q) {
  if (ASSUME_YES) { console.log(`${q}y（--yes）`); return Promise.resolve(true) }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}

async function bumpModules() {
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: { modules: version },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return version
}

async function restore() {
  const snap = JSON.parse(fs.readFileSync(resolve(ROOT, RESTORE_FILE), 'utf-8'))
  console.log(`還原快照：${RESTORE_FILE}（${snap.docs.length} 份模組）`)
  if (!APPLY) { console.log('（dry-run。加 --apply 才會寫入）'); return }
  if (!await promptConfirm('確認還原？ [y/N] ')) { console.log('已取消。'); return }
  const batch = db.batch()
  for (const d of snap.docs) batch.set(db.collection('modules').doc(d.id), d.data)
  await batch.commit()
  const v = await bumpModules()
  console.log(`\n✅ 已還原，modules 版本已 bump → ${v}`)
}

/**
 * 一份文件改完之後該長什麼樣，以及逐欄 diff。
 *
 * 規則（每一階獨立套用）：
 *   · 敘述推得出 `(欄位, 數值)` → 該欄設成那個數值，**其餘 20 欄一律移除**
 *   · 敘述推不出來             → 這一階原封不動（那是條件式效果，不歸本腳本管）
 * 頂層的武器增傷欄是**最後一階的鏡像**（既有慣例，見 patch-module-tier2-keyin.mjs）。
 */
function planFor(data) {
  const next = JSON.parse(JSON.stringify(data))
  const diffs = []
  let lastExpected = null

  for (const [i, lv] of (next.levels ?? []).entries()) {
    const want = expectedFrom(lv.description)
    if (!want) continue
    lastExpected = want
    for (const f of WEAPON_DMG_FIELDS) {
      const cur = lv[f]
      const target = f === want.field ? want.value : undefined
      if (cur === target || (cur === undefined && target === undefined)) continue
      diffs.push(`levels[${i}].${f}`.padEnd(30)
        + `${JSON.stringify(cur ?? null)} → ${JSON.stringify(target ?? null)}   「${lv.description}」`)
      if (target === undefined) delete lv[f]
      else lv[f] = target
    }
  }

  // 頂層＝滿階鏡像。沒有任何一階推得出來（純條件式模組）就不動頂層
  if (lastExpected) {
    for (const f of WEAPON_DMG_FIELDS) {
      const cur = next[f]
      const target = f === lastExpected.field ? lastExpected.value : undefined
      if (cur === target || (cur === undefined && target === undefined)) continue
      diffs.push(`（頂層）${f}`.padEnd(30) + `${JSON.stringify(cur ?? null)} → ${JSON.stringify(target ?? null)}`)
      if (target === undefined) delete next[f]
      else next[f] = target
    }
  }

  return { next, diffs }
}

async function main() {
  initFirebase()
  if (RESTORE_FILE) return restore()

  const snaps = await Promise.all(TARGETS.map(id => db.collection('modules').doc(id).get()))
  const docs = new Map()
  for (let i = 0; i < TARGETS.length; i++) {
    if (!snaps[i].exists) throw new Error(`找不到 modules/${TARGETS[i]}`)
    docs.set(TARGETS[i], snaps[i].data())
  }

  console.log('── 將修改 ──────────────────────────────────────────────────')
  const plans = new Map()
  let total = 0
  for (const id of TARGETS) {
    const d = docs.get(id)
    const plan = planFor(d)
    plans.set(id, plan)
    console.log(`\n  modules/${id}   「${d.name}」  managedBy=${d.managedBy ?? '-'}`)
    if (plan.diffs.length === 0) { console.log('      （已經是對的，不動）'); continue }
    plan.diffs.forEach(s => console.log(`      ${s}`))
    total += plan.diffs.length
  }

  if (total === 0) {
    console.log('\n✅ 九份文件都已經是對的，沒有東西要改。')
    return
  }
  console.log(`\n  合計 ${total} 個欄位、${[...plans.values()].filter(p => p.diffs.length).length} 份文件。之後 bump modules 版本。`)

  if (!APPLY) {
    console.log('\n（dry-run，未寫入任何東西。確認無誤後加 --apply）')
    return
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(OUT_DIR, `module-weapon-dmg-backup-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({
    docs: TARGETS.map(id => ({ id, data: docs.get(id) })),
  }, null, 2), 'utf-8')
  console.log(`\n💾 還原快照：${path.relative(ROOT, backupFile)}`)
  console.log(`   還原：node scripts/patch-module-weapon-dmg-fields.mjs --restore "${path.relative(ROOT, backupFile)}" --apply`)

  if (!await promptConfirm('\n確認寫入 Firestore？ [y/N] ')) { console.log('已取消。'); return }

  const batch = db.batch()
  for (const id of TARGETS) {
    const plan = plans.get(id)
    if (!plan.diffs.length) continue
    // ⚠ 用 set() 整份覆蓋而不是 update()：要移除的是**陣列元素裡**的一個 key，
    //   而 FieldValue.delete() 只作用在文件層級的路徑上，進不到 levels[i] 內部。
    batch.set(db.collection('modules').doc(id), plan.next)
  }
  await batch.commit()
  console.log(`  …已更新 ${[...plans.values()].filter(p => p.diffs.length).length} 份模組`)

  const version = await bumpModules()
  console.log(`\n✅ 完成。modules 版本已 bump → ${version}`)
  console.log('   下一步：清掉 moduleRules.test.ts 的 KNOWN_TIER_MISMATCH 白名單四行')
  console.log('           node scripts/export-emulator-slice.mjs --simulator（讓本機種子跟上）')
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1) })
