// 劇情故事館的靜態資料（scripts/import-story.mjs 產出的 src/data/story/）與前台的約定
//   npm test   →   node --test "src/**/*.test.ts"
//
// 前台用 import.meta.glob 載書、用目錄畫館首頁：兩邊對不上的話，館首頁會出現點進去被轉走的卡片，
// 或有書檔卻沒有入口。這裡直接讀檔核對，不經過 Vite。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { StoryBook, StoryCatalog } from './storyTypes.ts'

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
