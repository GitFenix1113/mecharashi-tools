/**
 * PLAN-032 follow-up 1a — 合併技能庫的大小寫孿生
 *
 * 技能庫裡有 5 組「同一個技能存了兩份 doc」：`SKILL_重擊` 與 `skill_重擊` 這種。
 * 成因是後台撞名防呆原本只查 `makeEntityId` 產出的**小寫**形式，看不到大寫那批
 * （PLAN-032 M0 已修防呆，本腳本清既有的）。
 *
 * 每組挑一份為正本、把另一份的引用改指過去、再刪掉輸家。
 *
 * ── 正本挑選規則：**資料較完整者勝** ────────────────────────────────────────
 *   1. 已填欄位多者勝（weapon / unitType / icon / iconLocal / effects / buffIds / descriptionRefs）
 *   2. 平手時引用數多者勝（少改幾處引用）
 *   3. 再平手取小寫（makeEntityId 的產出形式）
 *
 * 為什麼不是「引用數多者勝」：實測 5 組全部呈現同一個模式——
 *   `SKILL_` 大寫 = manual:true 手動建立，只填了 1–2/7 個欄位
 *   `skill_` 小寫 = 爬蟲管理，填了 4–5/7 個欄位
 * 用引用數當首要判準，精確打擊與重擊會挑到只填 1/7 的手動版當正本，
 * 等於用貧乏的那份取代豐富的那份。引用數只值得當第二判準——改幾處引用是小事，
 * 挑錯正本是把資料弄差。
 *
 * ── 為什麼不做完整的 ID 正規化 ──────────────────────────────────────────────
 * 把 134 筆 `SKILL_` 全改小寫要同步改 178 處引用，而 M0 的防呆已經解除實際危害，
 * 剩下的只是「看起來不整齊」。本腳本只處理**真的重複**的那 5 組。
 *
 * 使用方式：
 *   node scripts/migrate-skill-casing-twins.mjs            ← dry-run
 *   node scripts/migrate-skill-casing-twins.mjs --apply    ← 互動確認後寫入 + bump 版本
 *   node scripts/migrate-skill-casing-twins.mjs --restore <快照> --apply   ← 還原
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
const RESTORE_IDX = args.indexOf('--restore')
const RESTORE_FILE = RESTORE_IDX >= 0 ? args[RESTORE_IDX + 1] : null

const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')

// 會出現 refType:'skill' 引用或硬掛載的集合。漏掉一個就是留下斷鏈，故寧可多掃。
const COLLS = [
  'pilotSkills', 'pilots', 'weapons', 'buffs', 'modules', 'backpacks',
  'backpackSkills', 'components', 'glossaryTerms', 'neuralDriveAbilities', 'mechs',
]

// ── Firebase 初始化（同其他遷移腳本）──────────────────────────────────────────
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
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定')
  const abs = resolve(ROOT, credPath)
  if (!fs.existsSync(abs)) throw new Error(`找不到服務帳號金鑰：${abs}`)
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(abs, 'utf-8'))) })
  db = admin.firestore()
}
function promptConfirm(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}

// ─── 人工裁決：實質衝突逐欄取捨 ───────────────────────────────────────────────
//
// 兩份孿生若在「正文語意」「type」「iconLocal」上不一致，就不是單純的重複——
// 合併等於**替使用者決定哪個版本是對的**，而那是遊戲事實問題，腳本猜不得。
// 逐項到遊戲內確認後填進來。
//
// 格式：'<正本 id>': { <欄位>: { keep: 'winner' | 'loser', why: '理由' } }
//   keep:'winner' → 沿用正本的值，丟棄輸家的
//   keep:'loser'  → **把輸家的值搬到正本上**（正確答案在手動版那邊時用這個）
// why 會印進報告留痕，別省。
const ACCEPT_CONFLICT = {
  // 站長 2026-08-07 於遊戲內確認
  'skill_星墜閃': {
    description: { keep: 'winner', why: '遊戲內實測為 1.2 倍；手動版的 1.3 是舊值或誤記' },
    // 本技能 type 是「指令技能」，而 Icon_skill_order_* 正是指令技能的圖庫前綴；
    // 輸家的 Icon_skill_main_1162 是主動技能圖，與自身 type 矛盾。取正本。
    iconLocal: { keep: 'winner', why: 'order_ 前綴與 type=指令技能 相符；輸家的 main_ 是主動技能圖' },
  },
  'skill_精確打擊': {
    // 遊戲內浮窗顯示「類型：指令／消耗 3AP／冷卻 0 回合」——爬蟲標成「主動技能」是錯的。
    // 佐證：兩份的 iconLocal 都是 Icon_skill_order_1006，order_ 前綴同樣指向指令技能。
    type: { keep: 'loser', why: '遊戲內浮窗顯示「類型：指令」（奈奧米技能）；爬蟲標主動技能有誤' },
  },
}

const norm = (s) => (s ?? '').toString().trim()
const PUNCT_MAP = { '，': ',', '。': '.', '、': ',', '：': ':', '；': ';', '（': '(', '）': ')', '％': '%', '～': '~', '！': '!', '？': '?' }
/** 描述比較正規化（同 migrate-weapon-skills.mjs）：吃掉方括號、空白、標點全半形 */
const normDesc = (s) => norm(s).replace(/[[\]]/g, '').replace(/\s+/g, '')
  .replace(/[，。、：；（）％～！？]/g, (c) => PUNCT_MAP[c] ?? c)
/**
 * 技能圖示路徑正規化 —— 與前台 utils/assets.ts 的 normalizeSkillPath 同規則。
 *
 * 必須做，否則會產出假衝突：`/images/skills/Icon_skill_main_1020.png`（扁平）與
 * `/images/skills/主動技能/Icon_skill_main_1020.png`（明確子資料夾）在前台
 * **渲染的是同一個檔案**——normalizeSkillPath 會依檔名前綴把扁平路徑推回子資料夾。
 * 字面比對會把它報成「兩份對同一技能的圖示不一致」，把真正需要人看的
 * （星墜閃：order_1136 vs main_1162，兩個不同的圖檔）淹掉。
 */
const SKILL_PREFIX_FOLDERS = [
  ['Icon_skill_main', '主動技能'], ['Icon_skill_order', '指令技能'],
  ['Icon_skill_passive', '被動技能'], ['Icon_skill_pp', 'pp技能'],
  ['Icon_skill_talent', '天賦技能'],
]
const SKILL_SUBFOLDERS = new Set([...SKILL_PREFIX_FOLDERS.map(([, f]) => f), '背包技能'])
const normIcon = (p) => {
  const v = norm(p)
  const m = v.match(/(^|\/)images\/skills\/(.+)$/)
  if (!m) return v
  const parts = m[2].split('/')
  const file = parts.pop() ?? ''
  if (parts.length && SKILL_SUBFOLDERS.has(parts[parts.length - 1])) return v
  const sub = SKILL_PREFIX_FOLDERS.find(([pre]) => file.startsWith(pre))?.[1]
  return sub ? `${m[1]}images/skills/${sub}/${file}` : v
}

const hasVal = (v) => {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

/**
 * 遞迴改寫文件內所有指向 fromId 的引用為 toId。回傳改動筆數與說明。
 *
 * 涵蓋兩種形態：
 *   · descriptionRefs 的 `{ refType:'skill', refId }`（可能巢狀在 per-field 的分層下）
 *   · 字串陣列元素（pilots.skills[] 是 doc id 字串）
 * 刻意就地遞迴而不是靠路徑白名單——新集合／新欄位加進來時不會漏。
 */
function repoint(node, fromId, toId, log, path = '') {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map((v, i) => {
      if (typeof v === 'string' && v === fromId) { log.push(`${path}[${i}]`); return toId }
      return repoint(v, fromId, toId, log, `${path}[${i}]`)
    })
  }
  const out = {}
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k
    if (k === 'refId' && v === fromId && node.refType === 'skill') { log.push(p); out[k] = toId; continue }
    if (typeof v === 'string' && v === fromId && k === 'skillId') { log.push(p); out[k] = toId; continue }
    out[k] = repoint(v, fromId, toId, log, p)
  }
  return out
}

// ─── 還原 ─────────────────────────────────────────────────────────────────────
async function restore(file) {
  const abs = resolve(ROOT, file)
  if (!fs.existsSync(abs)) { console.error(`❌ 找不到快照：${abs}`); process.exit(1) }
  const snap = JSON.parse(fs.readFileSync(abs, 'utf-8'))
  console.log(`📄 快照：${path.relative(ROOT, abs)}`)
  console.log(`   要還原的 doc：${snap.docs.length} 份（含被刪除的技能 ${snap.deleted.length} 份）`)
  if (!APPLY) { console.log('\n[DRY-RUN] 未寫入。加 --apply 執行還原。'); return }
  if (!await promptConfirm('確認還原？ [y/N] ')) { console.log('已取消。'); process.exit(0) }

  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch()
    for (const d of snap.docs.slice(i, i + 400)) batch.set(db.collection(d.coll).doc(d.id), d.data)
    await batch.commit()
  }
  for (const d of snap.deleted) await db.collection('pilotSkills').doc(d.id).set(d.data)
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: Object.fromEntries([...new Set(snap.docs.map(d => d.coll))].map(c => [c, version])),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  console.log(`\n✅ 已還原 ${snap.docs.length} 份 doc、復原 ${snap.deleted.length} 份技能，版本已 bump。`)
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🔧 PLAN-032 1a 大小寫孿生合併（${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}）\n`)
  initFirebase()
  if (RESTORE_FILE) return restore(RESTORE_FILE)

  const snaps = await Promise.all(COLLS.map(c => db.collection(c).get()))
  const store = Object.fromEntries(COLLS.map((c, i) => [c, snaps[i].docs.map(d => ({ id: d.id, ...d.data() }))]))
  const lib = store.pilotSkills
  console.log(`📦 技能庫 ${lib.length} 筆，掃描 ${COLLS.length} 個集合共 ${Object.values(store).flat().length} 份文件\n`)

  // ── 找孿生組 ────────────────────────────────────────────────────────────────
  const byLower = new Map()
  for (const d of lib) {
    const k = d.id.toLowerCase()
    if (!byLower.has(k)) byLower.set(k, [])
    byLower.get(k).push(d)
  }
  const groups = [...byLower.values()].filter(v => v.length > 1)
  if (!groups.length) { console.log('✅ 沒有大小寫孿生，無事可做（冪等重跑）。'); return }

  // ── 數每個 id 的引用 ────────────────────────────────────────────────────────
  const refCount = new Map()
  const refWhere = new Map()
  for (const d of lib) { refCount.set(d.id, 0); refWhere.set(d.id, []) }
  for (const coll of COLLS) {
    for (const doc of store[coll]) {
      for (const id of refCount.keys()) {
        const log = []
        repoint(doc, id, '__PROBE__', log)
        if (log.length) {
          refCount.set(id, refCount.get(id) + log.length)
          refWhere.get(id).push(`${coll}:${norm(doc.name) || doc.id} (${log.join(', ')})`)
        }
      }
    }
  }

  // ── 決定正本 + 合併內容 ─────────────────────────────────────────────────────
  const RICH_FIELDS = ['weapon', 'unitType', 'icon', 'iconLocal', 'effects', 'buffIds', 'descriptionRefs']
  const richness = (d) => RICH_FIELDS.filter(k => hasVal(d[k])).length

  const plans = []
  for (const g of groups) {
    // 規則 1 資料完整度；規則 2 引用數；規則 3 小寫（見檔頭）
    const sorted = [...g].sort((a, b) => {
      const r = richness(b) - richness(a)
      if (r !== 0) return r
      const d = refCount.get(b.id) - refCount.get(a.id)
      if (d !== 0) return d
      const aLower = a.id === a.id.toLowerCase()
      const bLower = b.id === b.id.toLowerCase()
      if (aLower !== bLower) return aLower ? -1 : 1
      return a.id.localeCompare(b.id)
    })
    const [winner, ...losers] = sorted
    // 逐欄取較豐富者（空殼不得覆蓋有值），比照 Stage 1 的 keep()
    const merged = { ...winner }
    for (const l of losers) {
      for (const k of ['description', 'descriptionRefs', 'icon', 'iconLocal', 'effects', 'buffIds', 'weapon', 'ap', 'cd', 'pp', 'unitType']) {
        if (!hasVal(merged[k]) && hasVal(l[k])) merged[k] = l[k]
      }
      // iconLocal 兩份等價時，取**明確寫出子資料夾**的那份：不依賴前端的前綴推導，
      // 日後圖片改分類也不會跟著錯。
      if (hasVal(merged.iconLocal) && hasVal(l.iconLocal) &&
          normIcon(merged.iconLocal) === normIcon(l.iconLocal) &&
          l.iconLocal.split('/').length > merged.iconLocal.split('/').length) {
        merged.iconLocal = l.iconLocal
      }
    }
    const changedFields = Object.keys(merged).filter(k => JSON.stringify(merged[k]) !== JSON.stringify(winner[k]))

    // ── 實質衝突偵測 ──────────────────────────────────────────────────────
    // 兩份都有值、但值不同 → 合併等於替使用者決定哪個版本正確。
    // description 用 normDesc 比（標點全半形差異是雜訊，不算衝突）。
    const conflicts = []
    for (const l of losers) {
      if (hasVal(winner.description) && hasVal(l.description) &&
          normDesc(winner.description) !== normDesc(l.description)) {
        conflicts.push({ field: 'description', a: norm(winner.description), b: norm(l.description) })
      }
      // iconLocal 先過 normalizeSkillPath 再比（扁平 vs 明確子資料夾＝同一個檔案）
      if (hasVal(winner.iconLocal) && hasVal(l.iconLocal) &&
          normIcon(winner.iconLocal) !== normIcon(l.iconLocal)) {
        conflicts.push({ field: 'iconLocal', a: norm(winner.iconLocal), b: norm(l.iconLocal) })
      }
      for (const k of ['type', 'icon', 'ap', 'cd', 'pp', 'unitType']) {
        if (hasVal(winner[k]) && hasVal(l[k]) && String(winner[k]) !== String(l[k])) {
          conflicts.push({ field: k, a: String(winner[k]), b: String(l[k]) })
        }
      }
      // weapon 是物件，單獨比
      if (hasVal(winner.weapon) && hasVal(l.weapon) &&
          JSON.stringify(winner.weapon) !== JSON.stringify(l.weapon)) {
        conflicts.push({ field: 'weapon', a: JSON.stringify(winner.weapon), b: JSON.stringify(l.weapon) })
      }
    }
    const accepted = ACCEPT_CONFLICT[winner.id] ?? {}
    const unresolved = conflicts.filter(c => !accepted[c.field])
    // keep:'loser' → 把輸家的值搬到正本上（正確答案在手動版那邊）
    const overrides = []
    for (const [field, dec] of Object.entries(accepted)) {
      if (dec?.keep !== 'loser') continue
      const src = losers.find(l => hasVal(l[field]))
      if (!src) continue
      merged[field] = src[field]
      overrides.push({ field, from: winner[field], to: src[field], why: dec.why })
    }
    const changed2 = Object.keys(merged).filter(k => JSON.stringify(merged[k]) !== JSON.stringify(winner[k]))
    plans.push({ winner, losers, merged, changedFields: changed2, conflicts, unresolved, accepted, overrides })
  }

  // ── 算出要改寫的文件 ────────────────────────────────────────────────────────
  const docUpdates = new Map()   // `${coll}/${id}` -> { coll, id, before, after, changes }
  for (const p of plans) {
    for (const l of p.losers) {
      for (const coll of COLLS) {
        for (const doc of store[coll]) {
          const key = `${coll}/${doc.id}`
          const base = docUpdates.get(key)?.after ?? doc
          const log = []
          const after = repoint(base, l.id, p.winner.id, log)
          if (!log.length) continue
          const prev = docUpdates.get(key)
          docUpdates.set(key, {
            coll, id: doc.id, name: norm(doc.name) || doc.id,
            before: prev?.before ?? doc, after,
            changes: [...(prev?.changes ?? []), ...log.map(x => `${l.id} → ${p.winner.id} @ ${x}`)],
          })
        }
      }
    }
  }

  // ─── 報告 ───────────────────────────────────────────────────────────────────
  console.log(`── 孿生組：${plans.length} 組 ──────────────────────────────`)
  for (const p of plans) {
    console.log(`\n  「${p.winner.name}」`)
    console.log(`     ✔ 正本 ${p.winner.id.padEnd(20)} 引用 ${refCount.get(p.winner.id)} 處`)
    for (const l of p.losers) {
      const n = refCount.get(l.id)
      console.log(`     ✘ 刪除 ${l.id.padEnd(20)} 引用 ${n} 處${n ? ' → 改指正本' : '（無引用，直接刪）'}`)
      refWhere.get(l.id).forEach(w => console.log(`          ${w}`))
    }
    if (p.changedFields.length) console.log(`     ↻ 正本補上輸家較豐富的欄位：${p.changedFields.join(', ')}`)
    for (const c of p.conflicts) {
      const ok = p.accepted[c.field]
      console.log(`     ${ok ? `▸ 已裁決（取${ok.keep === 'loser' ? '輸家' : '正本'}）` : '⚠ 衝突          '} ${c.field}`)
      console.log(`          正本：${c.a.slice(0, 90)}`)
      console.log(`          輸家：${c.b.slice(0, 90)}`)
      if (ok) console.log(`          理由：${ok.why}`)
    }
  }

  const updates = [...docUpdates.values()]
  console.log(`\n── 要改寫的文件：${updates.length} 份 ────────────────────`)
  const byColl = {}
  for (const u of updates) byColl[u.coll] = (byColl[u.coll] ?? 0) + 1
  console.log(`  ${JSON.stringify(byColl)}`)
  updates.forEach(u => {
    console.log(`  ${u.coll}/${u.name}`)
    u.changes.forEach(c => console.log(`     ${c}`))
  })

  // ── 中止條件 ①：實質衝突未裁決 ─────────────────────────────────────────────
  const conflicted = plans.filter(p => p.unresolved.length)
  if (conflicted.length) {
    console.error(`\n❌ ${conflicted.length} 組有未裁決的實質衝突，中止。`)
    console.error('   這些不是「同一份資料存兩次」，而是兩份對同一個技能的描述不一致——')
    console.error('   合併等於替使用者決定哪個版本是對的，而那是遊戲事實問題，腳本猜不得。\n')
    for (const p of conflicted) {
      console.error(`   「${p.winner.name}」（正本 ${p.winner.id}）`)
      p.unresolved.forEach(c => console.error(`      ${c.field}：正本「${c.a.slice(0, 60)}」／輸家「${c.b.slice(0, 60)}」`))
    }
    console.error('\n   → 逐項確認哪個正確後，填進本腳本頂端的 ACCEPT_CONFLICT：')
    console.error("     ACCEPT_CONFLICT = { '正本id': { <欄位>: { keep: 'winner'|'loser', why: '理由' } } }")
    console.error("     keep:'winner' 沿用正本；keep:'loser' 把輸家的值搬到正本上。")
    process.exit(1)
  }

  // ── 中止條件 ②：改寫後不可留下任何指向被刪 id 的引用 ────────────────────────
  const deletedIds = plans.flatMap(p => p.losers.map(l => l.id))
  const after = Object.fromEntries(COLLS.map(c => [c, store[c].map(d => docUpdates.get(`${c}/${d.id}`)?.after ?? d)]))
  const leftovers = []
  for (const coll of COLLS) for (const doc of after[coll]) for (const id of deletedIds) {
    const log = []
    repoint(doc, id, '__PROBE__', log)
    if (log.length) leftovers.push(`${coll}/${doc.id}: ${id} @ ${log.join(', ')}`)
  }
  if (leftovers.length) {
    console.error(`\n❌ 改寫後仍有 ${leftovers.length} 處指向被刪除的 id，中止：`)
    leftovers.slice(0, 20).forEach(x => console.error(`   ${x}`))
    process.exit(1)
  }
  console.log(`\n✓ 一致性檢查：改寫後 0 處殘留指向被刪除的 id`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入 Firestore。審閱上方無誤後加 --apply。')
    return
  }

  // ── 寫入前快照 ──────────────────────────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(OUT_DIR, `plan032-1a-backup-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({
    docs: [...updates.map(u => ({ coll: u.coll, id: u.id, data: u.before })),
           ...plans.map(p => ({ coll: 'pilotSkills', id: p.winner.id, data: p.winner }))],
    deleted: plans.flatMap(p => p.losers.map(l => ({ id: l.id, data: l }))),
  }, null, 2), 'utf-8')
  console.log(`\n💾 已寫出還原快照：${path.relative(ROOT, backupFile)}`)
  console.log(`   還原：node scripts/migrate-skill-casing-twins.mjs --restore "${path.relative(ROOT, backupFile)}" --apply`)

  console.log(`\n將：改寫 ${updates.length} 份文件的引用、更新 ${plans.length} 份正本、刪除 ${deletedIds.length} 份重複技能。`)
  if (!await promptConfirm('確認寫入 Firestore？ [y/N] ')) { console.log('已取消。'); process.exit(0) }

  // 順序：先改引用 → 再更新正本 → 最後刪輸家。
  // 反過來（先刪）的話，中途失敗會留下一堆指向不存在 doc 的斷鏈引用。
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch()
    for (const u of updates.slice(i, i + 400)) batch.set(db.collection(u.coll).doc(u.id), u.after)
    await batch.commit()
    console.log(`  …引用已改寫 ${Math.min(i + 400, updates.length)}/${updates.length}`)
  }
  const wb = db.batch()
  for (const p of plans) wb.set(db.collection('pilotSkills').doc(p.winner.id), p.merged, { merge: true })
  await wb.commit()
  console.log(`  …正本已更新 ${plans.length} 份`)

  const delb = db.batch()
  for (const id of deletedIds) delb.delete(db.collection('pilotSkills').doc(id))
  await delb.commit()
  console.log(`  …重複技能已刪除 ${deletedIds.length} 份`)

  const version = new Date().toISOString()
  const touched = [...new Set([...updates.map(u => u.coll), 'pilotSkills'])]
  await db.doc('meta/gameData').set({
    versions: Object.fromEntries(touched.map(c => [c, version])),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  console.log(`\n✅ 完成。版本已 bump：${touched.join(' / ')} → ${version}`)
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
