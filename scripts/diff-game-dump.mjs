#!/usr/bin/env node
/**
 * 遊戲擷取差異報告——遊戲改版、跑完擷取工具之後的第一步：這一版多了什麼、改了什麼。
 *
 *   node scripts/diff-game-dump.mjs                          最新一次 vs 前一次擷取
 *   node scripts/diff-game-dump.mjs --old=Data --new=latest  指定兩次擷取（資料夾名或路徑）
 *   node scripts/diff-game-dump.mjs --no-thumbs              不產縮圖（快，報告只有檔名）
 *   共用：--root=<擷取根目錄>（預設 E:/Mecharashi_Data）
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
 *   ⑤ 報告：每組附「下一步」的匯入指令。誰是誰（gameId 與 artKey 不互推）一律由人確認，腳本不猜。
 *
 * ⚠ 擷取來源是陸版，比台版快——報告裡的新東西不一定已經在台版上線。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { DUMP_ROOT, PIXEL_DIFF_SAME, loadDumpIndex, localDate, pixelDiff, preferTexture, resolveDump } from './lib/gameDump.mjs'
import { EQUIP_POOLS, iconFamily, iconPoolIndex, isLibraryKey } from './lib/gameIconKinds.mjs'
import { UI_GROUPS, isUiArt, uiLocation, uiModuleInfo } from './lib/gameUiModules.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (!m) { console.error(`❌ 看不懂的參數：${a}`); process.exit(1) }
  return [m[1], m[2] ?? true]
}))
const DUMPS = String(args.root ?? DUMP_ROOT)
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
const N = byName(loadDumpIndex(NEW.dir))

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
const site = { stems: new Set(), pilotIds: new Set(), waps: new Set(), artIds: new Set() }
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
  for (const s of site.stems) { const m = s.match(/^Pilot_(\d+)/); if (m) site.artIds.add(m[1]) }
}
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
    if (!c.id.startsWith('1010')) return { text: 'NPC／劇情頭像（非可抽）', fresh: false }
    if (site.pilotIds.has(c.id) || site.artIds.has(c.id)) return { text: c.part === 'card' ? '既有機師的造型卡' : '既有機師的新造型', fresh: true }
    return { text: c.part === 'card' ? '新機師卡（gameId 候選）' : '新立繪（artKey 候選）', fresh: true }
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
    if (fs.existsSync(path.join(SITE, 'icons', c.family, `${r.name}.webp`))) return { text: '圖庫已有', fresh: false }
    // 匯入模式只收固定幾個資料夾（ICON_POOLS／EQUIP_POOLS）；不在裡面的照實講，別讓人以為跑 --icons 就會有
    const equip = c.family === 'weapon' || c.family === 'backpack'
    const importable = equip ? EQUIP_POOLS.some(([, dir]) => r.asset_path?.includes(dir)) : iconPoolIndex(r.asset_path, r.type, r.name) >= 0
    const dir = r.asset_path?.match(/uiicons\/([^/]+)/)?.[1] ?? '?'
    return importable ? { text: '圖庫沒有', fresh: true, importable } : { text: `圖庫沒有（匯入模式不收 ${dir}）`, fresh: true, importable }
  }
  return { text: '', fresh: true }
}

const item = (r, extra = {}) => {
  const c = classify(r)
  return { name: r.name, type: r.type, w: r.width, h: r.height, path: r.path, asset: r.asset_path || '', ...c, ...siteStatus(r, c), ...extra }
}
const addedItems = added.map((r) => item(r)).sort((a, b) => a.name.localeCompare(b.name))
const changedItems = changed.map(({ was, now, d }) => item(now, { d, oldPath: was.path, oldW: was.width, oldH: was.height }))
  .sort((a, b) => b.d - a.d)
const removedItems = removed.map((r) => ({ name: r.name, type: r.type, w: r.width, h: r.height, path: r.path, ...classify(r) }))
  .sort((a, b) => a.name.localeCompare(b.name))

// ── 下一步指令 ─────────────────────────────────────────────────────────────────
const SRC = `--src=${NEW.id}`
const newPilotCards = [...new Set(addedItems.filter((i) => i.kind === 'pilot' && i.part === 'card' && i.fresh && i.text.startsWith('新機師')).map((i) => i.id))]
const newPilotArts = [...new Set(addedItems.filter((i) => i.kind === 'pilot' && i.part !== 'card' && i.fresh && i.text.startsWith('新立繪')).map((i) => i.name.replace(/_(half|head|Raw)$/, '')))]
const newWaps = [...new Set(addedItems.filter((i) => i.kind === 'mech' && i.part !== 'skin' && i.text === '新機甲').map((i) => i.wap))]
const freshIcons = addedItems.filter((i) => i.kind === 'icon' && i.fresh)
const freshUi = addedItems.filter((i) => i.kind === 'ui' && i.art && UI_GROUPS[i.group].archive)
const nextSteps = []
if (newPilotCards.length || newPilotArts.length) {
  nextSteps.push({
    title: '新機師（gameId 與 artKey 不互推，先確認誰是誰、台版上線了沒）',
    lines: [`機師卡編號（gameId 候選）：${newPilotCards.join('、') || '（無）'}`, `立繪主鍵（artKey 候選）：${newPilotArts.join('、') || '（無）'}`,
      ...newPilotCards.map((id) => `node scripts/import-game-assets.mjs ${SRC} --id=${id} --art-key=<確認後填，例 ${newPilotArts[0] ?? `Pilot_${id}A`}>`)],
  })
}
if (newWaps.length) nextSteps.push({ title: '新機甲（先確認台版上線了沒）', lines: newWaps.map((w) => `node scripts/import-game-assets.mjs ${SRC} --wap=${w}`) })
if (freshIcons.some((i) => (i.family === 'skill' || i.family === 'buff') && i.importable)) nextSteps.push({ title: '技能／BUFF 圖示（只會補新 key）', lines: [`node scripts/import-game-assets.mjs ${SRC} --icons`] })
if (freshIcons.some((i) => (i.family === 'weapon' || i.family === 'backpack') && i.importable)) nextSteps.push({ title: '武器／背包圖示（只會補新 key）', lines: [`node scripts/import-game-assets.mjs ${SRC} --equip-icons`] })
const notImportable = freshIcons.filter((i) => !i.importable)
if (notImportable.length) {
  nextSteps.push({ title: `圖庫命名但匯入模式不收的圖示 ${notImportable.length} 張（站上目前用不到；要用時再替 import-game-assets 加來源）`, lines: [notImportable.map((i) => i.name).join('、')] })
}
const newSkins = [...new Set(addedItems.filter((i) => i.kind === 'pilot' && i.fresh && i.text.includes('造型')).map((i) => i.name.replace(/_(half|head|Raw)$/, '')))]
if (newSkins.length) {
  nextSteps.push({ title: '既有機師的新造型：讀取端只用預設造型，目前沒有匯入模式（extended 只吃 v3 定版），先記著', lines: [newSkins.join('、')] })
}
if (freshUi.length) nextSteps.push({ title: '活動、招募、大廳等介面美術 → repo 外封存夾（不進 git、不部署）', lines: [`node scripts/import-game-assets.mjs ${SRC} --ui`] })
const unsorted = [...new Set(addedItems.filter((i) => i.kind === 'ui' && !i.known).map((i) => i.module))]
if (unsorted.length) nextSteps.push({ title: '字典沒登記的新模組 → 先補 scripts/lib/gameUiModules.mjs 的 DICT', lines: unsorted })
nextSteps.forEach((s) => s.lines.forEach((l, i, a) => { if (l.startsWith('node ')) a[i] = l + '                 # 先 dry-run，確認後加 --apply' }))

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
  ['icon', '圖示圖庫：技能／BUFF／武器／背包', (i) => i.family],
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
</style></head><body><main>
<h1>遊戲擷取差異　${esc(OLD.date)} → ${esc(NEW.date)}</h1>
<p class="muted">舊：<code>${esc(OLD.id)}</code>　新：<code>${esc(NEW.id)}</code>　產生於 ${esc(new Date().toLocaleString('zh-TW'))}　・
綠框＝站上沒有的。勾選框會記在這台電腦的瀏覽器裡（看過的勾掉）。⚠ 擷取是陸版，新東西不一定已在台版上線。</p>
<table><tr><th></th>${SECTIONS.map(([, t]) => `<th>${esc(t.split('：')[0].split('（')[0])}</th>`).join('')}</tr>
${['added', 'changed', 'removed'].map((k) => `<tr><td>${{ added: '新增', changed: '內容變更', removed: '消失' }[k]}</td>${SECTIONS.map(([s]) => `<td>${summary[k][s] || ''}</td>`).join('')}</tr>`).join('')}</table>
<p class="muted">sha256 不同 ${candidates.length} 筆，像素比對後真的變了 ${changed.length} 筆（其餘是圖集重新打包）。</p>
<h2>下一步</h2>${nextSteps.length ? nextSteps.map((s) => `<p><b>${esc(s.title)}</b></p><pre>${s.lines.map(esc).join('\n')}</pre>`).join('') : '<p class="muted">沒有需要匯入的。</p>'}
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
for (const s of nextSteps) console.log(`\n▶ ${s.title}\n${s.lines.map((l) => '  ' + l).join('\n')}`)
console.log(`\n📝 報告：${path.relative(ROOT, outBase)}.html（＋ .json）`)
