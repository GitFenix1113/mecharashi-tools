#!/usr/bin/env node
/**
 * 遊戲擷取差異報告——遊戲改版、跑完擷取工具之後的第一步：這一版多了什麼、改了什麼。
 *
 *   node scripts/diff-game-dump.mjs                          最新一次 vs 前一次擷取
 *   node scripts/diff-game-dump.mjs --old=Data --new=latest  指定兩次擷取（資料夾名或路徑）
 *   node scripts/diff-game-dump.mjs --no-thumbs              不產縮圖（快，報告只有檔名）
 *   共用：--root=<擷取根目錄>（預設 E:/Mecharashi_Data）、--archive=<封存夾>（預設 E:/Mecharashi_Data/site-archive）
 *
 * 全程唯讀：不寫 public/、不碰 Firestore（0 read）、原始 PNG 不進 repo。真正寫檔的是 import-game-assets.mjs。
 * 產出 _local-notes/<YYYY-MM>/<YYYY-MM-DD>_遊戲擷取差異.html（縮圖內嵌，本機直接打開）＋ 同名 .json。
 *
 * ── 五個步驟 ──────────────────────────────────────────────────────────────────
 *   ① 範圍：01 立繪、03 招募、04 劇情背景、05 圖示、07 介面與活動、15 公告原圖；06 簡中文字圖另列、預設收起。
 *      02 動態立繪零件、08–14 特效／模型／場景貼圖不看；sactx-*（整張圖集，重新打包就換名）不看。
 *   ② 比對：檔名就是 key（官方檔名本身就是 ID）；同名多筆取 Texture2D。分成新增、內容變更、消失。
 *   ③ 濾假變更：sha256 不同時再做像素比對，平均差 ≥ 6 才算真的變了（圖集重新打包只會改位元組）。
 *   ④ 認出是什麼：命名規則（scripts/lib/gameAssetKinds、gameIconKinds、gameUiModules）＋ 對照 public/images/game/。
 *      英文名鍵對中文名用 v3 定版對照（_local-notes，有就用、沒有就只列英文）。
 *   ⑤ 報告：「下一步」是一張可以照抄的清單——每一步附指令，並對照 public/ 與封存夾標出 ✅ 已完成／⬜ 待做；
 *      最後附收尾（commit、push、清快取）。誰是誰（gameId 與 artKey 不互推）一律由人確認，腳本不猜。
 *      報告是當下的快照：做完任何一步後重跑本腳本，狀態就會更新。整套流程不需要 AI，見 public/images/game/README.md。
 *
 * ⚠ 擷取來源是陸版，比台版快——報告裡的新東西不一定已經在台版上線。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { playableArtDirs } from './lib/gameAssetKinds.mjs'
import { ARCHIVE_ROOT, DUMP_ROOT, PIXEL_DIFF_SAME, loadDumpIndex, localDate, pixelDiff, preferTexture, resolveDump } from './lib/gameDump.mjs'
import { EQUIP_POOLS, emblemFamilyOf, iconFamily, iconPoolIndex, isLibraryKey, otherIconPaths } from './lib/gameIconKinds.mjs'
import { UI_GROUPS, isUiArt, uiArchivePath, uiLocation, uiModuleInfo } from './lib/gameUiModules.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (!m) { console.error(`❌ 看不懂的參數：${a}`); process.exit(1) }
  return [m[1], m[2] ?? true]
}))
const DUMPS = String(args.root ?? DUMP_ROOT)
const ARCHIVE_GAME = path.join(path.resolve(String(args.archive ?? ARCHIVE_ROOT)), 'game')
const THUMBS = !args['no-thumbs']
const V3 = path.join(ROOT, '_local-notes/2026-10/2026-10-03_機師機甲圖片資源mapping_v3_final.json')
const SITE = path.join(ROOT, 'public/images/game')

let OLD, NEW
try {
  OLD = resolveDump(String(args.old ?? 'previous'), DUMPS)
  NEW = resolveDump(String(args.new ?? 'latest'), DUMPS)
} catch (e) { console.error(`❌ ${e.message}`); process.exit(1) }
if (OLD.dir === NEW.dir) { console.error('❌ 新舊是同一次擷取'); process.exit(1) }
console.log(`舊：${OLD.id}（${OLD.date}）\n新：${NEW.id}（${NEW.date}）`)

// ── ① 範圍 ＋ ② 比對 ───────────────────────────────────────────────────────────
const SCOPE = new Set(['01', '03', '04', '05', '06', '07', '15'])
const inScope = (r) => SCOPE.has(String(r.category).slice(0, 2)) && !r.name.startsWith('sactx-')
function byName(rows) {
  const m = new Map()
  for (const r of rows) if (inScope(r)) (m.get(r.name) ?? m.set(r.name, []).get(r.name)).push(r)
  return m
}
const O = byName(loadDumpIndex(OLD.dir))
const newRows = loadDumpIndex(NEW.dir)
const N = byName(newRows)
/** 名字 → --other-icons 的封存相對路徑（要看整份擷取才判斷得出「同名是不是被別的模式收了」；同名可在多個官方資料夾） */
const otherRelsOf = new Map()
for (const [rel, rs] of otherIconPaths(newRows)) (otherRelsOf.get(rs[0].name) ?? otherRelsOf.set(rs[0].name, []).get(rs[0].name)).push(rel)

const added = [], candidates = [], removed = []
for (const [name, rs] of N) {
  const now = preferTexture(rs)
  const before = O.get(name)
  if (!before) { added.push(now); continue }
  const was = preferTexture(before)
  if (was.sha256 !== now.sha256) candidates.push({ was, now })
}
for (const [name, rs] of O) if (!N.has(name)) removed.push(preferTexture(rs))

// ── ③ 濾假變更 ─────────────────────────────────────────────────────────────────
const changed = []
{
  const q = [...candidates]
  let n = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (q.length) {
      const c = q.shift()
      const ra = c.was.width / c.was.height, rb = c.now.width / c.now.height
      let d
      if (Math.abs(ra - rb) / ra > 0.02) d = 255   // 長寬比變了＝換了一張圖
      else {
        try { d = await pixelDiff(path.join(OLD.dir, c.was.path), path.join(NEW.dir, c.now.path)) }
        catch { d = 255 }   // 讀不到就當成有變，交給人看
      }
      if (d >= PIXEL_DIFF_SAME) changed.push({ ...c, d: Math.round(d * 10) / 10 })
      if (++n % 200 === 0) process.stdout.write(`  像素比對 ${n}/${candidates.length}\n`)
    }
  }))
}
console.log(`新增 ${added.length}、sha 不同 ${candidates.length}（真的變了 ${changed.length}）、消失 ${removed.length}`)

// ── ④ 認出是什麼 ───────────────────────────────────────────────────────────────
/** 站上 public/images/game/ 已有的檔（不含副檔名）與 ID 資料夾 */
const site = { stems: new Set(), pilotIds: new Set(), waps: new Set(), artIds: new Set(), npcIds: new Set() }
{
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name))
      else site.stems.add(e.name.replace(/\.[^.]+$/, ''))
    }
  }
  walk(SITE)
  for (const d of fs.existsSync(path.join(SITE, 'pilots')) ? fs.readdirSync(path.join(SITE, 'pilots')) : []) site.pilotIds.add(d)
  for (const d of fs.existsSync(path.join(SITE, 'mechs')) ? fs.readdirSync(path.join(SITE, 'mechs')) : []) site.waps.add(d)
  // artIds＝可抽機師的立繪號碼（只看 game/pilots/）；npcIds＝NPC 圖庫的號碼（2026-10-12 起上站）。
  // 兩者要分開：NPC 圖庫的號碼若混進 artIds，NPC 轉正的新機師卡會被誤判成「既有機師的造型卡」
  const numbersIn = (sub, out) => {
    const dir = path.join(SITE, sub)
    for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      for (const f of fs.readdirSync(path.join(dir, d))) { const m = f.match(/^Pilot_(\d+)/); if (m) out.add(m[1]) }
    }
  }
  numbersIn('pilots', site.artIds)
  numbersIn('npc', site.npcIds)
}
/** 可抽機師的立繪號碼 → gameId（--skins 的落點 pilots/<gameId>/） */
const playable = playableArtDirs(path.join(SITE, 'pilots'))
/** 封存夾裡有沒有這個相對路徑（不含副檔名） */
const archived = (rel) => fs.existsSync(path.join(ARCHIVE_GAME, `${rel}.webp`))
/** 英文名鍵 → 站上中文名（v3 定版；沒有這份檔就全部當成「對不到」） */
const enName = new Map()
if (fs.existsSync(V3)) {
  const v3 = JSON.parse(fs.readFileSync(V3, 'utf-8'))
  for (const [k, v] of Object.entries({ ...v3.pilotEnKeys, ...v3.mechEnKeys })) enName.set(k.toLowerCase(), v.names.join('／'))
}

function classify(r) {
  const n = r.name
  let m
  if ((m = n.match(/^Pilot_(\d+)([A-Z]{0,2})_(half|head|Raw)$/))) return { kind: 'pilot', id: m[1], skin: m[2] || 'A', part: m[3] }
  if ((m = n.match(/^Icon_item_(1010\d{4})([A-Z]{1,2})$/))) return { kind: 'pilot', id: m[1], skin: m[2], part: 'card' }
  if ((m = n.match(/^Icon_mecha_wap(\d{4})(_SN_Raw)?$/))) return { kind: 'mech', wap: m[1], part: m[2] ? 'sn' : 'icon' }
  if ((m = n.match(/^Icon_wap(\d{4})_([1-4])$/))) return { kind: 'mech', wap: m[1], part: `part${m[2]}` }
  if ((m = n.match(/^(?:Img_Skin_wap|Icon_wap)(\d{4})_S\d+/))) return { kind: 'mech', wap: m[1], part: 'skin' }
  if ((m = n.match(/^Img_1_pilot_gacha_(?:banner_|title_)?([A-Za-z]+?)\d*(?:_Raw)?$/))) return { kind: 'gacha', key: m[1] }
  if ((m = n.match(/^Img_1_mechcard_(?:illustration|banner|name)_([A-Za-z]+?)\d*(?:_Raw)?$/))) return { kind: 'gacha', key: m[1] }
  if (isLibraryKey(n)) return { kind: 'icon', family: iconFamily(n) }
  const loc = uiLocation(r.asset_path)
  const info = loc && uiModuleInfo(loc.module, loc.text)
  if (n.startsWith('Icon_') && (!loc || info.group === 'entity')) return { kind: 'iconOther', prefix: n.split('_').slice(0, 2).join('_') }
  if (loc && info.group === 'text') return { kind: 'text', module: loc.module }
  if (loc && info.group !== 'entity') {
    return { kind: 'ui', group: info.group, module: loc.module, sub: loc.sub.join('/'), zh: info.zh, known: info.known, art: isUiArt(r) }
  }
  return { kind: 'other', cat: String(r.category).slice(0, 2) }
}

/** 站上狀態（給人看的一句話）＋ 是否算「站上沒有」 */
function siteStatus(r, c) {
  if (c.kind === 'pilot') {
    if (site.stems.has(r.name)) return { text: '站上已有', fresh: false }
    if (site.pilotIds.has(c.id) || site.artIds.has(c.id)) return { text: c.part === 'card' ? '既有機師的造型卡' : '既有機師的新造型', fresh: true }
    if (c.part === 'card') {
      return site.npcIds.has(c.id)
        ? { text: '新機師卡：NPC 轉正（立繪已在 NPC 圖庫，後台可直接選）', fresh: true }
        : { text: '新機師卡（gameId 候選）', fresh: true }
    }
    // 不屬於可抽機師的立繪一律進 NPC 圖庫（劇情 NPC、尚未上線的新角色都在這）
    return { text: c.id.startsWith('1010') ? '新立繪（NPC 圖庫沒有；artKey 候選）' : '新 NPC 立繪（NPC 圖庫沒有）', fresh: true, npcArt: true }
  }
  if (c.kind === 'mech') {
    if (site.stems.has(r.name)) return { text: '站上已有', fresh: false }
    if (c.part === 'skin') return { text: site.waps.has(c.wap) ? '既有機甲的塗裝' : '塗裝（機甲站上沒有）', fresh: true }
    return { text: site.waps.has(c.wap) ? '既有機甲缺這張' : '新機甲', fresh: true }
  }
  if (c.kind === 'gacha') {
    const zh = enName.get(c.key.toLowerCase())
    return zh ? { text: `對應站上：${zh}`, fresh: false } : { text: '英文名對不到站上（新角色？）', fresh: true }
  }
  if (c.kind === 'icon') {
    // 匯入模式只收固定幾個資料夾（ICON_POOLS／EQUIP_POOLS／EMBLEM_POOLS）；不在裡面的照實講，別讓人以為跑 --icons 就會有
    // importable 不看站上現況（匯入後重跑，「下一步」才能把它算成 ✅ 而不是整步消失）
    const equip = c.family === 'weapon' || c.family === 'backpack'
    const emblem = c.family === 'class' || c.family === 'license' || c.family === 'camp'
    const importable = equip ? EQUIP_POOLS.some(([, dir]) => r.asset_path?.includes(dir))
      : emblem ? emblemFamilyOf(r) === c.family
        : iconPoolIndex(r.asset_path, r.type, r.name) >= 0
    // 陣營徽章依資料夾認：factory 的同名廠商 logo 不能因為圖庫有同名檔就算「已有」（那是另一張圖）
    if ((importable || !emblem) && fs.existsSync(path.join(SITE, 'icons', c.family, `${r.name}.webp`))) return { text: '圖庫已有', fresh: false, importable }
    const dir = r.asset_path?.match(/uiicons\/([^/]+)/)?.[1] ?? '?'
    return importable ? { text: '圖庫沒有', fresh: true, importable } : { text: `圖庫沒有（${dir} 不上站，--other-icons 封存）`, fresh: true, importable }
  }
  return { text: '', fresh: true }
}

const item = (r, extra = {}) => {
  const c = classify(r)
  // 封存落點（--ui／--other-icons），給「下一步」對照封存夾判斷做了沒
  const uiRel = uiArchivePath(r) ?? undefined
  const otherRels = otherRelsOf.get(r.name)
  return { name: r.name, type: r.type, w: r.width, h: r.height, path: r.path, asset: r.asset_path || '', ...c, ...siteStatus(r, c), uiRel, otherRels, ...extra }
}
const addedItems = added.map((r) => item(r)).sort((a, b) => a.name.localeCompare(b.name))
const changedItems = changed.map(({ was, now, d }) => item(now, { d, oldPath: was.path, oldW: was.width, oldH: was.height }))
  .sort((a, b) => b.d - a.d)
const removedItems = removed.map((r) => ({ name: r.name, type: r.type, w: r.width, h: r.height, path: r.path, ...classify(r) }))
  .sort((a, b) => a.name.localeCompare(b.name))

// ── 下一步：照抄的清單 ─────────────────────────────────────────────────────────────
// 每一步的「目標」只看這次擷取新增了什麼、不看站上現況；「做了沒」對照 public/ 與封存夾。
// 所以做完一步重跑本腳本，那一步會變成 ✅（而不是從報告上消失，讓人分不清是做完了還是本來就不用做）。
const SRC = `--src=${NEW.id}`
const DRY = '      # 先不加 --apply 看結果（dry-run），沒問題再加 --apply'
const uniq = (xs) => [...new Set(xs)]
const artName = (i) => i.name.replace(/_(half|head|Raw)$/, '')
const pilotArts = addedItems.filter((i) => i.kind === 'pilot' && i.part !== 'card')
const nextSteps = []
/**
 * kind：public＝上站（之後要 commit、push）／archive＝repo 外封存（不必 commit）／manual＝要人改東西
 * targets：這一步負責的檔 { name, ok（目的地已有）, url（上站的才有，給清快取清單）}
 */
function step({ targets, lines, ...s }) {
  const missing = targets.filter((t) => !t.ok)
  nextSteps.push({ ...s, total: targets.length, todo: missing.length, missing: missing.map((t) => t.name),
    urls: targets.map((t) => t.url).filter(Boolean), lines: lines.map((l) => (l.startsWith('node ') ? l + DRY : l)) })
}

// 新機師卡：Icon_item_<gameId>A（gameId 與 artKey 不互推——--art-key 由人確認後填）
const cards = addedItems.filter((i) => i.kind === 'pilot' && i.part === 'card' && i.skin === 'A')
if (cards.length) {
  const artKeys = uniq(pilotArts.filter((i) => i.id.startsWith('1010') && !playable.has(i.id)).map(artName))
  step({
    kind: 'public', title: '新機師卡 → 上站（gameId 與 artKey 不互推：先確認誰是誰，--art-key 由人填）',
    targets: cards.map((i) => ({ name: i.name, ok: site.stems.has(i.name), url: `images/game/pilots/${i.id}/${i.name}.webp` })),
    lines: [`機師卡編號（gameId）：${cards.map((i) => i.id).join('、')}`,
      `立繪主鍵（artKey 候選）：${artKeys.join('、') || '（擷取裡沒有新的；NPC 轉正的話立繪在 NPC 圖庫）'}`,
      ...cards.filter((i) => !site.stems.has(i.name))
        .map((i) => `node scripts/import-game-assets.mjs ${SRC} --id=${i.id} --art-key=<確認後填，例 ${artKeys[0] ?? `Pilot_${i.id}A`}>`)],
  })
}
// 新機甲：立繪／部件／全身大圖。只放圖、不碰資料庫——哪台是哪台由管理者在後台「選取官方立繪」決定
const mechCore = addedItems.filter((i) => i.kind === 'mech' && i.part !== 'skin')
if (mechCore.length) {
  step({
    kind: 'public', title: '新機甲 → 上站（只放圖、不碰資料庫；哪台是哪台由管理者在後台「選取官方立繪」決定）',
    targets: mechCore.map((i) => ({ name: i.name, ok: site.stems.has(i.name), url: `images/game/mechs/${i.wap}/${i.name}.webp` })),
    lines: uniq(mechCore.filter((i) => !site.stems.has(i.name)).map((i) => i.wap)).map((w) => `node scripts/import-game-assets.mjs ${SRC} --wap=${w}`),
  })
}
// NPC 圖庫：不是可抽機師的立繪（劇情 NPC、尚未上線的新角色）
const npcArts = pilotArts.filter((i) => !playable.has(i.id))
if (npcArts.length) {
  step({
    kind: 'public', title: 'NPC 立繪 → 上站（NPC 轉正時，管理者在後台「選取官方立繪」的 NPC 分組直接選）',
    targets: npcArts.map((i) => ({ name: i.name, ok: site.stems.has(i.name), url: `images/game/npc/${i.id}/${i.name}.webp` })),
    lines: [uniq(npcArts.map(artName)).join('、'), `node scripts/import-game-assets.mjs ${SRC} --npc`],
  })
}
// 圖示圖庫：只補新 key
for (const [families, flag, title] of [
  [['skill', 'buff'], '--icons', '技能／BUFF 圖示 → 上站（只補新 key）'],
  [['weapon', 'backpack'], '--equip-icons', '武器／背包圖示 → 上站（只補新 key）'],
  [['class', 'license', 'camp'], '--emblems', '職業／駕照圖示、陣營徽章 → 上站（只補新的；新職業或新陣營出現時，前台的對照表要人補，見 PLAN-059）'],
]) {
  const icons = addedItems.filter((i) => i.kind === 'icon' && i.importable && families.includes(i.family))
  if (!icons.length) continue
  step({
    kind: 'public', title,
    targets: icons.map((i) => ({ name: i.name, ok: fs.existsSync(path.join(SITE, 'icons', i.family, `${i.name}.webp`)), url: `images/game/icons/${i.family}/${i.name}.webp` })),
    lines: [`node scripts/import-game-assets.mjs ${SRC} ${flag}`],
  })
}
// 可抽機師的其他造型 → 封存（站上只用預設造型）
const skins = pilotArts.filter((i) => playable.has(i.id) && !site.stems.has(i.name))
if (skins.length) {
  step({
    kind: 'archive', title: '既有機師的新造型 → repo 外封存（站上只用預設造型）',
    targets: skins.map((i) => ({ name: i.name, ok: archived(`pilots/${playable.get(i.id)}/${i.name}`) })),
    lines: [uniq(skins.map(artName)).join('、'), `node scripts/import-game-assets.mjs ${SRC} --skins`],
  })
}
// 介面美術 → 封存（落點規則 uiArchivePath，與 --ui 同一份）
const uiArts = addedItems.filter((i) => i.uiRel)
if (uiArts.length) {
  step({
    kind: 'archive', title: '活動、招募、大廳、造型等介面美術 → repo 外封存',
    targets: uiArts.map((i) => ({ name: i.name, ok: archived(i.uiRel) })),
    lines: [`node scripts/import-game-assets.mjs ${SRC} --ui`],
  })
}
// 其他圖示 → 封存（落點規則 otherIconPaths，與 --other-icons 同一份）
const others = addedItems.filter((i) => i.otherRels)
if (others.length) {
  step({
    kind: 'archive', title: '其他圖示（道具、勳章、肉鴿、車輛、塗裝小圖、外觀卡…）→ repo 外封存',
    targets: others.map((i) => ({ name: i.name, ok: i.otherRels.every(archived) })),
    lines: [`node scripts/import-game-assets.mjs ${SRC} --other-icons`],
  })
}
// 字典沒登記的新模組：已經封存在 ui/_unsorted/，補字典只是讓它們歸到對的用途（補完重跑 --ui --apply 會自動搬家）
const unsorted = uniq(addedItems.filter((i) => i.kind === 'ui' && !i.known).map((i) => i.module))
if (unsorted.length) {
  nextSteps.push({ kind: 'manual', title: '字典沒登記的新模組 → 補 scripts/lib/gameUiModules.mjs 的 DICT（不補也已封存在 ui/_unsorted/，補了只是歸類更清楚）',
    total: unsorted.length, todo: unsorted.length, missing: [], urls: [], lines: unsorted })
}
const badge = (s) => s.kind === 'manual' ? '⚠ 要人處理' : !s.todo ? '✅ 已完成'
  : s.todo === s.total ? `⬜ 待做（${s.total} 個檔）` : `◐ 做了一部分（還差 ${s.todo}／${s.total}）`
/** 上站的新檔（部署前若有人開過網址，Cloudflare 會把 404 快取住，要清） */
const publicUrls = nextSteps.filter((s) => s.kind === 'public').flatMap((s) => s.urls)

// ── 縮圖 ───────────────────────────────────────────────────────────────────────
async function thumb(file) {
  try {
    const buf = await sharp(file).resize(150, 150, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer()
    return `data:image/webp;base64,${buf.toString('base64')}`
  } catch { return '' }
}
if (THUMBS) {
  const jobs = [
    ...addedItems.filter((i) => i.kind !== 'ui' || i.art).map((i) => [i, 'thumb', path.join(NEW.dir, i.path)]),
    ...changedItems.flatMap((i) => [[i, 'thumb', path.join(NEW.dir, i.path)], [i, 'oldThumb', path.join(OLD.dir, i.oldPath)]]),
    ...removedItems.filter((i) => i.kind !== 'ui' || isUiArt({ name: i.name, width: i.w, height: i.h })).map((i) => [i, 'thumb', path.join(OLD.dir, i.path)]),
  ]
  let n = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (jobs.length) {
      const [it, key, file] = jobs.shift()
      it[key] = await thumb(file)
      if (++n % 200 === 0) process.stdout.write(`  縮圖 ${n}\n`)
    }
  }))
}

// ── ⑤ 報告 ─────────────────────────────────────────────────────────────────────
const SECTIONS = [
  ['pilot', '機師：立繪、頭像、機師卡', (i) => `${i.id}${i.skin}`],
  ['mech', '機甲：立繪、部件、全身大圖、塗裝', (i) => `wap${i.wap}`],
  ['gacha', '招募立繪（依英文名鍵）', (i) => i.key],
  ['icon', '圖示圖庫：技能／BUFF／武器／背包／職業／駕照／陣營徽章', (i) => i.family],
  ['ui', '介面美術：活動、招募、大廳、劇情…（依用途 → 官方模組）', (i) => `${UI_GROUPS[i.group].zh}｜${i.module}${i.sub ? '/' + i.sub : ''}${i.zh ? '　' + i.zh : ''}`],
  ['iconOther', '其他圖示（道具、勳章、肉鴿…）', (i) => i.prefix],
  ['other', '其他', (i) => `類別 ${i.cat}`],
  ['text', '簡中文字圖（字卡、活動標題；暫不處理）', (i) => i.module],
]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const card = (i, opts = {}) => `<label class="card${i.fresh ? ' fresh' : ''}">
  <input type="checkbox" data-k="${esc(i.name)}">
  <div class="th">${opts.old ? `<img src="${i.oldThumb ?? ''}" alt="" title="舊"><span class="arrow">→</span>` : ''}${i.thumb ? `<img src="${i.thumb}" alt="">` : '<span class="nothumb">—</span>'}</div>
  <code>${esc(i.name)}</code>
  <small>${i.w}×${i.h}${opts.old && (i.oldW !== i.w || i.oldH !== i.h) ? `（舊 ${i.oldW}×${i.oldH}）` : ''}${i.d !== undefined ? `・差 ${i.d}` : ''}${i.type === 'Sprite' ? '・Sprite' : ''}</small>
  ${i.text ? `<em>${esc(i.text)}</em>` : ''}
</label>`
function grouped(items, keyOf, opts) {
  const g = new Map()
  for (const i of items) (g.get(keyOf(i)) ?? g.set(keyOf(i), []).get(keyOf(i))).push(i)
  return [...g].sort((a, b) => a[0].localeCompare(b[0])).map(([k, list]) => {
    const art = opts?.artOnly ? list.filter((i) => i.art) : list
    const rest = list.length - art.length
    return `<details${opts?.closed ? '' : ' open'}><summary>${esc(k)} <b>${list.length}</b>${rest ? `<span class="muted">（其中 ${rest} 張是按鈕、零件，不顯示）</span>` : ''}</summary>
<div class="grid">${art.map((i) => card(i, opts)).join('')}</div></details>`
  }).join('\n')
}
function section(title, items, keyOf, opts = {}) {
  if (!items.length) return ''
  return `<section><h2>${esc(title)} <span class="count">${items.length}</span></h2>${opts.note ? `<p class="note">${opts.note}</p>` : ''}
${grouped(items, keyOf, opts)}</section>`
}
const kindCount = (list) => Object.fromEntries(SECTIONS.map(([k]) => [k, list.filter((i) => i.kind === k).length]))
const summary = { added: kindCount(addedItems), changed: kindCount(changedItems), removed: kindCount(removedItems) }
const today = localDate()
const outBase = path.join(ROOT, '_local-notes', today.slice(0, 7), `${today}_遊戲擷取差異`)
fs.mkdirSync(path.dirname(outBase), { recursive: true })

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>遊戲擷取差異 ${esc(NEW.date)}</title>
<style>
:root{--bg:#fafaf8;--fg:#1f1f1d;--muted:#6b6a64;--card:#fff;--line:#e2e0d8;--accent:#0f6e56;--fresh:#e1f5ee;--chk:#ececec}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1a;--fg:#ecebe6;--muted:#a19f97;--card:#262624;--line:#3a3935;--accent:#5dcaa5;--fresh:#173b30;--chk:#333}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,"Noto Sans TC",sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}h1{font-size:22px;margin:8px 0}h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
.count{color:var(--muted);font-weight:400}.muted,.note{color:var(--muted)}.note{margin:4px 0 8px}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid var(--line);padding:4px 10px;text-align:right}th:first-child,td:first-child{text-align:left}
pre{background:var(--card);border:1px solid var(--line);padding:10px;overflow-x:auto;font-size:12.5px}
details{margin:6px 0}summary{cursor:pointer;padding:4px 0}summary b{color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;margin:6px 0 12px}
.card{display:flex;flex-direction:column;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px;position:relative;cursor:pointer}
.card.fresh{border-color:var(--accent);background:var(--fresh)}.card input{position:absolute;top:6px;right:6px}
.card:has(input:checked){opacity:.45}
.th{height:110px;display:flex;align-items:center;justify-content:center;gap:4px;border-radius:4px;
background:repeating-conic-gradient(var(--chk) 0 25%,transparent 0 50%) 0 0/16px 16px}
.th img{max-width:100%;max-height:110px;min-width:0}.th:has(.arrow) img{max-width:44%}.arrow{color:var(--muted)}.nothumb{color:var(--muted)}
code{font-size:11.5px;word-break:break-all}small{color:var(--muted);font-size:11.5px}em{font-style:normal;font-size:12px;color:var(--accent)}
ol.steps{padding-left:22px}ol.steps>li{margin:10px 0}ol.steps>li.done{color:var(--muted)}ol.steps pre{margin:6px 0}
.tag{display:inline-block;font-size:11.5px;padding:0 6px;border:1px solid var(--line);border-radius:4px;color:var(--muted);margin-left:6px}
</style></head><body><main>
<h1>遊戲擷取差異　${esc(OLD.date)} → ${esc(NEW.date)}</h1>
<p class="muted">舊：<code>${esc(OLD.id)}</code>　新：<code>${esc(NEW.id)}</code>　產生於 ${esc(new Date().toLocaleString('zh-TW'))}　・
綠框＝站上沒有的。勾選框會記在這台電腦的瀏覽器裡（看過的勾掉）。⚠ 擷取是陸版，新東西不一定已在台版上線。</p>
<table><tr><th></th>${SECTIONS.map(([, t]) => `<th>${esc(t.split('：')[0].split('（')[0])}</th>`).join('')}</tr>
${['added', 'changed', 'removed'].map((k) => `<tr><td>${{ added: '新增', changed: '內容變更', removed: '消失' }[k]}</td>${SECTIONS.map(([s]) => `<td>${summary[k][s] || ''}</td>`).join('')}</tr>`).join('')}</table>
<p class="muted">sha256 不同 ${candidates.length} 筆，像素比對後真的變了 ${changed.length} 筆（其餘是圖集重新打包）。</p>
<h2>下一步 <span class="count">（✅ ${nextSteps.filter((s) => s.kind !== 'manual' && !s.todo).length}／${nextSteps.length} 步）</span></h2>
<p class="note">照順序做。每個指令先<b>不加</b> <code>--apply</code> 跑一次（dry-run，只報告、不寫任何東西），沒問題再加 <code>--apply</code> 重跑。
這份報告是產生當下的快照：做完幾步後重跑 <code>node scripts/diff-game-dump.mjs</code>，狀態就會更新。
「上站」的步驟做完要接下面的收尾；「封存」寫在 repo 外（<code>${esc(ARCHIVE_GAME)}</code>），不必 commit。</p>
${nextSteps.length ? `<ol class="steps">${nextSteps.map((s) => {
  const pre = `<pre>${s.lines.map(esc).join('\n')}</pre>`
  const done = s.kind !== 'manual' && !s.todo
  return `<li class="${done ? 'done' : ''}"><b>${esc(badge(s))}</b>　${esc(s.title)}<span class="tag">${{ public: '上站', archive: '封存', manual: '人工' }[s.kind]}</span>
${done ? `<details><summary>指令</summary>${pre}</details>` : pre}</li>`
}).join('\n')}</ol>` : '<p class="muted">沒有需要匯入的。</p>'}
<h2>收尾（上站的步驟做完之後）</h2>
<ol class="steps">
<li><code>npm run dev</code> 開本機，確認後台看得到新圖：新機甲／新機師在「選取官方立繪」的「未使用」，新圖示在圖示選圖器的「最新」。dev／build 會自動重產圖片索引。</li>
<li><code>git status</code> 確認變動只在 <code>public/images/game/</code>、<code>src/data/</code>、<code>scripts/lib/</code>，然後：
<pre>git add -A
git commit -m "chore(images): ${esc(NEW.date)} 擷取的官方原檔匯入"</pre>（chore 不必寫網站更新履歷）</li>
<li><code>npm run push</code>：會先跑 build，失敗就不會推上去。</li>
<li>到 GitHub 的 Actions 等 <code>pages-build-deployment</code> 跑完（幾分鐘）。部署完成前若有人開過新圖的網址，Cloudflare 會把 404 快取住 → 到 Cloudflare 清快取（網址清單在下面）。</li>
<li>管理者在後台把新機甲／新機師連上官方原檔（誰是誰由管理者決定）。</li>
<li>重跑 <code>node scripts/diff-game-dump.mjs</code>：每一步都應該是 ✅。</li>
</ol>
${publicUrls.length ? `<details><summary>上站的新檔網址 ${publicUrls.length} 個（清 Cloudflare 快取用；含先前已部署的，不確定哪些被開過就整批清，無害）</summary><pre>${publicUrls.map((u) => esc(`https://mecharashi.wiki/${u}`)).join('\n')}</pre></details>` : ''}
<p class="muted">刻意不收的：簡中文字圖、按鈕／遮罩／特效零件、系統介面（規則見 <code>scripts/lib/gameUiModules.mjs</code>）。
整套流程的說明：<code>public/images/game/README.md</code>。</p>
<h2 style="border:0;margin-top:36px">新增</h2>
${SECTIONS.map(([k, t, keyOf]) => section(t, addedItems.filter((i) => i.kind === k), keyOf,
    { artOnly: k === 'ui', closed: k === 'text' || k === 'other' || k === 'iconOther' || (k === 'ui'),
      note: k === 'ui' ? '依用途分組，展開看圖；按鈕、遮罩、小零件只算數量。用途是 scripts/lib/gameUiModules.mjs 的字典推測的，不對就改字典。' : '' })).join('\n')}
<h2 style="border:0;margin-top:36px">內容變更（像素比對後真的變了）</h2>
${section('變更', changedItems, (i) => SECTIONS.find(([k]) => k === i.kind)?.[1].split('：')[0] ?? i.kind, { old: true, closed: true })}
<h2 style="border:0;margin-top:36px">消失（新擷取裡沒有了）</h2>
${section('消失', removedItems, (i) => SECTIONS.find(([k]) => k === i.kind)?.[1].split('：')[0] ?? i.kind, { closed: true })}
</main><script>
const K='diff:${esc(NEW.id)}:';
for(const c of document.querySelectorAll('input[data-k]')){try{c.checked=localStorage.getItem(K+c.dataset.k)==='1'}catch{}
c.addEventListener('change',()=>{try{c.checked?localStorage.setItem(K+c.dataset.k,'1'):localStorage.removeItem(K+c.dataset.k)}catch{}})}
</script></body></html>`
fs.writeFileSync(`${outBase}.html`, html)

const strip = (list) => list.map(({ thumb: _t, oldThumb: _o, ...rest }) => rest)
fs.writeFileSync(`${outBase}.json`, JSON.stringify({
  generatedBy: 'scripts/diff-game-dump.mjs', generatedAt: new Date().toISOString(),
  old: { id: OLD.id, date: OLD.date }, new: { id: NEW.id, date: NEW.date },
  summary, nextSteps, added: strip(addedItems), changed: strip(changedItems), removed: strip(removedItems),
}, null, 1) + '\n')

// ── 終端摘要 ───────────────────────────────────────────────────────────────────
console.log('\n新增（站上沒有的／全部）：')
for (const [k, t] of SECTIONS) {
  const all = addedItems.filter((i) => i.kind === k)
  if (all.length) console.log(`  ${t.split('：')[0].split('（')[0].padEnd(8, '　')} ${all.filter((i) => i.fresh).length} / ${all.length}`)
}
console.log(`\n下一步（✅ ${nextSteps.filter((s) => s.kind !== 'manual' && !s.todo).length}／${nextSteps.length} 步）：`)
for (const s of nextSteps) {
  console.log(`\n${badge(s)}　${s.title}`)
  if (s.kind === 'manual' || s.todo) console.log(s.lines.map((l) => '  ' + l).join('\n'))
}
if (publicUrls.length) console.log('\n上站的步驟做完 → 收尾見報告最後（npm run dev 確認 → commit → npm run push → 等部署，必要時清 Cloudflare 快取）')
console.log(`\n📝 報告：${path.relative(ROOT, outBase)}.html（＋ .json）`)
