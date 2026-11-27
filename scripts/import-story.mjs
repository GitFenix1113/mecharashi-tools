#!/usr/bin/env node
// 劇情對白匯入：台版遊戲參數 SQLite → src/data/story/ 靜態 JSON（劇情故事館 /lore/story）。
//
//   node scripts/import-story.mjs            預覽：只印摘要，不寫任何檔案
//   node scripts/import-story.mjs --write    寫入 src/data/story/（會先清掉舊的書檔，再整批重寫）
//   --db <路徑>                               指定 遊戲資料.sqlite（預設：E:\ 底下最新的 Mecharashi_data_TW*）
//
// ── 為什麼是靜態檔、不進 Firestore ──
// 劇情是「改版才會變」的固定內容，六萬多行對白進資料庫只會白白吃讀取額度。
// 這裡一章（或一個活動、一位機師的回憶）一個 JSON，前台用 import.meta.glob 的 lazy 模式按需載入，0 read。
//
// ── 資料怎麼串（2026-11-22 盤點，_local-notes/2026-11/2026-11-22_劇情對白資料盤點.md）──
//   主線  WorldMapChapter.MainWayPointIds／BranchWayPointIds → WorldMapWayPoint
//           Start／EndDialogID ＝ 開場／結尾過場；FuncTypeParam ＝ 戰場 ID
//   活動  PlotActivityInfo.PlotLevelGroupList → PlotActivityLevelGroup.LevelList → PlotActivityLevel
//           Start／EndDialogID；LevelBattleIdList → PlotActivityLevelBattle.BattleMapInfoList[].BattleMapID ＝ 戰場 ID
//         另外 ChallengeLevelGroupList／DailyLevelGroupList 也要看：「只有挑戰關」版型的活動（金沙遺夢、瑞歲百角戲）
//           劇情關卡組是空的、劇情整段寫在挑戰關上（2026-11-28 發現漏收）
//   機師回憶  PilotMemoryPiecesGroup.Levels → PilotMemoryPieceLevel（Start／EndDialogID、BattleMapId）
//   戰中對白  戰場 JSON 裡的事件觸發 `"m_type":1,"m_param1":<對白 ID>`（依出現順序）
//   對白本身  ConfigDataDialogueInfo，NextID 串成一段；文字一律查 texts（台版繁中，ConfigDataST_TW）
//
// 資料包是唯讀的：一律 readOnly 開啟，不寫任何東西回去。

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'src', 'data', 'story')
/** 書的種類 → 輸出子資料夾（也是書 ID 的前綴：main-3 ⇔ main/3.json） */
const KIND_DIRS = { main: 'main', event: 'event', memory: 'memory' }

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const dbArg = args.includes('--db') ? args[args.indexOf('--db') + 1] : null

// ─── 找資料包 ────────────────────────────────────────────────────────────────

/** E:\ 底下所有 Mecharashi_data_TW*\遊戲參數\遊戲資料.sqlite，取檔案修改時間最新的（解包工具要求每版換新資料夾） */
function findLatestTwDb() {
  const drive = 'E:/'
  if (!fs.existsSync(drive)) return null
  const cands = []
  for (const d of fs.readdirSync(drive)) {
    if (!/^Mecharashi_data_TW/i.test(d)) continue
    const p = path.join(drive, d, '遊戲參數', '遊戲資料.sqlite')
    if (fs.existsSync(p)) cands.push({ p, t: fs.statSync(p).mtimeMs })
  }
  cands.sort((a, b) => a.t - b.t)
  return cands.at(-1)?.p ?? null
}

const dbPath = dbArg ?? findLatestTwDb()
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('✗ 找不到台版 遊戲資料.sqlite。用 --db <路徑> 指定，或把解包放在 E:\\Mecharashi_data_TW*\\遊戲參數\\')
  process.exit(1)
}

/** 版本資訊：同一包的 索引/來源與版本.json（build_info 是 key=value 的多行字串） */
function readBuildInfo() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(path.dirname(dbPath), '索引', '來源與版本.json'), 'utf8'))
    const kv = Object.fromEntries(String(j.build_info ?? '').split(/\r?\n/).filter(Boolean).map((l) => l.split('=')))
    return { build: kv.BuildNum ?? '', buildTime: kv.BuildTime ?? '' }
  } catch {
    return { build: '', buildTime: '' }
  }
}

const sql = new DatabaseSync(dbPath, { readOnly: true })
const TEXT = new Map(sql.prepare('SELECT id, value FROM texts').all().map((r) => [String(r.id), r.value]))
const tx = (key) => (key && typeof key === 'string' ? TEXT.get(key.replace(/^ST:/, '')) ?? '' : '')

/** 整張表 → Map<ID, 記錄> */
function table(name) {
  const rows = sql.prepare('SELECT json FROM records WHERE table_name = ?').all(name)
  return new Map(rows.map((r) => { const o = JSON.parse(r.json); return [o.ID, o] }))
}

const DIALOG = table('ConfigDataDialogueInfo')
const CHOOSE = table('ConfigDataDialogChooseItem')

// ─── 文字清理 ────────────────────────────────────────────────────────────────

const stats = { unknownTags: new Map(), loops: 0, missingText: 0 }

/**
 * 遊戲富文字 → 站上只認的兩種標記（renderer 在 src/components/lore/story/storyText.ts）：
 *   <yellow>／<huntyellow> → <y>…</y>（強調色）
 *   <color=#RRGGBB>        → <c=#rrggbb>…</c>
 * 其餘標記（<TestRichText> 之類的測試殘留）一律拿掉、只留文字，並記進摘要。字面上的 \n 轉成真的換行。
 */
function cleanText(raw) {
  let s = String(raw ?? '').replace(/\\n/g, '\n')
  s = s.replace(/<(\/?)(?:yellow|huntyellow)>/gi, '<$1y>')
  s = s.replace(/<color=(#[0-9a-f]{6})(?:[0-9a-f]{2})?>/gi, (_, hex) => `<c=${hex.toLowerCase()}>`)
  s = s.replace(/<\/color>/gi, '</c>')
  s = s.replace(/<\/?([A-Za-z][\w-]*)(=[^>]*)?>/g, (m, tag) => {
    if (tag === 'y' || tag === 'c') return m
    stats.unknownTags.set(tag, (stats.unknownTags.get(tag) ?? 0) + 1)
    return ''
  })
  return s.trim()
}

/** 說話者：哪一側的名字有值就用哪個；「旁白」與空白一律當旁白（存空字串） */
function speakerOf(d) {
  const name = cleanText(tx(d.LeftNameStrKey) || tx(d.RightNameStrKey))
  return name === '旁白' ? '' : name
}

// ─── 對白串 ──────────────────────────────────────────────────────────────────

/**
 * 從某一行沿 NextID 走到底。一行 = [說話者, 文字] 或 [說話者, 文字, 選項[]]。
 * 選項（DialogChooseItem）在台版資料裡全都沒有分支（DialogId 恆為 0，是戰場用的二選一／三選一），所以只列出選項文字。
 */
function walk(headId) {
  const lines = []
  const seen = new Set()
  let id = headId
  while (id && DIALOG.has(id)) {
    if (seen.has(id)) { stats.loops++; break }
    seen.add(id)
    const d = DIALOG.get(id)
    const text = cleanText(tx(d.WordsStrKey))
    if (!text && d.WordsStrKey) stats.missingText++
    const choices = (d.ChooseItemList ?? []).map((c) => cleanText(tx(CHOOSE.get(c)?.WordsStrKey))).filter(Boolean)
    if (text || choices.length) lines.push(choices.length ? [speakerOf(d), text, choices] : [speakerOf(d), text])
    id = d.NextID
  }
  return lines
}

// ─── 戰中對白：戰場事件觸發 ──────────────────────────────────────────────────

const SCENE_DIALOGS = new Map()
for (const { id, json } of sql.prepare('SELECT id, json FROM scenes').all()) {
  const heads = []
  for (const m of json.matchAll(/"m_type":1,"m_param1":(\d+)/g)) {
    const h = Number(m[1])
    if (DIALOG.has(h) && !heads.includes(h)) heads.push(h)
  }
  if (heads.length) SCENE_DIALOGS.set(Number(id), heads)
}

/**
 * 一關的三段：開場／戰中／結尾。同一關多個難度常指到同一批戰中對白 ⇒ 以開頭 ID 去重。
 * 戰中每個觸發各是一小段，彼此用 null 隔開（renderer 畫成分隔線）。
 */
function stageParts(startId, endId, sceneIds) {
  const parts = []
  const used = new Set()
  /** 過場（開場／結尾）的開頭 ID；去重以它為準，沒有過場的關才看戰中 */
  const cutscene = []
  const start = startId ? walk(startId) : []
  if (start.length) { parts.push({ at: 'start', lines: start }); used.add(startId); cutscene.push(startId) }
  const battle = []
  for (const sid of sceneIds) {
    for (const h of SCENE_DIALOGS.get(sid) ?? []) {
      if (used.has(h)) continue
      used.add(h)
      const seg = walk(h)
      if (!seg.length) continue
      if (battle.length) battle.push(null)
      battle.push(...seg)
    }
  }
  if (battle.length) parts.push({ at: 'battle', lines: battle })
  const end = endId && !used.has(endId) ? walk(endId) : []
  if (end.length) { parts.push({ at: 'end', lines: end }); cutscene.push(endId) }
  const battleHeads = [...used].filter((h) => !cutscene.includes(h))
  return { parts, heads: cutscene.length ? cutscene : battleHeads }
}

const lineCount = (parts) => parts.reduce((n, p) => n + p.lines.filter(Boolean).length, 0)

/**
 * 去重用的登記簿：對白開頭 ID → 第一次收錄它的書。
 * 收錄順序是 主線 → 機師回憶 → 活動，所以同一段對白會留在「最正式」的那本：
 *   · 首發是活動、之後併進主線世界地圖的章節（蜂箱網路＝XⅥ、啟示錄＝XⅧ）留在主線
 *   · 機師回憶活動（零落之刻、尋鄉奇旅）留在該機師的回憶
 *   · 復刻活動留在第一次
 * 活動是**逐關**比對：啟示錄的活動版比主線多一關「意料之外的」，只留那一關、其餘註明見主線。
 */
const OWNER = new Map()
const claim = (bookId, stages) => { for (const s of stages) for (const h of s.heads) if (!OWNER.has(h)) OWNER.set(h, bookId) }
/** 活動至少要有這麼多行才收：王牌協議之類的玩法活動只有幾句系統台詞 */
const MIN_EVENT_LINES = 20

// ─── 主線 ────────────────────────────────────────────────────────────────────

const CHAPTERS = table('ConfigDataWorldMapChapterInfo')
const WAYPOINTS = table('ConfigDataWorldMapWayPointInfo')
/** WayPointType：1 主線關、2 支線、3 遭遇戰／突襲戰、5 緊急行動 */
const books = []

for (const ch of [...CHAPTERS.values()].sort((a, b) => a.ID - b.ID)) {
  const stages = []
  const wps = [
    ...ch.MainWayPointIds.map((id) => ({ id, branch: false })),
    ...ch.BranchWayPointIds.map((id) => ({ id, branch: true })),
  ]
  for (const { id, branch } of wps) {
    const w = WAYPOINTS.get(id)
    if (!w) continue
    const { parts, heads } = stageParts(w.StartDialogID, w.EndDialogID, [w.FuncTypeParam])
    if (!parts.length) continue
    stages.push({
      heads,
      key: `w${id}`,
      code: cleanText(tx(w.TitleStrKey)),
      name: cleanText(tx(w.NameStrKey)),
      place: cleanText(tx(w.PosStrKey)) || undefined,
      desc: cleanText(tx(w.DescStrKey)) || undefined,
      branch: branch || undefined,
      parts,
    })
  }
  if (!stages.length) continue
  claim(`main-${ch.ID}`, stages)
  books.push({
    id: `main-${ch.ID}`,
    kind: 'main',
    title: cleanText(tx(ch.NameStrKey)),
    name: cleanText(tx(ch.DescStrKey)),
    desc: cleanText(tx(ch.DetailDescStrKey)) || undefined,
    stages,
  })
}

// ─── 機師回憶（先於活動：機師回憶活動的對白要歸在機師名下）─────────────────

const MEMORY_GROUPS = table('ConfigDataPilotMemoryPiecesGroupInfo')
const MEMORY_LEVELS = table('ConfigDataPilotMemoryPieceLevelInfo')

for (const g of [...MEMORY_GROUPS.values()].sort((a, b) => a.ID - b.ID)) {
  const stages = []
  for (const lid of g.Levels ?? []) {
    const l = MEMORY_LEVELS.get(lid)
    if (!l) continue
    const { parts, heads } = stageParts(l.StartDialogID, l.EndDialogID, [l.BattleMapId])
    if (!parts.length) continue
    stages.push({
      heads,
      key: `m${lid}`,
      code: String(l.Number ?? ''),
      name: cleanText(tx(l.TitleStrKey)),
      desc: cleanText(tx(l.DescriptStrKey)) || undefined,
      parts,
    })
  }
  if (!stages.length) continue
  claim(`memory-${g.ID}`, stages)
  books.push({
    id: `memory-${g.ID}`,
    kind: 'memory',
    title: '機師回憶',
    name: cleanText(tx(g.TitleStrKey)),
    desc: cleanText(tx(g.DescStrKey)) || undefined,
    // 機師卡編號（＝站上 pilots 的 gameId）：前台拿來接立繪與機師故事館
    gameId: String(g.PilotID ?? '') || undefined,
    stages,
  })
}

// ─── 活動 ────────────────────────────────────────────────────────────────────

const ACTIVITIES = table('ConfigDataPlotActivityInfo')
const LEVEL_GROUPS = table('ConfigDataPlotActivityLevelGroupInfo')
const LEVELS = table('ConfigDataPlotActivityLevelInfo')
const LEVEL_BATTLES = table('ConfigDataPlotActivityLevelBattleInfo')
const skipped = []
/** 挑戰／每日關卡組裡只有零星戰中台詞、沒收的（列進摘要，不算漏收） */
const thinExtras = []
const bookName = (id) => { const b = books.find((x) => x.id === id); return b ? `${b.title}「${b.name}」` : id }

for (const a of [...ACTIVITIES.values()].sort((x, y) => x.ID - y.ID)) {
  const actName = cleanText(tx(a.NameStrKey))
  const stages = []
  const groupNames = new Set()
  /** 重複的關卡：收在哪本 → 幾關 */
  const dupOwners = new Map()
  // 劇情關卡組一律收；挑戰／每日關卡組（extra）多半只有一兩句戰中台詞（掠食特訓、迎擊戰…），
  // 整組新收的行數要到 MIN_EVENT_LINES 才收。否則「尋鄉奇旅」這種全數重複的活動會多出一關 4 行的台詞，
  // 被判成玩法活動，連帶弄丟機師回憶上「曾以活動〇〇推出」的註記
  const groupIds = [
    ...(a.PlotLevelGroupList ?? []).map((gid) => ({ gid, extra: false })),
    ...(a.ChallengeLevelGroupList ?? []).map((gid) => ({ gid, extra: true })),
    ...(a.DailyLevelGroupList ?? []).map((gid) => ({ gid, extra: true })),
  ]
  for (const { gid, extra } of groupIds) {
    const g = LEVEL_GROUPS.get(gid)
    if (!g) continue
    const group = cleanText(tx(g.NameStrKey))
    const groupStages = []
    for (const lid of g.LevelList ?? []) {
      const l = LEVELS.get(lid)
      if (!l) continue
      const sceneIds = (l.LevelBattleIdList ?? []).flatMap((b) => (LEVEL_BATTLES.get(b)?.BattleMapInfoList ?? []).map((m) => m.BattleMapID))
      const { parts, heads } = stageParts(l.StartDialogID, l.EndDialogID, sceneIds)
      if (!parts.length) continue
      // 逐關去重：這關的過場已經收在別本（主線／機師回憶／先前的活動）就不重複收
      if (heads.length && heads.every((h) => OWNER.has(h))) {
        const owner = OWNER.get(heads[0])
        dupOwners.set(owner, (dupOwners.get(owner) ?? 0) + 1)
        continue
      }
      // 關名：多數活動是「標題＝關名、名稱＝地點」（冠軍｜機甲鬥技場）；
      // 少數活動的標題是內部代稱「逆止之疑劇情關1」，那時改用名稱當關名、不列地點
      const title = cleanText(tx(l.TitleStrKey))
      const name = cleanText(tx(l.NameStrKey))
      const internal = !title || /劇情關\s*\d+$/.test(title)
      groupStages.push({
        heads,
        key: `l${lid}`,
        code: String(l.Number ?? ''),
        name: internal ? name : title,
        place: !internal && name && name !== title ? name : undefined,
        desc: cleanText(tx(l.DescStrKey)) || undefined,
        group: group || undefined,
        parts,
      })
    }
    if (!groupStages.length) continue
    const groupLines = groupStages.reduce((n, s) => n + lineCount(s.parts), 0)
    if (extra && groupLines < MIN_EVENT_LINES) {
      thinExtras.push(`活動 ${a.ID}「${actName}」${group || `組 ${gid}`}（${groupLines} 行）`)
      continue
    }
    groupNames.add(group)
    stages.push(...groupStages)
  }
  const dupNote = [...dupOwners].map(([id, n]) => `${n} 關見${bookName(id)}`).join('、')
  if (!stages.length) {
    if (!dupNote) continue
    skipped.push(`活動 ${a.ID}「${actName}」：全部重複（${dupNote}）`)
    // 整個活動都被主線／機師回憶吸收（不是復刻）⇒ 在那本記下「曾以活動〇〇推出」，讀者才找得到
    for (const id of dupOwners.keys()) {
      const owner = books.find((b) => b.id === id)
      if (owner && owner.kind !== 'event' && actName !== owner.name) owner.aka = [...new Set([...(owner.aka ?? []), actName])]
    }
    continue
  }
  const lines = stages.reduce((n, s) => n + lineCount(s.parts), 0)
  if (lines < MIN_EVENT_LINES) { skipped.push(`活動 ${a.ID}「${actName}」：只有 ${lines} 行，視為玩法活動`); continue }
  claim(`event-${a.ID}`, stages)
  // 只有一個群組時不分幕
  if (groupNames.size <= 1) for (const s of stages) delete s.group
  const desc = cleanText(tx(a.DescStrKey))
  books.push({
    id: `event-${a.ID}`,
    kind: 'event',
    title: a.IsPilotMemoryPiece ? '機師回憶活動' : '活動劇情',
    name: actName,
    desc: desc && desc !== actName ? desc : undefined,
    // 部分關卡與別本相同（例：啟示錄的活動版只多一關）⇒ 註明其餘去哪看，前台做成連結
    seeAlso: dupOwners.size ? [...dupOwners].map(([id, stagesCount]) => ({ id, stages: stagesCount })) : undefined,
    stages,
  })
  if (dupNote) {
    skipped.push(`活動 ${a.ID}「${actName}」：只收 ${stages.length} 關，其餘 ${dupNote}`)
    // 反向連結：主線那本要知道「活動版多出幾關在別處」
    for (const id of dupOwners.keys()) {
      const owner = books.find((b) => b.id === id)
      if (owner) owner.extra = [...(owner.extra ?? []), { id: `event-${a.ID}`, stages: stages.length }]
    }
  }
}

/** 書的排列：主線 → 活動 → 機師回憶（各自依設定 ID） */
const KIND_ORDER = { main: 0, event: 1, memory: 2 }
books.sort((x, y) => KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || Number(x.id.split('-')[1]) - Number(y.id.split('-')[1]))
// 去重用的 heads 只在腳本裡用，不進輸出
for (const b of books) for (const s of b.stages) delete s.heads

// ─── 輸出 ────────────────────────────────────────────────────────────────────

const { build, buildTime } = readBuildInfo()
const catalog = {
  source: { build, buildTime },
  books: books.map((b) => ({
    id: b.id,
    kind: b.kind,
    title: b.title,
    name: b.name,
    ...(b.desc ? { desc: b.desc } : {}),
    ...(b.gameId ? { gameId: b.gameId } : {}),
    ...(b.aka ? { aka: b.aka } : {}),
    stages: b.stages.length,
    lines: b.stages.reduce((n, s) => n + lineCount(s.parts), 0),
  })),
}

const total = catalog.books.reduce((n, b) => n + b.lines, 0)
const byKind = (k) => catalog.books.filter((b) => b.kind === k)
console.log(`資料包　${dbPath}`)
console.log(`版本　　${build || '（讀不到）'}　${buildTime}`)
console.log(`對白表　${DIALOG.size.toLocaleString()} 行；有戰中對白的戰場 ${SCENE_DIALOGS.size}`)
console.log('')
for (const [k, label] of [['main', '主線'], ['event', '活動'], ['memory', '機師回憶']]) {
  const list = byKind(k)
  console.log(`${label}　${list.length} 本、${list.reduce((n, b) => n + b.stages, 0)} 關、${list.reduce((n, b) => n + b.lines, 0).toLocaleString()} 行`)
  for (const b of list) console.log(`  ${b.id.padEnd(12)} ${b.title}　${b.name}　${b.stages} 關／${b.lines} 行`)
}
console.log('')
console.log(`合計　${catalog.books.length} 本、${total.toLocaleString()} 行（對白表的 ${Math.round((total / DIALOG.size) * 100)}%；其餘多為肉鴿、武裝討伐、系統提示）`)
if (skipped.length) { console.log('\n略過：'); for (const s of skipped) console.log(`  · ${s}`) }
if (thinExtras.length) console.log(`\n挑戰／每日關卡只有零星戰中台詞、未收（不足 ${MIN_EVENT_LINES} 行）：\n  ${thinExtras.join('、')}`)
if (stats.unknownTags.size) console.log(`\n已拿掉的未知標記：${[...stats.unknownTags].map(([t, n]) => `<${t}>×${n}`).join('、')}`)
if (stats.loops) console.log(`⚠ 對白串出現迴圈 ${stats.loops} 次（已截斷）`)
if (stats.missingText) console.log(`⚠ 查不到文字的行 ${stats.missingText}（texts 表缺字）`)

if (!WRITE) {
  console.log('\n（預覽模式，沒有寫檔。確認無誤後加 --write）')
  process.exit(0)
}

// 整批重寫：先清掉三個子資料夾的舊書檔，避免改版後被拿掉的章節殘留成孤兒
for (const dir of Object.values(KIND_DIRS)) {
  const d = path.join(OUT_DIR, dir)
  fs.mkdirSync(d, { recursive: true })
  for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) fs.rmSync(path.join(d, f))
}
let bytes = 0
for (const b of books) {
  const [kind, num] = b.id.split('-')
  const file = path.join(OUT_DIR, KIND_DIRS[kind], `${num}.json`)
  const body = JSON.stringify(b)
  bytes += Buffer.byteLength(body)
  fs.writeFileSync(file, body + '\n')
}
const indexBody = JSON.stringify(catalog, null, 1)
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), indexBody + '\n')

console.log(`\n✅ 已寫入 src/data/story/：index.json＋${books.length} 本（${(bytes / 1024 / 1024).toFixed(2)} MB）`)
console.log('\n下一步：')
console.log('  ⬜ npm test　　　（storyData.test.ts 會核對目錄與書檔一致、沒有殘留的遊戲標記）')
console.log('  ⬜ npm run dev → 打開 /lore/story 抽看一兩章')
console.log('  ⬜ commit 時記得更新網站履歷（src/data/siteChangelog/）')
