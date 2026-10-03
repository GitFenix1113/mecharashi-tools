#!/usr/bin/env node
/**
 * 圖片引用掃描器（PLAN-054 B-6）——檔名一變，所有引用一起改；靠掃描器守門，不靠記憶。
 *
 *   node scripts/check-image-refs.mjs                 掃描並印摘要（唯讀）
 *   node scripts/check-image-refs.mjs --report=<檔>   另寫一份完整清單（Markdown）
 *   node scripts/check-image-refs.mjs --fail-on=a     (a) 壞路徑 > 0 時 exit 1（D-3 之後的驗收）
 *   node scripts/check-image-refs.mjs --fail-on=b     (b) 舊路徑 > 0 時 exit 1（D-1 刪檔前的閘門）
 *
 * 來源：
 *   · Firestore 全部集合（唯讀）——略過 users、analytics*、changeHistory、systemLog：
 *     前兩者不存圖片路徑，後兩者是歷史紀錄，裡面的舊路徑是「當時的樣子」，不是現役引用。
 *   · repo 文字：src／scripts（不含 temp_scripts）／workers/src／docs／CLAUDE.md。
 * 輸出：
 *   (a) 壞路徑：指向不存在檔案的本地路徑（連 .webp 變體也不存在）
 *   (b) 舊路徑：指向「有官方原檔取代、即將刪除」的舊檔（PLAN-054 決策十一的清單）
 * 閘門（--fail-on）只算**現役引用**：Firestore 與正式程式碼。測試檔裡的假路徑、docs 裡的歷史紀錄
 * 照樣列在報告裡，但不擋——它們描述的是「當時的樣子」，改寫它們等於竄改歷史。
 *
 * ⚠ 判定「存不存在」要照**前台實際會請求的路徑**算，不是照資料字面：
 *   · 技能圖示走 normalizeSkillPath（src/utils/assets.ts）——DB 裡 3,239 個扁平路徑
 *     （/images/skills/Icon_skill_passive_5004.png）實際請求的是分類資料夾裡的檔案；
 *     不套用同一個正規化，這裡會誤報三千多筆。
 *   · imageCandidates() 會在原樣之後補試 .webp 變體，所以 .png 指向的檔只要有 .webp 版就算存在。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { GAME_DIR, classifyMechFile, classifyPilotFile } from './lib/gameAssetKinds.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(ROOT, 'public')
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true] }))
const SKIP_COLLECTIONS = new Set(['users', 'analyticsDaily', 'analyticsEntity', 'changeHistory', 'systemLog'])

// ── 與前台相同的正規化（src/utils/assets.ts 的 resolveIconSrc → normalizeSkillPath）────────
const SKILL_PREFIX_FOLDERS = [
  ['Icon_skill_main', '主動技能'], ['Icon_skill_order', '指令技能'], ['Icon_skill_passive', '被動技能'],
  ['Icon_skill_pp', 'pp技能'], ['Icon_skill_talent', '天賦技能'],
]
const SKILL_SUBFOLDERS = new Set([...SKILL_PREFIX_FOLDERS.map(([, f]) => f), '背包技能'])
function normalizeSkillPath(p) {
  const m = p.match(/(^|\/)images\/skills\/(.+)$/)
  if (!m) return p
  const parts = m[2].split('/'); const file = parts.pop() ?? ''
  if (parts.length && SKILL_SUBFOLDERS.has(parts[parts.length - 1])) return p
  const sub = SKILL_PREFIX_FOLDERS.find(([pre]) => file.startsWith(pre))?.[1]
  return sub ? `${m[1]}images/skills/${sub}/${file}` : p
}
/** 字面路徑 → 前台實際請求的 public/ 相對路徑（不含開頭斜線）；不是本地圖片回 null */
function toPublicPath(raw) {
  if (/^https?:\/\//i.test(raw)) return null
  const i = raw.indexOf('images/')
  if (i < 0) return null
  let p = raw.slice(i)
  try { p = decodeURIComponent(p) } catch { /* 保留原樣 */ }
  return normalizeSkillPath(p)
}
const exists = (rel) => fs.existsSync(path.join(PUBLIC, rel))
/** 照 imageCandidates() 的順序：原樣 → .webp 變體 */
const resolvable = (rel) => exists(rel) || (/\.(png|jpe?g)$/i.test(rel) && exists(rel.replace(/\.(png|jpe?g)$/i, '.webp')))

// ── 即將刪除的舊檔（PLAN-054 決策十一：有官方原檔的一律換官方）──────────────────────────
// 由「實體在 game/ 有哪幾種圖」反推它在名字資料夾裡的哪幾張舊圖會退場：
//   機師 half／raw → pilots/<名>/half.*、full.*
//   機甲 icon → mechs/<名>/portrait.*；部件 n → torso/leftArm/rightArm/legs.*；sn → art.*
// 名字資料夾由 DB 的 portrait 路徑取出（與 pilotArtDir／mechArtDir 同一條規則）。
function gameKinds(kind, id) {
  if (!id) return new Set()   // 沒有遊戲 ID（索妮婭）：沒有官方原檔可取代，舊圖不退場
  const dir = path.join(PUBLIC, GAME_DIR, kind, id)
  if (!fs.existsSync(dir)) return new Set()
  const out = new Set()
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.webp')) continue
    const c = kind === 'pilots' ? classifyPilotFile(f.slice(0, -5), id) : classifyMechFile(f.slice(0, -5), id)
    if (c) out.add(c.kind)
  }
  return out
}
function legacyFiles(pilots, mechs) {
  const out = new Map()   // public 相對路徑（不含副檔名）→ 誰的哪一張
  const add = (folder, base, why) => { if (folder) out.set(`${folder}/${base}`, why) }
  for (const p of pilots) {
    const folder = p.portrait?.match(/(?:^|\/)(images\/pilots\/[^/]+)\/[^/]+$/)?.[1]
    const k = gameKinds('pilots', p.gameId)
    if (k.has('half')) add(folder, 'half', `${p.name} 頭像`)
    if (k.has('raw')) add(folder, 'full', `${p.name} 半身`)
  }
  for (const m of mechs) {
    const folder = m.portrait?.match(/(?:^|\/)(images\/mechs\/[^/]+)\/[^/]+$/)?.[1]
    const k = gameKinds('mechs', m.gameId)
    if (k.has('icon')) add(folder, 'portrait', `${m.name} 立繪`)
    if (k.has('sn')) add(folder, 'art', `${m.name} 全身大圖`)
    for (const part of ['torso', 'leftArm', 'rightArm', 'legs']) if (k.has(part)) add(folder, part, `${m.name} 部件`)
  }
  return out
}
const legacyKey = (rel) => rel.replace(/\.[a-z0-9]+$/i, '')

// ── 收集引用 ───────────────────────────────────────────────────────────────────
const RE = /(?:https?:\/\/[^\s"'`)<>]+|\/?(?:[\w.-]+\/)*images\/[^\s"'`)<>?#]+?\.(?:webp|png|jpe?g|gif|svg|avif))/gi
const refs = []   // { where, field, raw, rel }

function walk(value, at, push) {
  if (typeof value === 'string') { for (const m of value.matchAll(RE)) push(at, m[0]); return }
  if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${at}[${i}]`, push)); return }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, at ? `${at}.${k}` : k, push)
}

async function scanFirestore() {
  const require = createRequire(path.join(ROOT, 'package.json'))
  const admin = require('firebase-admin')
  for (const f of ['.env', '.env.migration']) {
    const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue
    for (const l of fs.readFileSync(p, 'utf-8').split('\n')) { const i = l.indexOf('='); if (i > 0) { const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim(); if (k && v && !k.startsWith('#')) process.env[k] = v } }
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.resolve(ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf-8'))) })
  const db = admin.firestore()
  const data = { pilots: [], mechs: [] }
  for (const col of await db.listCollections()) {
    if (SKIP_COLLECTIONS.has(col.id)) continue
    for (const d of (await col.get()).docs) {
      const doc = d.data()
      if (col.id === 'pilots' || col.id === 'mechs') data[col.id].push({ id: d.id, ...doc })
      walk(doc, '', (field, raw) => refs.push({ where: `${col.id}/${d.id}`, field, raw }))
    }
  }
  return data
}

function scanText() {
  const roots = ['src', 'scripts', 'workers/src', 'docs', 'CLAUDE.md']
  const skipDir = new Set(['node_modules', 'temp_scripts', 'dist'])
  const exts = /\.(ts|tsx|mjs|js|json|html|md|css)$/
  const visit = (abs) => {
    const st = fs.statSync(abs)
    if (st.isDirectory()) { for (const e of fs.readdirSync(abs)) if (!skipDir.has(e)) visit(path.join(abs, e)); return }
    if (!exts.test(abs) || abs.endsWith(path.join('images', 'manifest.json'))) return
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    if (rel === 'scripts/check-image-refs.mjs') return
    fs.readFileSync(abs, 'utf-8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(RE)) refs.push({ where: `${rel}:${i + 1}`, field: '', raw: m[0] })
    })
  }
  for (const r of roots) { const abs = path.join(ROOT, r); if (fs.existsSync(abs)) visit(abs) }
}

const data = await scanFirestore()
scanText()
const legacy = legacyFiles(data.pilots, data.mechs)

/** 引用的性質：firestore／code 是現役引用（閘門只算這兩種），test／docs 只列不擋 */
function scopeOf(where) {
  if (!where.includes(':')) return 'firestore'
  const file = where.split(':')[0]
  if (/\.test\.(ts|tsx|mjs)$/.test(file)) return 'test'
  if (file.startsWith('docs/') || file.endsWith('.md') || file.startsWith('src/data/siteChangelog/')) return 'docs'
  return 'code'
}
const LIVE = new Set(['firestore', 'code'])

const broken = [], old = []
const byWhere = new Map()   // 集合或檔案 → { a, b }
for (const r of refs) {
  r.scope = scopeOf(r.where)
  r.rel = toPublicPath(r.raw)
  if (!r.rel) continue
  // 不是可驗證的字面路徑：模板字串（`${dir}`）、註解裡的佔位範例（`{名稱}`、`**`、`xxx`）、
  // og/entities（build 產物，gitignore）
  if (/\$\{|[{}*]|xxx|\/x\./.test(r.rel) || r.rel.startsWith('images/og/entities/')) continue
  const group = r.where.includes(':') ? r.where.split(':')[0] : r.where.split('/')[0]
  const s = byWhere.get(group) ?? { a: 0, b: 0, scope: r.scope }
  if (!resolvable(r.rel)) { broken.push(r); s.a++ }
  if (legacy.has(legacyKey(r.rel))) { old.push({ ...r, why: legacy.get(legacyKey(r.rel)) }); s.b++ }
  byWhere.set(group, s)
}

const liveA = broken.filter((r) => LIVE.has(r.scope)), liveB = old.filter((r) => LIVE.has(r.scope))
console.log(`圖片引用：${refs.length} 筆（Firestore＋repo 文字）；即將退場的舊檔 ${legacy.size} 張`)
console.log(`現役引用（Firestore＋程式碼）：(a) 壞路徑 ${liveA.length} 筆　(b) 舊路徑 ${liveB.length} 筆`)
console.log(`只列不擋（測試／文件）：(a) ${broken.length - liveA.length} 筆　(b) ${old.length - liveB.length} 筆`)
for (const [g, s] of [...byWhere].filter(([, s]) => (s.a || s.b) && LIVE.has(s.scope)).sort()) {
  console.log(`  ${g.padEnd(40)} a=${s.a}  b=${s.b}`)
}

if (args.report) {
  const fmt = (r) => `- \`${r.where}\`${r.field ? ` \`${r.field}\`` : ''}：\`${r.raw}\`${r.why ? `（${r.why}）` : ''}`
  const md = [
    '# 圖片引用掃描（PLAN-054 B-6）', '', `- 時間：${new Date().toISOString()}`,
    `- 引用 ${refs.length} 筆；即將退場的舊檔 ${legacy.size} 張`, `- (a) 壞路徑 ${broken.length} 筆；(b) 舊路徑 ${old.length} 筆`, '',
    '## 依來源', '', '| 來源 | (a) 壞路徑 | (b) 舊路徑 |', '|---|---:|---:|',
    ...[...byWhere].filter(([, s]) => s.a || s.b).sort().map(([g, s]) => `| ${g} | ${s.a} | ${s.b} |`), '',
    '## (a) 壞路徑・現役', '', ...liveA.map(fmt), '', '## (b) 舊路徑・現役', '', ...liveB.map(fmt), '',
    '## 只列不擋（測試／文件）', '', ...broken.filter((r) => !LIVE.has(r.scope)).map((r) => fmt(r) + '　(a)'),
    ...old.filter((r) => !LIVE.has(r.scope)).map((r) => fmt(r) + '　(b)'), '',
  ].join('\n')
  fs.writeFileSync(path.resolve(String(args.report)), md)
  console.log(`📝 完整清單：${args.report}`)
}
const fail = String(args['fail-on'] ?? '')
if ((fail.includes('a') && liveA.length) || (fail.includes('b') && liveB.length)) process.exit(1)
process.exit(0)
