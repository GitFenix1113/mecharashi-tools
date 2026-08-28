/**
 * 機甲專屬模組的 levels[] 回填 —— 資料源是官方 module_data/detail
 *
 * ── 為什麼需要這支腳本 ────────────────────────────────────────────────────
 * 專屬模組（slot = 機甲專屬模組）的等級階梯，以前沒有任何自動來源：
 * `scrape-mechs.js` 只從機甲的 ModuleCarried 讀到「這台機甲帶這顆模組」，
 * 讀不到「這顆模組有幾級、每一級寫什麼」，於是 levels[] 靠人工補，結果是
 *
 *   · 3 顆只存了 1 級，而且存進去的是**最高級**的文字
 *     （流態發生器 / 重生者組件 / 強襲者組件 —— 官方 L1 的數字比較小）
 *   · 復仇女神四顆〈模型-XX〉是**空陣列**（它們是彩甲「限制解除」才啟動的隱藏模組，
 *     從來不在任何部件的 ModuleCarried 裡，爬蟲當然抓不到）
 *
 * 症狀是「四個部位健在時顯示不會錯，缺一格就錯」——因為那 3 顆的滿級是
 * 兩個部位各出 1 級湊出來的，正常配裝下本來就在最高級。
 *
 * 2026-08-28 找到 `module_data/detail?query=<族id>` 這個端點，它回傳的
 * `mappingIds[]` 就是**完整的等級階梯，含每一級的效果文字**。本腳本把它接上。
 *
 * ── 資料源與對照方式 ──────────────────────────────────────────────────────
 * ① `module_data/list`  → 621 筆 { ID(族id), name(簡體) }，用**名稱**對回站上文件。
 * ② 名稱撞號時用**部位**消歧義：破曉者-02 有兩顆都叫〈匯流樞紐〉
 *    （20391 寫「軀幹插槽中的模組等級翻倍」、20394 寫「腿部…」），
 *    這時去 `aircraft_data/detail` 解出各部位帶哪顆，再與站上 boundPart 比集合。
 *    ⚠ 陣列不可直接比對：`["leftArm","rightArm"]` 與 `["rightArm","leftArm"]` 兩種順序都存在。
 * ③ `module_data/detail?query=<族id>` → `mappingIds[i]` 即第 i+1 級。
 *
 * ── 寫入範圍（很窄，刻意的）────────────────────────────────────────────────
 * **只碰 `levels[]`，其他欄位一律不動**，頂層 `description` 也不動
 * （它是「滿級摘要」，而且彌造者那筆帶著人工加的「※只有[海莉絲]能發動此模組※」）。
 *
 *   · 缺少的等級 → 補上，數值欄位一律 0（官方沒給數字，填了就是編造）
 *     例外：官方階梯只有 1 級、而站上頂層 description 已有值時，
 *     優先沿用站上那份（保住人工潤飾，例如復仇女神四顆）
 *   · 已存在但文字不符 → **預設只報告不改**，要 `--fix-text` 才改
 *     且 managedBy='manual' 的文件連 `--fix-text` 都不動，要再加 `--force-manual`
 *   · 站上比官方多出來的等級 → 只報告，**永遠不自動刪**
 *
 * ⚠ 專屬模組的 24 筆裡，只有 `mod_2064`（AI火控單元）的 levels 帶非零數值（acc_rate）。
 *   本腳本不覆寫既有等級物件、只換 description，所以那組數值不會被洗掉。
 *
 * ── 使用方式 ──────────────────────────────────────────────────────────────
 *   node scripts/patch-exclusive-module-levels.mjs                  ← dry-run（唯讀，逐級 diff）
 *   node scripts/patch-exclusive-module-levels.mjs --apply          ← 只補缺少的等級 + bump modules
 *   node scripts/patch-exclusive-module-levels.mjs --fix-text --apply       ← 連同文字不符者一起修
 *   node scripts/patch-exclusive-module-levels.mjs --fix-text --force-manual --apply
 *   node scripts/patch-exclusive-module-levels.mjs --module=mod_輝龍_fixed_4 ← 只跑一份
 *   node scripts/patch-exclusive-module-levels.mjs --restore <快照> --apply  ← 還原
 *
 * 寫入後：本腳本自己會 bump modules 版本；本機驗收再跑
 *   node scripts/export-emulator-slice.mjs --simulator
 */

import fs from 'fs'
import path from 'path'
import https from 'https'
import readline from 'readline'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import admin from 'firebase-admin'
import * as OpenCC from 'opencc-js'
import { fixOverConversion } from './lib/textFixes.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')

const API_BASE = 'https://ma-activity.zlongame.com/common/infodata/mQuery.do'
const APP_KEY = '1616148215678'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const FIX_TEXT = args.includes('--fix-text')
const FORCE_MANUAL = args.includes('--force-manual')
const ASSUME_YES = args.includes('--yes')
const ONLY = (args.find(a => a.startsWith('--module=')) || '').split('=')[1] || null
const RESTORE_IDX = args.indexOf('--restore')
const RESTORE_FILE = RESTORE_IDX >= 0 ? args[RESTORE_IDX + 1] : null

const EXCLUSIVE_SLOT = '機甲專屬模組'
/** ModuleLevel 的必填數值欄位（src/types/module.ts）。補新等級時一律填 0。 */
const LEVEL_NUM_FIELDS = [
  'dmg', 'crit_rate', 'critDmg', 'acc_rate', 'firepower_rate', 'armor_rate',
  'crit_resist_rate', 'output_bonus', 'dodge_rate', 'durable_rate', 'dmg_resist_rate',
]

const _t2s = OpenCC.Converter({ from: 'tw', to: 'cn' })
const _s2t = OpenCC.Converter({ from: 'cn', to: 'tw' })
/** 簡體 → 繁體（含本站的過度轉換修正，例：回避模组 不要變成 迴避模組）。 */
const toTw = s => fixOverConversion(_s2t(String(s ?? '')))
/** 繁→簡→繁 正規化：讓「回避／迴避」這類孿生收斂成同一個鍵。 */
const normName = s => (s ? _s2t(_t2s(String(s))) : '')
/**
 * 官方富文本清乾淨。
 * ⚠ 與 `scrape-mechs.js` 的同名函式**刻意不同**：那邊會把 `<buf>[虛粒子形態]</buf>` 的
 *   方括號一起吃掉，這裡必須留著 —— `[xxx]` 是 PLAN-019 的引用標記，
 *   前台靠它把詞條連成浮窗，清掉等於把既有的 descriptionRefs 全部斷開。
 *   標籤本身用通吃的 `<[^>]+>` 清即可。
 */
const cleanRichText = t => String(t ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/\\n/g, '\n')
  .trim()
/** 只比內容不比空白：官方偶爾在分號後多一個換行。 */
const squash = s => String(s ?? '').replace(/\s+/g, '')

let db

// ════════════════════════════════════════════════════════════
// 基礎設施（與 patch-module-*.mjs 同一套）
// ════════════════════════════════════════════════════════════
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

function fetchJson(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, timeout: 20000 }, r => {
      if (r.statusCode !== 200) { r.resume(); rej(new Error(`HTTP ${r.statusCode} for ${url}`)); return }
      // ⚠ `setEncoding` 不可省（PLAN-052-K E-4，2026-08-29）：不設的話 chunk 是 Buffer，
      //   `data += chunk` 會逐塊 toString，一個 UTF-8 中文字剛好跨在 chunk 邊界時就會**碎掉一個字**。
      //   症狀不穩定（只有大回應會中）、而且長得像官方改了文案 —— 全庫實測留下 2 筆
      //   `levels[].description` 帶 U+FFFD（mod_2045 鏡像矩陣 Lv3、mod_3028 陷陣模組 Lv7）。
      //   ⚠ 只對「文字回應」設；下載圖片那條走 chunks.push(Buffer)，設了會壞。
      r.setEncoding('utf8')
      let d = ''
      r.on('data', c => { d += c })
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(new Error(`JSON 解析失敗：${url}`)) } })
    }).on('error', rej)
  })
}
const apiUrl = (target, type, query = '') =>
  `${API_BASE}?appkey=${APP_KEY}&target=${target}&type=${type}` + (query ? `&query=${encodeURIComponent(query)}` : '')

// ════════════════════════════════════════════════════════════
// 官方資料
// ════════════════════════════════════════════════════════════
/** 621 筆 { ID, name }；回傳 normName(name) → [ID…] */
async function fetchOfficialNameIndex() {
  const rows = (await fetchJson(apiUrl('module_data', 'list'))).data?.data || []
  const idx = new Map()
  for (const r of rows) {
    if (!r?.ID || !r?.name) continue
    const k = normName(r.name)
    if (!idx.has(k)) idx.set(k, [])
    idx.get(k).push(String(r.ID))
  }
  return idx
}

/** 族 id → [{ level, entityId, effect }]（mappingIds 的順序就是等級順序）。 */
async function fetchLadder(familyId) {
  const d = (await fetchJson(apiUrl('module_data', 'detail', familyId))).data?.data || {}
  return (d.mappingIds || []).map((m, i) => ({
    level: i + 1,
    entityId: String(m.ID),
    effect: toTw(cleanRichText(m.SpecificEffects)),
  }))
}

const POSITION_MAP = { 躯干: 'torso', 左臂: 'leftArm', 右臂: 'rightArm', 腿部: 'legs' }

/**
 * 某台機甲「哪個部位帶哪顆模組」。
 * 軀幹是物件陣列且內容是**整台的總表**，其餘三部位是壓縮字串 `<族id>:<等級>/`，
 * 所以軀幹自身 = 總表 − 其他三部位（全 83 台驗算無負值、無孤兒 id）。
 * 回傳 Map<族id, Set<position>>；只用來消歧義，不寫進資料庫。
 */
async function fetchPartAttribution(mechNameTw) {
  const parts = (await fetchJson(apiUrl('aircraft_data', 'detail', _t2s(mechNameTw)))).data?.data || []
  const by = {}
  for (const p of parts) by[POSITION_MAP[p.position]] = p
  if (!by.torso) return new Map()

  const parseStr = s => {
    const o = {}
    if (typeof s !== 'string') return o
    for (const seg of s.split('/')) {
      if (!seg.trim()) continue
      const [id, lv] = seg.split(':')
      o[id] = (o[id] || 0) + Number(lv || 0)
    }
    return o
  }
  // 取滿階（manji）那一份：專屬模組在滿階最齊。
  const total = {}
  for (const m of (by.torso.manji?.ModuleCarried || by.torso.ModuleCarried || [])) {
    total[m.id] = (total[m.id] || 0) + Number(m.level || 0)
  }
  const others = {}
  for (const k of ['leftArm', 'rightArm', 'legs']) {
    others[k] = parseStr(by[k]?.manji?.ModuleCarried ?? by[k]?.ModuleCarried)
  }
  const ids = new Set([...Object.keys(total), ...Object.values(others).flatMap(o => Object.keys(o))])
  const out = new Map()
  for (const id of ids) {
    const set = new Set()
    for (const k of ['leftArm', 'rightArm', 'legs']) if (others[k][id]) set.add(k)
    const torsoOwn = (total[id] || 0) - ['leftArm', 'rightArm', 'legs'].reduce((a, k) => a + (others[k][id] || 0), 0)
    if (torsoOwn > 0) set.add('torso')
    out.set(id, set)
  }
  return out
}

const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x))

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

  // ── 1. 站上的專屬模組 ──────────────────────────────────────
  const snap = await db.collection('modules').where('slot', '==', EXCLUSIVE_SLOT).get()
  let docs = snap.docs.map(d => ({ docId: d.id, ...d.data() }))
  if (ONLY) docs = docs.filter(d => d.docId === ONLY)
  if (!docs.length) throw new Error(ONLY ? `找不到 modules/${ONLY}（或它不是${EXCLUSIVE_SLOT}）` : `查無${EXCLUSIVE_SLOT}`)
  docs.sort((a, b) => a.docId.localeCompare(b.docId))
  console.log(`站上「${EXCLUSIVE_SLOT}」${docs.length} 筆\n`)

  // 消歧義要用機甲名稱，先把 boundMechId → name 準備好
  const mechNames = new Map((await db.collection('mechs').get()).docs.map(d => [d.id, d.data().name]))

  // ── 2. 對回官方族 id ──────────────────────────────────────
  const nameIdx = await fetchOfficialNameIndex()
  const attributionCache = new Map()
  const resolved = []
  const unresolved = []

  for (const d of docs) {
    const cands = nameIdx.get(normName(d.name)) || []
    if (cands.length === 0) { unresolved.push({ d, why: '官方 module_data 查無同名' }); continue }

    let familyId = cands[0]
    if (cands.length > 1) {
      const mechName = mechNames.get(d.boundMechId)
      if (!mechName) { unresolved.push({ d, why: `名稱撞號（${cands.join('/')}）且 boundMechId 無效` }); continue }
      if (!attributionCache.has(mechName)) attributionCache.set(mechName, await fetchPartAttribution(mechName))
      const attribution = attributionCache.get(mechName)
      const want = new Set(d.boundPart || [])
      const hit = cands.filter(id => attribution.has(id) && sameSet(attribution.get(id), want))
      if (hit.length !== 1) {
        unresolved.push({ d, why: `名稱撞號（${cands.join('/')}），用 boundPart=${JSON.stringify(d.boundPart)} 消歧義後仍有 ${hit.length} 筆` })
        continue
      }
      familyId = hit[0]
    }
    resolved.push({ d, familyId, viaPart: cands.length > 1 })
  }

  // ── 3. 逐筆比對階梯 ───────────────────────────────────────
  const plans = []
  for (const r of resolved) {
    const ladder = await fetchLadder(r.familyId)
    if (!ladder.length) { unresolved.push({ d: r.d, why: `module_data/detail?query=${r.familyId} 沒有 mappingIds` }); continue }
    const cur = Array.isArray(r.d.levels) ? r.d.levels : []
    const isManual = r.d.managedBy === 'manual'
    const changes = []

    for (const lv of ladder) {
      const exist = cur.find(x => Number(x.level) === lv.level)
      if (!exist) {
        // 官方只有一級、而站上頂層描述已有值 ⇒ 沿用站上那份（保住人工潤飾）
        const useSite = ladder.length === 1 && String(r.d.description || '').trim()
        changes.push({
          kind: 'ADD', level: lv.level, from: null,
          to: useSite ? String(r.d.description).trim() : lv.effect,
          note: useSite ? '沿用站上頂層 description' : '',
        })
      } else if (squash(exist.description) !== squash(lv.effect)) {
        const blocked = !FIX_TEXT || (isManual && !FORCE_MANUAL)
        changes.push({
          kind: blocked ? 'DIFF(略過)' : 'FIX', level: lv.level,
          from: exist.description || '(空)', to: lv.effect,
          note: blocked ? (!FIX_TEXT ? '需 --fix-text' : 'managedBy=manual，需 --force-manual') : '',
        })
      }
    }
    for (const x of cur) {
      if (Number(x.level) > ladder.length) {
        changes.push({ kind: 'EXTRA(不動)', level: Number(x.level), from: x.description || '(空)', to: null, note: '官方階梯沒有這一級' })
      }
    }
    plans.push({ ...r, ladder, changes, isManual })
  }

  // ── 4. 報告 ──────────────────────────────────────────────
  const willWrite = plans.filter(p => p.changes.some(c => c.kind === 'ADD' || c.kind === 'FIX'))
  const pad = s => String(s).padEnd(22)

  console.log('── 對照結果 ────────────────────────────────────────────────')
  for (const p of plans) {
    const flags = [p.isManual ? 'manual' : 'auto', p.viaPart ? '部位消歧義' : null].filter(Boolean).join(' · ')
    const head = `modules/${p.d.docId}`
    const act = p.changes.filter(c => c.kind === 'ADD' || c.kind === 'FIX').length
    console.log(`\n  ${head}   「${p.d.name}」  官方族id ${p.familyId}  階梯 ${p.ladder.length} 級  [${flags}]${act ? '' : '  ✔ 已一致'}`)
    for (const c of p.changes) {
      console.log(`      ${pad(`L${c.level} ${c.kind}`)}${c.note ? `（${c.note}）` : ''}`)
      if (c.from !== null) console.log(`         舊：${c.from}`)
      if (c.to !== null) console.log(`         新：${c.to}`)
    }
    // 新文字裡的 [xxx] 若沒有對應 descriptionRefs，前台會回退到父模組的 refs
    const refKeys = new Set(Object.keys(p.d.descriptionRefs || {}))
    const missing = new Set()
    for (const c of p.changes) {
      if (c.kind !== 'ADD' && c.kind !== 'FIX') continue
      for (const m of String(c.to).matchAll(/\[([^\]]+)\]/g)) if (!refKeys.has(m[1])) missing.add(m[1])
    }
    if (missing.size) console.log(`      ⚠ 新文字含未側錄的引用：${[...missing].map(x => `[${x}]`).join(' ')}（PLAN-019 refs 需人工補）`)
  }

  if (unresolved.length) {
    console.log('\n── 對不上，未處理 ──────────────────────────────────────────')
    for (const u of unresolved) console.log(`  ⚠ modules/${u.d.docId}「${u.d.name}」：${u.why}`)
  }

  const nAdd = plans.reduce((a, p) => a + p.changes.filter(c => c.kind === 'ADD').length, 0)
  const nFix = plans.reduce((a, p) => a + p.changes.filter(c => c.kind === 'FIX').length, 0)
  const nSkip = plans.reduce((a, p) => a + p.changes.filter(c => c.kind.startsWith('DIFF')).length, 0)
  const nExtra = plans.reduce((a, p) => a + p.changes.filter(c => c.kind.startsWith('EXTRA')).length, 0)
  console.log('\n── 小結 ────────────────────────────────────────────────────')
  console.log(`  補新等級 ${nAdd}　修正文字 ${nFix}　文字不符但略過 ${nSkip}　站上多出來 ${nExtra}　對不上 ${unresolved.length}`)
  console.log(`  將寫入 ${willWrite.length} 份文件（只動 levels[]，其他欄位不碰）`)
  if (nSkip && !FIX_TEXT) console.log('  · 要一併修正文字請加 --fix-text')

  if (!willWrite.length) { console.log('\n沒有要寫的東西。'); return }
  if (!APPLY) { console.log('\n（dry-run，未寫入任何東西。確認無誤後加 --apply）'); return }

  // ── 5. 寫入 ──────────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(OUT_DIR, `exclusive-module-levels-backup-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({
    docs: willWrite.map(p => ({ id: p.d.docId, data: (({ docId, ...rest }) => rest)(p.d) })),
  }, null, 2), 'utf-8')
  console.log(`\n💾 還原快照：${path.relative(ROOT, backupFile)}`)
  console.log(`   還原：node scripts/patch-exclusive-module-levels.mjs --restore "${path.relative(ROOT, backupFile)}" --apply`)

  if (!await promptConfirm('\n確認寫入 Firestore？ [y/N] ')) { console.log('已取消。'); return }

  const batch = db.batch()
  for (const p of willWrite) {
    const byLevel = new Map((Array.isArray(p.d.levels) ? p.d.levels : []).map(x => [Number(x.level), { ...x }]))
    for (const c of p.changes) {
      if (c.kind === 'ADD') {
        const blank = Object.fromEntries(LEVEL_NUM_FIELDS.map(f => [f, 0]))
        byLevel.set(c.level, { ...blank, level: c.level, description: c.to })
      } else if (c.kind === 'FIX') {
        byLevel.set(c.level, { ...byLevel.get(c.level), description: c.to })
      }
    }
    const levels = [...byLevel.values()].sort((a, b) => Number(a.level) - Number(b.level))
    batch.update(db.collection('modules').doc(p.d.docId), { levels })
  }
  await batch.commit()
  console.log(`  …已更新 ${willWrite.length} 份模組的 levels[]`)

  console.log(`\n✅ 完成。modules 版本已 bump → ${await bumpModules()}`)
  console.log('   下一步：node scripts/export-emulator-slice.mjs --simulator（讓本機種子跟上）')
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1) })
