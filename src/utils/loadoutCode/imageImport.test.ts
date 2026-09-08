// PLAN-052-O：從配裝圖讀回分享碼 —— 只測純函式 `imageFromDataTransfer()`
//   npm test   →   node --test "src/**/*.test.ts"
//
// `readLoadoutFromImage()` 依賴 canvas／`createImageBitmap`，Node 沒有，交給 Playwright e2e。
// 這裡釘的是 paste／drop 事件到「拿到哪個檔」之間的取捨：
//   ① `files` 優先於 `items`（Chrome 貼圖時兩邊都有、內容相同；Firefox 有時只有 items）；
//   ② 非圖片檔一律略過 —— 使用者把一個 .txt 拖進來，對話框要說「不是圖片」，
//      而不是把它送去解碼然後說「讀不出來」；
//   ③ 沒有 DataTransfer（某些合成事件）不可以 throw。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageFromDataTransfer } from './imageImport.ts'

type Dt = Parameters<typeof imageFromDataTransfer>[0]
interface FakeItem { kind: string; type: string; getAsFile(): File | null }

/** 假的 DataTransfer：只湊 `files` 與 `items` 兩個欄位（函式的 `Pick` 就是為了這個）。 */
const fakeDt = (files: File[], items: FakeItem[] = []): Dt => ({ files, items }) as unknown as Dt

const png = (name = 'loadout.png') =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'shot.jpg', { type: 'image/jpeg' })
const txt = () => new File(['hello'], 'note.txt', { type: 'text/plain' })
const fileItem = (f: File): FakeItem => ({ kind: 'file', type: f.type, getAsFile: () => f })
const stringItem = (type = 'text/plain'): FakeItem => ({ kind: 'string', type, getAsFile: () => null })

test('沒有 DataTransfer（null／undefined）回 null，不 throw', () => {
  assert.equal(imageFromDataTransfer(null), null)
  assert.equal(imageFromDataTransfer(undefined), null)
})

test('files 裡有圖片檔：回那個 File 本身（同一個參考）', () => {
  const f = png()
  assert.equal(imageFromDataTransfer(fakeDt([f])), f)
})

test('files 裡先是非圖片、後面才是圖片：略過前者、取圖片', () => {
  const f = jpeg()
  assert.equal(imageFromDataTransfer(fakeDt([txt(), f])), f)
})

test('files 優先於 items：兩邊都有時回 files 的那個', () => {
  const fromFiles = png('a.png')
  const fromItems = png('b.png')
  assert.equal(imageFromDataTransfer(fakeDt([fromFiles], [fileItem(fromItems)])), fromFiles)
})

test('files 是空的才看 items：kind==="file" 且 type 是 image/* 的項目', () => {
  const f = png()
  assert.equal(imageFromDataTransfer(fakeDt([], [stringItem('text/html'), fileItem(f)])), f)
})

test('items 裡的非圖片檔與 getAsFile() 回 null 的項目都略過', () => {
  const dead: FakeItem = { kind: 'file', type: 'image/png', getAsFile: () => null }
  assert.equal(imageFromDataTransfer(fakeDt([], [fileItem(txt()), dead])), null)
})

test('兩邊都只有非圖片：回 null（對話框據此說「不是圖片檔」）', () => {
  assert.equal(imageFromDataTransfer(fakeDt([txt()], [fileItem(txt()), stringItem()])), null)
})

test('files／items 缺席（只有其中一個欄位）也不 throw', () => {
  const f = png()
  assert.equal(imageFromDataTransfer({ files: [f] } as unknown as Dt), f)
  assert.equal(imageFromDataTransfer({ items: [fileItem(f)] } as unknown as Dt), f)
  assert.equal(imageFromDataTransfer({} as unknown as Dt), null)
})

// ── 審查修正（2026-09-08）：空 type 後備 ＋ 尺寸炸彈守門 ─────────────────────
import sharp from 'sharp'
import { imageDimensionsFromHeader, MAX_IMAGE_PIXELS } from './imageImport.ts'

test('type 為空字串的檔當後備收下（交給檔頭判定），但只在沒有 image/* 檔時；type 明確非圖片仍略過', () => {
  const untyped = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'noext', { type: '' })
  assert.equal(imageFromDataTransfer(fakeDt([untyped])), untyped)
  const p = png()
  assert.equal(imageFromDataTransfer(fakeDt([untyped, p])), p, 'image/* 優先於空 type')
  assert.equal(imageFromDataTransfer(fakeDt([txt(), untyped])), untyped, 'text/plain 略過、空 type 收下')
  assert.equal(imageFromDataTransfer(fakeDt([txt()])), null)
})

test('imageDimensionsFromHeader：PNG／JPEG（基線與漸進式）／GIF 只憑檔頭讀尺寸；WebP 與非圖片回 null', async () => {
  const mk = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
  const pngBuf = await mk(321, 123).png().toBuffer()
  assert.deepEqual(imageDimensionsFromHeader(new Uint8Array(pngBuf)), { width: 321, height: 123 })
  const jpgBuf = await mk(640, 480).jpeg().toBuffer()
  assert.deepEqual(imageDimensionsFromHeader(new Uint8Array(jpgBuf)), { width: 640, height: 480 })
  const pjpg = await mk(200, 100).jpeg({ progressive: true }).toBuffer()
  assert.deepEqual(imageDimensionsFromHeader(new Uint8Array(pjpg)), { width: 200, height: 100 })
  const gifBuf = await mk(77, 33).gif().toBuffer()
  assert.deepEqual(imageDimensionsFromHeader(new Uint8Array(gifBuf)), { width: 77, height: 33 })
  const webp = await mk(10, 10).webp().toBuffer()
  assert.equal(imageDimensionsFromHeader(new Uint8Array(webp)), null)
  assert.equal(imageDimensionsFromHeader(new Uint8Array([1, 2, 3])), null)
  assert.equal(imageDimensionsFromHeader(new Uint8Array()), null)
  // 只讀檔頭：JPEG 截到 SOF 之後也讀得到（守門員不需要整張圖）
  assert.deepEqual(imageDimensionsFromHeader(new Uint8Array(jpgBuf.subarray(0, 600))), { width: 640, height: 480 })
})

test('尺寸炸彈：不到 100 bytes 的 PNG 宣告 20000×16000，光看檔頭就超過像素上限', () => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  const bomb = new Uint8Array([...sig, ...be(13), 0x49, 0x48, 0x44, 0x52, ...be(20000), ...be(16000), 8, 2, 0, 0, 0, 0, 0, 0, 0])
  const d = imageDimensionsFromHeader(bomb)
  assert.ok(d && d.width * d.height > MAX_IMAGE_PIXELS)
})
