#!/usr/bin/env node
/**
 * 官方原檔匯入（PLAN-054 B-1／B-2／B-3）——陸版客戶端擷取的 PNG → WebP，以官方檔名放進 ID 資料夾。
 *
 *   node scripts/import-game-assets.mjs                                         v3 整批・core（預設 dry-run）
 *   node scripts/import-game-assets.mjs --tier=extended                         v3 整批・extended → 封存夾（repo 外）
 *   node scripts/import-game-assets.mjs --tier=reserve                          站上沒有的實體（NPC／敵方機甲／對不到的英文名鍵）→ 封存夾
 *   node scripts/import-game-assets.mjs --id=10103174 --art-key=Pilot_10103174A 新機師：依命名規則從圖片索引.csv 找 core 四種圖
 *   node scripts/import-game-assets.mjs --wap=3062                              新機甲：立繪／部件 1~4／全身大圖
 *   node scripts/import-game-assets.mjs --icons                                 圖示圖庫（PLAN-055）：技能類＋BUFF 字形 → game/icons/
 *
 * ── --icons（PLAN-055 A-2）────────────────────────────────────────────────
 *   來源取聯集：擷取的 uiicons/skilltype_abs（Texture2D）＋ bufftype_abs 的 Icon_buff_*／Icon_debuff_*（Sprite），
 *   再補上站上舊夾（skills／modules／components／backpacks_skills／pilot_forms）裡「擷取沒有的官方檔名」——
 *   多半是官方 CDN 的舊版圖示，仍有資料在用，博物館原則不丟。中文佔位檔名不收（DB 遷移時換成官方 key）。
 *   兩邊都有的同名圖以擷取為準；像素不同的列進報告給站長看（不中止）。
 *   落點 public/images/game/icons/{skill,buff}/<官方檔名>.webp，WebP **lossless**（128px 平塗圖示實測比 q82 還小）；
 *   站上舊夾本來就是 .webp 的直接複製、不重壓。之後有新擷取時跑同一個指令，只會補新的 key。
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
import { iconFamily, isLibraryKey, keyFromValue } from './lib/gameIconKinds.mjs'

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
const MODE = args.icons ? 'icons' : args.id ? 'pilot' : args.wap ? 'mech' : 'v3'
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
  const [iType, iName, iW, iH, iPath, iSha, iAsset] = ['type', 'name', 'width', 'height', 'path', 'sha256', 'asset_path'].map(col)
  const rows = []
  for (const line of lines) {
    if (!line) continue
    const c = line.split(',')   // 索引欄位不含逗號（檔名與路徑都是 ASCII／中文分類名，無引號）
    rows.push({ type: c[iType], name: c[iName], w: +c[iW], h: +c[iH], path: c[iPath], sha: c[iSha], asset: c[iAsset] })
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

function addTask(srcRel, destDir, name, label, group, absSrc) {
  tasks.push({ src: absSrc ?? path.join(SRC, srcRel), dest: path.join(destRoot, destDir, `${name}.webp`), label, group, name })
}

// ── --icons 用：站上舊夾裡的圖示檔 ─────────────────────────────────────────────────
const LEGACY_ICON_DIRS = ['skills', 'modules', 'components', 'backpacks_skills', 'pilot_forms']
/** 站上舊夾 → { byKey: Map<官方檔名, 絕對路徑[]>, nonKey: 相對路徑[] }；元件外框與關卡 BOSS 圖不是圖示，略過 */
function scanLegacyIcons() {
  const byKey = new Map(), nonKey = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!/^(OuterFrame|Stage\d+_Boss)$/.test(e.name)) walk(p); continue }
      if (!/\.(png|webp)$/i.test(e.name)) continue
      const key = keyFromValue(e.name)
      if (!isLibraryKey(key)) { nonKey.push(path.relative(ROOT, p).split(path.sep).join('/')); continue }
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(p)
    }
  }
  for (const d of LEGACY_ICON_DIRS) walk(path.join(ROOT, 'public/images', d))
  return { byKey, nonKey }
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
/** 兩張圖的平均像素差（0–255；64×64、透明處墊黑）——判斷「同名但畫面不同」 */
async function pixelDiff(a, b) {
  const raw = (p) => sharp(p).resize(64, 64, { fit: 'fill' }).flatten({ background: '#000' }).removeAlpha().raw().toBuffer()
  const [x, y] = await Promise.all([raw(a), raw(b)])
  let s = 0
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i])
  return s / x.length
}
/**
 * 「是不是同一張圖」的特徵：32×32、透明處墊黑，灰階＋RGB 兩組（與 10-01 盤點對佔位圖的方法相同）。
 * 距離＝灰階平均差＋RGB 平均差。2026-10-05 實測：舊編號的官方圖對到現行編號時 < 6（同圖，只差渲染），
 * 6～14 多半是「同設計重繪」，14 以上開始出現換色的變體（紫框 vs 紅框）——那是不同的圖。
 */
async function iconFeature(p) {
  // 先統一成 128²，再自己「墊黑＋4×4 區塊平均」縮到 32²——不用 sharp 的縮圖核心，
  // 它對半透明邊緣的處理會把同一張圖的 lossy WebP 與 PNG 拉開到誤判（實測 5302.webp 對 5314：7.1 vs 1.5）
  const { data } = await sharp(p).ensureAlpha().resize(128, 128, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const rgb = new Float32Array(3072), gray = new Float32Array(1024)
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4, a = data[i + 3] / 255, o = ((y >> 2) * 32 + (x >> 2)) * 3
      rgb[o] += data[i] * a / 16; rgb[o + 1] += data[i + 1] * a / 16; rgb[o + 2] += data[i + 2] * a / 16
    }
  }
  for (let i = 0; i < 1024; i++) gray[i] = (rgb[i * 3] * 299 + rgb[i * 3 + 1] * 587 + rgb[i * 3 + 2] * 114) / 1000
  return { rgb, gray }
}
function featureDistance(a, b) {
  let g = 0, c = 0
  for (let i = 0; i < 1024; i++) g += Math.abs(a.gray[i] - b.gray[i])
  for (let i = 0; i < 3072; i++) c += Math.abs(a.rgb[i] - b.rgb[i])
  return g / 1024 + c / 3072
}
/** 舊編號 → 現行編號的門檻：只收「幾乎逐像素相同」的；同設計重繪、換色變體都當成不同的圖保留 */
const ALIAS_MAX_DISTANCE = 6
const iconReport = { fromDump: 0, dumpOnly: [], legacy: [], diffs: [], nonKey: [], siteCopies: 0, aliases: {} }

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
} else if (MODE === 'icons') {
  const rows = loadCsv()
  // 擷取：技能類整夾（Texture2D）＋ BUFF 字形（只有 Sprite——它們住在一張圖集裡）
  const fromDump = new Map()   // key → row
  const pools = [
    rows.filter((r) => r.asset?.includes('/uiicons/skilltype_abs') && r.type === 'Texture2D'),
    rows.filter((r) => r.asset?.includes('/uiicons/bufftype_abs') && r.type === 'Sprite' && /^Icon_(de)?buff_/.test(r.name)),
    // 神經驅動分區圖示（α／β／γ…）：住在晶片圖集旁，但 pilots.neuralDrive[].icon 引用了 1,190 處
    rows.filter((r) => r.asset?.includes('/uiicons/itemchips_abs') && r.type === 'Texture2D' && /^Icon_zoneskill_/.test(r.name)),
  ]
  for (const pool of pools) {
    const names = new Set(pool.map((r) => r.name))
    for (const name of names) {
      if (!isLibraryKey(name)) { notes.push(`擷取裡的 ${name} 不符合圖庫命名規則，略過`); continue }
      const pick = pickRow(pool, name)
      if (pick.conflict) { problems.push(`${name}：擷取內同名但內容不同 ${pick.conflict.join(' ／ ')}`); continue }
      fromDump.set(name, pick.row)
    }
  }
  const { byKey: site, nonKey } = scanLegacyIcons()
  iconReport.nonKey = nonKey
  // 擷取技能類圖示的特徵（用來判斷站上的舊圖是不是「同一張圖、舊編號」）
  const feats = new Map()
  const skillKeys = [...fromDump.keys()].filter((k) => iconFamily(k) === 'skill')
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (skillKeys.length) { const k = skillKeys.shift(); feats.set(k, await iconFeature(path.join(SRC, fromDump.get(k).path))) }
  }))
  const nearest = (f) => {
    let key, d = Infinity
    for (const [k, g] of feats) { const x = featureDistance(f, g); if (x < d) { d = x; key = k } }
    return { key, d }
  }
  for (const [key, files] of site) {
    iconReport.siteCopies += files.length
    if (fromDump.has(key)) continue
    // 擷取沒有的舊圖：同名多份必須位元組相同（2026-10-04 實測 391 組全相同），否則不猜
    const shas = new Set(files.map(sha))
    if (shas.size > 1) { problems.push(`${key}：站上同名但內容不同 ${files.map((f) => path.relative(ROOT, f)).join(' ／ ')}`); continue }
    const src = files.find((f) => f.endsWith('.png')) ?? files[0]
    // 跟擷取裡某張圖幾乎逐像素相同 → 是官方改過編號的同一張圖（或站上猜錯編號），記成別名、不另存一份
    const nn = nearest(await iconFeature(src))
    if (nn.d < ALIAS_MAX_DISTANCE) { iconReport.aliases[key] = nn.key; continue }
    addTask(null, `icons/${iconFamily(key)}`, key, '站上舊圖', 'icon-legacy', src)
    iconReport.legacy.push(key)
  }
  for (const [key, row] of fromDump) {
    addTask(row.path, `icons/${iconFamily(key)}`, key, '擷取', `icon-${iconFamily(key)}`)
    iconReport.fromDump++
    if (!site.has(key)) iconReport.dumpOnly.push(key)
  }
  // 兩邊都有：以擷取為準，畫面不同的列出來
  const both = [...fromDump.keys()].filter((k) => site.has(k))
  const q = [...both]
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const key = q.shift()
      const d = await pixelDiff(path.join(SRC, fromDump.get(key).path), site.get(key)[0])
      if (d < 6) continue
      // 站上這張其實是別的官方圖（猜錯編號）→ 找出它真正的編號，交給 DB 修正（PLAN-055 C）
      const nn = nearest(await iconFeature(site.get(key)[0]))
      iconReport.diffs.push({
        key, d: Math.round(d * 10) / 10, site: path.relative(ROOT, site.get(key)[0]).split(path.sep).join('/'),
        actual: nn.d < ALIAS_MAX_DISTANCE ? nn.key : undefined,
      })
    }
  }))
  iconReport.diffs.sort((a, b) => b.d - a.d)
  iconReport.both = both.length
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
  // 圖示（PLAN-055）：128px 平塗圖 lossless 比 q82 還小；本來就是 .webp 的舊圖直接複製、不重壓
  const buf = !t.group.startsWith('icon-') ? await sharp(t.src).webp({ quality: 82 }).toBuffer()
    : t.src.endsWith('.webp') ? fs.readFileSync(t.src)
    : await sharp(t.src).webp({ lossless: true, effort: 6 }).toBuffer()
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
const title = MODE === 'v3' ? `v3 整批・${TIER}` : MODE === 'pilot' ? `新機師 ${args.id}` : MODE === 'icons' ? '圖示圖庫' : `新機甲 wap${args.wap}`
const iconSection = MODE !== 'icons' ? [] : [
  '## 圖示圖庫（PLAN-055）', '',
  `- 擷取：${iconReport.fromDump}（其中站上沒有的 ${iconReport.dumpOnly.length}，見計畫書決策三）`,
  `- 站上舊圖（擷取沒有的官方檔名，索引標 legacy）：${iconReport.legacy.length}`,
  `- 舊編號別名（跟擷取裡某張圖幾乎逐像素相同，不另存，寫進 src/data/gameIconAliases.ts）：${Object.keys(iconReport.aliases).length}`,
  `- 站上舊夾的圖示檔共 ${iconReport.siteCopies} 個（同一張圖散在多個資料夾的副本都算）；兩邊都有的 ${iconReport.both} 張以擷取為準`,
  `- 同名但畫面不同（平均像素差 ≥ 6）：${iconReport.diffs.length}——站上那張是猜錯編號的圖，資料要改指向「其實是」那張（PLAN-055 C）`,
  ...iconReport.diffs.map((d) => `  - \`${d.key}\` 差 ${d.d}　站上：\`${d.site}\`　其實是：${d.actual ? `\`${d.actual}\`` : '（擷取裡找不到）'}`),
  `- 不收的站上檔（不是官方檔名，多半是中文佔位）：${iconReport.nonKey.length}`,
  ...iconReport.nonKey.map((f) => `  - \`${f}\``), '',
  '<details><summary>擷取有、站上沒有的 key</summary>', '', iconReport.dumpOnly.sort().join('、'), '', '</details>', '',
  '<details><summary>舊編號別名</summary>', '',
  ...Object.entries(iconReport.aliases).sort().map(([a, b]) => `- \`${a}\` → \`${b}\``), '', '</details>', '',
]
if (MODE === 'icons' && APPLY) {
  // 別名表：前台 gameIconPath() 用它把舊編號解析到現行編號（DB 與爬蟲原始快照裡還有舊編號）
  const entries = Object.entries(iconReport.aliases).sort(([a], [b]) => a.localeCompare(b))
  const ts = [
    '// ⚠ 自動產生，請勿手動編輯 —— node scripts/import-game-assets.mjs --icons --apply（PLAN-055 A-2）',
    '//',
    '// 舊編號 → 現行編號：站上舊資料夾裡有一批官方圖示，掛的是官方重新編號前的舊編號',
    '// （例：Icon_skill_main_1043 現在叫 Icon_skill_main_1141），畫面跟擷取裡的現行圖幾乎逐像素相同。',
    '// 圖庫只存現行編號那一份；DB 與爬蟲原始快照裡的舊編號靠這張表解析，不必另存一份。',
    `// 判定：32×32 特徵距離 < ${ALIAS_MAX_DISTANCE}（同設計重繪、換色變體都不算，照常以舊編號收進圖庫）。`,
    '',
    'export const GAME_ICON_ALIASES: Record<string, string> = {',
    ...entries.map(([a, b]) => `  ${a}: '${b}',`),
    '}',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(ROOT, 'src/data/gameIconAliases.ts'), ts)
  // 腳本用（Node 20 不能 import .ts）：別名＋哪些是「現行客戶端已沒有」的舊圖（索引標 legacy，選圖器預設收起）
  const meta = { generatedBy: 'scripts/import-game-assets.mjs --icons --apply', aliases: Object.fromEntries(entries), legacy: [...iconReport.legacy].sort() }
  fs.writeFileSync(path.join(ROOT, 'scripts/lib/gameIconMeta.json'), JSON.stringify(meta, null, 1) + '\n')
}
const report = [
  `# ${MODE === 'icons' ? 'PLAN-055' : 'PLAN-054'} 官方原檔匯入${APPLY ? '' : '（dry-run）'}：${title}`, '',
  `- 時間：${new Date().toISOString()}`,
  `- 來源：${SRC}`,
  `- 落點：${destRoot}${TIER === 'core' ? '（進版控、部署）' : '（repo 外封存，不進 git、不部署）'}`,
  `- 檔數：${tot.n}（已存在略過 ${tot.skipped}）　來源 PNG ${MB(tot.srcBytes)} MB → WebP ${MB(tot.outBytes)} MB`, '',
  '| 組 | 檔數 | 已存在 | PNG MB | WebP MB |', '|---|---:|---:|---:|---:|', ...rowsOut, '',
  ...iconSection,
  ...(notes.length ? ['## 備註', '', ...notes.map((n) => `- ${n}`), ''] : []),
].join('\n')
console.log(MODE === 'icons' ? report.split('<details>')[0] : report)
if (MODE === 'icons') {
  const out = path.join(ROOT, `_local-notes/2026-10/2026-10-05_PLAN-055_A-3_匯入報告${APPLY ? '' : '_dry-run'}.md`)
  fs.writeFileSync(out, report + '\n')
  console.log(`📝 報告：${path.relative(ROOT, out)}`)
}
if (MODE === 'v3') {
  const out = path.join(ROOT, `_local-notes/2026-10/2026-10-04_PLAN-054_B_匯入報告_${TIER}${APPLY ? '' : '_dry-run'}.md`)
  fs.writeFileSync(out, report + '\n')
  console.log(`📝 報告：${path.relative(ROOT, out)}`)
}
if (!APPLY) console.log('（dry-run：沒有寫入。確認後加 --apply）')
