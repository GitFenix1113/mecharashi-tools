/**
 * 六顆觸發式模組的 `unlockCondition` ＋ 兩顆〈匯流樞紐〉的 `slotLevelMultiplier`
 * —— PLAN-052-K Phase B 的 B-3 / B-4。
 *
 * ── 為什麼要一支腳本，而不是後台手點 ──────────────────────────────────────
 * 這 8 格是**結構化欄位的第一批值**，而 Phase C 的後台編輯器還沒做。
 * 用腳本落值有三個好處：① 寫死的名單附帶「為什麼是這顆」的證據，
 * ② 每一格寫入前都先驗前提（名稱／boundMechId／描述特徵字串），資料一移動就中止而不是寫錯格，
 * ③ 可 dry-run、可還原。
 *
 * ── 這 8 格是哪來的 ────────────────────────────────────────────────────────
 * **B-3 · unlockCondition**
 *   · 復仇女神 ×4〈模型-武／憐愛／月升／無恙〉→ `{ moduleAtMaxLevel, mod_3034 }`
 *     ⚠ 觸發者是**別顆模組**。這四顆自己的描述裡**沒有**「限制解除」四個字 ——
 *       那句話在〈迸發模組〉(`mod_3034`) 的 LV8 文本：
 *       「進入[限制解除]狀態，激活集成在部位內的額外模組效果」。
 *       任何「掃模組自己的描述」的做法都會整批漏掉這四顆。
 *   · 彌造者〈帕姆斯陣列〉→ 海莉絲、星夜女神〈觀星者單元〉→ 曜（`pilotOnly`）。
 *     兩顆的描述末尾都帶「※只有[X]能發動此模組※」（人工加的，不在官方文本裡）。
 *
 *   ⚠ **不進這個欄位的**：影虎〈虎魄·無束〉L2「當[虎王]駕駛一整套[影虎]時…」、
 *     輝龍龍威 L2「當[戰部渡]駕駛整套[輝龍]時…」—— 那是**效果內的條件**，
 *     模組本身照樣存在、照樣算等級。混進來的話那六顆會在非專屬機師下整顆消失。
 *
 * **B-4 · slotLevelMultiplier**
 *   破曉者-02 有**兩顆同名**的〈匯流樞紐〉，效果不同：
 *     `mod_破曉者-02_fixed_4`（官方 20391）「**軀幹**插槽中的模組等級翻倍」→ ['torso']
 *     `mod_破曉者-02_fixed_1`（官方 20394）「**腿部**插槽中的模組等級翻倍」→ ['legs']
 *   ⚠ 名稱不唯一 ⇒ 任何用名稱查表的程式都會撞在一起，這正是要落成結構化欄位的理由。
 *   ⚠ 翻的是**插槽貢獻**，不含天生貢獻（站長實測）。
 *
 * ── 使用方式 ──────────────────────────────────────────────────────────────
 *   node scripts/patch-module-unlock-conditions.mjs                   ← dry-run（唯讀）
 *   node scripts/patch-module-unlock-conditions.mjs --apply           ← 寫入 ＋ bump modules
 *   node scripts/patch-module-unlock-conditions.mjs --restore <快照> --apply
 *
 * 寫入後：node scripts/export-emulator-slice.mjs --simulator（讓本機種子跟上）
 */

import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ASSUME_YES = args.includes('--yes')
const RESTORE_IDX = args.indexOf('--restore')
const RESTORE_FILE = RESTORE_IDX >= 0 ? args[RESTORE_IDX + 1] : null

let db

/**
 * 要寫的 8 格。`expect` 是**寫入前的前提檢查**：任何一項對不上就中止整批 ——
 * 資料搬過家的話，寧可什麼都不寫，也不要把值填到別格去。
 */
const TARGETS = [
  // ── B-3 復仇女神 ×4：觸發者是 mod_3034〈迸發模組〉LV8 的「限制解除」 ──
  ...['1', '2', '3', '4'].map((n) => ({
    docId: `mod_復仇女神_fixed_${n}`,
    expect: { boundMechId: 'mech_034_復仇女神' },
    patch: { unlockCondition: { kind: 'moduleAtMaxLevel', moduleId: 'mod_3034' } },
    why: '〈迸發模組〉LV8：「進入[限制解除]狀態，激活集成在部位內的額外模組效果」',
  })),
  // ── B-3 機師限定 ×2：描述末尾「※只有[X]能發動此模組※」 ──
  {
    docId: 'mod_彌造者_fixed_1',
    expect: { name: '帕姆斯陣列', boundMechId: 'mech_052_彌造者', descIncludes: '只有[海莉絲]能發動此模組' },
    patch: { unlockCondition: { kind: 'pilotOnly', pilotIds: ['pilot_049_海莉絲'] } },
    why: '描述末尾「※只有[海莉絲]能發動此模組※」',
  },
  {
    docId: 'mod_星夜女神_fixed_1',
    expect: { name: '觀星者單元', boundMechId: 'mech_089_星夜女神', descIncludes: '只有[曜]能發動此模組' },
    patch: { unlockCondition: { kind: 'pilotOnly', pilotIds: ['pilot_088_曜'] } },
    why: '描述末尾「※只有[曜]能發動此模組※」',
  },
  // ── B-4 匯流樞紐 ×2：同名不同效果，靠描述裡的部位分辨 ──
  {
    docId: 'mod_破曉者-02_fixed_4',
    expect: { name: '匯流樞紐', boundMechId: 'mech_026_破曉者-02', descIncludes: '軀幹插槽中的模組等級翻倍' },
    patch: { slotLevelMultiplier: ['torso'] },
    why: '官方 20391「軀幹插槽中的模組等級翻倍」',
  },
  {
    docId: 'mod_破曉者-02_fixed_1',
    expect: { name: '匯流樞紐', boundMechId: 'mech_026_破曉者-02', descIncludes: '腿部插槽中的模組等級翻倍' },
    patch: { slotLevelMultiplier: ['legs'] },
    why: '官方 20394「腿部插槽中的模組等級翻倍」',
  },
]

/** `pilotOnly` 的機師必須真的存在 —— 斷鏈的 pilotId 會讓那顆模組**永遠**解不開。 */
const REQUIRED_PILOTS = ['pilot_049_海莉絲', 'pilot_088_曜']
/** `moduleAtMaxLevel` 的觸發者必須存在且有階梯（`required <= 0` 一律判為未解鎖）。 */
const REQUIRED_TRIGGER = 'mod_3034'

// ════════════════════════════════════════════════════════════
// 基礎設施（與 patch-module-*.mjs 同一套）
// ════════════════════════════════════════════════════════════
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
  db = admin.firestore()
}

function promptConfirm(q) {
  if (ASSUME_YES) { console.log(`${q}y（--yes）`); return Promise.resolve(true) }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}

async function bumpModules() {
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: { modules: version },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return version
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** 只比內容不比空白：站上的描述有時帶換行、有時帶全形空白。 */
const squash = (s) => String(s ?? '').replace(/\s+/g, '')

// ════════════════════════════════════════════════════════════
// 主流程
// ════════════════════════════════════════════════════════════
async function restore() {
  const snap = JSON.parse(fs.readFileSync(resolve(ROOT, RESTORE_FILE), 'utf-8'))
  console.log(`還原快照：${RESTORE_FILE}（${snap.docs.length} 份模組）`)
  if (!APPLY) { console.log('（dry-run。加 --apply 才會寫入）'); return }
  if (!await promptConfirm('確認還原？ [y/N] ')) { console.log('已取消。'); return }
  const batch = db.batch()
  for (const d of snap.docs) batch.set(db.collection('modules').doc(d.id), d.data)
  await batch.commit()
  console.log(`\n✅ 已還原，modules 版本已 bump → ${await bumpModules()}`)
}

async function main() {
  initFirebase()
  if (RESTORE_FILE) return restore()

  // ── 1. 被引用的目標必須存在 ────────────────────────────────
  //    斷鏈的 pilotId／moduleId 會讓那顆模組**永遠**解不開，而且畫面上沒有症狀。
  const refErrors = []
  for (const pid of REQUIRED_PILOTS) {
    if (!(await db.collection('pilots').doc(pid).get()).exists) refErrors.push(`pilots/${pid} 不存在`)
  }
  const trig = await db.collection('modules').doc(REQUIRED_TRIGGER).get()
  if (!trig.exists) refErrors.push(`modules/${REQUIRED_TRIGGER} 不存在`)
  else if (!(trig.data().levels || []).length) {
    refErrors.push(`modules/${REQUIRED_TRIGGER} 沒有 levels[] ⇒ maxLevel=0，條件永遠不成立`)
  }
  if (refErrors.length) throw new Error(`引用目標檢查失敗：\n  · ${refErrors.join('\n  · ')}`)
  console.log(`引用目標 OK：機師 ${REQUIRED_PILOTS.length} 位、觸發者 ${REQUIRED_TRIGGER}（${(trig.data().levels || []).length} 階）\n`)

  // ── 2. 逐格驗前提、算 diff ─────────────────────────────────
  const plans = []
  const problems = []
  for (const t of TARGETS) {
    const snap = await db.collection('modules').doc(t.docId).get()
    if (!snap.exists) { problems.push(`modules/${t.docId} 不存在`); continue }
    const d = snap.data()
    if (t.expect.name && d.name !== t.expect.name) {
      problems.push(`modules/${t.docId} name「${d.name}」≠ 預期「${t.expect.name}」`)
    }
    if (t.expect.boundMechId && d.boundMechId !== t.expect.boundMechId) {
      problems.push(`modules/${t.docId} boundMechId「${d.boundMechId}」≠ 預期「${t.expect.boundMechId}」`)
    }
    if (t.expect.descIncludes && !squash(d.description).includes(squash(t.expect.descIncludes))) {
      problems.push(`modules/${t.docId} 描述不含特徵字串「${t.expect.descIncludes}」`)
    }
    const changed = Object.entries(t.patch).filter(([k, v]) => !eq(d[k], v))
    plans.push({ t, doc: d, changed })
  }
  if (problems.length) throw new Error(`前提檢查失敗，未寫入任何東西：\n  · ${problems.join('\n  · ')}`)

  // ── 3. 報告 ──────────────────────────────────────────────
  console.log('── 寫入計畫 ────────────────────────────────────────────────')
  for (const p of plans) {
    const head = `  modules/${p.t.docId}   「${p.doc.name}」`
    if (!p.changed.length) { console.log(`${head}  ✔ 已是目標值`); continue }
    console.log(head)
    for (const [k, v] of p.changed) {
      console.log(`      ${k}`)
      console.log(`         舊：${JSON.stringify(p.doc[k] ?? null)}`)
      console.log(`         新：${JSON.stringify(v)}`)
    }
    console.log(`      依據：${p.t.why}`)
  }

  const willWrite = plans.filter((p) => p.changed.length)
  console.log('\n── 小結 ────────────────────────────────────────────────────')
  console.log(`  將寫入 ${willWrite.length} 份文件（共 ${willWrite.reduce((a, p) => a + p.changed.length, 0)} 個欄位）`)
  if (!willWrite.length) { console.log('\n沒有要寫的東西。'); return }
  if (!APPLY) { console.log('\n（dry-run，未寫入任何東西。確認無誤後加 --apply）'); return }

  // ── 4. 寫入 ──────────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(OUT_DIR, `module-unlock-conditions-backup-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({
    docs: willWrite.map((p) => ({ id: p.t.docId, data: p.doc })),
  }, null, 2), 'utf-8')
  console.log(`\n💾 還原快照：${path.relative(ROOT, backupFile)}`)
  console.log(`   還原：node scripts/patch-module-unlock-conditions.mjs --restore "${path.relative(ROOT, backupFile)}" --apply`)

  if (!await promptConfirm('\n確認寫入 Firestore？ [y/N] ')) { console.log('已取消。'); return }

  const batch = db.batch()
  for (const p of willWrite) batch.update(db.collection('modules').doc(p.t.docId), Object.fromEntries(p.changed))
  await batch.commit()
  console.log(`  …已更新 ${willWrite.length} 份模組`)

  console.log(`\n✅ 完成。modules 版本已 bump → ${await bumpModules()}`)
  console.log('   下一步：node scripts/export-emulator-slice.mjs --simulator（讓本機種子跟上）')
}

main().catch((err) => { console.error('\n❌', err.message); process.exit(1) })
