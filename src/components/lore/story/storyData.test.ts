// 劇情故事館的靜態資料（scripts/import-story.mjs 產出的 src/data/story/）與前台的約定
//   npm test   →   node --test "src/**/*.test.ts"
//
// 前台用 import.meta.glob 載書、用目錄畫館首頁：兩邊對不上的話，館首頁會出現點進去被轉走的卡片，
// 或有書檔卻沒有入口。這裡直接讀檔核對，不經過 Vite。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { StoryBook, StoryCatalog, StoryOutline } from './storyTypes.ts'
import { facePath, mapStripPath, scenePath } from './storyScenes.ts'

const DIR = new URL('../../../data/story/', import.meta.url)
const catalog = JSON.parse(fs.readFileSync(new URL('index.json', DIR), 'utf8')) as StoryCatalog
const bookFiles = fs.readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => fs.readdirSync(new URL(`${d.name}/`, DIR)).filter((f) => f.endsWith('.json')).map((f) => `${d.name}/${f}`))
const readBook = (file: string) => JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8')) as StoryBook

test('目錄與書檔一一對應：main-3 ⇔ main/3.json', () => {
  const fromCatalog = catalog.books.map((b) => b.id.replace('-', '/') + '.json').sort()
  assert.deepEqual(fromCatalog, [...bookFiles].sort())
})

test('書 ID 只有三種前綴、全是設定表的數字 ID（網址要穩定）', () => {
  for (const b of catalog.books) assert.match(b.id, /^(main|event|memory)-\d+$/, b.id)
  assert.equal(new Set(catalog.books.map((b) => b.id)).size, catalog.books.length)
})

test('每本書：目錄的關數、行數與全文一致；對白只帶站上認得的兩種標記', () => {
  for (const entry of catalog.books) {
    const book = readBook(entry.id.replace('-', '/') + '.json')
    assert.equal(book.id, entry.id)
    assert.equal(book.kind, entry.kind)
    assert.equal(book.stages.length, entry.stages, `${entry.id} 關數`)
    let lines = 0
    for (const s of book.stages) {
      assert.ok(s.parts.length > 0, `${entry.id} ${s.key} 沒有任何對白`)
      for (const p of s.parts) {
        assert.ok(['start', 'battle', 'end'].includes(p.at), `${entry.id} ${s.key} 段落 ${p.at}`)
        for (const l of p.lines) {
          if (l === null) continue
          lines++
          assert.ok(Array.isArray(l) && typeof l[0] === 'string' && typeof l[1] === 'string', `${entry.id} ${s.key} 行格式`)
          // 遊戲富文字已在匯入時收斂成 <y>／<c=#…>；殘留原始標記代表 cleanText 漏了一種
          for (const m of l[1].matchAll(/<\/?([A-Za-z][\w-]*)(=[^>]*)?>/g)) {
            const ok = m[1] === 'y' ? !m[2] : m[1] === 'c' && (!m[2] || /^=#[0-9a-f]{6}$/.test(m[2]))
            assert.ok(ok, `${entry.id} ${s.key} 殘留標記：${m[0]}`)
          }
        }
      }
    }
    assert.equal(lines, entry.lines, `${entry.id} 行數`)
  }
})

test('互相參照指到存在的書', () => {
  const ids = new Set(catalog.books.map((b) => b.id))
  for (const file of bookFiles) {
    const b = readBook(file)
    for (const r of [...(b.seeAlso ?? []), ...(b.extra ?? [])]) assert.ok(ids.has(r.id), `${b.id} 參照不存在的 ${r.id}`)
  }
})

// ─── 場景條（PLAN-042-J）────────────────────────────────────────────────────
// 前台照 shots 插圖、不再判斷，所以壞資料一定要在這裡擋：指錯行會把圖插在分隔線上，
// 指到不存在的圖則是上線後破圖——而且 Cloudflare 會把那個 404 快取住。

const PUBLIC = new URL('../../../../public/', import.meta.url)
const publicFile = (p: string) => new URL(p.replace(/^\//, ''), PUBLIC)

// 「相鄰兩格不同張」只要求過場：戰鬥中切回戰場（沒有背景的行）之後再出現同一張 CG，是合理的重新定場
// （2026-11-28 全館 5 處：3 處隔著戰中分隔、2 處隔了 37／145 行戰場對白）
test('場景條：索引在範圍內、指到真的對白行、同一段嚴格遞增、過場裡相鄰兩格不同張', () => {
  let shots = 0
  for (const file of bookFiles) {
    const b = readBook(file)
    for (const s of b.stages) {
      for (const p of s.parts) {
        if (p.shots === undefined) continue
        assert.ok(p.shots.length > 0, `${b.id} ${s.key} ${p.at}：沒有圖就不該帶 shots`)
        let last = -1
        let lastKey = ''
        for (const [i, key] of p.shots) {
          assert.ok(Number.isInteger(i) && i > last && i < p.lines.length, `${b.id} ${s.key} ${p.at}：行索引 ${i}`)
          assert.ok(p.lines[i] !== null, `${b.id} ${s.key} ${p.at}：第 ${i} 行是分隔線`)
          assert.match(key, /^[\w-]+$/, `${b.id} ${s.key}：key ${key}`)
          if (p.at !== 'battle') assert.notEqual(key, lastKey, `${b.id} ${s.key} ${p.at}：相鄰兩格都是 ${key}`)
          last = i
          lastKey = key
          shots++
        }
      }
    }
  }
  assert.ok(shots > 0, '一張場景圖都沒有：匯入腳本的場景條壞了？')
})

test('場景條：書檔用到的 CG 與戰場地圖都在 public/images/game/story/', () => {
  const missing = new Set<string>()
  for (const file of bookFiles) {
    const b = readBook(file)
    if (b.map && !fs.existsSync(publicFile(mapStripPath(b.map)))) missing.add(mapStripPath(b.map))
    if (b.map) assert.equal(b.kind, 'main', `${b.id}：只有主線有區域地圖`)
    for (const s of b.stages) {
      for (const p of s.parts) {
        for (const [, key] of p.shots ?? []) if (!fs.existsSync(publicFile(scenePath(key)))) missing.add(scenePath(key))
      }
    }
  }
  assert.deepEqual([...missing], [], '缺圖：重跑 node scripts/import-story.mjs --write')
})

// ─── 說話者頭像（PLAN-042-J 第二段）─────────────────────────────────────────

test('頭像：face 與 lines 等長、編號在 faces 範圍內、分隔線與旁白是 0、書上列的每張都有人用', () => {
  let shown = 0
  for (const file of bookFiles) {
    const b = readBook(file)
    const used = new Set<number>()
    for (const s of b.stages) {
      for (const p of s.parts) {
        if (p.face === undefined) continue
        assert.ok(b.faces?.length, `${b.id}：有 face 卻沒有 faces 表`)
        assert.equal(p.face.length, p.lines.length, `${b.id} ${s.key} ${p.at}：face 與 lines 不等長`)
        p.face.forEach((n, i) => {
          assert.ok(Number.isInteger(n) && n >= 0 && n <= b.faces!.length, `${b.id} ${s.key} ${p.at}：第 ${i} 行編號 ${n}`)
          const line = p.lines[i]
          if (!line || !line[0]) assert.equal(n, 0, `${b.id} ${s.key} ${p.at}：第 ${i} 行是分隔線或旁白，卻有頭像`)
          if (n) { used.add(n); shown++ }
        })
      }
    }
    if (b.faces) assert.equal(used.size, b.faces.length, `${b.id}：faces 表有沒人用的頭像`)
  }
  assert.ok(shown > 0, '一個頭像都沒有：匯入腳本的頭像對照壞了？')
})

test('頭像：書檔用到的頭像都在 public/images/game/', () => {
  const missing = new Set<string>()
  for (const file of bookFiles) {
    for (const f of readBook(file).faces ?? []) {
      assert.match(f, /^(pilots|npc)\/[\w/-]+$/, `頭像路徑 ${f}`)
      if (!fs.existsSync(publicFile(facePath(f)))) missing.add(facePath(f))
    }
  }
  assert.deepEqual([...missing], [], '缺圖：頭像是 PLAN-054 已上站的圖，檔案被搬走或改名了？重跑 node scripts/import-story.mjs --write')
})

// ─── 選章舞台（PLAN-042-K）──────────────────────────────────────────────────

test('代表圖：每本都有、圖在站上；覆寫表的書與圖都存在', () => {
  for (const b of catalog.books) {
    assert.ok(b.cover, `${b.id} 沒有代表圖`)
    assert.ok(fs.existsSync(publicFile(scenePath(b.cover))), `${b.id} 的代表圖 ${b.cover} 不在站上`)
  }
  const overrides = JSON.parse(fs.readFileSync(new URL('../../../../scripts/lib/storyCovers.json', import.meta.url), 'utf8')) as Record<string, string>
  for (const [id, key] of Object.entries(overrides)) {
    if (id.startsWith('//')) continue
    assert.ok(catalog.books.some((b) => b.id === id), `storyCovers.json：沒有 ${id} 這本書`)
    assert.ok(fs.existsSync(publicFile(scenePath(key))), `storyCovers.json：${id} → ${key} 站上沒有這張圖`)
    assert.equal(catalog.books.find((b) => b.id === id)?.cover, key, `storyCovers.json：${id} 的覆寫沒有套用（重跑 import-story.mjs --write）`)
  }
})

test('關卡大綱 outline.json 與書檔一一對應（key／編號／名稱／支線／分幕）', () => {
  const outline = JSON.parse(fs.readFileSync(new URL('outline.json', DIR), 'utf8')) as StoryOutline
  assert.deepEqual(Object.keys(outline).sort(), catalog.books.map((b) => b.id).sort())
  for (const file of bookFiles) {
    const b = readBook(file)
    assert.deepEqual(
      outline[b.id],
      b.stages.map((s) => (s.group ? [s.key, s.code, s.name, s.branch ? 1 : 0, s.group] : [s.key, s.code, s.name, s.branch ? 1 : 0])),
      `${b.id} 的大綱與書檔不一致（重跑 import-story.mjs --write）`,
    )
  }
})
