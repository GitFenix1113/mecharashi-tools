/**
 * PLAN-032 武器技能引用化 — 遷移 Stage 2（flip）
 *
 * 把每把武器 skills[] 內的**內嵌 WeaponSkill** 換成 `{ skillId, activation }` 引用。
 * 技能本體早在 Stage 1（migrate-weapon-skills.mjs）就已建進技能庫。
 *
 * ⚠⚠ 這是本計畫唯一**破壞性、單向**的一步 ⚠⚠
 * 執行後武器上的技能名稱／正文／effects／buffIds 全部消失，只剩兩個欄位。
 * 撿得回來的唯一途徑是 --backup 產出的快照檔，請務必保留。
 *
 * ── 硬前置（不滿足就 exit 1，不留餘地）─────────────────────────────────────
 *   1. 前台雙格式解析必須已上線（M3）。沒上線就 flip → 活站武器技能整區空白。
 *      腳本無法自動偵測前端版本，故以互動提示要求操作者明確確認。
 *   2. 每一筆要換掉的內嵌技能，技能庫都必須有對應 doc，**且內容一致**。
 *      對不上就中止——flip 後那筆技能就永遠找不回來了。
 *
 * 使用方式：
 *   node scripts/migrate-weapon-skills-flip.mjs            ← dry-run：只比對、印報告，不寫入
 *   node scripts/migrate-weapon-skills-flip.mjs --apply    ← 互動確認後寫入 + bump 兩個版本
 *   node scripts/migrate-weapon-skills-flip.mjs --apply --no-backup   ← 跳過快照（不建議）
 *   node scripts/migrate-weapon-skills-flip.mjs --restore <快照檔>          ← 還原預覽
 *   node scripts/migrate-weapon-skills-flip.mjs --restore <快照檔> --apply  ← 實際還原
 *
 * 冪等：重跑只會處理仍是內嵌格式的條目；全部已 flip 時報告 0 筆待處理並正常結束。
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
const NO_BACKUP = args.includes('--no-backup')
// 還原模式：--restore <快照檔路徑>。把 flip 前的 skills 陣列原樣寫回。
const RESTORE_IDX = args.indexOf('--restore')
const RESTORE_FILE = RESTORE_IDX >= 0 ? args[RESTORE_IDX + 1] : null

const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')
const MAP_FILE = resolve(OUT_DIR, 'plan032-weapon-skill-map.json')

// ── Firebase 初始化（同 migrate-weapon-skills.mjs）────────────────────────────
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
  const absCredPath = resolve(ROOT, credPath)
  if (!fs.existsSync(absCredPath)) throw new Error(`找不到服務帳號金鑰：${absCredPath}`)
  const serviceAccount = JSON.parse(fs.readFileSync(absCredPath, 'utf-8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  db = admin.firestore()
}
function promptConfirm(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase() === 'y') }))
}
function promptText(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()) }))
}

// ── 工具（與 Stage 1 一致，兩邊比對規則必須相同）──────────────────────────────
const norm = (s) => (s ?? '').toString().trim()
const PUNCT_MAP = { '，': ',', '。': '.', '、': ',', '：': ':', '；': ';', '（': '(', '）': ')', '％': '%', '～': '~', '！': '!', '？': '?' }
const normDesc = (s) => norm(s)
  .replace(/[[\]]/g, '')
  .replace(/\s+/g, '')
  .replace(/[，。、：；（）％～！？]/g, (c) => PUNCT_MAP[c] ?? c)

const isRef = (e) => e && typeof e === 'object' && 'skillId' in e

/**
 * 順序無關的深層相等。
 *
 * ⚠ 不可用 `JSON.stringify(a) === JSON.stringify(b)` 比對 descriptionRefs（實測踩過）：
 *   物件序列化對 key 順序敏感，而 `{refType, refId}` 與 `{refId, refType}` 在資料庫裡
 *   兩種寫法都有（不同時期由不同工具寫入）。用 stringify 比會產生 65 筆假警報，
 *   把真正需要看的那幾筆淹掉。
 */
function deepEq(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]))
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length &&
    ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]))
}

// ─── 人工裁決：接受正文差異 ───────────────────────────────────────────────────
//
// flip 會丟掉武器上的正文，只留 skillId。若技能庫那份與武器側不同，flip 就等於
// **默默改了使用者看到的內容**——所以預設一律中止。
//
// 但有一類差異是「同一技能、官方文本自己就不一致」（錯別字、異體字），
// 那正是本計畫要收斂掉的東西。逐字確認後列在這裡，並寫明理由。
// 鍵是**技能庫 doc id**，值是理由字串（會印進報告留痕）。
//
// ⚠ 加進來之前務必把兩段文字逐字看過。這裡放寬一筆，就等於接受該武器的顯示內容被改寫。
const ACCEPT_TEXT_DIFF = {
  // 官方文本錯字：三把持有武器中，天燼審判／諸神黃昏 寫「回復」（＝恢復，此處正確），
  // 焚風·改 寫「回覆」（＝答覆，語意錯誤）。其餘四十餘字完全相同，icon 亦相同
  // （name→icon 稽核為 1:1）。收斂後全站統一顯示正確的「回復」。
  'skill_續航協議': '官方文本錯字 回覆→回復；三把持有武器僅此一字之差',
}

/**
 * 還原：把快照裡的 skills 陣列寫回武器。
 *
 * flip 用的是 `batch.update(doc, { skills })`——**只碰 skills 這一個欄位**，
 * 其餘欄位（attack / upgrade / fixedMod…）從頭到尾沒被動過。
 * 所以把 skills 寫回去就是完整還原，不需要整份文件的快照。
 * （已實測：內嵌技能的 11 個欄位含 descriptionRefs / effects 巢狀結構，
 *   JSON 往返零損失、無 undefined 欄位。）
 *
 * ⚠ 還原不會 un-bump 版本，而是再 bump 一次——使用者的快取必須跟著失效，
 *   否則會繼續讀到 flip 後的引用格式。
 */
async function restore(file) {
  const abs = resolve(ROOT, file)
  if (!fs.existsSync(abs)) { console.error(`❌ 找不到快照檔：${abs}`); process.exit(1) }
  const snap = JSON.parse(fs.readFileSync(abs, 'utf-8'))
  if (!Array.isArray(snap) || !snap.length) { console.error('❌ 快照檔格式不對或為空。'); process.exit(1) }

  console.log(`📄 快照：${path.relative(ROOT, abs)}（${snap.length} 把武器）`)
  const bad = snap.filter(x => !x?.id || !Array.isArray(x.skills))
  if (bad.length) { console.error(`❌ ${bad.length} 筆缺 id 或 skills，中止。`); process.exit(1) }

  snap.slice(0, 10).forEach(x => {
    const names = x.skills.map(sk => (sk && 'skillId' in sk) ? `→${sk.skillId}` : (sk?.name ?? '?')).join('、')
    console.log(`   ${x.name ?? x.id}：${x.skills.length} 筆  [${names}]`)
  })
  if (snap.length > 10) console.log(`   …另有 ${snap.length - 10} 把`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入。確認上方無誤後加 --apply。')
    return
  }
  const ok = await promptConfirm(`\n將把上述 ${snap.length} 把武器的 skills 還原成快照內容。確認？ [y/N] `)
  if (!ok) { console.log('已取消。'); process.exit(0) }

  let done = 0
  for (let i = 0; i < snap.length; i += 400) {
    const batch = db.batch()
    for (const x of snap.slice(i, i + 400)) {
      batch.update(db.collection('weapons').doc(x.id), { skills: x.skills })
    }
    await batch.commit()
    done += Math.min(400, snap.length - i)
    console.log(`  …已還原 ${done}/${snap.length}`)
  }
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: { weapons: version, pilotSkills: version },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  console.log(`\n✅ 已還原 ${done} 把武器，版本已 bump → ${version}`)
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  if (RESTORE_FILE) {
    console.log(`♻ PLAN-032 flip 還原（${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}）\n`)
    initFirebase()
    return restore(RESTORE_FILE)
  }
  console.log(`🔧 PLAN-032 Stage 2 flip（${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}）\n`)
  initFirebase()

  const [wSnap, sSnap] = await Promise.all([
    db.collection('weapons').get(),
    db.collection('pilotSkills').get(),
  ])
  const weapons = wSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id))
  const lib = sSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`📦 讀到 ${weapons.length} 把武器、技能庫 ${lib.length} 筆\n`)

  const libById = new Map(lib.map(d => [d.id, d]))
  const libByName = new Map()
  for (const d of lib) {
    const n = norm(d.name)
    if (!n) continue
    if (!libByName.has(n)) libByName.set(n, [])
    libByName.get(n).push(d)
  }

  // ── 對照檔：Stage 1 產出的 weaponSkillRefs。過期就中止而非硬跑 ──────────────
  //
  // 為什麼要對照檔而不是每次現算：Stage 1 做過的裁決（ABSORB_ANYWAY / FORK_AS_WEAPON、
  // 以及「同名多份 doc 時跳過」）不會重現在這裡。現算等於把那些裁決默默丟掉。
  let mapFile = null
  if (fs.existsSync(MAP_FILE)) {
    mapFile = JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8'))
    console.log(`📄 對照檔：${path.relative(ROOT, MAP_FILE)}（產生於 ${mapFile.generatedAt ?? '未知時間'}）`)
  } else {
    console.error(`❌ 找不到對照檔 ${path.relative(ROOT, MAP_FILE)}`)
    console.error('   請先跑 node scripts/migrate-weapon-skills.mjs（Stage 1）。')
    process.exit(1)
  }
  // 權威解析表：技能名 → doc id。承載 Stage 1 的所有裁決（吸收既有 id／分家／
  // ABSORB_ANYWAY），且**與位置無關**。
  //
  // ⚠ 為什麼不用 weaponSkillRefs 的陣列位置對齊：實測踩過——Stage 1 早期版本
  //   是在「技能名字母序」的外層迴圈裡 push，與武器 skills[] 的實際順序錯位，
  //   結果同一把武器的技能 id 互相輪轉。那種錯法 flip 完仍然「每把武器都有技能」，
  //   只是全部指錯人，靠肉眼幾乎抓不到。位置對齊是這個腳本最危險的設計選項，故不用。
  const idByName = mapFile.skillIdByName ?? null
  if (!idByName) {
    console.error('❌ 對照檔缺少 skillIdByName（舊版格式）。請重跑 Stage 1 產生新對照檔。')
    process.exit(1)
  }
  const refMap = mapFile.weaponSkillRefs ?? {}    // 僅用於交叉驗證，不作為解析來源

  // ── 逐武器比對 ──────────────────────────────────────────────────────────────
  const updates = []        // { id, name, skills, before }
  const blockers = []       // 中止級問題
  const warnings = []       // 提醒但不中止
  const acceptedDiffs = []  // 經 ACCEPT_TEXT_DIFF 放行的正文差異（要印出來留痕）
  const gainedRefsNotices = [] // 技能庫比武器側多的引用（決策六收斂的成果，非缺陷）
  let alreadyFlipped = 0
  let embeddedTotal = 0

  for (const w of weapons) {
    const skills = Array.isArray(w.skills) ? w.skills : []
    if (skills.length === 0) continue

    const planned = refMap[w.id]
    const next = []
    let changed = false

    for (let i = 0; i < skills.length; i++) {
      const sk = skills[i]
      if (isRef(sk)) {                              // 已 flip → 原樣保留（冪等）
        alreadyFlipped++
        // 但仍要驗證它指得到——斷鏈的引用等於該武器少一塊技能，且前台不報錯
        if (!libById.has(sk.skillId)) {
          blockers.push({ weapon: w.name, id: w.id, kind: '既有引用斷鏈', detail: `skills[${i}].skillId = ${sk.skillId} 在技能庫查無此 doc` })
        }
        next.push(sk)
        continue
      }
      embeddedTotal++

      const name = norm(sk?.name)
      if (!name) {
        warnings.push({ weapon: w.name, kind: '無名內嵌技能', detail: `skills[${i}] 無 name，保留內嵌` })
        next.push(sk)
        continue
      }

      // 目標 id：查 Stage 1 的裁決表（以技能名為鍵），退回技能庫唯一同名 doc
      const hits = libByName.get(name) ?? []
      let targetId = idByName[name]

      if (!targetId) {
        if (hits.length === 1) targetId = hits[0].id
        else {
          blockers.push({
            weapon: w.name, id: w.id, kind: '裁決表無此技能且無法唯一定位',
            detail: `skills[${i}]「${name}」→ 技能庫同名 doc ${hits.length} 筆。請重跑 Stage 1 更新對照檔。`,
          })
          next.push(sk); continue
        }
      }

      // 交叉驗證：位置計畫若與名稱解析不一致，代表兩者其一算錯了。
      // 單向遷移沒有「猜一個」的餘地——直接中止。
      const planId = planned?.[i]?.skillId
      if (planId && planId !== targetId) {
        blockers.push({
          weapon: w.name, id: w.id, kind: '對照檔位置計畫與名稱解析不符',
          detail: `skills[${i}]「${name}」名稱解析=${targetId}／位置計畫=${planId}。對照檔可能已過期，請重跑 Stage 1。`,
        })
        next.push(sk); continue
      }

      const doc = libById.get(targetId)
      if (!doc) {
        blockers.push({
          weapon: w.name, id: w.id, kind: '技能庫查無目標 doc',
          detail: `skills[${i}]「${name}」→ ${targetId}（技能庫沒有）。flip 後這筆技能會永久消失。`,
        })
        next.push(sk); continue
      }

      // 內容一致性：flip 會丟掉武器上的正文，若技能庫那份不同就是**默默改了顯示內容**
      if (normDesc(doc.description) !== normDesc(sk.description)) {
        const accepted = ACCEPT_TEXT_DIFF[targetId]
        if (!accepted) {
          blockers.push({
            weapon: w.name, id: w.id, kind: '正文不一致',
            detail: `「${name}」→ ${targetId}\n        技能庫：${norm(doc.description).slice(0, 80)}\n        武器側：${norm(sk.description).slice(0, 80)}\n        → 逐字確認是同一技能後，把 '${targetId}' 加進本腳本頂端的 ACCEPT_TEXT_DIFF（需附理由）。`,
          })
          next.push(sk); continue
        }
        acceptedDiffs.push({ weapon: w.name, id: targetId, name, reason: accepted })
      }

      // ── descriptionRefs：normDesc 看不到它，必須獨立比對 ──────────────────
      //
      // ⚠ 正文檢查用的 normDesc **第一步就把方括號剝掉**（為了消滅 PLAN-019 漂移）。
      //   於是「武器側有 [xxx] 標註＋descriptionRefs、技能庫那份沒有」對它完全隱形：
      //   兩段正文正規化後相等 → 放行 → flip 把 descriptionRefs 一起丟掉。
      //   症狀是該武器詳情頁的引用晶片全部退化成純文字，不報錯。
      //   對抗審查以兩份獨立重現確認此路徑。
      //
      // 方向很重要：只擋「武器側有、技能庫沒有或指向別處」（＝flip 會**弄丟**東西）。
      // 反向的「技能庫有、武器側沒有」是**決策六正在生效**——同一技能的另一把武器補過
      // PLAN-019 方括號，收斂後這把武器跟著獲得引用晶片。那是本計畫的目的，不是缺陷。
      const wRefs = sk.descriptionRefs ?? {}
      const dRefs = doc.descriptionRefs ?? {}
      const lostRefs = Object.keys(wRefs).filter(k => !(k in dRefs))
      const changedRefs = Object.keys(wRefs).filter(k =>
        k in dRefs && !deepEq(dRefs[k], wRefs[k]))
      const gainedRefs = Object.keys(dRefs).filter(k => !(k in wRefs))
      if (gainedRefs.length) {
        gainedRefsNotices.push({ weapon: w.name, name, id: targetId, keys: gainedRefs })
      }
      if (lostRefs.length || changedRefs.length) {
        blockers.push({
          weapon: w.name, id: w.id, kind: 'descriptionRefs 會遺失或被改寫',
          detail: `「${name}」→ ${targetId}` +
            `
        武器側獨有的引用：${JSON.stringify(lostRefs)}` +
            `
        指向不同實體的引用：${JSON.stringify(changedRefs)}` +
            `
        → 到後台技能庫把這些引用補進 ${targetId} 的 descriptionRefs 後重跑。`,
        })
        next.push(sk); continue
      }

      // ── 專武強化兩欄（決策七移到定義側）──────────────────────────────────
      // 遺失的症狀是機師頁的「▶ 專武強化」對照區塊整塊消失，不報錯。
      const enhLost = []
      for (const f of ['enhancesTalentName', 'enhancedTalentDescription']) {
        const wv = norm(sk[f]); const dv = norm(doc[f])
        if (wv && normDesc(wv) !== normDesc(dv)) enhLost.push(`${f}（武器側「${wv.slice(0, 40)}」／技能庫「${dv.slice(0, 40) || '(空)'}」）`)
      }
      if (enhLost.length) {
        blockers.push({
          weapon: w.name, id: w.id, kind: '專武強化欄位會遺失',
          detail: `「${name}」→ ${targetId}` +
            enhLost.map(x => `
        ${x}`).join('') +
            `
        → 重跑 Stage 1 會把武器側的值合併進技能庫。`,
        })
        next.push(sk); continue
      }

      // ── effects：實測武器側恆為空（爬蟲寫死 effects: []），但別假設它永遠是 ──
      const wEff = Array.isArray(sk.effects) ? sk.effects.filter(Boolean) : []
      const dEff = Array.isArray(doc.effects) ? doc.effects.filter(Boolean) : []
      if (wEff.length && JSON.stringify(wEff) !== JSON.stringify(dEff)) {
        blockers.push({
          weapon: w.name, id: w.id, kind: 'effects 會遺失',
          detail: `「${name}」→ ${targetId} 的 effects 與武器側不同。flip 後模擬器改讀技能庫那份。` +
            `
        武器側：${JSON.stringify(wEff).slice(0, 120)}` +
            `
        技能庫：${JSON.stringify(dEff).slice(0, 120)}`,
        })
        next.push(sk); continue
      }

      // buffIds 檢查：武器側有、技能庫沒有 → flip 後模擬器少算這些 buff（數值偏低，不報錯）
      const wb = (sk.buffIds ?? []).filter(Boolean)
      const db_ = (doc.buffIds ?? []).filter(Boolean)
      const lost = wb.filter(b => !db_.includes(b))
      if (lost.length) {
        blockers.push({
          weapon: w.name, id: w.id, kind: 'buffIds 會遺失',
          detail: `「${name}」→ ${targetId} 缺少 ${JSON.stringify(lost)}。flip 後模擬器會少算，且不報錯。`,
        })
        next.push(sk); continue
      }

      // 對照檔的 activation 應與武器現況相同（Stage 1 是原樣搬的）。不同代表資料在兩次跑之間變了。
      const plannedAct = planned?.[i]?.activation
      const act = norm(sk.activation) || 'carry'
      if (plannedAct && plannedAct !== act) {
        warnings.push({
          weapon: w.name, kind: 'activation 與對照檔不符（採用武器現況）',
          detail: `「${name}」對照檔=${plannedAct}／現況=${act}`,
        })
      }

      next.push({ skillId: targetId, activation: act })
      changed = true
    }

    if (changed) updates.push({ id: w.id, name: norm(w.name), skills: next, before: skills })
  }

  // ─── 報告 ───────────────────────────────────────────────────────────────────
  console.log('\n── flip 範圍 ────────────────────────────────')
  console.log(`  待轉換的內嵌掛載：${embeddedTotal}`)
  console.log(`  受影響武器：      ${updates.length}`)
  console.log(`  已是引用格式：    ${alreadyFlipped}（重跑安全，原樣保留）`)

  if (gainedRefsNotices.length) {
    console.log(`
▸ 收斂成果：${gainedRefsNotices.length} 筆掛載會**獲得**原本沒有的引用晶片`)
    console.log('   （同一技能的另一把武器補過 PLAN-019 方括號，flip 後全站共用那份——這正是本計畫的目的）')
    gainedRefsNotices.slice(0, 8).forEach(g =>
      console.log(`   ${g.weapon} 的「${g.name}」+ ${JSON.stringify(g.keys)}`))
    if (gainedRefsNotices.length > 8) console.log(`   …另有 ${gainedRefsNotices.length - 8} 筆`)
  }

  if (acceptedDiffs.length) {
    console.log(`
▸ 已人工裁決放行的正文差異 ${acceptedDiffs.length} 筆 —— flip 後這些武器的顯示文字會改成技能庫版本：`)
    acceptedDiffs.forEach(a => console.log(`   ${a.id}（${a.weapon} 的「${a.name}」）：${a.reason}`))
  }

  if (warnings.length) {
    console.log(`\n⚠ 提醒 ${warnings.length} 筆（不中止）：`)
    warnings.forEach(x => console.log(`   [${x.kind}] ${x.weapon}：${x.detail}`))
  }

  if (blockers.length) {
    console.error(`\n❌ 中止級問題 ${blockers.length} 筆 —— flip 是單向的，這些必須先解決：`)
    for (const b of blockers) {
      console.error(`\n   [${b.kind}] ${b.weapon}（${b.id}）`)
      console.error(`      ${b.detail}`)
    }
    console.error('\n   常見處置：')
    console.error('     · 正文不一致 / buffIds 遺失 → 重跑 Stage 1（會把武器側的值合併進技能庫）')
    console.error('     · 技能庫查無 doc          → 重跑 Stage 1 建庫')
    console.error('     · 既有引用斷鏈            → 到後台把該武器重新掛一次技能')
    console.error('\n❌ 已中止，未寫入任何資料。')
    process.exit(1)
  }

  if (updates.length === 0) {
    console.log('\n✅ 沒有待轉換的內嵌技能——全部已是引用格式（冪等重跑）。')
    return
  }

  console.log('\n── 逐武器預覽（前 15 把）────────────────────')
  updates.slice(0, 15).forEach(u => {
    console.log(`\n   ${u.name}（${u.id}）`)
    u.skills.forEach((s, i) => {
      const b = u.before[i]
      if (isRef(b)) { console.log(`      [${i}] （已是引用，不動）${s.skillId}`); return }
      console.log(`      [${i}] ${norm(b?.name)} → ${s.skillId}  activation=${s.activation}`)
    })
  })
  if (updates.length > 15) console.log(`\n   …另有 ${updates.length - 15} 把`)

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入 Firestore。')
    console.log('          確認上方無誤、且**雙格式前台已上線**後，加 --apply。')
    return
  }

  // ── 寫入前的兩道人為閘門 ────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('⚠ 這是單向破壞性操作。執行後武器上的技能名稱／正文／effects／buffIds')
  console.log('  全部消失，只剩 { skillId, activation }。')
  console.log('═'.repeat(60))

  const m3 = await promptConfirm('\n[1/2] 雙格式前台（M3）**已經部署上線**了嗎？未上線會讓活站武器技能整區空白。 [y/N] ')
  if (!m3) {
    console.log('已取消。請先部署 M3（resolveWeaponSkills 已接線的版本）再回來。')
    process.exit(0)
  }

  const typed = await promptText(`\n[2/2] 確認要把 ${updates.length} 把武器的 ${embeddedTotal} 筆內嵌技能換成引用。\n      請輸入 FLIP 以繼續：`)
  if (typed !== 'FLIP') { console.log('已取消。'); process.exit(0) }

  // ── 快照備份（唯一的回頭路）──────────────────────────────────────────────
  if (!NO_BACKUP) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFile = resolve(OUT_DIR, `plan032-flip-backup-${stamp}.json`)
    fs.writeFileSync(backupFile, JSON.stringify(
      updates.map(u => ({ id: u.id, name: u.name, skills: u.before })), null, 2), 'utf-8')
    console.log(`\n💾 已寫出還原快照：${path.relative(ROOT, backupFile)}`)
    console.log('   這是唯一能把內嵌技能撿回來的東西，請保留到確認線上正常為止。')
  } else {
    console.log('\n⚠ --no-backup：跳過快照。出錯將無法還原內嵌內容。')
  }

  // ── 寫入 ────────────────────────────────────────────────────────────────────
  let done = 0
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch()
    for (const u of updates.slice(i, i + 400)) {
      // update 而非 set：文件必定存在，此刻若已不存在應該失敗而非重建成殘缺文件
      batch.update(db.collection('weapons').doc(u.id), { skills: u.skills })
    }
    await batch.commit()
    done += Math.min(400, updates.length - i)
    console.log(`  …weapons 已更新 ${done}/${updates.length}`)
  }

  // ── bump 兩個版本 ───────────────────────────────────────────────────────────
  // weapons 是必須的（結構變了）；pilotSkills 一併 bump 是因為現在武器技能的顯示
  // 完全依賴技能庫，兩者的快取必須同時失效——只 bump 一個會讓拿到新 weapons、
  // 舊 pilotSkills 的 client 解析不到，技能區整塊空白。
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: { weapons: version, pilotSkills: version },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  console.log(`\n✅ 完成。${updates.length} 把武器已 flip，版本已 bump → ${version}`)
  console.log('   驗收：')
  console.log('     · 無痕視窗開武器詳情頁／圖鑑／機師專武欄，技能顯示與 flip 前相同')
  console.log('     · 模擬器選一把有技能的武器，buff 池含該技能的 buff')
  console.log('     · 到後台技能庫改一筆武器技能的正文 → 所有持有它的武器同時更新')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
