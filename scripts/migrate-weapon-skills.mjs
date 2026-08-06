/**
 * PLAN-032 武器技能引用化 — 遷移 Stage 1（建庫）
 *
 * 讀取所有 weapons，把內嵌的 skills[] 以「技能名」去重，建成技能庫
 * （pilotSkills 集合）的共用文件，一律標 domain:'weapon'。
 *
 * **本腳本完全不動 weapons**（那是 Stage 2 migrate-weapon-skills-flip.mjs 的事）。
 * 兩段式的理由見計畫書：前台雙格式解析必須先上線，否則活站讀到新格式會整區空白。
 * 此階段結束後 weapons 仍是內嵌格式、前台行為零變化，但技能庫已建好、
 * [起爆] 這類引用當天就能用。
 *
 * 使用方式：
 *   node scripts/migrate-weapon-skills.mjs            ← dry-run：只算、印報告、寫對照檔，不碰 Firestore
 *   node scripts/migrate-weapon-skills.mjs --apply    ← 互動確認後寫入，並 bump pilotSkills 版本
 *
 * 產物（gitignored）：scripts/temp_scripts/plan032-weapon-skill-map.json
 *   { skills, skillIdByName, weaponSkillRefs }
 *   · skillIdByName  技能名 → doc id。**Stage 2 flip 的權威輸入**，承載本腳本的所有裁決。
 *   · weaponSkillRefs weaponId → 依原始索引排列的掛載計畫，供人工複查與 flip 交叉驗證。
 *   本階段只產出不寫入 weapons。
 *
 * ── 去重鍵：一律用 skill.name，絕不可用 icon ────────────────────────────────
 * 實測 name→icon 為 1:1（124 個相異技能名，0 個對到 >1 個 icon），
 * 但 icon→name **不是**：107 個 icon 中 11 個對到 2–3 個不同技能名
 * （Icon_skill_passive_5136 → 擴容火力／追蹤調律／扞拒）。
 * icon 是共用美術素材，不是技能 ID。用它去重會把無關技能合併成一筆，
 * 而合併後看起來完全正常——沒有任何錯誤訊息。
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

const OUT_DIR = resolve(ROOT, 'scripts/temp_scripts')
const OUT_FILE = resolve(OUT_DIR, 'plan032-weapon-skill-map.json')

// ─── 人工裁決名單 ─────────────────────────────────────────────────────────────
//
// 技能庫裡已經有同名 doc、但描述與武器側**不一致**時，腳本無法自行判斷那是
//   (a) 同一個技能，只是文字漂移（→ 該吸收）
//   (b) 剛好同名的不同技能，跨域碰撞（→ 該分家）
// 實測確實存在跨域同名（Icon_skill_passive_5198 → 蹁躚／故障植入，後者與機師技能碰撞）。
//
// 猜錯的代價不對稱：吸收錯了會**把兩個無關技能合併成一筆**，且合併後看起來正常。
// 所以預設不猜——列進報告，未裁決就中止 --apply。裁決寫在這裡（進版控、可 review、可重現）。
//
// 註：只差 PLAN-019 方括號的（[固定傷害] vs 固定傷害）**不需要**列進來，
//     那是本計畫要消滅的漂移，正規化比較後視為相同、自動吸收。

/** 確認是同一技能 → 吸收進既有 doc（描述取較豐富者，見 pickRicherText） */
const ABSORB_ANYWAY = new Set([
  // '某技能名',
])

/** 確認是不同技能 → 另建 `skill_<name>_weapon`，不碰既有 doc */
const FORK_AS_WEAPON = new Set([
  // '某技能名',
])

// ── Firebase 初始化（同 migrate-plan043-extract.mjs）──────────────────────────
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

// ─── 工具 ─────────────────────────────────────────────────────────────────────
const norm = (s) => (s ?? '').toString().trim()

/** Firestore 文件 ID 不可含 '/'；技能名極少含之，仍保險替換 */
const slugName = (name) => norm(name).replace(/\//g, '_')

/**
 * 標點全形→半形對照。**只用於比較，不改寫任何寫入的文字。**
 *
 * 為什麼需要：技能庫裡由維護者手 key 的 doc 用半形逗號，爬蟲抓的官方文本用全形——
 *   技能庫：使用機槍攻擊時,對目標施加1層[火控延遲],可疊加5層
 *   武器側：使用機槍攻擊時，對目標施加1層[火控延遲]，可疊加5層
 * 這是輸入法造成的系統性雜訊，不是語意差異。不正規化的話，
 * 每一筆手 key 過的既有 doc 都會被誤報成「同名不同效」要人工裁決——
 * 真正需要看的跨域碰撞會被淹沒在雜訊裡，而那正是最不該漏看的東西。
 */
const PUNCT_MAP = { '，': ',', '。': '.', '、': ',', '：': ':', '；': ';', '（': '(', '）': ')', '％': '%', '～': '~', '！': '!', '？': '?' }

/**
 * 描述比較用的正規化：拿掉 PLAN-019 引用方括號、所有空白，並統一標點全半形。
 *
 * 方括號是本計畫要消滅的漂移形態——
 *   [凱旋·改 S+] 「…造成15%武器攻擊力的固定傷害」
 *   [獵器   SS ] 「…造成15%武器攻擊力的[固定傷害]」
 * 兩者是同一個官方技能，只差一份補過方括號。若用字面比較，
 * 這種案例會被誤報成「同名不同效」，同樣是雜訊。
 */
const normDesc = (s) => norm(s)
  .replace(/[[\]]/g, '')
  .replace(/\s+/g, '')
  .replace(/[，。、：；（）％～！？]/g, (c) => PUNCT_MAP[c] ?? c)

/** 有沒有實際內容（空陣列 / 空物件 / 空字串都算沒有） */
const hasVal = (v) => {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

/** 省略 undefined 鍵（Firestore 不接受 undefined） */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

/**
 * 決策六：文字漂移的收斂——**有 descriptionRefs 的那份勝**。
 * 理由是它資訊量嚴格較多（補過方括號＋帶側錄表），取它就順手消滅漂移。
 * 兩份都有 refs（或都沒有）時取先遇到的，且以 doc id 排序保證重跑結果相同。
 */
function pickRicherText(a, b) {
  if (!a) return b
  if (!b) return a
  const aRich = hasVal(a.descriptionRefs)
  const bRich = hasVal(b.descriptionRefs)
  if (aRich !== bRich) return aRich ? a : b
  return a
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🔧 PLAN-032 Stage 1 武器技能建庫（${APPLY ? 'APPLY 寫入' : 'DRY-RUN 預覽'}）\n`)
  initFirebase()

  // 以 doc id 排序：去重時「誰先被遇到」會影響 id 歸屬與 pickRicherText 的平手結果，
  // 排序後重跑結果完全相同（冪等的前提）。
  const [wSnap, sSnap] = await Promise.all([
    db.collection('weapons').get(),
    db.collection('pilotSkills').get(),
  ])
  const weapons = wSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id))
  const existingDocs = sSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`📦 讀到 ${weapons.length} 把武器、技能庫既有 ${existingDocs.length} 筆\n`)

  // ── 技能庫既有 doc 以「名稱」索引（不是 id）──────────────────────────────
  // 用名稱是因為 id 大小寫是歷史遺留的混血（SKILL_ 134 筆 / skill_ 512 筆），
  // 而 makeEntityId 只產得出小寫——只查 id 會漏掉大寫那批，
  // 於是替 SKILL_故障植入 再建一份 skill_故障植入，變成同名兩份（M0 修的正是這個洞的後台版）。
  const existingByName = new Map()
  for (const d of existingDocs) {
    const n = norm(d.name)
    if (!n) continue
    if (!existingByName.has(n)) existingByName.set(n, [])
    existingByName.get(n).push(d)
  }
  const casingMix = existingDocs.filter(d => d.id.startsWith('SKILL_')).length
  console.log(`   （其中 SKILL_ 大寫前綴 ${casingMix} 筆、skill_ 小寫 ${existingDocs.length - casingMix} 筆）\n`)

  // ── 掃描武器技能 ────────────────────────────────────────────────────────────
  const byName = new Map()          // name -> { instances: [{weaponId, skill}], iconSet:Set }
  const iconToNames = new Map()     // 反向稽核：icon -> Set<name>
  let totalInstances = 0
  let alreadyRef = 0

  for (const w of weapons) {
    for (const sk of w.skills ?? []) {
      if (!sk) continue
      // 已是引用格式（重跑本腳本、或後台已手動掛過）→ 不重複建，只記數
      if (typeof sk === 'object' && 'skillId' in sk) { alreadyRef++; continue }
      const name = norm(sk.name)
      if (!name) continue
      totalInstances++

      if (!byName.has(name)) byName.set(name, { instances: [], iconSet: new Set() })
      const g = byName.get(name)
      // idx = 該技能在武器 skills[] 的**原始位置**。不記的話 weaponSkillRefs 只能按
      // 「技能名字母序」的迴圈順序 push，與武器實際順序錯位（實測會把同一把武器的
      // 技能 id 互相輪轉，且 flip 前完全看不出來）。
      g.instances.push({ weaponId: w.id, weaponName: norm(w.name), skill: sk, idx: (w.skills ?? []).indexOf(sk) })
      const iconKey = norm(sk.icon) || norm(sk.iconLocal)
      if (iconKey) {
        g.iconSet.add(iconKey)
        if (!iconToNames.has(iconKey)) iconToNames.set(iconKey, new Set())
        iconToNames.get(iconKey).add(name)
      }
    }
  }

  // ── 去重鍵稽核：驗證「name 可當鍵、icon 不可」在當前資料上仍成立 ──────────
  const nameToManyIcons = [...byName.entries()].filter(([, g]) => g.iconSet.size > 1)
  const iconToManyNames = [...iconToNames.entries()].filter(([, s]) => s.size > 1)

  // ── 合併成 doc ──────────────────────────────────────────────────────────────
  const skills = []                 // 要寫入的 doc（含吸收既有者）
  const weaponSkillRefs = {}        // weaponId -> WeaponSkillRef[]（**依原始索引**）
  const skillIdByName = {}          // 技能名 -> doc id（Stage 2 flip 的權威輸入，與位置無關）
  const absorbed = []               // 吸收既有 doc
  const ambiguous = []              // 同名但描述不同，需人工裁決
  const forked = []                 // 裁決為「不同技能」而另建
  const driftFixed = []             // 同名不同**原文**（含只差方括號者），已用 refs-勝出規則收斂
  const semanticDiff = []           // 同名且**正規化後仍不同**——可能是真的不同效，要人眼看
  const enhanceConflicts = []       // 專武強化兩欄衝突（計畫書未盤點，必須斷言）

  for (const [name, g] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // ── 武器之間的合併（決策六）──────────────────────────────────────────
    let best = null
    const descSet = new Set()       // 正規化後（語意層）
    const rawSet = new Set()        // 原文（含方括號／標點差異）
    let effects = [], buffIds = []
    let icon = '', iconLocal = '', type = ''
    let enhancesTalentName, enhancedTalentDescription

    for (const { weaponId, weaponName, skill } of g.instances) {
      descSet.add(normDesc(skill.description))
      rawSet.add(norm(skill.description))
      best = pickRicherText(best, skill)
      // effects / buffIds：實測 0 衝突，任取一份——但保留「空殼不得覆蓋有值」保護。
      // 沒有這層保護，某把武器的空 effects 會覆蓋掉另一把已由後台補過的值，且無錯誤。
      if (!hasVal(effects) && hasVal(skill.effects)) effects = skill.effects
      if (!hasVal(buffIds) && hasVal(skill.buffIds)) buffIds = skill.buffIds.filter(Boolean)
      if (!hasVal(icon) && hasVal(skill.icon)) icon = norm(skill.icon)
      if (!hasVal(iconLocal) && hasVal(skill.iconLocal)) iconLocal = norm(skill.iconLocal)
      if (!hasVal(type) && hasVal(skill.type)) type = norm(skill.type)

      // 專武強化兩欄（PLAN-032 決策七）：移到定義側，故跨武器必須一致。
      // 計畫書只實測過 activation/effects/buffIds，這兩欄沒測過——**斷言而非假設**。
      for (const [field, cur, incoming] of [
        ['enhancesTalentName', enhancesTalentName, norm(skill.enhancesTalentName)],
        ['enhancedTalentDescription', enhancedTalentDescription, norm(skill.enhancedTalentDescription)],
      ]) {
        if (!incoming) continue
        if (cur && normDesc(cur) !== normDesc(incoming)) {
          enhanceConflicts.push({ name, field, a: cur, b: incoming, weaponId, weaponName })
        }
      }
      if (norm(skill.enhancesTalentName) && !enhancesTalentName) enhancesTalentName = norm(skill.enhancesTalentName)
      if (norm(skill.enhancedTalentDescription) && !enhancedTalentDescription) enhancedTalentDescription = norm(skill.enhancedTalentDescription)
    }
    // 兩軸分開報：
    //   rawSet>1 且 descSet==1 → 純文字漂移（方括號／標點），**本計畫要消滅的正是這個**
    //   descSet>1             → 正規化後仍不同，可能真的是不同效，要人眼看
    if (rawSet.size > 1) {
      driftFixed.push({
        name, raw: rawSet.size, sem: descSet.size,
        holders: g.instances.map(i => i.weaponName),
        samples: [...rawSet],
      })
    }
    if (descSet.size > 1) {
      semanticDiff.push({ name, holders: g.instances.map(i => i.weaponName), samples: [...rawSet] })
    }

    // ── 與技能庫既有 doc 的關係 ──────────────────────────────────────────
    const hits = existingByName.get(name) ?? []
    let targetId = `skill_${slugName(name)}`
    let mode = 'create'
    let existing = null

    if (hits.length > 1) {
      ambiguous.push({ name, reason: `技能庫有 ${hits.length} 筆同名 doc`, ids: hits.map(h => h.id) })
      continue
    }
    if (hits.length === 1) {
      existing = hits[0]
      const sameDesc = normDesc(existing.description) === normDesc(best.description)
      if (FORK_AS_WEAPON.has(name)) {
        targetId = `skill_${slugName(name)}_weapon`
        mode = 'fork'
        forked.push({ name, id: targetId, existingId: existing.id })
      } else if (sameDesc || ABSORB_ANYWAY.has(name)) {
        targetId = existing.id                        // ← 就地吸收，沿用既有 id（含 SKILL_ 大寫）
        mode = 'absorb'
        absorbed.push({
          name, id: existing.id, auto: sameDesc,
          existingDesc: existing.description, weaponDesc: best.description,
          existingRefs: hasVal(existing.descriptionRefs), weaponRefs: hasVal(best.descriptionRefs),
        })
      } else {
        ambiguous.push({
          name, reason: '同名但描述不同（可能是跨域碰撞，也可能只是漂移）',
          ids: [existing.id],
          existingDesc: norm(existing.description),
          weaponDesc: norm(best.description),
        })
        continue
      }
    }

    // ── 組 doc ────────────────────────────────────────────────────────────
    // 吸收模式下「空殼不得覆蓋有值」：既有 doc 已由後台補過的 effects/buffIds
    // 不可被武器側的空值洗掉。以 merge:true 寫入，故直接省略該鍵即可保留既有值。
    //
    // ⚠ 回傳 undefined 是**有意義的**：compact() 會把該鍵整個拿掉，merge:true 於是保留既有值。
    //   fallback 一定要走參數，不可在呼叫端補 `?? ''` / `?? []` ——
    //   那會把「省略」立刻還原成空值寫回去，保護等於沒做。實測 133 筆武器技能的 effects
    //   全為空，若被這樣寫回，兩筆吸收 doc 上維護者補過的 effects/buffIds 會被靜默清光。
    const keep = (weaponVal, existingVal, fallback) => {
      if (hasVal(weaponVal)) return weaponVal
      if (mode === 'absorb' && hasVal(existingVal)) return undefined   // ← 省略＝保留既有
      return fallback
    }

    // 決策六同樣適用於「武器側 vs 技能庫既有」：有 descriptionRefs 的那份勝。
    // 平手（都有／都沒有）時取武器側——它是爬蟲的權威來源，日後補丁也從那邊來。
    // 沒有這段的話，手 key 過的既有 doc 會被武器側無條件覆寫，
    // 連帶把維護者補過的方括號洗掉——正是本計畫要消滅的漂移，反向再造一次。
    const textSrc = mode === 'absorb' ? pickRicherText(best, existing) : best
    const textFromExisting = mode === 'absorb' && textSrc === existing

    // 吸收時 refs 取**聯集**（既有優先），而非讓勝出方整張表覆蓋。
    // 平手（兩邊都有 refs）時 pickRicherText 取武器側，若直接覆蓋就會丟掉
    // 維護者在既有 doc 上補過、而武器側沒有的那些 key——遷移是單向的，丟了撿不回來。
    // 兩邊文字已通過 normDesc 相等檢查，方括號標籤必然一致，故聯集不會產生對不到正文的孤兒 key。
    const mergedRefs = mode === 'absorb'
      ? { ...(best.descriptionRefs ?? {}), ...(existing?.descriptionRefs ?? {}) }
      : (hasVal(best.descriptionRefs) ? best.descriptionRefs : {})
    const refsGained = mode === 'absorb'
      ? Object.keys(mergedRefs).length - Object.keys(best.descriptionRefs ?? {}).length
      : 0

    const doc = compact({
      id: targetId,
      name,
      type: type || '被動技能',
      domain: 'weapon',
      // 文字勝出方是既有 doc → 省略（merge:true 保留原值），不要寫回去繞一圈
      description: textFromExisting ? undefined : norm(textSrc.description),
      // refs 與 description 不同步：即使正文沿用既有的，refs 仍寫聯集（可能多了武器側的 key）
      descriptionRefs: hasVal(mergedRefs) ? mergedRefs : (mode === 'absorb' ? undefined : {}),
      icon: keep(icon, existing?.icon, ''),
      iconLocal: keep(iconLocal, existing?.iconLocal, ''),
      effects: keep(effects, existing?.effects, []),
      buffIds: keep(buffIds, existing?.buffIds, []),
      enhancesTalentName,
      enhancedTalentDescription,
    })
    // 吸收時「因為省略而保留下來」的既有欄位——這是保護實際生效的證據，要印出來給人看
    const preserved = mode === 'absorb'
      ? ['description', 'icon', 'iconLocal', 'effects', 'buffIds'].filter(
          k => !(k in doc) && hasVal(existing?.[k]))
      : []
    skills.push({ doc, mode, holders: g.instances.length, textFromExisting, refsGained, preserved })

    // ── Stage 2 flip 的輸入 ───────────────────────────────────────────────
    //
    // skillIdByName 才是**權威**：本腳本的裁決（ABSORB_ANYWAY／FORK_AS_WEAPON／
    // 就地吸收既有 id）本質都是「這個技能名對應到哪個 doc」，與位置無關。
    // flip 一律查這張表，不靠陣列位置對齊——位置對齊過一次就錯過一次，
    // 而且錯法是「同一把武器的技能互相輪轉」，flip 之後看起來仍然「有技能」。
    skillIdByName[name] = targetId

    // weaponSkillRefs 是**依原始索引寫入**的完整計畫，供人工複查與 flip 交叉驗證。
    // activation 原樣從各武器搬，不做任何收斂——它是掛載側的真實變異
    // （實測 38 個技能跨武器不同），統一就是毀資料。
    for (const { weaponId, skill, idx } of g.instances) {
      if (!weaponSkillRefs[weaponId]) weaponSkillRefs[weaponId] = []
      weaponSkillRefs[weaponId][idx] = { skillId: targetId, activation: norm(skill.activation) || 'carry' }
    }
  }

  // ─── 報告 ───────────────────────────────────────────────────────────────────
  const weaponsWithSkills = weapons.filter(w => (w.skills ?? []).some(Boolean)).length
  console.log('── 掃描結果 ──────────────────────────────')
  console.log(`  武器總數／有技能者：${weapons.length} ／ ${weaponsWithSkills}`)
  console.log(`  武器技能實例：      ${totalInstances}`)
  console.log(`  去重後唯一技能名：  ${byName.size}`)
  console.log(`  重複率：            ${totalInstances ? ((1 - byName.size / totalInstances) * 100).toFixed(1) : 0}%`)
  if (alreadyRef) console.log(`  已是引用格式而跳過：${alreadyRef}（重跑安全）`)

  console.log('\n── 去重鍵稽核（驗證 name 可當鍵、icon 不可）──')
  console.log(`  name → icon 一對多：${nameToManyIcons.length}  ${nameToManyIcons.length === 0 ? '✓ 1:1，可當鍵' : '⚠ 需複查'}`)
  console.log(`  icon → name 一對多：${iconToManyNames.length}  ${iconToManyNames.length > 0 ? '✓ 符合預期（icon 是共用美術素材，不可當鍵）' : ''}`)
  if (nameToManyIcons.length) {
    console.log('  ⚠ 以下技能名對到多個 icon —— 去重前請人工確認是否真為同一技能：')
    nameToManyIcons.forEach(([n, g]) => console.log(`      「${n}」→ ${[...g.iconSet].join(' , ')}`))
  }
  if (iconToManyNames.length) {
    console.log('  （反例佐證，用 icon 去重會把這些合併成一筆）')
    iconToManyNames.slice(0, 5).forEach(([i, s]) => console.log(`      ${i} → ${[...s].join('／')}`))
    if (iconToManyNames.length > 5) console.log(`      …另有 ${iconToManyNames.length - 5} 組`)
  }

  console.log('\n── 與技能庫既有 doc 的關係 ────────────────')
  console.log(`  新建：              ${skills.filter(s => s.mode === 'create').length}`)
  console.log(`  就地吸收既有 doc：  ${absorbed.length}`)
  console.log(`  裁決為不同技能而分家：${forked.length}`)
  console.log(`  ⚠ 待人工裁決：      ${ambiguous.length}`)
  if (absorbed.length) {
    absorbed.forEach(a => {
      const s = skills.find(x => x.doc.id === a.id)
      const src = s?.textFromExisting ? '正文保留技能庫既有版本' : '正文改用武器側版本'
      console.log(`
      吸收 ${a.id}${a.auto ? '（正規化後描述相同，自動判定）' : '（人工裁決 ABSORB_ANYWAY）'}`)
      console.log(`         ${src}${s?.textFromExisting ? '' : '  ← merge 會覆寫既有 description'}`)
      console.log(`         技能庫既有：${norm(a.existingDesc).slice(0, 90)}`)
      console.log(`         武器側　　：${norm(a.weaponDesc).slice(0, 90)}`)
      console.log(`         既有 refs ${a.existingRefs ? '有' : '無'} · 武器側 refs ${a.weaponRefs ? '有' : '無'}（決策六：有 refs 者勝，平手取武器側）`)
      if (s?.refsGained) console.log(`         refs 聯集後多保住 ${s.refsGained} 個既有 key（未被武器側覆蓋）`)
      console.log(`         保留既有欄位（武器側為空，不覆寫）：${s?.preserved?.length ? s.preserved.join(', ') : '（無，武器側各欄皆有值）'}`)
    })
  }
  if (forked.length) forked.forEach(f => console.log(`      分家 ${f.existingId} ↛ ${f.id}`))

  if (driftFixed.length) {
    const pure = driftFixed.filter(d => d.sem === 1)
    console.log(`\n── 已收斂的文字漂移（${driftFixed.length} 個技能名）────────`)
    console.log('   同名技能在不同武器上**原文**不一致，已依「有 descriptionRefs 的那份勝」取正本。')
    console.log(`   其中 ${pure.length} 個是純文字漂移（正規化後相同，只差方括號／標點）——`)
    console.log('   這正是本計畫要消滅的東西：同一個官方技能存了多份，只有一份補過 PLAN-019 方括號。')
    driftFixed.slice(0, 12).forEach(d => {
      const tag = d.sem > 1 ? `  ⚠ 正規化後仍有 ${d.sem} 種` : '（純方括號／標點差異）'
      console.log(`\n      「${d.name}」${d.raw} 種寫法${tag}`)
      console.log(`         持有：${d.holders.join('／')}`)
      d.samples.forEach(t => console.log(`         · ${t.slice(0, 80)}${t.length > 80 ? '…' : ''}`))
    })
    if (driftFixed.length > 12) console.log(`\n      …另有 ${driftFixed.length - 12} 個`)
  }

  if (semanticDiff.length) {
    console.log(`\n⚠ 同名但正規化後仍不同 ${semanticDiff.length} 筆 —— 去重會把它們合併成一筆，請確認確實是同一技能：`)
    semanticDiff.forEach(d => {
      console.log(`   「${d.name}」持有：${d.holders.join('／')}`)
      d.samples.forEach(t => console.log(`      · ${t.slice(0, 100)}`))
    })
    console.log('   （name→icon 稽核為 1:1 是這個合併的主要佐證；若上面兩段文字語意明顯不同，先停下來。）')
  }

  console.log('\n── 資料完整度（待後台補的量）────────────')
  const n = skills.length || 1
  console.log(`  effects 為空：      ${skills.filter(s => !hasVal(s.doc.effects)).length}/${skills.length}`)
  console.log(`  buffIds 為空：      ${skills.filter(s => !hasVal(s.doc.buffIds)).length}/${skills.length}`)
  console.log(`  有 descriptionRefs：${skills.filter(s => hasVal(s.doc.descriptionRefs)).length}/${skills.length}`)
  console.log(`  專武強化欄位：      ${skills.filter(s => s.doc.enhancesTalentName).length}/${n}`)

  // ── 中止條件 ────────────────────────────────────────────────────────────────
  let fatal = false

  if (enhanceConflicts.length) {
    console.error(`\n❌ 專武強化欄位跨武器衝突 ${enhanceConflicts.length} 筆（決策七假設此欄無變異，實測推翻）：`)
    enhanceConflicts.forEach(c => {
      console.error(`   「${c.name}」.${c.field} 在 ${c.weaponName}(${c.weaponId}) 與先前值不同`)
      console.error(`      先前：${c.a.slice(0, 60)}`)
      console.error(`      本次：${c.b.slice(0, 60)}`)
    })
    console.error('   → 這兩欄放在定義側就無法同時表達兩個值。請先決定：')
    console.error('     (a) 若只是文字漂移 → 到後台把武器側統一後重跑')
    console.error('     (b) 若真是每武器變異 → 需把該欄移回 WeaponSkillRef 掛載側（回頭改 PLAN-032 決策七）')
    fatal = true
  }

  if (ambiguous.length) {
    console.error(`\n⚠ 待人工裁決 ${ambiguous.length} 筆 —— 技能庫已有同名 doc 但描述不同：`)
    ambiguous.forEach(a => {
      console.error(`\n   「${a.name}」（${a.reason}）`)
      a.ids.forEach(i => console.error(`      既有 doc：${i}`))
      if (a.existingDesc !== undefined) {
        console.error(`      技能庫：${a.existingDesc.slice(0, 90)}`)
        console.error(`      武器側：${a.weaponDesc.slice(0, 90)}`)
      }
    })
    console.error('\n   → 逐筆判斷後，把技能名加進本腳本頂端的：')
    console.error('     ABSORB_ANYWAY（同一技能，只是文字不同 → 吸收進既有 doc）')
    console.error('     FORK_AS_WEAPON（剛好同名的不同技能 → 另建 skill_<name>_weapon）')
    console.error('   刻意不自動猜：吸收錯了會把兩個無關技能合併成一筆，而且合併後看起來完全正常。')
    fatal = true
  }

  // ── 寫對照檔（gitignored）────────────────────────────────────────────────
  //
  // ⚠ fatal 時寫到 .partial 而非正式檔名。原本無條件覆寫 OUT_FILE 有個陷阱：
  //   一次因待裁決而中止的 dry-run，螢幕印「❌ 中止」讓人以為什麼都沒做，
  //   但磁碟上那份跑成功、承載全部裁決的對照檔已被殘缺版蓋掉
  //   （缺的正是被 continue 跳過、沒進 skillIdByName 的那些技能名）。
  //   之後跑 flip 會讀到殘缺表卻毫無所覺——它只驗 skillIdByName 存在與否。
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const outPath = fatal ? OUT_FILE + '.partial' : OUT_FILE
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    skills: skills.map(s => s.doc),
    skillIdByName,
    weaponSkillRefs,
  }, null, 2), 'utf-8')
  console.log(`\n📝 對照檔已寫出：${path.relative(ROOT, outPath)}`)
  if (fatal) console.log('   （因有待裁決項，寫成 .partial 以免覆蓋上一份完整的對照檔）')
  console.log(`   skillIdByName ${Object.keys(skillIdByName).length} 筆（flip 的權威裁決表，以技能名為鍵）`)
  console.log(`   weaponSkillRefs ${Object.keys(weaponSkillRefs).length} 把武器（依原始索引，供交叉驗證）`)

  if (fatal) {
    console.error('\n❌ 有未解決的裁決項，中止。修正後重跑 dry-run。')
    process.exit(1)
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未寫入 Firestore。審閱上方報告無誤後加 --apply。')
    console.log('          特別確認：去重鍵稽核那段、以及「就地吸收」清單是否符合預期。')
    return
  }

  // ── 寫入前快照：吸收模式會覆寫既有 doc，那是不可逆的 ────────────────────
  //
  // flip 有 --backup，Stage 1 原本沒有——但它同樣以 merge:true 覆寫既有文件的
  // description / descriptionRefs / type / domain。判斷錯一筆，既有 doc 的原始內容
  // 就永久消失，而對照檔存的是**合併後**的結果、不是 pre-image。
  const touchedIds = new Set(skills.map(x => x.doc.id))
  const preImage = existingDocs.filter(d => touchedIds.has(d.id))
  if (preImage.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const preFile = resolve(OUT_DIR, `plan032-stage1-preimage-${stamp}.json`)
    fs.writeFileSync(preFile, JSON.stringify(preImage, null, 2), 'utf-8')
    console.log(`
💾 已寫出既有 doc 的寫入前快照（${preImage.length} 筆）：${path.relative(ROOT, preFile)}`)
    console.log('   本次唯一會被覆寫的就是這幾筆；判斷錯了靠它還原。')
  }

  // ── 寫入（互動確認，不盲寫）──────────────────────────────────────────────
  console.log(`\n將寫入 pilotSkills ${skills.length} 筆（新建 ${skills.filter(s => s.mode === 'create').length}／吸收 ${absorbed.length}／分家 ${forked.length}）。`)
  console.log('**不動 weapons**——flip 是 Stage 2 的事。')
  const ok = await promptConfirm('確認寫入 Firestore？ [y/N] ')
  if (!ok) { console.log('已取消。'); process.exit(0) }

  let written = 0
  for (let i = 0; i < skills.length; i += 400) {
    const batch = db.batch()
    for (const { doc } of skills.slice(i, i + 400)) {
      // merge:true：吸收模式下省略的鍵會保留既有值（那正是「空殼不得覆蓋有值」的兌現方式）
      batch.set(db.collection('pilotSkills').doc(doc.id), doc, { merge: true })
    }
    await batch.commit()
    written += Math.min(400, skills.length - i)
    console.log(`  …pilotSkills 已寫入 ${written}/${skills.length}`)
  }

  // ── bump 版本（寫在腳本裡，不靠人記）──────────────────────────────────────
  // 漏 bump 的症狀是「使用者持續讀到舊 localStorage 快取」，而操作者自己看起來一切正常。
  // 只 bump pilotSkills：weapons 這次一個位元組都沒動。
  const version = new Date().toISOString()
  await db.doc('meta/gameData').set({
    versions: { pilotSkills: version },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  console.log(`\n✅ 完成。pilotSkills ${skills.length} 筆已寫入，版本已 bump → ${version}`)
  console.log('   下一步：')
  console.log('     · 後台技能庫加 domain 篩選（M4），逐筆補 effects/buffIds')
  console.log('     · weapons 仍是內嵌格式、前台行為零變化——這是安全的停點')
  console.log('     · 確認線上正常後才可跑 Stage 2 flip（M6）')
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message)
  console.error(err.stack)
  process.exit(1)
})
