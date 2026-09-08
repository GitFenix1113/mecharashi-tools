// pngText 的測試 —— PLAN-052-O Phase A
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這一組測的是三件**在圖上看不出來**的事：
//   ① 寫出去的 chunk 是不是「別人也讀得懂」的 tEXt（長度／型別／CRC 全合規）—— 一個位元組
//      算錯，看圖軟體可能整張判壞、但 readPngText 自己仍讀得回，單靠 round trip 抓不到；
//      所以拿 `node:zlib` 的 crc32 與 `sharp`（libvips）當獨立的裁判。
//   ② 讀取端吃任何位元組都不 throw —— 使用者丟進來的是 JPEG、截斷檔、宣稱 4GB 的 chunk，
//      在對話框裡一個例外＝「貼了圖沒反應」。
//   ③ 寫入端不對勁一律回 null 而不是 throw —— 它跑在匯出流程尾端，例外＝整張圖存不下來。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 as zlibCrc32 } from 'node:zlib'
import sharp from 'sharp'
import {
  LOADOUT_PNG_KEYWORD,
  crc32,
  isPng,
  insertPngText,
  readPngText,
  dataUrlToBytes,
} from './pngText.ts'

const KW = LOADOUT_PNG_KEYWORD
const SHARE_URL = 'https://mecharashi.wiki/simulator?b=ASEWNAEUAQAHZGVmYXVsdAIBEAqwAQGIjgZC'

// ─── 測試用的 PNG 組裝工具（獨立實作，不借用被測檔的 walker） ─────────────────

const ascii = (s: string): number[] => Array.from(new TextEncoder().encode(s))

const u32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]

const readU32 = (b: Uint8Array, at: number): number =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

/** 組一個 chunk：長度 ＋ 型別 ＋ 資料 ＋ CRC（CRC 涵蓋型別＋資料，用 zlib 算、不靠被測檔）。 */
function chunk(type: string, data: number[]): number[] {
  const body = Uint8Array.from([...ascii(type), ...data])
  return [...u32(data.length), ...body, ...u32(zlibCrc32(body))]
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** IHDR 資料：1×1、8-bit 灰階、無交錯（13 bytes，規格固定）。 */
const IHDR_DATA = [...u32(1), ...u32(1), 8, 0, 0, 0, 0]
/** signature ＋ IHDR ＝ 8 ＋ 12 ＋ 13；tEXt 應插在這個位移。 */
const AFTER_IHDR = 8 + 12 + IHDR_DATA.length

/** 最小合法 PNG：signature ＋ IHDR 1×1 ＋（可選的中間 chunk）＋ IEND。沒有 IDAT，因為被測檔不解像素。 */
function minimalPng(middle: number[] = []): Uint8Array {
  return Uint8Array.from([...SIGNATURE, ...chunk('IHDR', IHDR_DATA), ...middle, ...chunk('IEND', [])])
}

interface ParsedChunk {
  type: string
  len: number
  /** 長度欄位的位移 */
  at: number
  dataStart: number
  crc: number
}

/** 逐 chunk 走到 IEND；只給結構正常的 PNG 用（測試自己組的，長度都是誠實的）。 */
function parseChunks(bytes: Uint8Array): ParsedChunk[] {
  const out: ParsedChunk[] = []
  let at = SIGNATURE.length
  while (at + 12 <= bytes.length) {
    const len = readU32(bytes, at)
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    out.push({ type, len, at, dataStart: at + 8, crc: readU32(bytes, at + 8 + len) })
    at += 12 + len
    if (type === 'IEND') break
  }
  return out
}

/** 可重現的雜訊（LCG）：測試要能穩定重跑，不能用 Math.random。 */
function pseudoRandomBytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out[i] = s >>> 24
  }
  return out
}

const bytesOf = (b: Uint8Array): number[] => Array.from(b)

// ─── CRC ────────────────────────────────────────────────────────────────────

test('CRC-32 錨點：crc32("IEND") 必須是 0xae426082 —— 每張 PNG 都帶著的規格常數', () => {
  assert.equal(crc32(Uint8Array.from(ascii('IEND'))), 0xae426082)
  // ISO 3309 的標準檢查值（"123456789"）；與 zlib 同一條多項式
  assert.equal(crc32(Uint8Array.from(ascii('123456789'))), 0xcbf43926)
  assert.equal(crc32(Uint8Array.from(ascii('123456789'))), zlibCrc32('123456789'))
  // 空範圍 ＝ 0（zlib 的 crc32(0, NULL, 0) 慣例）
  assert.equal(crc32(new Uint8Array(0)), 0)
})

test('crc32 的 [start, end) 範圍要真的生效 —— chunk 的 CRC 只涵蓋型別＋資料，不含前面的長度欄位', () => {
  const padded = Uint8Array.from([0xff, 0x00, ...ascii('IEND'), 0x12, 0x34])
  assert.equal(crc32(padded, 2, 6), 0xae426082)
  assert.notEqual(crc32(padded), 0xae426082, '整段算的值必須不同，否則測不出範圍有沒有生效')
  // 高位元有值時仍是無號數（不會因為 JS 的 32 位有號位元運算變負）
  const noise = pseudoRandomBytes(1000, 7)
  const v = crc32(noise, 100, 900)
  assert.ok(v >= 0 && v <= 0xffffffff)
  assert.equal(v, zlibCrc32(noise.subarray(100, 900)))
})

// ─── 寫入 ───────────────────────────────────────────────────────────────────

test('最小合法 PNG（signature ＋ IHDR 1×1 ＋ IEND）：插入後讀得回、輸入陣列不被改動', () => {
  const png = minimalPng()
  const snapshot = bytesOf(png)
  const out = insertPngText(png, KW, SHARE_URL)
  assert.ok(out, '插不進去')
  assert.equal(readPngText(out, KW), SHARE_URL)
  assert.deepEqual(bytesOf(png), snapshot, '輸入陣列不該被就地修改')
  assert.equal(out.length, png.length + 12 + KW.length + 1 + SHARE_URL.length)
  assert.equal(isPng(out), true)
  assert.equal(readPngText(png, KW), null, '原圖本來就沒有這個 chunk')
})

test('插入位置在 IHDR 之後：第二個 chunk 是 tEXt、內容 ＝ keyword ＋ NUL ＋ text，前後的 chunk 原封不動', () => {
  const png = minimalPng()
  const out = insertPngText(png, KW, 'hello')!
  const chunks = parseChunks(out)
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'tEXt', 'IEND'])

  const t = chunks[1]
  assert.equal(t.at, AFTER_IHDR)
  assert.equal(t.len, KW.length + 1 + 'hello'.length)
  assert.deepEqual(bytesOf(out.subarray(t.dataStart, t.dataStart + t.len)), [...ascii(KW), 0, ...ascii('hello')])

  // signature ＋ IHDR（含 CRC）與 IEND 逐位元組與原圖相同
  assert.deepEqual(bytesOf(out.subarray(0, AFTER_IHDR)), bytesOf(png.subarray(0, AFTER_IHDR)))
  assert.deepEqual(bytesOf(out.subarray(t.dataStart + t.len + 4)), bytesOf(png.subarray(AFTER_IHDR)))
})

test('原圖 IHDR 之後已有其他 chunk（sharp 常見的 pHYs／既有 tEXt）時，我們的 tEXt 仍排在它們前面', () => {
  const png = minimalPng([
    ...chunk('pHYs', [...u32(2835), ...u32(2835), 1]),
    ...chunk('tEXt', [...ascii('Software'), 0, ...ascii('test')]),
  ])
  const out = insertPngText(png, KW, 'first')!
  assert.deepEqual(parseChunks(out).map((c) => c.type), ['IHDR', 'tEXt', 'pHYs', 'tEXt', 'IEND'])
  assert.equal(readPngText(out, KW), 'first')
  assert.equal(readPngText(out, 'Software'), 'test', '既有的 tEXt 不受影響')
})

test('tEXt chunk 的 CRC 是重算過的：涵蓋「型別＋資料」、與 zlib 的算法一致、跟著資料變', () => {
  const out = insertPngText(minimalPng(), KW, 'crc-check')!
  const t = parseChunks(out)[1]
  assert.equal(t.type, 'tEXt')
  const covered = out.subarray(t.at + 4, t.dataStart + t.len)
  assert.equal(t.crc, zlibCrc32(covered), '與獨立實作（node:zlib）算出的值不同 ⇒ 看圖軟體會判 chunk 壞掉')
  assert.equal(t.crc, crc32(out, t.at + 4, t.dataStart + t.len))
  assert.notEqual(t.crc, zlibCrc32(out.subarray(t.at, t.dataStart + t.len)), '誤把長度欄位算進去會得到另一個值')
  // 差一個字元就是另一個 CRC —— 確認 CRC 真的綁著資料，不是寫死的常數
  const other = parseChunks(insertPngText(minimalPng(), KW, 'crc-cheek')!)[1]
  assert.notEqual(other.crc, t.crc)
})

test('長度不設上限：比 QR 畫不到的 4096 字元碼更長的 text 也照樣進出（這正是內嵌路徑存在的理由）', () => {
  const text = `https://mecharashi.wiki/simulator?b=${'A'.repeat(8000)}`
  const out = insertPngText(minimalPng(), KW, text)!
  assert.equal(readPngText(out, KW), text)
  assert.equal(parseChunks(out)[1].len, KW.length + 1 + text.length)
})

// ─── 不對勁的輸入：寫入回 null、讀取回 null，都不 throw ─────────────────────

test('非 PNG（JPEG 檔頭、空陣列、隨機 bytes）：isPng 為 false，讀寫皆 null、不 throw', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1])
  const cases: [string, Uint8Array][] = [
    ['JPEG', jpeg],
    ['空陣列', new Uint8Array(0)],
    ['雜訊', pseudoRandomBytes(4096, 0x52a1)],
  ]
  for (const [name, bytes] of cases) {
    assert.equal(isPng(bytes), false, name)
    assert.doesNotThrow(() => readPngText(bytes, KW), name)
    assert.equal(readPngText(bytes, KW), null, name)
    assert.doesNotThrow(() => insertPngText(bytes, KW, 'x'), name)
    assert.equal(insertPngText(bytes, KW, 'x'), null, name)
  }
  // 檔頭差一個 byte、或不足 8 bytes，都不算 PNG
  assert.equal(isPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b])), false)
  assert.equal(isPng(Uint8Array.from(SIGNATURE.slice(0, 7))), false)
  assert.equal(isPng(Uint8Array.from(SIGNATURE)), true, '只有 8 bytes 檔頭也算 PNG（讀取時再處理沒有 chunk 的情況）')
})

test('截斷的 PNG：從任何位置切斷都不 throw；tEXt 連 CRC 一起完整才讀得到', () => {
  const full = insertPngText(minimalPng(), KW, 'cut')!
  const t = parseChunks(full)[1]
  const textChunkEnd = t.dataStart + t.len + 4
  for (let cut = 0; cut <= full.length; cut++) {
    const part = full.subarray(0, cut)
    assert.doesNotThrow(() => readPngText(part, KW), `讀取：切在 ${cut}`)
    assert.equal(readPngText(part, KW), cut >= textChunkEnd ? 'cut' : null, `讀取：切在 ${cut}`)
    assert.doesNotThrow(() => insertPngText(part, KW, 'again'), `插入：切在 ${cut}`)
  }
  // 連 IHDR 都不完整就沒有「IHDR 之後」可插 ⇒ null
  for (const cut of [0, 7, 8, 12, 20, AFTER_IHDR - 1]) {
    assert.equal(insertPngText(full.subarray(0, cut), KW, 'x'), null, `插入：切在 ${cut}`)
  }
  // IHDR 完整、後面不管截在哪，插得進去而且讀得回（呼叫端拿到的不會是壞掉一半的 chunk）
  const stub = insertPngText(full.subarray(0, AFTER_IHDR), KW, 'stub')!
  assert.equal(readPngText(stub, KW), 'stub')
})

test('宣告超長的 chunk 長度（截斷或造假）：不讀出界、不無窮迴圈，回 null', () => {
  // ① tEXt 宣稱 0xffffffff bytes，後面其實只有幾個 byte（keyword 對得上也不能讀）
  const lyingText = Uint8Array.from([
    ...SIGNATURE, ...chunk('IHDR', IHDR_DATA),
    ...u32(0xffffffff), ...ascii('tEXt'), ...ascii(KW), 0, ...ascii('x'),
  ])
  assert.doesNotThrow(() => readPngText(lyingText, KW))
  assert.equal(readPngText(lyingText, KW), null)

  // ② IEND 前的 IDAT 宣稱 2GB —— 不會因為「後面有 IEND」就放行
  const lyingIdat = Uint8Array.from([
    ...SIGNATURE, ...chunk('IHDR', IHDR_DATA),
    ...u32(0x7fffffff), ...ascii('IDAT'), 1, 2, 3, 4,
    ...chunk('tEXt', [...ascii(KW), 0, ...ascii('unreachable')]),
    ...chunk('IEND', []),
  ])
  assert.doesNotThrow(() => readPngText(lyingIdat, KW))
  assert.equal(readPngText(lyingIdat, KW), null)

  // ③ IHDR 本身宣稱超長 ⇒ 找不到「IHDR 之後」的位置，插入回 null
  const lyingIhdr = Uint8Array.from([
    ...SIGNATURE, ...u32(0x10000), ...ascii('IHDR'), ...IHDR_DATA, 0, 0, 0, 0, ...chunk('IEND', []),
  ])
  assert.doesNotThrow(() => insertPngText(lyingIhdr, KW, 'x'))
  assert.equal(insertPngText(lyingIhdr, KW, 'x'), null)
  assert.equal(readPngText(lyingIhdr, KW), null)

  // ④ 第一個 chunk 不是 IHDR（規格強制）⇒ 也回 null，不會把 tEXt 插到 IHDR 前面
  const noIhdr = Uint8Array.from([
    ...SIGNATURE, ...chunk('tEXt', [...ascii('k'), 0]), ...chunk('IHDR', IHDR_DATA), ...chunk('IEND', []),
  ])
  assert.equal(insertPngText(noIhdr, KW, 'x'), null)
})

test('keyword 不合規（空、80 字、前後空白、連續空白、非 Latin-1、控制字元）一律 null；邊界 79 字與 Latin-1 高位可以', () => {
  const png = minimalPng()
  for (const bad of ['', 'a'.repeat(80), ' key', 'key ', 'a  b', '機師', 'k\x7fy', 'k\x00y', '\t', 'kĀ']) {
    assert.doesNotThrow(() => insertPngText(png, bad, 'x'), JSON.stringify(bad))
    assert.equal(insertPngText(png, bad, 'x'), null, JSON.stringify(bad))
  }
  for (const ok of ['a', 'a'.repeat(79), 'a b', 'café', KW]) {
    const out = insertPngText(png, ok, 'x')
    assert.ok(out, JSON.stringify(ok))
    assert.equal(readPngText(out, ok), 'x', JSON.stringify(ok))
  }
})

test('text 含非 Latin-1（中文、emoji）或 NUL ⇒ null —— 寫出規格外的 chunk 會讓某些看圖軟體判整張圖壞掉', () => {
  const png = minimalPng()
  for (const bad of ['備註', `${SHARE_URL}😀`, 'a\0b', 'Ā']) {
    assert.doesNotThrow(() => insertPngText(png, KW, bad), JSON.stringify(bad))
    assert.equal(insertPngText(png, KW, bad), null, JSON.stringify(bad))
  }
  // Latin-1 上限 0xff、空字串都合法；空字串讀回是 ''（有 chunk）而不是 null（沒 chunk）
  for (const ok of ['', 'ÿ', 'plain ascii ~', 'https://mecharashi.wiki/simulator?b=ABC-_']) {
    const out = insertPngText(png, KW, ok)
    assert.ok(out, JSON.stringify(ok))
    assert.equal(readPngText(out, KW), ok, JSON.stringify(ok))
  }
})

// ─── 讀取 ───────────────────────────────────────────────────────────────────

test('走訪只到 IEND 為止：IEND 之後的 tEXt 不算數（尾巴的垃圾不該被當成資料）', () => {
  const trailing = Uint8Array.from([...minimalPng(), ...chunk('tEXt', [...ascii(KW), 0, ...ascii('ghost')])])
  assert.equal(readPngText(trailing, KW), null)
})

test('多個 tEXt 各認各的 keyword：別人的、不存在的、只有前綴相同的都 null；沒有 NUL 的壞 tEXt 直接跳過', () => {
  const png = minimalPng([
    ...chunk('tEXt', [...ascii('Software')]), // 沒有 NUL 分隔 ⇒ 略過、不 throw
    ...chunk('tEXt', [...ascii('Comment'), 0, ...ascii('hello')]),
    ...chunk('tEXt', [...ascii('Empty'), 0]),
  ])
  const out = insertPngText(png, KW, 'mine')!
  assert.equal(readPngText(out, KW), 'mine')
  assert.equal(readPngText(out, 'Comment'), 'hello')
  assert.equal(readPngText(out, 'Empty'), '')
  assert.equal(readPngText(out, 'Software'), null)
  assert.equal(readPngText(out, 'Nope'), null)
  assert.equal(readPngText(out, 'mecharashi'), null, '前綴相同不算命中')
  assert.equal(readPngText(out, `${KW}x`), null, '多一個字元也不算')
})

test('讀取端刻意不驗 CRC：tEXt 的 CRC 被改壞仍讀得到 —— 被工具改壞 CRC 的圖不該白白失去這條路徑', () => {
  const out = insertPngText(minimalPng(), KW, 'still-here')!
  const t = parseChunks(out)[1]
  out[t.dataStart + t.len] ^= 0xff
  assert.notEqual(parseChunks(out)[1].crc, zlibCrc32(out.subarray(t.at + 4, t.dataStart + t.len)), '前置：CRC 確實壞了')
  assert.equal(readPngText(out, KW), 'still-here')
})

// ─── 真的 PNG：拿 sharp（libvips）當獨立裁判 ────────────────────────────────

test('sharp 產的 PNG 插入後：sharp 仍讀得出寬高與像素、把那個 tEXt 當正規 metadata 讀出來；readPngText 也讀得回', async () => {
  const png = await sharp({
    create: { width: 5, height: 3, channels: 4, background: { r: 10, g: 12, b: 16, alpha: 1 } },
  }).png().toBuffer()
  assert.equal(isPng(png), true)

  const out = insertPngText(png, KW, SHARE_URL)
  assert.ok(out, '真的 PNG 插不進去')

  const meta = await sharp(out).metadata()
  assert.equal(meta.format, 'png')
  assert.equal(meta.width, 5)
  assert.equal(meta.height, 3)
  // libvips 把它當成正規的 tEXt 讀出來 —— 證明長度／型別／CRC 都合規，不是「只有自己讀得懂」
  assert.deepEqual(
    (meta.comments ?? []).filter((c) => c.keyword === KW),
    [{ keyword: KW, text: SHARE_URL }],
  )
  // 像素也解得開（IDAT 沒被我們的插入弄壞）
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
  assert.equal(data.length, info.width * info.height * info.channels)
  assert.deepEqual([data[0], data[1], data[2]], [10, 12, 16])

  assert.equal(readPngText(out, KW), SHARE_URL)
  assert.equal(parseChunks(out)[1].type, 'tEXt', 'sharp 自己也會寫 chunk，我們的仍要排在 IHDR 之後第一位')
})

test('與匯出流程同構：toPng 的 data URL → dataUrlToBytes → insertPngText → 下載的檔案是 sharp 認得的 PNG', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 100, b: 50 } },
  }).png().toBuffer()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`

  const bytes = dataUrlToBytes(dataUrl)
  assert.ok(bytes)
  assert.deepEqual(bytesOf(bytes), bytesOf(png), 'data URL 拆回來要與原位元組一模一樣')

  const stamped = insertPngText(bytes, KW, SHARE_URL)
  assert.ok(stamped)
  const meta = await sharp(stamped).metadata()
  assert.deepEqual([meta.width, meta.height], [2, 2])
  assert.equal(readPngText(stamped, KW), SHARE_URL)
})

// ─── dataUrlToBytes ─────────────────────────────────────────────────────────

test('dataUrlToBytes：base64（html-to-image 的 toPng 格式）拆回一模一樣的位元組', () => {
  const png = minimalPng()
  const bytes = dataUrlToBytes(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
  assert.ok(bytes)
  assert.deepEqual(bytesOf(bytes), bytesOf(png))
  assert.equal(isPng(bytes), true)
  // MIME 帶參數也拆得開
  assert.deepEqual(bytesOf(dataUrlToBytes('data:text/plain;charset=utf-8;base64,aGk=')!), ascii('hi'))
})

test('dataUrlToBytes：非 base64 的 data URL 走百分比解碼 ＋ UTF-8', () => {
  assert.deepEqual(bytesOf(dataUrlToBytes('data:text/plain,hello%20world')!), ascii('hello world'))
  assert.deepEqual(bytesOf(dataUrlToBytes('data:,%E6%A9%9F')!), Array.from(new TextEncoder().encode('機')))
  assert.deepEqual(bytesOf(dataUrlToBytes('data:,')!), [], '空內容是空陣列，不是 null')
})

test('dataUrlToBytes：不是 data URL、base64 壞掉、百分比編碼壞掉一律 null、不 throw', () => {
  const bad = [
    '',
    'https://mecharashi.wiki/x.png',
    'iVBORw0KGgo=', // 裸 base64、沒有 data: 前綴
    'data:image/png;base64', // 沒有逗號
    'data:image/png;base64,@@@@', // atob 吃不下的字元
    'data:text/plain,%E0%A4%A', // 壞掉的百分比編碼
  ]
  for (const s of bad) {
    assert.doesNotThrow(() => dataUrlToBytes(s), JSON.stringify(s))
    assert.equal(dataUrlToBytes(s), null, JSON.stringify(s))
  }
})

// ── 審查修正（2026-09-08）：兩道新守門 ────────────────────────────────────────
import { MAX_TEXT_CHUNK_BYTES } from './pngText.ts'

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const IEND = [...be32(0), 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
/** 讀取端不驗 CRC，測試用的 chunk CRC 填 0 即可 */
const rawChunk = (type: string, data: number[]) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0]

test('IHDR 長度不是 13 時 insertPngText 回 null —— 照造假的長度算插入點會把 tEXt 塞進別的 chunk 中間', () => {
  const png = new Uint8Array([...SIG, ...rawChunk('IHDR', new Array(14).fill(0)), ...IEND])
  assert.equal(insertPngText(png, LOADOUT_PNG_KEYWORD, 'x'), null)
  // 對照：13 bytes 就插得進去
  const ok = new Uint8Array([...SIG, ...rawChunk('IHDR', new Array(13).fill(0)), ...IEND])
  assert.notEqual(insertPngText(ok, LOADOUT_PNG_KEYWORD, 'x'), null)
})

test(`超過 MAX_TEXT_CHUNK_BYTES（${MAX_TEXT_CHUNK_BYTES}）的 tEXt 直接跳過、不拼字串；後面正常的那個仍讀得到`, () => {
  const kw = [...LOADOUT_PNG_KEYWORD].map((c) => c.charCodeAt(0))
  const huge = [...kw, 0, ...new Array(MAX_TEXT_CHUNK_BYTES + 1 - kw.length - 1).fill(0x41)]
  const normal = [...kw, 0, ...[...'ok'].map((c) => c.charCodeAt(0))]
  const png = new Uint8Array([...SIG, ...rawChunk('IHDR', new Array(13).fill(0)), ...rawChunk('tEXt', huge), ...rawChunk('tEXt', normal), ...IEND])
  assert.equal(readPngText(png, LOADOUT_PNG_KEYWORD), 'ok')
  // 只有那個超大的 ⇒ null（不是整串 'AAAA…'）
  const onlyHuge = new Uint8Array([...SIG, ...rawChunk('IHDR', new Array(13).fill(0)), ...rawChunk('tEXt', huge), ...IEND])
  assert.equal(readPngText(onlyHuge, LOADOUT_PNG_KEYWORD), null)
  // 剛好等於上限的仍然讀（邊界含）
  const atLimit = [...kw, 0, ...new Array(MAX_TEXT_CHUNK_BYTES - kw.length - 1).fill(0x42)]
  const atLimitPng = new Uint8Array([...SIG, ...rawChunk('IHDR', new Array(13).fill(0)), ...rawChunk('tEXt', atLimit), ...IEND])
  assert.equal(readPngText(atLimitPng, LOADOUT_PNG_KEYWORD)?.length, MAX_TEXT_CHUNK_BYTES - kw.length - 1)
})
