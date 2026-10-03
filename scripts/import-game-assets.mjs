#!/usr/bin/env node
/**
 * 官方原檔匯入（PLAN-054 B-1／B-2／B-3）——陸版客戶端擷取的 PNG → WebP，以官方檔名放進 ID 資料夾。
 *
 *   node scripts/import-game-assets.mjs                                         v3 整批・core（預設 dry-run）
 *   node scripts/import-game-assets.mjs --tier=extended                         v3 整批・extended → 封存夾（repo 外）
 *   node scripts/import-game-assets.mjs --tier=reserve                          站上沒有的實體（NPC／敵方機甲／對不到的英文名鍵）→ 封存夾
 *   node scripts/import-game-assets.mjs --id=10103174 --art-key=Pilot_10103174A 新機師：依命名規則從圖片索引.csv 找 core 四種圖
 *   node scripts/import-game-assets.mjs --wap=3062                              新機甲：立繪／部件 1~4／全身大圖
 *
 * 共用旗標：--apply（真的寫檔；預設只報告）、--force（已存在也重轉）、--only=<gameId|wap>（v3 模式只做一個）、
 *           --src=<客戶端擷取的 Data 夾>（預設 E:/Mecharashi_Data/Data）、--archive=<封存夾>（預設 E:/Mecharashi_Data/site-archive）
 *
 * ── 落點 ──────────────────────────────────────────────────────────────────
 *   core      public/images/game/{pilots/<gameId>,mechs/<wap>}/<官方檔名>.webp   進版控、部署上線
 *   extended  <archive>/game/{pilots,mechs}/<id>/<官方檔名>.webp                  **不進 git、不部署**
 *   reserve   <archive>/game/_reserve/{npc/<id>,enemy-mech/<wap>,unknown/<key>}/  **不進 git、不部署**
 * extended／reserve 不進 repo 是站長 2026-10-04 的決定：repo 是公開的，進 repo 就等於把台版還沒上線的
 * 造型、NPC 公開出去，而且 git 歷史收不回來。封存夾只是原始擷取的轉檔副本，隨時可以從 --src 重產。
 *
 * ── 轉檔與守門 ────────────────────────────────────────────────────────────
 *   sharp → WebP q82、原尺寸不縮、保留 alpha；檔名＝官方資產名逐字（含大小寫）＋ .webp。
 *   同名的 Sprite／Texture2D 取 Texture2D（Sprite 是裁切過的圖集切片）。
 *   同一個落點對到兩個內容不同的來源（sha256 不同）→ 中止，不猜。
 *   落點小寫後撞名（Windows 不分大小寫、GitHub Pages 分）→ 中止。
 *   ⚠ 原始 PNG、圖片索引.csv、擷取工具（設定檔含解密金鑰）一律不進 repo——本腳本只讀 --src。
 *
 * 命名規則在 scripts/lib/gameAssetKinds.mjs（與索引、引用掃描共用）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { GAME_DIR, MECH_KINDS, PILOT_KINDS, TIER_GROUPS, mechFileName, pilotFileName } from './lib/gameAssetKinds.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (!m) { console.error(`❌ 看不懂的參數：${a}`); process.exit(1) }
  return [m[1], m[2] ?? true]
}))
const SRC = path.resolve(String(args.src ?? 'E:/Mecharashi_Data/Data'))
const ARCHIVE = path.resolve(String(args.archive ?? 'E:/Mecharashi_Data/site-archive'))
const V3 = path.join(ROOT, '_local-notes/2026-10/2026-10-03_機師機甲圖片資源mapping_v3_final.json')
const CSV = path.join(SRC, '圖片索引.csv')
const PUBLIC_GAME = path.join(ROOT, 'public', GAME_DIR)
const APPLY = !!args.apply
const FORCE = !!args.force
const MODE = args.id ? 'pilot' : args.wap ? 'mech' : 'v3'
const TIER = MODE === 'v3' ? String(args.tier ?? 'core') : 'core'

if (!['core', 'extended', 'reserve'].includes(TIER)) fail(`--tier 只能是 core／extended／reserve：${TIER}`)
if (TIER !== 'core' && isInside(ARCHIVE, ROOT)) {
  fail(`--archive 在 repo 裡面（${ARCHIVE}）——extended／reserve 不能進 repo（站長 2026-10-04 定案 A）`)
}
if (!fs.existsSync(SRC)) fail(`找不到客戶端擷取：${SRC}（用 --src 指定）`)

function fail(msg) { console.error(`❌ ${msg}`); process.exit(1) }
function isInside(p, dir) { const r = path.relative(dir, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r) || r === '' }
const destRoot = TIER === 'core' ? PUBLIC_GAME : path.join(ARCHIVE, 'game')

// ── 圖片索引.csv（新實體模式與 reserve 才需要）──────────────────────────────────
function loadCsv() {
  if (!fs.existsSync(CSV)) fail(`找不到 ${CSV}`)
  const text = fs.readFileSync(CSV, 'utf-8').replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  const head = lines.shift().split(',')
  const col = (n) => { const i = head.indexOf(n); if (i < 0) fail(`圖片索引.csv 少了欄位 ${n}`); return i }
  const [iType, iName, iW, iH, iPath, iSha] = ['type', 'name', 'width', 'height', 'path', 'sha256'].map(col)
  const rows = []
  for (const line of lines) {
    if (!line) continue
    const c = line.split(',')   // 索引欄位不含逗號（檔名與路徑都是 ASCII／中文分類名，無引號）
    rows.push({ type: c[iType], name: c[iName], w: +c[iW], h: +c[iH], path: c[iPath], sha: c[iSha] })
  }
  return rows
}

/** 同名多筆：取 Texture2D；Texture2D 不只一筆時 sha256 必須相同，否則回 { conflict }。 */
function pickRow(rows, name) {
  const all = rows.filter((r) => r.name === name)
  const tex = all.filter((r) => r.type === 'Texture2D')
  const pool = tex.length ? tex : all
  if (!pool.length) return { missing: true }
  const shas = new Set(pool.map((r) => r.sha))
  if (shas.size > 1) return { conflict: pool.map((r) => r.path) }
  return { row: pool[0] }
}

// ── 組出任務清單：{ src, dest, label, group } ─────────────────────────────────────
const tasks = []
const problems = []   // 中止等級
const notes = []      // 報告用

function addTask(srcRel, destDir, name, label, group) {
  tasks.push({ src: path.join(SRC, srcRel), dest: path.join(destRoot, destDir, `${name}.webp`), label, group, name })
}

if (MODE === 'v3') {
  const v3 = JSON.parse(fs.readFileSync(V3, 'utf-8'))
  if (v3.version !== 'v3-final') fail(`輸入不是 v3 定版：${v3.version}`)
  if (TIER === 'reserve') {
    const rows = loadCsv().filter((r) => r.type === 'Texture2D')
    const byName = new Map()
    for (const r of rows) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r) }
    const take = (re, dir, label) => {
      let n = 0
      for (const [name, rs] of byName) {
        if (!re.test(name)) continue
        const pick = pickRow(rs, name)
        if (pick.conflict) { problems.push(`${label} ${name}：同名 Texture2D 內容不同 ${pick.conflict.join(' ／ ')}`); continue }
        addTask(pick.row.path, dir, name, label, 'reserve'); n++
      }
      if (!n) notes.push(`${label}：圖片索引裡找不到任何符合的檔案`)
    }
    for (const id of v3.reserve.npc.ids) {
      take(new RegExp(`^(Pilot_${id}[A-Z]{0,2}_(half|head|Raw)|Icon_item_${id}[A-Z]{0,2})$`), `_reserve/npc/${id}`, `NPC ${id}`)
    }
    for (const wap of v3.reserve.enemyMech.ids) {
      take(new RegExp(`^(Icon_mecha_wap${wap}(_SN_Raw)?|Icon_wap${wap}_[1-4])$`), `_reserve/enemy-mech/${wap}`, `敵方機甲 wap${wap}`)
    }
    for (const key of v3.reserve.unknown.keys) {
      // 只收立繪類：招募立繪／招募橫幅／機甲卡立繪與橫幅／大廳場景。名字字卡（_name_）與活動橫幅（Img_Act_）是文字類，不收。
      take(new RegExp(`^(Img_1_mechcard_(banner|illustration)_${key}\\d*(_Raw)?|Img_main_Skin_${key}(_Raw)?|Img_1_pilot_gacha_(banner_)?${key}\\d*(_Raw)?)$`, 'i'),
        `_reserve/unknown/${key}`, `英文名鍵 ${key}`)
    }
  } else {
    const groups = TIER_GROUPS[TIER]
    for (const [kind, list, idOf] of [['pilots', v3.pilots, (e) => e.gameId], ['mechs', v3.mechs, (e) => e.wap]]) {
      for (const e of list) {
        const id = idOf(e)
        if (!id) { notes.push(`${e.name}：v3 沒有遊戲 ID，略過`); continue }
        if (args.only && String(args.only) !== id) continue
        // 同名時 Texture2D 優先；v3 的 core 實測全是 Texture2D、零同名，這段是給 extended 與日後的保險
        const byName = new Map()
        for (const a of e.assets) {
          if (!groups[kind].includes(a.group)) continue
          const prev = byName.get(a.name)
          if (!prev || (prev.type !== 'Texture2D' && a.type === 'Texture2D')) byName.set(a.name, a)
          else if (prev.type === a.type && prev.path !== a.path) {
            const [h1, h2] = [prev.path, a.path].map((p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(SRC, p))).digest('hex'))
            if (h1 !== h2) problems.push(`${e.name} ${a.name}：同名同型別但內容不同（${prev.path} ／ ${a.path}）`)
          }
        }
        for (const a of byName.values()) addTask(a.path, `${kind}/${id}`, a.name, e.name, a.group)
      }
    }
  }
} else {
  const rows = loadCsv()
  if (MODE === 'pilot') {
    const id = String(args.id), artKey = args['art-key'] ? String(args['art-key']) : undefined
    if (!artKey) fail('新機師模式要同時給 --id 與 --art-key（兩者不互推，見 src/types/pilot.ts）')
    for (const kind of PILOT_KINDS) {
      const name = pilotFileName(kind, id, artKey)
      const pick = pickRow(rows, name)
      if (pick.missing) notes.push(`缺 ${kind}：圖片索引裡沒有 ${name}`)
      else if (pick.conflict) problems.push(`${name}：同名 Texture2D 內容不同 ${pick.conflict.join(' ／ ')}`)
      else addTask(pick.row.path, `pilots/${id}`, name, `機師 ${id}`, kind)
    }
  } else {
    const wap = String(args.wap)
    for (const kind of MECH_KINDS) {
      const name = mechFileName(kind, wap)
      const pick = pickRow(rows, name)
      if (pick.missing) notes.push(`缺 ${kind}：圖片索引裡沒有 ${name}`)
      else if (pick.conflict) problems.push(`${name}：同名 Texture2D 內容不同 ${pick.conflict.join(' ／ ')}`)
      else addTask(pick.row.path, `mechs/${wap}`, name, `機甲 wap${wap}`, kind)
    }
  }
}

// ── 守門：來源存在、小寫碰撞 ─────────────────────────────────────────────────────
const lower = new Map()
for (const t of tasks) {
  if (!fs.existsSync(t.src)) problems.push(`${t.label} ${t.name}：來源不存在 ${t.src}`)
  const k = t.dest.toLowerCase()
  if (lower.has(k) && lower.get(k) !== t.dest) problems.push(`小寫碰撞：${lower.get(k)} ／ ${t.dest}`)
  lower.set(k, t.dest)
}
if (problems.length) {
  console.error(`❌ 守門命中 ${problems.length} 筆，中止（沒有寫入任何東西）：`)
  problems.slice(0, 30).forEach((p) => console.error('  ' + p))
  process.exit(1)
}

// ── 轉檔 ───────────────────────────────────────────────────────────────────────
const stat = new Map()   // group → { n, srcBytes, outBytes, skipped }
const bump = (g, k, v) => { const s = stat.get(g) ?? { n: 0, srcBytes: 0, outBytes: 0, skipped: 0 }; s[k] += v; stat.set(g, s) }
let done = 0
async function run(t) {
  bump(t.group, 'n', 1)
  bump(t.group, 'srcBytes', fs.statSync(t.src).size)
  if (fs.existsSync(t.dest) && !FORCE) { bump(t.group, 'skipped', 1); bump(t.group, 'outBytes', fs.statSync(t.dest).size); return }
  const buf = await sharp(t.src).webp({ quality: 82 }).toBuffer()
  bump(t.group, 'outBytes', buf.length)
  if (APPLY) {
    fs.mkdirSync(path.dirname(t.dest), { recursive: true })
    fs.writeFileSync(t.dest, buf)
  }
  if (++done % 100 === 0) process.stdout.write(`  …${done}/${tasks.length}\n`)
}
const queue = [...tasks]
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await run(queue.shift()) }))

// ── 報告 ───────────────────────────────────────────────────────────────────────
const MB = (b) => (b / 1048576).toFixed(1)
const rowsOut = [...stat].sort().map(([g, s]) => `| ${g} | ${s.n} | ${s.skipped} | ${MB(s.srcBytes)} | ${MB(s.outBytes)} |`)
const tot = [...stat.values()].reduce((a, s) => ({ n: a.n + s.n, skipped: a.skipped + s.skipped, srcBytes: a.srcBytes + s.srcBytes, outBytes: a.outBytes + s.outBytes }), { n: 0, skipped: 0, srcBytes: 0, outBytes: 0 })
const title = MODE === 'v3' ? `v3 整批・${TIER}` : MODE === 'pilot' ? `新機師 ${args.id}` : `新機甲 wap${args.wap}`
const report = [
  `# PLAN-054 官方原檔匯入${APPLY ? '' : '（dry-run）'}：${title}`, '',
  `- 時間：${new Date().toISOString()}`,
  `- 來源：${SRC}`,
  `- 落點：${destRoot}${TIER === 'core' ? '（進版控、部署）' : '（repo 外封存，不進 git、不部署）'}`,
  `- 檔數：${tot.n}（已存在略過 ${tot.skipped}）　來源 PNG ${MB(tot.srcBytes)} MB → WebP ${MB(tot.outBytes)} MB`, '',
  '| 組 | 檔數 | 已存在 | PNG MB | WebP MB |', '|---|---:|---:|---:|---:|', ...rowsOut, '',
  ...(notes.length ? ['## 備註', '', ...notes.map((n) => `- ${n}`), ''] : []),
].join('\n')
console.log(report)
if (MODE === 'v3') {
  const out = path.join(ROOT, `_local-notes/2026-10/2026-10-04_PLAN-054_B_匯入報告_${TIER}${APPLY ? '' : '_dry-run'}.md`)
  fs.writeFileSync(out, report + '\n')
  console.log(`📝 報告：${path.relative(ROOT, out)}`)
}
if (!APPLY) console.log('（dry-run：沒有寫入。確認後加 --apply）')
