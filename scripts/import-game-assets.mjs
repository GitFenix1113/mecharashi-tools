#!/usr/bin/env node
/**
 * 官方原檔匯入（PLAN-054 B-1／B-2／B-3）——陸版客戶端擷取的 PNG → WebP，以官方檔名放進 ID 資料夾。
 *
 *   node scripts/import-game-assets.mjs                                         v3 整批・core（預設 dry-run）
 *   node scripts/import-game-assets.mjs --tier=extended                         v3 整批・extended → 封存夾（repo 外）
 *   node scripts/import-game-assets.mjs --tier=reserve                          站上沒有的實體（NPC／敵方機甲／對不到的英文名鍵）→ 封存夾
 *   node scripts/import-game-assets.mjs --id=10103174 --art-key=Pilot_10103174A 新機師：依命名規則從圖片索引.csv 找 core 四種圖
 *   node scripts/import-game-assets.mjs --wap=3062                              新機甲：立繪／部件 1~4／全身大圖
 *   node scripts/import-game-assets.mjs --npc                                   NPC 圖庫：還沒對應到可抽機師的官方立繪 → game/npc/（上站）
 *   node scripts/import-game-assets.mjs --icons                                 圖示圖庫（PLAN-055）：技能類＋BUFF 字形 → game/icons/
 *   node scripts/import-game-assets.mjs --equip-icons                           武器／背包圖示（PLAN-056）→ game/icons/{weapon,backpack}/
 *   node scripts/import-game-assets.mjs --ui                                    介面美術（活動、招募、大廳…）→ 封存夾 game/ui/（repo 外）
 *   node scripts/import-game-assets.mjs --other-icons                           其他圖示（道具、勳章、肉鴿、車輛…）→ 封存夾 game/icons/（repo 外）
 *   node scripts/import-game-assets.mjs --skins                                 可抽機師的其他造型 → 封存夾 game/pilots/<gameId>/（repo 外）
 *   node scripts/import-game-assets.mjs --promote=activity/uiactivity/ob6       封存夾裡挑好的介面美術 → public/images/game/ui/（上架、會公開）
 *
 * 新擷取先跑 `node scripts/diff-game-dump.mjs` 看這一版多了什麼，報告會列出該跑哪幾個模式。
 *
 * ── --npc（2026-10-12）──────────────────────────────────────────────────────
 *   擷取裡所有 `Pilot_<號碼><造型>_{half,head,Raw}`，**扣掉可抽機師**（game/pilots/ 裡的立繪鍵號碼，連同他們的外觀）
 *   → public/images/game/npc/<號碼>/<官方檔名>.webp（q82，同 core）。劇情 NPC、尚未上線的新角色都在這裡。
 *   用途：NPC 轉正的機師（維娜、索妮婭…）官方不一定出新立繪，沿用的是 NPC 時期那張——
 *   管理員在後台「選取官方立繪」的 NPC 分組直接點，立繪鍵（artKey）指過去就好，不必等站長匯入、也不必等機師卡。
 *   站長 2026-10-12 決定上站（取代 10-04「NPC 不進 repo」）：查資料的人不怕劇透，而官方之後還會有好幾位 NPC 轉正。
 *   每次新擷取都跑一次（--src=latest），只會補新的；已存在的不重轉（--force 例外）。建議第一次先 --src=Data 再 --src=latest。
 *   NPC 之後轉正、用 --id 匯入 core 時，NPC 圖庫那份會留著（DB 的 portrait 可能還指著它）；選圖器會自動去重。
 *   --apply 時另寫 scripts/lib/npcArtMeta.json：每個號碼的英文名（3D 模型資料夾 pilot/pilotbNN_abs/<號碼>/pilot_<英文>.png）
 *   與有沒有外觀卡（Icon_pilotSkin_<號碼>*），只增不減。選圖器拿英文名搜尋／顯示——新機師公布英文名就找得到 NPC 時期的立繪。
 *   「這套其實是哪位可抽機師的另一造型」機器判斷不了，人工登記在 scripts/lib/npcArtNotes.json。
 *
 * ── --ui（2026-10-11）───────────────────────────────────────────────────────
 *   活動、招募、大廳、劇情背景、常駐玩法、造型的美術圖，照官方模組結構封存：
 *     <archive>/game/ui/<用途>/<官方模組>/<子資料夾…>/<官方檔名>.webp
 *   用途與「什麼算美術圖」的規則在 scripts/lib/gameUiModules.mjs（字典＋過濾）；系統介面零件與簡中文字圖不收。
 *   **不進 git、不部署**（同 extended：陸版比台版快，進 repo 就等於公開還沒上線的活動）。之後要上站的，再挑出來放進 public/。
 *   會一併產生 ui/README.md（每個模組是什麼、幾張）與 ui/_index.json（每張的官方路徑、尺寸、sha256、第一次出現在哪次擷取）。
 *   改了字典的用途分類，重跑 --apply 會把既有檔搬到新的用途資料夾；字典不再收的檔只列出來、不刪。
 *   WebP q82（同 core）。建議順序：先 --src=Data 再 --src=latest，兩次擷取的聯集都會留著（museum 原則）。
 *
 * ── --other-icons（2026-10-12）────────────────────────────────────────────────
 *   客戶端 uiicons/ 底下、其他模式都不收的圖示，照官方資料夾封存：<archive>/game/icons/<官方資料夾>/<官方檔名>.webp
 *   （規則：scripts/lib/gameIconKinds.mjs 的 otherIconPaths——--icons、--equip-icons、機甲 core 與機師卡收的不重複存）。
 *   道具、勳章、肉鴿、敵方車輛、塗裝色、機師外觀卡、機甲塗裝小圖……站上目前用不到，但博物館原則先留著。
 *   **不進 git、不部署**；會一併產生 icons/README.md 與 icons/_index.json（同 --ui）。WebP q82。
 *   建議順序同 --ui：先 --src=Data 再 --src=latest，兩次擷取的聯集都會留著。
 *
 * ── --skins（2026-10-12）──────────────────────────────────────────────────────
 *   可抽機師（public/images/game/pilots/ 裡有的立繪號碼）的其他造型 `Pilot_<號碼><造型>_{half,head,Raw}`
 *   → <archive>/game/pilots/<gameId>/（與 v3 extended 同一個位置）。站上讀取端只用預設造型，所以不進 repo。
 *   不是可抽機師的號碼歸 --npc（上站），這裡不收。外觀卡 Icon_pilotSkin_* 在 --other-icons（icons/itemtype/）。
 *
 * ── --promote（2026-10-11）──────────────────────────────────────────────────
 *   決定用途後，把封存夾裡挑好的圖「上架」：<archive>/game/ui/<路徑> → public/images/game/ui/<同一路徑>。
 *   路徑相對封存夾的 ui/，可以是單一檔（.webp 可省略）或整個資料夾；多個用逗號隔開。
 *   原樣複製（已經是 q82 WebP，不重壓）；已存在就跳過（--force 覆寫）。
 *   ⚠ 上架＝部署後任何人都看得到：只挑台版已經上線的。之後 npm run dev／build 會把它們掃進後台圖片挑選器的 manifest。
 *
 * ── --icons（PLAN-055 A-2）────────────────────────────────────────────────
 *   來源取聯集：擷取的 uiicons/skilltype_abs（Texture2D）＋ bufftype_abs 的 Icon_buff_*／Icon_debuff_*（Sprite），
 *   再補上站上舊夾（skills／modules／components／backpacks_skills／pilot_forms）裡「擷取沒有的官方檔名」——
 *   多半是官方 CDN 的舊版圖示，仍有資料在用，博物館原則不丟。中文佔位檔名不收（DB 遷移時換成官方 key）。
 *   兩邊都有的同名圖以擷取為準；像素不同的列進報告給站長看（不中止）。
 *   落點 public/images/game/icons/{skill,buff}/<官方檔名>.webp，WebP **lossless**（128px 平塗圖示實測比 q82 還小）；
 *   站上舊夾本來就是 .webp 的直接複製、不重壓。之後有新擷取時跑同一個指令，只會補新的 key。
 *   ⚠ PLAN-055 E-1（2026-10-11）已刪掉這些舊夾：之後「站上舊夾」那一側永遠是空的，舊編號別名與 legacy 清單
 *   改以已存的 scripts/lib/gameIconMeta.json 為準、只增不減（見下方「以已存的為準」那段）。
 *
 * ── --equip-icons（PLAN-056 A-1）─────────────────────────────────────────
 *   擷取的 uiicons/wapweapons_abs、wapbackpack_abs **整夾全收**（站長 2026-10-09：資料多只有好處——
 *   含 400x 敵方 BOSS 裝備、9 開頭的機甲綁定肩部、_b 外型變化）。每個名稱有 340² 原圖（Texture2D）與去邊 Sprite 兩份，取前者。
 *   WebP **q82**（不是 lossless：武器是 3D 渲染圖，lossless 會大好幾倍）。站上舊夾 weapons／backpacks 只拿來比對、不收：
 *   中文佔位與猜錯的編號（20400502、10200402）不進圖庫，資料改指向正確的官方 gameId。
 *   --apply 時另寫檔名大小寫例外表（src/data/equipIconKeyCase.ts ＋ scripts/lib/equipIconKeyCase.json）。
 * 共用旗標：--apply（真的寫檔；預設只報告）、--force（已存在也重轉）、--only=<gameId|wap>（v3 模式只做一個）、
 *           --src=<擷取>（預設 E:/Mecharashi_Data/Data；可給 latest、previous、擷取根目錄下的資料夾名或完整路徑。
 *                        v3 模式一定要用 Data——v3 定版記的是那次擷取的檔案路徑）、
 *           --archive=<封存夾>（預設 E:/Mecharashi_Data/site-archive）
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
import { GAME_DIR, MECH_KINDS, NPC_ART_RE, PILOT_KINDS, TIER_GROUPS, classifyNpcFile, mechFileName, npcDirOf, pilotFileName, playableArtDirs } from './lib/gameAssetKinds.mjs'
import { EQUIP_POOLS, ICON_POOLS, OTHER_ICON_FOLDERS, equipGameIdOf, iconFamily, iconPoolIndex, isLibraryKey, keyFromValue, otherIconPaths } from './lib/gameIconKinds.mjs'
import { ARCHIVE_ROOT, PIXEL_DIFF_SAME, loadDumpIndex, localDate, pixelDiff, resolveDump } from './lib/gameDump.mjs'
import { UI_GROUPS, uiArchivePath, uiModuleInfo } from './lib/gameUiModules.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (!m) { console.error(`❌ 看不懂的參數：${a}`); process.exit(1) }
  return [m[1], m[2] ?? true]
}))
const MODE = args.promote ? 'promote' : args.icons ? 'icons' : args['equip-icons'] ? 'equip' : args.ui ? 'ui'
  : args['other-icons'] ? 'other' : args.skins ? 'skins' : args.npc ? 'npc' : args.id ? 'pilot' : args.wap ? 'mech' : 'v3'
const TIER = MODE === 'v3' ? String(args.tier ?? 'core') : 'core'
let SRC = ''   // --promote 讀的是封存夾、不讀擷取
if (MODE !== 'promote') {
  try { SRC = resolveDump(String(args.src ?? 'E:/Mecharashi_Data/Data')).dir } catch (e) { fail(`${e.message}（用 --src 指定）`) }
}
/** 擷取的識別碼＝資料夾名（Data／一般圖片_<版本碼>）；--ui／--other-icons 的 _index.json 用它記「第一次出現在哪次擷取」 */
const DUMP_ID = path.basename(SRC)
const ARCHIVE = path.resolve(String(args.archive ?? ARCHIVE_ROOT))
const V3 = path.join(ROOT, '_local-notes/2026-10/2026-10-03_機師機甲圖片資源mapping_v3_final.json')
const PUBLIC_GAME = path.join(ROOT, 'public', GAME_DIR)
const APPLY = !!args.apply
const FORCE = !!args.force
/** 寫到 repo 外的封存夾（extended／reserve／--ui／--other-icons／--skins），其餘寫進 public/ */
const TO_ARCHIVE = TIER !== 'core' || ['ui', 'other', 'skins'].includes(MODE)

if (!['core', 'extended', 'reserve'].includes(TIER)) fail(`--tier 只能是 core／extended／reserve：${TIER}`)
if (TO_ARCHIVE && isInside(ARCHIVE, ROOT)) {
  fail(`--archive 在 repo 裡面（${ARCHIVE}）——extended／reserve／ui／其他圖示／造型不能進 repo（站長 2026-10-04 定案 A）`)
}
if (MODE === 'v3' && DUMP_ID !== 'Data') fail(`v3 模式只能用 --src=Data（v3 定版記的是那次擷取的檔案路徑），收到 ${SRC}`)

function fail(msg) { console.error(`❌ ${msg}`); process.exit(1) }
function isInside(p, dir) { const r = path.relative(dir, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r) || r === '' }
const destRoot = TO_ARCHIVE ? path.join(ARCHIVE, 'game') : PUBLIC_GAME

// ── 圖片索引.csv（新實體模式、圖示、reserve、ui 才需要）────────────────────────────
// 新版擷取工具會替含逗號的欄位加引號，解析交給 scripts/lib/gameDump.mjs（RFC 4180）
function loadCsv() {
  try {
    return loadDumpIndex(SRC).map((r) => ({ type: r.type, name: r.name, w: r.width, h: r.height, path: r.path, sha: r.sha256, asset: r.asset_path }))
  } catch (e) { fail(e.message) }
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

// ── --icons 用：站上舊夾裡的圖示檔（PLAN-055 E-1 起已刪，掃到的是空集合；留著供從舊備份還原時用）──
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
// 「同名但畫面不同」的平均像素差 pixelDiff 與門檻 PIXEL_DIFF_SAME 在 scripts/lib/gameDump.mjs（diff-game-dump 共用）
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
const equipReport = { weapon: [], backpack: [], siteOnly: [], diffs: [], same: 0, keyCase: {} }
const UI_ROOT = path.join(destRoot, 'ui')
const ICON_META_FILE = path.join(ROOT, 'scripts/lib/gameIconMeta.json')
const uiReport = { rows: new Map(), conflicts: [], moves: [], notInDump: 0 }
const ICONS_ARCHIVE = path.join(destRoot, 'icons')
const otherReport = { rows: new Map(), conflicts: [] }
const skinReport = { fresh: new Set(), npcSkipped: 0 }
const npcReport = { en: new Map(), skinCard: new Set() }
const NPC_META_FILE = path.join(ROOT, 'scripts/lib/npcArtMeta.json')

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
  // 擷取：收哪些資料夾見 ICON_POOLS（技能類整夾＋BUFF 字形＋神經驅動分區圖示；diff-game-dump 共用同一份）
  const fromDump = new Map()   // key → row
  const pools = ICON_POOLS.map((_, i) => rows.filter((r) => iconPoolIndex(r.asset, r.type, r.name) === i))
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
      if (d < PIXEL_DIFF_SAME) continue
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

  // ── PLAN-055 E-1：別名表與 legacy 清單「以已存的為準、只增不減」──────────────────────
  // 上面兩份是從站上舊資料夾（LEGACY_ICON_DIRS）重算的；舊夾在 E-1 刪掉之後，重算結果會是空的。
  // 若照舊整份覆寫，下一次有新擷取跑 --apply，就會把別名（2026-10 時 172 筆）與 legacy（82 筆）**靜默清空**——
  // 前台解析不到 DB／爬蟲快照裡的舊編號、選圖器的 legacy 標記消失，而 build 與測試照樣全綠。
  const prevMeta = fs.existsSync(ICON_META_FILE) ? JSON.parse(fs.readFileSync(ICON_META_FILE, 'utf-8')) : { aliases: {}, legacy: [] }
  const prevAliases = prevMeta.aliases ?? {}, prevLegacy = prevMeta.legacy ?? []
  iconReport.aliasesNew = Object.keys(iconReport.aliases).filter((k) => !(k in prevAliases)).length
  iconReport.aliases = { ...prevAliases, ...iconReport.aliases }
  const legacyAll = new Set([...prevLegacy, ...iconReport.legacy])
  // 新擷取裡出現了的 legacy key 就不再是 legacy（官方又用回來了）；圖庫那張還是舊版，報告提醒用 --force 換新
  iconReport.becameCurrent = [...legacyAll].filter((k) => fromDump.has(k)).sort()
  iconReport.legacyMerged = [...legacyAll].filter((k) => !fromDump.has(k)).sort()
  iconReport.legacyNew = iconReport.legacyMerged.filter((k) => !prevLegacy.includes(k)).length
  // 守門：讀取端（gameIconPath）**先套別名**——新擷取若出現某個別名的「舊編號」，那張新圖永遠顯示不出來
  for (const [oldKey, cur] of Object.entries(iconReport.aliases)) {
    if (fromDump.has(oldKey)) {
      problems.push(`${oldKey}：新擷取出現了這個官方編號，但別名表把它導向 ${cur}——讀取端會先套別名，新圖會被蓋掉。` +
        '請人工判斷：新圖若就是舊圖，維持別名並略過；若是不同的圖，從 scripts/lib/gameIconMeta.json 刪掉這筆別名再重跑')
    }
    if (!fromDump.has(cur) && !fs.existsSync(path.join(PUBLIC_GAME, 'icons', iconFamily(cur), `${cur}.webp`))) {
      problems.push(`${oldKey} → ${cur}：別名指向的現行編號既不在擷取、也不在圖庫`)
    }
  }
} else if (MODE === 'equip') {
  const rows = loadCsv()
  const fromDump = new Map()   // key → row
  for (const [family, dir] of EQUIP_POOLS) {
    const pool = rows.filter((r) => r.asset?.includes(dir))
    for (const name of new Set(pool.map((r) => r.name))) {
      if (!isLibraryKey(name) || iconFamily(name) !== family) { notes.push(`擷取裡的 ${name} 不符合 ${family} 命名規則，略過`); continue }
      const pick = pickRow(pool, name)
      if (pick.conflict) { problems.push(`${name}：擷取內同名但內容不同 ${pick.conflict.join(' ／ ')}`); continue }
      if (pick.row.w !== 340 || pick.row.h !== 340) notes.push(`${name}：Texture2D 不是 340²（${pick.row.w}×${pick.row.h}）`)
      fromDump.set(name, pick.row)
      addTask(pick.row.path, `icons/${family}`, name, '擷取', `equip-${family}`)
      equipReport[family].push(name)
      // 大小寫例外：gameId → 檔名的一般式是 Icon_<family>_<gameId>
      const id = equipGameIdOf(name)
      if (name !== `Icon_${family}_${id}`) equipReport.keyCase[`${family}:${id}`] = name
    }
  }
  // 站上舊夾：只比對、不收（擷取是唯一來源）
  for (const dir of ['weapons', 'backpacks']) {
    const abs = path.join(ROOT, 'public/images', dir)
    if (!fs.existsSync(abs)) continue
    for (const file of fs.readdirSync(abs)) {
      if (!/\.(png|webp)$/i.test(file)) continue
      const key = keyFromValue(file)
      if (!fromDump.has(key)) { equipReport.siteOnly.push(`${dir}/${file}`); continue }
      const d = await pixelDiff(path.join(SRC, fromDump.get(key).path), path.join(abs, file))
      if (d >= PIXEL_DIFF_SAME) equipReport.diffs.push({ key, d: Math.round(d * 10) / 10, site: `${dir}/${file}` })
      else equipReport.same++
    }
  }
} else if (MODE === 'promote') {
  // 上架：封存夾的介面美術 → public/images/game/ui/<同一個相對路徑>（不讀擷取，原樣複製）
  const archiveUi = path.join(ARCHIVE, 'game', 'ui')
  const walkWebp = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkWebp(path.join(dir, e.name)) : e.name.endsWith('.webp') ? [path.join(dir, e.name)] : [])
  for (const raw of String(args.promote).split(',').map((s) => s.trim()).filter(Boolean)) {
    const rel = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/^ui\//, '')
    const abs = path.resolve(archiveUi, rel)
    if (abs === archiveUi || !isInside(abs, archiveUi)) { problems.push(`${raw}：要指到封存夾 ${archiveUi} 裡的某個檔或子資料夾`); continue }
    const isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory()
    const files = isDir ? walkWebp(abs) : [abs.endsWith('.webp') ? abs : `${abs}.webp`]
    if (isDir && !files.length) notes.push(`${raw}：資料夾裡沒有 .webp`)
    for (const f of files) {
      if (!fs.existsSync(f)) { problems.push(`${raw}：封存夾裡沒有 ${path.relative(archiveUi, f)}`); continue }
      const r = path.relative(archiveUi, f).split(path.sep).join('/')
      addTask(null, `ui/${path.posix.dirname(r)}`, path.posix.basename(r, '.webp'), '上架', 'promote', f)
    }
  }
  if (!tasks.length && !problems.length) problems.push('--promote 沒有挑到任何圖')
} else if (MODE === 'ui') {
  // 介面美術封存：落點與「什麼算美術圖」都由 uiArchivePath 決定（scripts/lib/gameUiModules.mjs）
  const byDest = new Map()   // 相對 game/ 的路徑（不含副檔名）→ 擷取列
  for (const r of loadCsv()) {
    const rel = uiArchivePath({ name: r.name, width: r.w, height: r.h, asset_path: r.asset })
    if (rel) (byDest.get(rel) ?? byDest.set(rel, []).get(rel)).push(r)
  }
  for (const [rel, rs] of byDest) {
    const tex = rs.filter((r) => r.type === 'Texture2D')
    const pool = tex.length ? tex : rs
    // 同模組同名、內容不同（2026-10-11 兩次擷取都是 0 筆）：取面積大的，報告列出來
    if (new Set(pool.map((r) => r.sha)).size > 1) uiReport.conflicts.push(rel)
    const best = pool.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
    addTask(best.path, path.posix.dirname(rel), best.name, '介面美術', `ui-${rel.split('/')[1]}`)
    uiReport.rows.set(`${rel}.webp`, best)
  }
  // 字典改了用途 → 既有檔還在舊的用途資料夾：--apply 時搬過去（同一張圖，不重轉）
  const tail = (abs) => path.relative(UI_ROOT, abs).split(path.sep).slice(1).join('/')   // 去掉用途那一層
  const existing = new Map()
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.webp')) existing.set(tail(p), p)
    }
  }
  walk(UI_ROOT)
  const wanted = new Set(tasks.map((t) => tail(t.dest)))
  for (const t of tasks) {
    const old = existing.get(tail(t.dest))
    if (old && old !== t.dest && !fs.existsSync(t.dest)) uiReport.moves.push([old, t.dest])
  }
  // 封存夾裡有、這次擷取沒有的：舊擷取才有的圖，或字典不再收的模組——博物館原則，不刪，只列數量
  uiReport.notInDump = [...existing.keys()].filter((k) => !wanted.has(k)).length
} else if (MODE === 'other') {
  // 其他圖示封存：哪些算「其他」由 otherIconPaths 決定（scripts/lib/gameIconKinds.mjs）
  const rows = loadCsv()
  for (const [rel, rs] of otherIconPaths(rows.map((r) => ({ ...r, asset_path: r.asset })))) {
    const tex = rs.filter((r) => r.type === 'Texture2D')
    const pool = tex.length ? tex : rs
    // 同資料夾同名、內容不同：取面積大的，報告列出來（同 --ui）
    if (new Set(pool.map((r) => r.sha)).size > 1) otherReport.conflicts.push(rel)
    const best = pool.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
    addTask(best.path, path.posix.dirname(rel), best.name, '其他圖示', `other-${rel.split('/')[1]}`)
    otherReport.rows.set(`${rel}.webp`, best)
  }
} else if (MODE === 'skins') {
  // 可抽機師的其他造型：號碼在 game/pilots/ 裡、但這個檔名不在（預設造型已在 core）
  const playable = playableArtDirs(path.join(PUBLIC_GAME, 'pilots'))
  const rows = loadCsv()
  const byName = new Map()
  for (const r of rows) if (NPC_ART_RE.test(r.name)) (byName.get(r.name) ?? byName.set(r.name, []).get(r.name)).push(r)
  for (const [name, rs] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    const gameId = playable.get(npcDirOf(classifyNpcFile(name).key))
    if (!gameId) { skinReport.npcSkipped++; continue }
    if (fs.existsSync(path.join(PUBLIC_GAME, 'pilots', gameId, `${name}.webp`))) continue   // 預設造型，core 已有
    const pick = pickRow(rs, name)
    if (pick.conflict) { problems.push(`${name}：同名 Texture2D 內容不同 ${pick.conflict.join(' ／ ')}`); continue }
    addTask(pick.row.path, `pilots/${gameId}`, name, `機師 ${gameId} 造型`, `skin-${classifyNpcFile(name).kind}`)
    if (!fs.existsSync(tasks.at(-1).dest)) skinReport.fresh.add(`${gameId}（${name.replace(/_(half|head|Raw)$/, '')}）`)
  }
  notes.push(`不是可抽機師的立繪 ${skinReport.npcSkipped} 個檔——歸 --npc（上站的 NPC 圖庫）`)
} else if (MODE === 'npc') {
  // 可抽機師的立繪鍵號碼（game/pilots/<gameId>/ 裡的 <artKey>_*）：他們的預設立繪與外觀都不算 NPC（外觀歸 --skins）
  const playable = playableArtDirs(path.join(PUBLIC_GAME, 'pilots'))
  const rows = loadCsv()
  const byName = new Map()
  for (const r of rows) if (NPC_ART_RE.test(r.name)) (byName.get(r.name) ?? byName.set(r.name, []).get(r.name)).push(r)
  // 英文名與外觀卡（寫進 npcArtMeta.json；見檔頭 --npc 段）
  for (const r of rows) {
    const m = r.asset?.match(/runtimeassets\/pilot\/pilotb\d+_abs\/(\d+)[a-z]?\/pilot_([a-z0-9]+)\.png$/)
    if (m) (npcReport.en.get(m[1]) ?? npcReport.en.set(m[1], new Set()).get(m[1])).add(m[2])
    const k = r.name.match(/^Icon_pilotSkin_(\d+)[A-Z]+$/)
    if (k) npcReport.skinCard.add(k[1])
  }
  const skipped = new Set()
  for (const [name, rs] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    const c = classifyNpcFile(name)
    const dir = npcDirOf(c.key)
    if (playable.has(dir)) { skipped.add(dir); continue }
    const pick = pickRow(rs, name)
    if (pick.conflict) { problems.push(`${name}：同名 Texture2D 內容不同 ${pick.conflict.join(' ／ ')}`); continue }
    addTask(pick.row.path, `npc/${dir}`, name, `NPC ${dir}`, `npc-${c.kind}`)
  }
  notes.push(`可抽機師（含外觀）略過 ${skipped.size} 個號碼——他們在 game/pilots/`)
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
// --ui：字典改了用途的既有檔先搬家（同一張圖，不重轉）；dry-run 時當成「已存在」計
const movedFrom = new Map(uiReport.moves.map(([from, to]) => [to, from]))
if (APPLY) {
  for (const [from, to] of uiReport.moves) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to) }
}
async function run(t) {
  bump(t.group, 'n', 1)
  bump(t.group, 'srcBytes', fs.statSync(t.src).size)
  const have = fs.existsSync(t.dest) ? t.dest : movedFrom.get(t.dest)
  if (have && !FORCE) { bump(t.group, 'skipped', 1); bump(t.group, 'outBytes', fs.statSync(have).size); return }
  // 圖示（PLAN-055）：128px 平塗圖 lossless 比 q82 還小；本來就是 .webp 的（站上舊圖、--promote 的封存檔）直接複製、不重壓
  const isIcon = t.group.startsWith('icon-')
  const buf = (isIcon || t.group === 'promote') && t.src.endsWith('.webp') ? fs.readFileSync(t.src)
    : isIcon ? await sharp(t.src).webp({ lossless: true, effort: 6 }).toBuffer()
    : await sharp(t.src).webp({ quality: 82 }).toBuffer()
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
const title = MODE === 'v3' ? `v3 整批・${TIER}` : MODE === 'pilot' ? `新機師 ${args.id}` : MODE === 'npc' ? 'NPC 圖庫' : MODE === 'icons' ? '圖示圖庫'
  : MODE === 'equip' ? '武器／背包圖示' : MODE === 'ui' ? '介面美術封存' : MODE === 'promote' ? '介面美術上架'
    : MODE === 'other' ? '其他圖示封存' : MODE === 'skins' ? '機師造型封存' : `新機甲 wap${args.wap}`
const iconSection = MODE !== 'icons' ? [] : [
  '## 圖示圖庫（PLAN-055）', '',
  `- 擷取：${iconReport.fromDump}` + (iconReport.siteCopies
    ? `（其中站上舊夾沒有的 ${iconReport.dumpOnly.length}，見計畫書決策三）`
    : '（站上舊夾已於 PLAN-055 E-1 刪除；真正的新圖看上表「檔數－已存在」）'),
  `- legacy（擷取沒有的官方檔名，索引標 legacy）：${iconReport.legacyMerged.length}（沿用已存 ${iconReport.legacyMerged.length - iconReport.legacyNew}、本次新增 ${iconReport.legacyNew}；這次從站上舊夾收到 ${iconReport.legacy.length} 張）`,
  ...(iconReport.becameCurrent.length ? [`- ⚠ legacy 轉為現行（新擷取又出現了；圖庫那張是舊版，要換新請對這幾張加 --force）：${iconReport.becameCurrent.join('、')}`] : []),
  `- 舊編號別名（跟擷取裡某張圖幾乎逐像素相同，不另存，寫進 src/data/gameIconAliases.ts）：${Object.keys(iconReport.aliases).length}（本次新增 ${iconReport.aliasesNew}；PLAN-055 E-1 起只增不減）`,
  `- 站上舊夾的圖示檔共 ${iconReport.siteCopies} 個（同一張圖散在多個資料夾的副本都算）；兩邊都有的 ${iconReport.both} 張以擷取為準`,
  `- 同名但畫面不同（平均像素差 ≥ 6）：${iconReport.diffs.length}——站上那張是猜錯編號的圖，資料要改指向「其實是」那張（PLAN-055 C）`,
  ...iconReport.diffs.map((d) => `  - \`${d.key}\` 差 ${d.d}　站上：\`${d.site}\`　其實是：${d.actual ? `\`${d.actual}\`` : '（擷取裡找不到）'}`),
  `- 不收的站上檔（不是官方檔名，多半是中文佔位）：${iconReport.nonKey.length}`,
  ...iconReport.nonKey.map((f) => `  - \`${f}\``), '',
  '<details><summary>擷取有、站上沒有的 key</summary>', '', iconReport.dumpOnly.sort().join('、'), '', '</details>', '',
  '<details><summary>舊編號別名</summary>', '',
  ...Object.entries(iconReport.aliases).sort().map(([a, b]) => `- \`${a}\` → \`${b}\``), '', '</details>', '',
]
const code = (s) => '`' + s + '`'
const equipSection = MODE !== 'equip' ? [] : [
  '## 武器／背包圖示（PLAN-056）', '',
  `- 擷取：武器 ${equipReport.weapon.length}、背包 ${equipReport.backpack.length}（整夾全收）`,
  `- 站上舊夾與擷取同名且畫面相同（平均像素差 < 6）：${equipReport.same}`,
  `- 站上同名但畫面不同：${equipReport.diffs.length}——站上那張是猜錯編號的圖，資料改指向正確的 gameId（PLAN-056 C-1）`,
  ...equipReport.diffs.map((d) => `  - ${code(d.key)} 差 ${d.d}　站上：${code(d.site)}`),
  `- 站上有、擷取沒有（中文佔位或猜錯的編號，不收）：${equipReport.siteOnly.length}`,
  ...equipReport.siteOnly.map((f) => `  - ${code(f)}`),
  `- 檔名大小寫例外：${Object.keys(equipReport.keyCase).length}`,
  ...Object.entries(equipReport.keyCase).map(([k, v]) => `  - ${code(k)} → ${code(v)}`), '',
]
if (MODE === 'equip' && APPLY) {
  const entries = Object.entries(equipReport.keyCase).sort(([a], [b]) => a.localeCompare(b))
  const ts = [
    '// ⚠ 自動產生，請勿手動編輯 —— node scripts/import-game-assets.mjs --equip-icons --apply（PLAN-056 A-1）',
    '//',
    '// 武器／背包官方檔名的大小寫例外：gameId → 檔名一般是 Icon_<family>_<gameId>，',
    '// 但官方有幾個背包寫成 Icon_BackPack_（大寫）。圖庫照官方檔名逐字存，GitHub Pages 分大小寫，所以要查表。',
    '',
    'export const EQUIP_ICON_KEY_CASE: Record<string, string> = {',
    ...entries.map(([k, v]) => `  '${k}': '${v}',`),
    '}',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(ROOT, 'src/data/equipIconKeyCase.ts'), ts)
  fs.writeFileSync(path.join(ROOT, 'scripts/lib/equipIconKeyCase.json'),
    JSON.stringify({ generatedBy: 'scripts/import-game-assets.mjs --equip-icons --apply', keyCase: Object.fromEntries(entries) }, null, 1) + '\n')
}
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
  // PLAN-055 E-1：別名與 legacy 都是「已存 ∪ 本次」——舊資料夾刪掉後本次重算是空的，不能整份覆寫
  const meta = { generatedBy: 'scripts/import-game-assets.mjs --icons --apply', aliases: Object.fromEntries(entries), legacy: iconReport.legacyMerged }
  fs.writeFileSync(path.join(ROOT, 'scripts/lib/gameIconMeta.json'), JSON.stringify(meta, null, 1) + '\n')
}
const promoteSection = MODE !== 'promote' ? [] : [
  '## 介面美術上架', '',
  '⚠ **上架＝部署後任何人都看得到**。只挑台版已經上線的；陸版先行的活動、角色會劇透。', '',
  ...tasks.map((t) => `- ${code(path.relative(PUBLIC_GAME, t.dest).split(path.sep).join('/'))}${fs.existsSync(t.dest) && !FORCE ? '（已在 public，跳過）' : ''}`), '',
  '下一步：`npm run manifest:images`（或直接 `npm run dev`／`build`）讓後台圖片挑選器看到它們 → 在後台選圖 → 照規則 commit、push。', '',
]
const uiSection = MODE !== 'ui' ? [] : [
  '## 介面美術封存', '',
  `- 落點：${UI_ROOT}／<用途>／<官方模組>／<子資料夾…>／<官方檔名>.webp（用途與過濾規則：scripts/lib/gameUiModules.mjs）`,
  `- 用途分佈：${[...stat].filter(([g]) => g.startsWith('ui-')).map(([g, s]) => `${UI_GROUPS[g.slice(3)]?.zh ?? g} ${s.n}`).join('、')}`,
  `- 字典改了用途、要搬家的既有檔：${uiReport.moves.length}`,
  `- 封存夾裡有、這次擷取沒有的：${uiReport.notInDump}（舊擷取才有的圖，或字典不再收的模組——不刪）`,
  `- 同模組同名、內容不同（取面積大的）：${uiReport.conflicts.length}`, ...uiReport.conflicts.map((r) => `  - ${code(r)}`), '',
]
const otherSection = MODE !== 'other' ? [] : [
  '## 其他圖示封存', '',
  `- 落點：${ICONS_ARCHIVE}／<官方資料夾>／<官方檔名>.webp（哪些算「其他」：scripts/lib/gameIconKinds.mjs 的 otherIconPaths）`,
  '- 資料夾分佈（檔數／已存在）：', '',
  '| 官方資料夾 | 說明 | 檔數 | 已存在 |', '|---|---|---:|---:|',
  ...[...stat].filter(([g]) => g.startsWith('other-')).sort(([, a], [, b]) => b.n - a.n)
    .map(([g, s]) => `| \`${g.slice(6)}\` | ${OTHER_ICON_FOLDERS[g.slice(6)] ?? '（沒登記，照樣收）'} | ${s.n} | ${s.skipped} |`), '',
  `- 同資料夾同名、內容不同（取面積大的）：${otherReport.conflicts.length}`, ...otherReport.conflicts.map((r) => `  - ${code(r)}`), '',
]
const skinSection = MODE !== 'skins' ? [] : [
  '## 機師造型封存', '',
  `- 落點：${path.join(destRoot, 'pilots')}／<gameId>／<官方檔名>.webp（與 v3 extended 同一個位置）`,
  `- 封存夾還沒有的造型：${[...skinReport.fresh].sort().join('、') || '（無）'}`, '',
]
const report = [
  `# ${{ icons: 'PLAN-055 ', equip: 'PLAN-056 ', ui: '', promote: '', other: '', skins: '' }[MODE] ?? 'PLAN-054 '}官方原檔匯入${APPLY ? '' : '（dry-run）'}：${title}`, '',
  `- 時間：${new Date().toISOString()}`,
  `- 來源：${MODE === 'promote' ? path.join(ARCHIVE, 'game', 'ui') : SRC}`,
  `- 落點：${destRoot}${TO_ARCHIVE ? '（repo 外封存，不進 git、不部署）' : '（進版控、部署）'}`,
  `- 檔數：${tot.n}（已存在略過 ${tot.skipped}）　來源 PNG ${MB(tot.srcBytes)} MB → WebP ${MB(tot.outBytes)} MB`, '',
  '| 組 | 檔數 | 已存在 | PNG MB | WebP MB |', '|---|---:|---:|---:|---:|', ...rowsOut, '',
  ...iconSection,
  ...equipSection,
  ...uiSection,
  ...otherSection,
  ...skinSection,
  ...promoteSection,
  ...(notes.length ? ['## 備註', '', ...notes.map((n) => `- ${n}`), ''] : []),
].join('\n')
console.log(MODE === 'icons' ? report.split('<details>')[0] : report)
/** 報告檔：_local-notes/<YYYY-MM>/<YYYY-MM-DD>_<名稱>[_dry-run].md（同一天重跑會覆寫當天那份，不會蓋到別天的） */
const REPORT_NAME = {
  icons: '圖示圖庫匯入報告', equip: '武器背包圖示匯入報告', ui: '介面美術封存報告', npc: 'NPC圖庫匯入報告',
  other: '其他圖示封存報告', skins: '機師造型封存報告', v3: `PLAN-054_匯入報告_${TIER}`,
}[MODE]
if (REPORT_NAME) {
  const day = localDate()
  const out = path.join(ROOT, '_local-notes', day.slice(0, 7), `${day}_${REPORT_NAME}${APPLY ? '' : '_dry-run'}.md`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, report + '\n')
  console.log(`📝 報告：${path.relative(ROOT, out)}`)
}
if (MODE === 'ui' && APPLY) writeUiIndex()
if (MODE === 'other' && APPLY) writeOtherIconIndex()
if (MODE === 'npc' && APPLY) writeNpcMeta()
if (!APPLY) console.log('（dry-run：沒有寫入。確認後加 --apply）')

/**
 * --npc --apply 之後：npcArtMeta.json 記每個 NPC 號碼的英文名、有沒有外觀卡（跨次擷取累積、只增不減）。
 * 只記這次有匯入任務的號碼（＝NPC 圖庫裡的號碼），可抽機師的號碼不記。
 */
function writeNpcMeta() {
  const prev = fs.existsSync(NPC_META_FILE) ? JSON.parse(fs.readFileSync(NPC_META_FILE, 'utf-8')).dirs ?? {} : {}
  const dirs = { ...prev }
  for (const dir of new Set(tasks.map((t) => path.basename(path.dirname(t.dest))))) {
    const en = [...new Set([...(prev[dir]?.en ?? []), ...(npcReport.en.get(dir) ?? [])])].sort()
    const skinCard = !!prev[dir]?.skinCard || npcReport.skinCard.has(dir)
    if (en.length || skinCard) dirs[dir] = { ...(en.length ? { en } : {}), ...(skinCard ? { skinCard } : {}) }
  }
  const sorted = Object.fromEntries(Object.entries(dirs).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })))
  fs.writeFileSync(NPC_META_FILE, JSON.stringify({
    generatedBy: 'scripts/import-game-assets.mjs --npc --apply（只增不減，勿手改；人工註記寫 npcArtNotes.json）',
    note: 'en＝3D 模型資料夾的英文名（pilot/pilotbNN_abs/<號碼>/pilot_<英文>.png）；skinCard＝擷取裡有 Icon_pilotSkin_<號碼>*',
    dirs: sorted,
  }, null, 1) + '\n')
  console.log(`📚 ${path.relative(ROOT, NPC_META_FILE)}：有英文名或外觀卡的號碼 ${Object.keys(sorted).length}`)
}

/**
 * 封存夾的 _index.json（--ui、--other-icons 共用）：每張圖的來歷，跨次擷取累積。
 * 只增不減：舊擷取才有的圖照樣留著；firstSeen＝第一次封存它的那次擷取（之後對版本的線索）。
 * rows 的 key 是相對 game/ 的路徑（ui/…、icons/…），寫進索引時去掉第一層。回傳合併後的 { files, dumps } 給 README 用。
 */
function updateArchiveIndex(root, rows, moves, flag) {
  const indexFile = path.join(root, '_index.json')
  const prev = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf-8')) : { dumps: {}, files: {} }
  const files = { ...prev.files }
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/')
  for (const [from, to] of moves) {   // 搬家的檔，紀錄跟著搬
    if (files[rel(from)]) { files[rel(to)] = files[rel(from)]; delete files[rel(from)] }
  }
  for (const [key, r] of rows) {
    const file = key.split('/').slice(1).join('/')
    if (files[file] && !FORCE) continue
    files[file] = { asset: r.asset, w: r.w, h: r.h, sha256: r.sha, firstSeen: files[file]?.firstSeen ?? DUMP_ID }
  }
  const dumps = { ...prev.dumps, [DUMP_ID]: localDate(fs.statSync(path.join(SRC, '圖片索引.csv')).mtime) }
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(indexFile, JSON.stringify({
    generatedBy: `scripts/import-game-assets.mjs ${flag} --apply（repo：mecharashi-tools）`, updatedAt: new Date().toISOString(),
    note: 'files 的 key 是相對本資料夾的路徑；asset＝官方資源路徑；firstSeen＝第一次封存它的擷取（見 dumps）', dumps,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  }, null, 1) + '\n')
  return { files, dumps }
}

/** --other-icons --apply 之後：更新 icons/_index.json 並重產 icons/README.md（給人看的目錄） */
function writeOtherIconIndex() {
  const { files, dumps } = updateArchiveIndex(ICONS_ARCHIVE, otherReport.rows, [], '--other-icons')
  const count = new Map()
  for (const f of Object.keys(files)) {
    if (!fs.existsSync(path.join(ICONS_ARCHIVE, f))) continue
    const folder = f.split('/')[0]
    count.set(folder, (count.get(folder) ?? 0) + 1)
  }
  const lines = [
    '# 其他圖示封存',
    '',
    '> ⚠ 自動產生，請勿手改——資料夾的中文說明改 `scripts/lib/gameIconKinds.mjs` 的 `OTHER_ICON_FOLDERS`，再跑',
    '> `node scripts/import-game-assets.mjs --src=<擷取> --other-icons --apply`（repo：mecharashi-tools）。',
    '',
    '遊戲客戶端（陸版）`ui/uiimages/uiicons/` 底下、站上目前用不到的圖示，照官方資料夾原樣封存（WebP q82、原尺寸、保留透明）。',
    '**不進 git、不部署**，後台也看不到。技能／BUFF／武器／背包圖示在 repo 的 `public/images/game/icons/`，',
    '可抽機甲的立繪與部件在 `public/images/game/mechs/`，這裡不重複存。',
    '',
    '- 路徑：`icons/<官方資料夾>/<官方檔名>.webp`（官方資料夾名去掉 `_abs`）',
    '- `_index.json`：每張圖的官方路徑、尺寸、sha256、第一次出現在哪次擷取（`firstSeen`）',
    '',
    `擷取紀錄：${Object.entries(dumps).map(([id, d]) => `\`${id}\`（${d}）`).join('、')}`,
    '',
    '| 官方資料夾 | 說明 | 張數 |', '|---|---|---:|',
    ...[...count].sort(([, a], [, b]) => b - a).map(([folder, n]) => `| \`${folder}\` | ${OTHER_ICON_FOLDERS[folder] ?? '（沒登記）'} | ${n} |`),
    '',
  ]
  fs.writeFileSync(path.join(ICONS_ARCHIVE, 'README.md'), lines.join('\n'))
  console.log(`📚 ${path.join(ICONS_ARCHIVE, 'README.md')}、_index.json 已更新（共 ${Object.keys(files).length} 張）`)
}

/**
 * --ui --apply 之後：更新 ui/_index.json（每張圖的來歷，跨次擷取累積）並重產 ui/README.md（給人看的目錄）。
 */
function writeUiIndex() {
  const { files, dumps } = updateArchiveIndex(UI_ROOT, uiReport.rows, uiReport.moves, '--ui')

  // README：照實際檔案統計（含舊擷取才有的），用途與中文說明來自字典
  const tree = new Map()   // group → module → { n, subs: Map<sub, n> }
  for (const f of Object.keys(files)) {
    if (!fs.existsSync(path.join(UI_ROOT, f))) continue
    const [group, module, ...rest] = f.split('/')
    const sub = rest.slice(0, -1).join('/') || '（模組根目錄）'
    const g = tree.get(group) ?? tree.set(group, new Map()).get(group)
    const m = g.get(module) ?? g.set(module, { n: 0, subs: new Map() }).get(module)
    m.n++; m.subs.set(sub, (m.subs.get(sub) ?? 0) + 1)
  }
  const lines = [
    '# 介面美術封存',
    '',
    '> ⚠ 自動產生，請勿手改——用途分類與中文說明改 `scripts/lib/gameUiModules.mjs` 的字典，再跑',
    '> `node scripts/import-game-assets.mjs --src=<擷取> --ui --apply`（repo：mecharashi-tools）。',
    '',
    '遊戲客戶端（陸版）擷取的活動、招募、大廳、劇情背景等美術圖，轉成 WebP（q82、原尺寸、保留透明）。',
    '**不進 git、不部署**：陸版比台版快，這裡有台版還沒上線的內容。後台看不到這裡的圖（後台只看得到網站送得出來的圖）。',
    '',
    '決定用途後再「上架」到 repo 的 `public/images/game/ui/`（同一個相對路徑），後台圖片挑選器就看得到：',
    '',
    '```bash',
    'node scripts/import-game-assets.mjs --promote=activity/uiactivity/ob6          # 整個資料夾（dry-run）',
    'node scripts/import-game-assets.mjs --promote=gacha/pilotgachaimg/Img_1_pilot_gacha_Erisa1_Raw --apply   # 單張',
    '```',
    '',
    '⚠ 上架＝部署後任何人都看得到，只挑台版已經上線的。',
    '',
    '## 怎麼找',
    '',
    '```',
    'ui/<用途>/<官方模組>/<子資料夾…>/<官方檔名>.webp',
    '```',
    '',
    '- **用途**：我們加的分類（下表），由字典決定；字典改了，重跑 `--ui --apply` 會自動搬家。',
    '- **官方模組**：客戶端資源路徑 `ui/uiimages/` 之後的第一段，去掉打包用的 `_abs`、`<模組>_atlas`／`_noatlas`。',
    '- **子資料夾**照官方原樣。常見的 `obNN`＝陸版第 NN 版（例：`gacha/uigacha/pilotob16/`＝第 16 版的機師卡池）。',
    '- **檔名**＝官方資源名逐字；`_Raw` 是官方給的大圖。',
    '- `_index.json`：每張圖的官方路徑、尺寸、sha256、第一次出現在哪次擷取（`firstSeen`）。',
    '- 只收「美術圖」：`_Raw`、長邊 ≥ 512、或檔名帶 banner；按鈕、遮罩、特效、圖集整張不收。系統介面零件與簡中文字圖不收。',
    '',
    `擷取紀錄：${Object.entries(dumps).map(([id, d]) => `\`${id}\`（${d}）`).join('、')}`,
    '',
  ]
  for (const [group, info] of Object.entries(UI_GROUPS)) {
    const g = tree.get(group)
    if (!g) continue
    const total = [...g.values()].reduce((s, m) => s + m.n, 0)
    lines.push(`## ${group}/　${info.zh}（${total} 張）`, '', '| 官方模組 | 說明 | 張數 | 子資料夾 |', '|---|---|---:|---|')
    for (const [module, m] of [...g].sort(([a], [b]) => a.localeCompare(b))) {
      const subs = [...m.subs].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      const subText = subs.length > 12 ? `${subs.slice(0, 12).map(([s, n]) => `${s}（${n}）`).join('、')}…等 ${subs.length} 個` : subs.map(([s, n]) => `${s}（${n}）`).join('、')
      lines.push(`| \`${module}\` | ${uiModuleInfo(module).zh || '（字典沒登記）'} | ${m.n} | ${subText} |`)
    }
    lines.push('')
  }
  fs.writeFileSync(path.join(UI_ROOT, 'README.md'), lines.join('\n'))
  console.log(`📚 ${path.join(UI_ROOT, 'README.md')}、_index.json 已更新（共 ${Object.keys(files).length} 張）`)
}
