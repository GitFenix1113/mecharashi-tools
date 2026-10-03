/**
 * 故事館名字字體子集產生器（PLAN-042-C D-1）—— 產出 `public/fonts/lore-names-tc.woff2`
 * 與 `public/fonts/lore-script-latin.woff2`。
 *
 * 為什麼可以子集化中文字體：名字是**封閉集合**。字集來源只有三處——
 * `public/images/pilots/*`／`public/images/mechs/*` 的資料夾名（＝顯示名）、
 * Firestore `pilots`／`mechs` 的 `name` + `fullName`（有 serviceAccountKey.json 才讀）、
 * 以及幾個名字裡會出現的標點。88＋88 個資料夾名只有一百多個相異字，
 * 加上 fullName 也不到三百字，woff2 落在 100KB 以內；正文字型不在此列
 * （042-A 計畫書「字集漂移」的顧慮是針對逸聞正文，名字不會漂）。
 *
 * ⚠ 這支**不接進 build／predev**：來源字型 15MB，不進版控也不該讓 CI 每次下載。
 *   產出物（woff2）進版控；新機師進圖庫或改名時手動重跑 `npm run fonts:lore` 再一起 commit。
 *   子集缺字時腳本**列出缺哪些字並失敗**，不靜默 fallback——同頁混排兩套字體比不換字體更醜。
 *
 * 字型：
 *   · LXGW WenKai TC（霞鶩文楷 TC，SIL OFL 1.1）——楷書、繁中字形完整。
 *   · Mr Dafoe（SIL OFL 1.1，Google Fonts）——復古筆刷草書，官網英文名的同路數；
 *     官網那套是商用字型（八張名字層字母造型一致，是字型不是手寫），授權不在站長與官方的共識範圍內。
 *
 * 來源字型找檔順序：`_local-notes/fonts/` → `node_modules/.cache/lore-fonts/` → 從 GitHub 下載到後者。
 *
 * 用法：node scripts/generate-lore-fonts.mjs   （或 npm run fonts:lore）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'
import * as fontkit from 'fontkit'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'fonts')
const CACHE_DIRS = [path.join(ROOT, '_local-notes', 'fonts'), path.join(ROOT, 'node_modules', '.cache', 'lore-fonts')]

const SOURCES = {
  tc: {
    file: 'LXGWWenKaiTC-Regular.ttf',
    url: 'https://github.com/lxgw/LxgwWenKaiTC/releases/latest/download/LXGWWenKaiTC-Regular.ttf',
    out: 'lore-names-tc.woff2',
  },
  script: {
    file: 'MrDafoe-Regular.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/mrdafoe/MrDafoe-Regular.ttf',
    out: 'lore-script-latin.woff2',
  },
}

/** 名字裡會出現、但不在任何名字字串裡也要保留的字元（分隔點、全形空白、括號） */
const NAME_PUNCT = '·‧・　「」（）'
/** 英文草書要涵蓋的字元：可列印 ASCII ＋ 名字常見的彎引號／連接號／省略號／中點 */
const LATIN_TEXT =
  Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('') + '‘’“”–—…·'

async function sourceFont(spec) {
  for (const dir of CACHE_DIRS) {
    const p = path.join(dir, spec.file)
    if (fs.existsSync(p)) return p
  }
  const dest = path.join(CACHE_DIRS[1], spec.file)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  console.log(`⬇ 下載 ${spec.file} …`)
  const res = await fetch(spec.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下載 ${spec.url} 失敗：HTTP ${res.status}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

function folderNames(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
}

/** Firestore 的 name／fullName（唯讀，180 次讀取）。沒有金鑰就略過，只用資料夾名。 */
async function firestoreNames() {
  const keyFile = path.join(ROOT, 'serviceAccountKey.json')
  if (!fs.existsSync(keyFile)) return { names: [], note: '（無 serviceAccountKey.json，未讀 Firestore 的 fullName）' }
  const admin = (await import('firebase-admin')).default
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyFile, 'utf-8'))) })
  }
  const db = admin.firestore()
  const names = []
  for (const col of ['pilots', 'mechs']) {
    const snap = await db.collection(col).select('name', 'fullName').get()
    snap.forEach((doc) => {
      const d = doc.data()
      if (typeof d.name === 'string') names.push(d.name)
      if (typeof d.fullName === 'string') names.push(d.fullName)
    })
  }
  return { names, note: `（Firestore pilots／mechs 的 name＋fullName 共 ${names.length} 筆）` }
}

/** 逐字檢查字型有沒有字形；回傳缺的字。 */
function missingGlyphs(fontPath, text) {
  const font = fontkit.openSync(fontPath)
  const missing = new Set()
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (!font.hasGlyphForCodePoint(cp)) missing.add(ch)
  }
  return [...missing]
}

async function build(spec, text, label) {
  const src = await sourceFont(spec)
  const missing = missingGlyphs(src, text)
  if (missing.length) {
    console.error(`❌ ${label}：字型 ${spec.file} 缺 ${missing.length} 個字：${missing.join(' ')}`)
    console.error('   換字型、或把這些名字改成字型有的寫法；不要讓它靜默退回系統字體。')
    process.exit(1)
  }
  const buf = await subsetFont(fs.readFileSync(src), text, { targetFormat: 'woff2' })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, spec.out)
  fs.writeFileSync(out, buf)
  console.log(`✅ ${label}：${path.relative(ROOT, out)}  ${(buf.length / 1024).toFixed(1)}KB（${[...new Set(text)].length} 字）`)
}

async function main() {
  const pilots = folderNames(path.join(ROOT, 'public', 'images', 'pilots'))
  const mechs = folderNames(path.join(ROOT, 'public', 'images', 'mechs'))
  const fs_ = await firestoreNames()
  const chars = [...new Set([...pilots, ...mechs, ...fs_.names, NAME_PUNCT].join(''))]
    .filter((c) => c.trim() !== '' || c === '　')
    .sort()
  const text = chars.join('')
  console.log(`字集：資料夾名 ${pilots.length}＋${mechs.length} 個 ${fs_.note}，相異字元 ${chars.length}`)

  await build(SOURCES.tc, text + ' ', '中文名字（楷書）')
  await build(SOURCES.script, LATIN_TEXT, '英文草書')

  // 字集清單進版控：diff 一看就知道這次多了哪些字
  fs.writeFileSync(path.join(OUT_DIR, 'lore-names.chars.txt'), text + '\n')
}

await main()
