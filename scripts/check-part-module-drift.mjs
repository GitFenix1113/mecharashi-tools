#!/usr/bin/env node
/**
 * 天生模組逐部位矩陣 — 官方 vs 站上推導的漂移檢查（唯讀）— PLAN-052-K E-1
 *
 * ── 為什麼需要這支 ────────────────────────────────────────────────────────
 * 天生模組的矩陣（90 台 × 4 部位 ≈ 1500 格）**不落盤、全部用算的**（決策一）。
 * 好處是官方改版時規則會自動跟上；代價是**規則錯了，1500 格一起錯，而且畫面上
 * 不會有任何錯誤訊息** —— 只會是一堆「看起來很合理但就是不對」的數字。
 *
 * 這支就是那個安全網：把官方 `aircraft_data/detail` 的逐部位矩陣拉下來，
 * 與 `resolveInnateModules()` 算出來的逐格比對。
 *
 * ⚠ **它 import 的是站上真正在跑的那份實作**（`src/utils/innateModules.ts`），
 *   不是在這裡重寫一份規則。重寫的話兩邊會各自漂移，而這支就從「安全網」
 *   變成「兩份都錯但互相同意」—— 那比沒有檢查更糟。
 *
 * ── 官方那側的資料長相 ────────────────────────────────────────────────────
 * `aircraft_data/detail?query=<簡體機名>` 回四個部位。**軀幹是物件陣列且內容是
 * 整台的總表**（每顆帶 `id`＝族 id、`level`＝該模組在整台上的總級數），
 * 其餘三部位是壓縮字串 `<族id>:<等級>/`。所以
 *
 *     軀幹自身 ＝ 總表 − （左臂 ＋ 右臂 ＋ 腿部）
 *
 * 全 83 台驗算無負值、無孤兒 id（2026-08-28）。一律取 `manji`（滿階）那一份 ——
 * 站上全站以滿階計（總綱 N3）。
 *
 * ── 三種結果、三種處置（報表會直接印出來，不要只丟 diff）────────────────────
 *   全中                → 不用做任何事。
 *   **某台某格**不符    → 那台是例外，填 `MechPart.innateModules`（後台 MechAdmin）。
 *   **一整批**不符      → 是規律變了，改 `INNATE_LEVEL_RULE`（改完重跑本支）。
 *
 * ⚠ **它只覆蓋得到官方有的那 83 台。** 站上 90 台已到 v3.6，官方 `aircraft_data`
 *   停在 v3.2 —— v3.3 之後的 7 台**永遠對不到**，那幾台的矩陣只有人工建檔可信。
 *   報表末尾會逐台列出來，因為「全中」很容易被讀成「全站都對」。
 *
 * ⚠ **站上有、官方沒有** 的模組不一定是錯：復仇女神四顆〈模型-XX〉、彌造者
 *   〈帕姆斯陣列〉、星夜女神〈觀星者單元〉是彩甲「限制解除」／機師限定才啟動的
 *   隱藏模組，**本來就不在部件的 `ModuleCarried` 裡**。判準是它有沒有
 *   `unlockCondition` —— 有的歸「預期內」，沒有的才是真的可疑。
 *   （`scrape-mechs.js` 檔頭那句「API 會回頭刪東西」就是誤把這件事當成刪除，E-4 已修。）
 *
 * 使用：
 *   node scripts/check-part-module-drift.mjs                 ← 全站，有落差時 exit 1
 *   node scripts/check-part-module-drift.mjs --mech=mech_022_帕斯卡
 *   node scripts/check-part-module-drift.mjs --verbose       ← 連對上的也逐格印
 */

import fs from 'fs'
import https from 'https'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'
import * as OpenCC from 'opencc-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API_BASE = 'https://ma-activity.zlongame.com/common/infodata/mQuery.do'
const APP_KEY = '1616148215678'

const args = process.argv.slice(2)
const ONLY = (args.find((a) => a.startsWith('--mech=')) || '').split('=')[1] || null
const VERBOSE = args.includes('--verbose')

const POS = ['torso', 'leftArm', 'rightArm', 'legs']
const POS_LABEL = { torso: '軀幹', leftArm: '左臂', rightArm: '右臂', legs: '腿部' }
const POSITION_MAP = { 躯干: 'torso', 左臂: 'leftArm', 右臂: 'rightArm', 腿部: 'legs' }

const _t2s = OpenCC.Converter({ from: 'tw', to: 'cn' })
const _s2t = OpenCC.Converter({ from: 'cn', to: 'tw' })
/** 繁→簡→繁 正規化：讓「回避／迴避」這類孿生收斂成同一個鍵（同 patch-exclusive-*）。 */
const normName = (s) => (s ? _s2t(_t2s(String(s))) : '')

/**
 * **刻意**與官方不同名的模組：`官方名（繁化後）` → `站上名`。
 *
 * 站上譯名與官方不一致時，這裡登記一筆就不再報。空著是刻意的 ——
 * 每一筆都該是站長看過、決定「站上就是要這樣叫」的結果，
 * 而不是為了讓檢查安靜而加的。**先確認是不是打錯字，再考慮加進來。**
 */
const NAME_ALIASES = new Map([
  // 2026-08-29：本表<b>第一個候選人已改回資料</b> —— `sub_mod_防爆模組` 的 name 曾是
  // 「防**暴**模組」，而官方與它自己的 doc id 都是「防**爆**」，站長判定為手動輸入的錯字
  // （效果文字「被暴擊率降低」裡的「暴」是暴擊，與模組名的「爆」無關）。
  // ⇒ 修的是資料，不是在這裡登記例外。**先確認是不是打錯字，再考慮加進來。**
])

// ─── 站上真正在跑的那份規則 ─────────────────────────────────────────────────
// ⚠ 絕對不要在本檔重寫一份。見檔頭。
const { resolveInnateModules } = await import(
  new URL('../src/utils/innateModules.ts', import.meta.url).href
)

// ─── 基礎設施 ───────────────────────────────────────────────────────────────

function loadEnv(filename) {
  const p = resolve(ROOT, filename)
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim()
    if (k && v && !k.startsWith('#')) process.env[k] = v
  }
}

function initFirebase() {
  loadEnv('.env')
  loadEnv('.env.migration')
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccountKey.json'
  const abs = resolve(ROOT, credPath)
  if (!fs.existsSync(abs)) {
    console.error(`✗ 找不到服務帳號金鑰：${abs}`)
    process.exit(1)
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(abs, 'utf-8'))) })
  return admin.firestore()
}

function fetchJson(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, timeout: 20000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); rej(new Error(`HTTP ${r.statusCode} for ${url}`)); return }
      // ⚠ `setEncoding` 不可省：不設的話 chunk 是 Buffer，`d += c` 會逐塊 toString，
      //   一個 UTF-8 中文字剛好跨在 chunk 邊界時就會**碎掉一個字**。
      //   症狀極不穩定（只有大回應會中），而且長得像「官方那顆模組叫別的名字」——
      //   實測 2026-08-29 塔納託斯的〈整備模組〉就是這樣配不上的。
      r.setEncoding('utf8')
      let d = ''
      r.on('data', (c) => { d += c })
      r.on('end', () => { try { res(JSON.parse(d)) } catch { rej(new Error(`JSON 解析失敗：${url}`)) } })
    }).on('error', rej)
  })
}
const apiUrl = (target, type, query = '') =>
  `${API_BASE}?appkey=${APP_KEY}&target=${target}&type=${type}` + (query ? `&query=${encodeURIComponent(query)}` : '')

// ─── 官方矩陣 ───────────────────────────────────────────────────────────────

/** `<族id>:<等級>/` → `{ 族id: 等級 }`。同一顆重複出現時相加（官方偶爾拆兩段）。 */
function parseCarried(s) {
  const o = {}
  if (typeof s !== 'string') return o
  for (const seg of s.split('/')) {
    if (!seg.trim()) continue
    const [id, lv] = seg.split(':')
    if (!id) continue
    o[id] = (o[id] || 0) + Number(lv || 0)
  }
  return o
}

/**
 * 一台機甲的官方逐部位矩陣。
 * 回傳 `{ matrix: Map<族id, {torso,leftArm,rightArm,legs}>, names: Map<族id, 官方名稱>, negative: [] }`。
 * `negative` ＝ 軀幹自身算出負數的那些 —— 那代表「總表 − 其他三部位」的假設在這台不成立，
 * 必須當成**這支腳本的前提壞了**來處理，而不是靜默夾成 0。
 */
async function fetchOfficialMatrix(mechNameTw) {
  const parts = (await fetchJson(apiUrl('aircraft_data', 'detail', _t2s(mechNameTw)))).data?.data || []
  const by = {}
  for (const p of parts) {
    const key = POSITION_MAP[p.position]
    if (key) by[key] = p
  }
  if (!by.torso) return null

  const names = new Map()
  const total = {}
  for (const m of (by.torso.manji?.ModuleCarried || by.torso.ModuleCarried || [])) {
    const id = String(m.id ?? m.ID ?? '')
    if (!id) continue
    total[id] = (total[id] || 0) + Number(m.level || 0)
    if (m.name) names.set(id, String(m.name))
  }
  const others = {}
  for (const k of ['leftArm', 'rightArm', 'legs']) {
    others[k] = parseCarried(by[k]?.manji?.ModuleCarried ?? by[k]?.ModuleCarried)
  }

  const ids = new Set([...Object.keys(total), ...Object.values(others).flatMap((o) => Object.keys(o))])
  const matrix = new Map()
  const negative = []
  for (const id of ids) {
    const outer = ['leftArm', 'rightArm', 'legs'].reduce((a, k) => a + (others[k][id] || 0), 0)
    const torsoOwn = (total[id] || 0) - outer
    if (torsoOwn < 0) negative.push({ id, total: total[id] || 0, outer })
    matrix.set(id, {
      torso: Math.max(0, torsoOwn),
      leftArm: others.leftArm[id] || 0,
      rightArm: others.rightArm[id] || 0,
      legs: others.legs[id] || 0,
    })
  }
  return { matrix, names, negative }
}

// ─── 站上推導 ───────────────────────────────────────────────────────────────

/** 用站上真正的規則算出這台的逐部位矩陣：`Map<docId, {torso,…}>`。 */
function siteMatrix(mech, lookup) {
  const out = new Map()
  const gaps = { unknownQuality: false, missingBoundPart: new Set(), unknownModuleIds: new Set() }
  for (const pos of POS) {
    const res = resolveInnateModules(mech, pos, lookup)
    if (res.unknownQuality) gaps.unknownQuality = true
    for (const id of res.missingBoundPart) gaps.missingBoundPart.add(id)
    for (const id of res.unknownModuleIds) gaps.unknownModuleIds.add(id)
    for (const e of res.entries) {
      if (!out.has(e.moduleId)) out.set(e.moduleId, { torso: 0, leftArm: 0, rightArm: 0, legs: 0 })
      out.get(e.moduleId)[pos] += e.level
    }
  }
  return { matrix: out, gaps }
}

/**
 * 族 id ↔ doc id 的對應，**只在這一台自己的模組範圍內**配對。
 *
 * 全庫用名稱查表會撞（破曉者-02 有兩顆都叫〈匯流樞紐〉），但一台機甲最多帶 7 顆，
 * 撞名只可能發生在自己人之間 —— 這時用**部位集合**消歧義，與
 * `patch-exclusive-module-levels.mjs` 同一招。
 */
function pairUp(officialMatrix, officialNames, siteM, moduleById) {
  const byName = new Map()
  for (const [docId, cells] of siteM) {
    const key = normName(moduleById.get(docId)?.name ?? docId)
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push({ docId, cells })
  }

  const pairs = []                 // { familyId, docId, official, site, nameMismatch? }
  const unpairedOfficial = []
  const matchedDocs = new Set()

  const posSet = (c) => POS.filter((p) => (c[p] ?? 0) > 0).join(',')

  for (const [familyId, official] of officialMatrix) {
    const officialName = normName(officialNames.get(familyId) ?? '')
    const wanted = NAME_ALIASES.get(officialName) ?? officialName
    const cands = (byName.get(normName(wanted)) || []).filter((c) => !matchedDocs.has(c.docId))
    let picked = cands[0] ?? null
    if (cands.length > 1) {
      // 同名多顆 ⇒ 用部位集合挑。挑不出來就不配，讓它進報表而不是隨便配一個。
      picked = cands.find((c) => posSet(c.cells) === posSet(official)) ?? null
    }
    if (!picked) { unpairedOfficial.push({ familyId, name: officialNames.get(familyId) ?? '?', official }); continue }
    matchedDocs.add(picked.docId)
    pairs.push({ familyId, docId: picked.docId, official, site: picked.cells })
  }

  // ── 後援：名稱對不上，但矩陣形狀唯一吻合 ────────────────────────────────
  //
  // 名稱是個**脆弱的 join key**（站上把〈防爆模組〉打成〈防暴模組〉就是現成的例子）。
  // 只靠名稱的話，一個錯字會讓那顆模組的四格**完全沒被比對到**，
  // 卻在報表上偽裝成「官方有、站上沒有」＋「站上有、官方沒有」兩筆 ——
  // 真正該檢查的東西反而被漏掉了。
  //
  // ⚠ 只在**兩側各自唯一**時才配（同形狀有兩顆就不配），否則就是在猜。
  const leftoverSite = [...siteM.keys()].filter((d) => !matchedDocs.has(d))
  const shapeOf = (c) => POS.map((p) => c[p] ?? 0).join('/')
  const nameMismatches = []
  for (const o of [...unpairedOfficial]) {
    const shape = shapeOf(o.official)
    const sameShapeOfficial = unpairedOfficial.filter((x) => shapeOf(x.official) === shape)
    const cands = leftoverSite.filter((d) => shapeOf(siteM.get(d)) === shape)
    if (sameShapeOfficial.length !== 1 || cands.length !== 1) continue
    const docId = cands[0]
    matchedDocs.add(docId)
    leftoverSite.splice(leftoverSite.indexOf(docId), 1)
    unpairedOfficial.splice(unpairedOfficial.indexOf(o), 1)
    pairs.push({ familyId: o.familyId, docId, official: o.official, site: siteM.get(docId) })
    nameMismatches.push({ familyId: o.familyId, docId, officialName: o.name, siteName: moduleById.get(docId)?.name ?? docId })
  }

  return { pairs, officialOnly: unpairedOfficial, siteOnly: leftoverSite, nameMismatches }
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

const db = initFirebase()

const [mechSnap, modSnap] = await Promise.all([
  db.collection('mechs').get(),
  db.collection('modules').get(),
])
const moduleById = new Map(modSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]))
const lookup = (id) => moduleById.get(id)

let mechs = mechSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id))
if (ONLY) {
  mechs = mechs.filter((m) => m.id === ONLY)
  if (!mechs.length) { console.error(`✗ 找不到 mechs/${ONLY}`); process.exit(1) }
}

console.log(`站上 ${mechSnap.size} 台機甲、${modSnap.size} 筆模組。拉官方 aircraft_data…\n`)

const officialList = (await fetchJson(apiUrl('aircraft_data', 'list'))).data?.data || []
const officialNamesCn = new Set(officialList.map((r) => String(r.name ?? r.AircraftName ?? '')).filter(Boolean))
console.log(`官方 aircraft_data/list：${officialNamesCn.size} 台\n`)

const cellDiffs = []      // 逐格不符
const notInOfficial = []  // 官方沒有這台（v3.3 之後的新機）
const officialOnlyAll = []
const nameMismatchAll = []
const siteOnlyExpected = []
const siteOnlySuspect = []
const negatives = []
const dataGaps = []
let checkedMechs = 0
let checkedCells = 0

for (const mech of mechs) {
  if (!officialNamesCn.has(_t2s(mech.name ?? ''))) {
    notInOfficial.push(mech)
    continue
  }
  let off
  try {
    off = await fetchOfficialMatrix(mech.name)
  } catch (e) {
    console.log(`⚠ ${mech.id}「${mech.name}」官方查詢失敗：${e.message}`)
    continue
  }
  if (!off) { console.log(`⚠ ${mech.id}「${mech.name}」官方回應沒有軀幹，略過`); continue }
  checkedMechs++
  if (off.negative.length) negatives.push({ mech, rows: off.negative })

  const { matrix: siteM, gaps } = siteMatrix(mech, lookup)
  if (gaps.unknownQuality || gaps.missingBoundPart.size || gaps.unknownModuleIds.size) {
    dataGaps.push({ mech, gaps })
  }

  const { pairs, officialOnly, siteOnly, nameMismatches } = pairUp(off.matrix, off.names, siteM, moduleById)
  for (const n of nameMismatches) nameMismatchAll.push({ mech, ...n })

  for (const p of pairs) {
    const mod = moduleById.get(p.docId)
    for (const pos of POS) {
      checkedCells++
      const a = p.official[pos] ?? 0
      const b = p.site[pos] ?? 0
      if (a === b) continue
      cellDiffs.push({
        mech, pos, docId: p.docId, name: mod?.name ?? p.docId,
        slot: mod?.slot ?? '?', quality: mech.quality ?? '?', official: a, site: b,
      })
    }
    if (VERBOSE) {
      console.log(`   ✓ ${mech.name} ${mod?.name ?? p.docId}：` +
        POS.map((x) => `${POS_LABEL[x]}${p.official[x]}`).join(' '))
    }
  }
  for (const o of officialOnly) officialOnlyAll.push({ mech, ...o })
  for (const docId of siteOnly) {
    const mod = moduleById.get(docId)
    ;(mod?.unlockCondition ? siteOnlyExpected : siteOnlySuspect).push({ mech, docId, name: mod?.name ?? docId })
  }
}

// ─── 報表 ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(70)}`)
console.log(`對帳完成：${checkedMechs} 台 × ${checkedCells} 格`)
console.log('═'.repeat(70))

if (negatives.length) {
  console.log(`\n🛑 ${negatives.length} 台的「軀幹 ＝ 總表 − 其他三部位」算出負數 —— 本腳本的前提壞了：`)
  for (const n of negatives) {
    for (const r of n.rows) console.log(`   · ${n.mech.name} 族${r.id}：總表 ${r.total} < 其他三部位 ${r.outer}`)
  }
  console.log('   ⚠ 先查清楚官方是不是改了回傳結構，再相信底下任何一行。')
}

if (dataGaps.length) {
  console.log(`\n⚠ ${dataGaps.length} 台有資料缺口（這些格子推導不出來，不是「沒有天生模組」）：`)
  for (const g of dataGaps) {
    if (g.gaps.unknownQuality) console.log(`   · ${g.mech.id}「${g.mech.name}」quality「${g.mech.quality ?? ''}」不在規則表內`)
    for (const id of g.gaps.missingBoundPart) console.log(`   · ${g.mech.id}「${g.mech.name}」專屬模組 ${id} 沒填 boundPart ⇒ 不會出現在任何部位`)
    for (const id of g.gaps.unknownModuleIds) console.log(`   · ${g.mech.id}「${g.mech.name}」moduleFixedIds 指到查無的 ${id}`)
  }
}

if (officialOnlyAll.length) {
  console.log(`\n❌ ${officialOnlyAll.length} 筆「官方有、站上配不到」——名稱對不上或根本沒建檔：`)
  for (const o of officialOnlyAll) {
    console.log(`   · ${o.mech.id}「${o.mech.name}」族${o.familyId}「${o.name}」` +
      `　${POS.map((p) => `${POS_LABEL[p]}${o.official[p]}`).join(' ')}`)
  }
  console.log('   修法：確認該模組在站上的名稱與 mech 的 module4Id/module8Id/moduleFixedIds。')
}

if (nameMismatchAll.length) {
  // 依「官方名 → 站上名」收斂：同一顆模組被 6 台帶著就是同一個問題，印 6 次只會蓋掉重點
  const byPair = new Map()
  for (const n of nameMismatchAll) {
    const k = `${n.officialName}→${n.siteName}`
    if (!byPair.has(k)) byPair.set(k, { ...n, mechs: [] })
    byPair.get(k).mechs.push(n.mech.name)
  }
  console.log(`
⚠ ${byPair.size} 顆模組的**名稱與官方不一致**（已用矩陣形狀配對，四格都逐格比對過了）：`)
  for (const v of byPair.values()) {
    console.log(`   · 官方「${v.officialName}」↔ 站上 ${v.docId}「${v.siteName}」`)
    console.log(`     出現在：${v.mechs.slice(0, 6).join('、')}${v.mechs.length > 6 ? ` …等 ${v.mechs.length} 台` : ''}`)
  }
  console.log('   ⚠ 名稱是 moduleFamilyKey 的依據（同族堆疊靠它），不是純顯示欄位。')
  console.log('   兩條路：① 打錯字 → 改 modules 那筆的 name（記得 bump modules）；')
  console.log('           ② 站上刻意用不同譯名 → 在本檔的 NAME_ALIASES 登記一筆。')
}

if (siteOnlySuspect.length) {
  console.log(`\n❌ ${siteOnlySuspect.length} 筆「站上有、官方沒有」且**沒有 unlockCondition**：`)
  for (const s of siteOnlySuspect) console.log(`   · ${s.mech.id}「${s.mech.name}」→ ${s.docId}「${s.name}」`)
  console.log('   ⚠ 隱藏模組（限制解除／機師限定）應該要有 unlockCondition；沒有的話它會被當成無條件生效。')
}
if (siteOnlyExpected.length) {
  console.log(`\nℹ ${siteOnlyExpected.length} 筆「站上有、官方沒有」但**有 unlockCondition** ⇒ 預期內的隱藏模組：`)
  for (const s of siteOnlyExpected) console.log(`   · ${s.mech.name} → ${s.name}`)
}

if (cellDiffs.length === 0) {
  console.log('\n✅ 逐格矩陣與官方完全一致。')
} else {
  // 一整批 vs 單點：同一個 (quality, slot, 部位, 官方值, 站上值) 出現在多台 ⇒ 是規律變了
  const groups = new Map()
  for (const d of cellDiffs) {
    const k = `${d.quality}|${d.slot}|${d.pos}|${d.official}|${d.site}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(d)
  }
  const batch = [...groups.entries()].filter(([, v]) => v.length >= 3)
  const single = [...groups.entries()].filter(([, v]) => v.length < 3)

  console.log(`\n❌ ${cellDiffs.length} 格與官方不符。`)
  if (batch.length) {
    console.log(`\n── 一整批不符（${batch.length} 種型態）⇒ 該改的是規則表 INNATE_LEVEL_RULE ──`)
    for (const [k, v] of batch) {
      const [quality, slot, pos, official, site] = k.split('|')
      console.log(`   · ${quality} 級 · ${slot} · ${POS_LABEL[pos]}：官方 ${official}、站上算 ${site}　（${v.length} 台）`)
      console.log(`     ${v.slice(0, 6).map((d) => d.mech.name).join('、')}${v.length > 6 ? ` …等 ${v.length} 台` : ''}`)
    }
    console.log('   修法：改 src/utils/innateModules.ts 的 INNATE_LEVEL_RULE，改完重跑本支與 npm test。')
  }
  if (single.length) {
    console.log(`\n── 單點不符 ⇒ 那幾台是例外，填 MechPart.innateModules（後台 MechAdmin 的部位卡）──`)
    for (const [, v] of single) {
      for (const d of v) {
        console.log(`   · ${d.mech.id}「${d.mech.name}」${POS_LABEL[d.pos]} · ${d.name}（${d.slot}）：` +
          `官方 ${d.official}、站上算 ${d.site}`)
      }
    }
    console.log('   修法：後台 → 機甲 → 該部位卡 → 「改成人工指定」，把該格填成官方那組值。')
  }
}

if (notInOfficial.length) {
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`⚠ ${notInOfficial.length} 台**官方沒有資料**，本支完全對不到（站上 v3.6、官方 aircraft_data 停在 v3.2）：`)
  for (const m of notInOfficial) console.log(`   · ${m.id}「${m.name}」（${m.quality ?? '?'} 級）`)
  console.log('   這幾台的矩陣只有人工建檔可信 —— 上面的「全中」**不等於全站都對**。')
}

// ⚠ 名稱不一致也算失敗：它今天沒有讓任何數字算錯（形狀配對接住了），但
//   `moduleFamilyKey` 用的就是名稱 —— 放著不管，下次官方出一顆同名模組時它會靜默併族。
process.exit(
  cellDiffs.length || officialOnlyAll.length || siteOnlySuspect.length ||
  negatives.length || nameMismatchAll.length ? 1 : 0,
)
