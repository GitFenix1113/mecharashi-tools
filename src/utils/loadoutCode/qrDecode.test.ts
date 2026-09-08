// PLAN-052-O Phase A：從像素找 QR（zxing-wasm）
//   npm test   →   node --test "src/**/*.test.ts"
//   單跑      →   node --test src/utils/loadoutCode/qrDecode.test.ts
//
// 這一組把 `_local-notes/2026-09/2026-09-08_qr-sanity4.mts` 的實驗固定成迴歸測試。它守的是
// 「解碼器選型的前提」：換掉 zxing-wasm、或動了 `OPTIONS`（tryHarder／tryDownscale／
// maxNumberOfSymbols），任何一條掉下來都代表使用者端會有一批圖突然讀不出來 —— 而那種退化
// 在 UI 上**看不出來**（對話框只會說「找不到 QR」，不會說是解碼器變弱了）。
//
// 測試圖不是真的匯出圖，而是**同構的合成圖**：2000×2400 的深色底（#0a0c10）右下角放一塊
// 420 實體 px 的白底 QR 方塊、最近鄰放大 —— 與 LoadoutExportCard 的版面、`loadoutQr()` 的
// BOX_PX × pixelRatio 一致。這樣不必在 repo 裡塞 PNG fixture，而且碼長可以任意調：
// 1461 字元那張每模組只有 3.07px（非整數間距），正是 jsQR 全數陣亡的那種圖。
//
// ⚠ 全檔離線：wasm 直接從 node_modules 讀進 `wasmBinary`，沒網路也能跑。`locateFile` 給的是
//   假網址 —— 有 wasmBinary 時 zxing 不會真的去抓，留著它是為了「萬一真的去抓」會炸在明處，
//   而不是靜默走套件預設的 jsDelivr CDN、讓測試在 CI 上偶爾因網路而綠紅不定。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encode } from 'uqr'
import sharp from 'sharp'
import { configureQrDecoder, decodeQrTexts, type PixelFrame } from './qrDecode.ts'

configureQrDecoder({
  wasmBinary: readFileSync(new URL('../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url)),
  locateFile: () => 'nonexistent://should-not-be-fetched/zxing_reader.wasm',
})

// ── 匯出圖的版面常數（與 exportTheme／loadoutQr 同構）──────────────────────────
/** 匯出圖尺寸（實體 px；1000×1200 CSS px × pixelRatio 2） */
const CANVAS_W = 2000
const CANVAS_H = 2400
/** QR 白底方塊邊長（實體 px；`loadoutQr` 的 boxPx 210 × pixelRatio 2） */
const BOX_PX = 420
/** 方塊與圖片邊緣的留白 */
const MARGIN = 24
/** 匯出圖底色 #0a0c10 */
const BG: readonly [number, number, number] = [0x0a, 0x0c, 0x10]

const urlWithCode = (n: number) => `https://mecharashi.wiki/simulator?b=${'A'.repeat(n)}`

/** 整張填成匯出圖底色的空畫布 */
function darkCanvas(width: number, height: number): PixelFrame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let o = 0; o < data.length; o += 4) {
    data[o] = BG[0]
    data[o + 1] = BG[1]
    data[o + 2] = BG[2]
    data[o + 3] = 255
  }
  return { data, width, height }
}

/**
 * 把 `url` 編成 QR（ecc L、靜區 4，與 `loadoutQr` 同參數），最近鄰放大成 `boxPx` 的白底方塊，
 * 畫在 `frame` 的 (x0, y0)。黑模組用底色而不是純黑 —— 匯出圖就是這樣畫的（`fill` 取主題色）。
 * 回每模組佔幾個實體像素（非整數時模組寬會在 floor／ceil 之間交錯，訊息裡印出來好對照）。
 */
function paintQr(frame: PixelFrame, url: string, boxPx: number, x0: number, y0: number): number {
  const m = encode(url, { ecc: 'L', border: 4 })
  const pxPerModule = boxPx / m.size
  for (let y = 0; y < boxPx; y++) {
    const row = m.data[Math.floor(y / pxPerModule)]
    for (let x = 0; x < boxPx; x++) {
      const black = row[Math.floor(x / pxPerModule)]
      const o = ((y0 + y) * frame.width + (x0 + x)) * 4
      frame.data[o] = black ? BG[0] : 0xff
      frame.data[o + 1] = black ? BG[1] : 0xff
      frame.data[o + 2] = black ? BG[2] : 0xff
      frame.data[o + 3] = 255
    }
  }
  return pxPerModule
}

/** 匯出圖同構：深色底、右下角一塊 QR */
function exportLike(url: string): { frame: PixelFrame; pxPerModule: number } {
  const frame = darkCanvas(CANVAS_W, CANVAS_H)
  const pxPerModule = paintQr(frame, url, BOX_PX, CANVAS_W - BOX_PX - MARGIN, CANVAS_H - BOX_PX - MARGIN)
  return { frame, pxPerModule }
}

/**
 * 模擬「Discord／LINE 預覽再截圖」的二手圖：等比縮到 `scale`、存 JPEG（`quality`），再解回 RGBA。
 * ⚠ sharp 的 raw 輸入要給 Buffer（不吃 Uint8ClampedArray）；輸出走 `ensureAlpha().raw()` 才拿得到
 *   4 通道 —— JPEG 沒有 alpha，漏掉 ensureAlpha 會回 3 通道，`decodeQrTexts` 會因長度不足直接回 []，
 *   測試就會以「解不開」的假象失敗。
 */
async function degrade(frame: PixelFrame, scale: number, quality: number): Promise<PixelFrame> {
  const jpeg = await sharp(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength), {
    raw: { width: frame.width, height: frame.height, channels: 4 },
  })
    .resize(Math.round(frame.width * scale))
    .jpeg({ quality })
    .toBuffer()
  const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.channels, 4, 'ensureAlpha 之後應為 RGBA')
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
}

// ── 原圖 ──────────────────────────────────────────────────────────────────────

test('原始匯出圖：36／530／1461 字元碼全部解回原字串（典型、滿備註常態、最壞情況）', async () => {
  for (const n of [36, 530, 1461]) {
    const url = urlWithCode(n)
    const { frame, pxPerModule } = exportLike(url)
    assert.deepEqual(await decodeQrTexts(frame), [url], `n=${n}（${pxPerModule.toFixed(2)} px/模組）`)
  }
})

test('1461 字元那張的模組間距是非整數（< 4px 且不整除）—— 這正是 jsQR 陣亡、改選 zxing 的那種圖', () => {
  // 這條不是在測解碼器，是在守「上一條真的涵蓋了非整數間距」這個前提：
  // 若哪天 BOX_PX 或碼長被改到剛好整除，上一條就測不到選型時的關鍵案例了。
  const { pxPerModule } = exportLike(urlWithCode(1461))
  assert.ok(pxPerModule < 4, `${pxPerModule}`)
  assert.notEqual(pxPerModule, Math.floor(pxPerModule), '應為非整數')
})

// ── 二手截圖（縮放＋JPEG）────────────────────────────────────────────────────

test('二手截圖：36 字元碼縮到 25%＋JPEG q40、530 字元碼縮到 40%＋q60 仍解得回原字串', async () => {
  // 經驗門檻約每模組 ≥ 1.9 實體像素：36 字元 → 2.56px、530 字元 → 1.89px，兩者都貼著門檻
  for (const [n, scale, quality] of [[36, 0.25, 40], [530, 0.4, 60]] as const) {
    const url = urlWithCode(n)
    const { frame, pxPerModule } = exportLike(url)
    const shot = await degrade(frame, scale, quality)
    assert.deepEqual(
      await decodeQrTexts(shot),
      [url],
      `n=${n} scale=${scale} q${quality}（${shot.width}×${shot.height}、${(pxPerModule * scale).toFixed(2)} px/模組）`,
    )
  }
})

test('退化到門檻以下（530 字元縮到 30%）：不 throw，而且絕不回錯的字串 —— 只可能是 [] 或原字串', async () => {
  // 這條不鎖「一定失敗」（解碼器升級後讀得出來是好事），鎖的是 ecc 該保證的事：
  // 讀出來的若不是原字串，對話框會拿一串壞掉的 base64url 去預覽、對使用者報「碼壞了」。
  const url = urlWithCode(530)
  const shot = await degrade(exportLike(url).frame, 0.3, 50)
  const out = await decodeQrTexts(shot)
  assert.ok(out.every((t) => t === url), `讀出了不是原字串的內容：${JSON.stringify(out)}`)
})

// ── 沒有 QR ───────────────────────────────────────────────────────────────────

test('4000×3000 純雜訊（手機照片尺寸、沒有 QR）：回 [] 且 2 秒內結束', async () => {
  // tryHarder + tryDownscale 會多掃幾輪，這條守的是「找不到」的成本不能爆 —— 使用者貼錯圖
  // （例如貼了一張自拍）時，對話框不能卡住好幾秒才說找不到。
  const W = 4000
  const H = 3000
  const noise = new Uint8ClampedArray(W * H * 4)
  let s = 1
  for (let i = 0; i < noise.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
    noise[i] = s >> 16
  }
  const t0 = performance.now()
  const out = await decodeQrTexts({ data: noise, width: W, height: H })
  const ms = performance.now() - t0
  assert.deepEqual(out, [])
  assert.ok(ms < 2000, `耗時 ${ms.toFixed(0)}ms`)
})

test('只有底色、沒有 QR 的匯出圖尺寸畫布：回 []（不會把大片單色誤判成什麼）', async () => {
  assert.deepEqual(await decodeQrTexts(darkCanvas(CANVAS_W, CANVAS_H)), [])
})

// ── 同框多個 QR ───────────────────────────────────────────────────────────────

test('同框兩個 QR（右下角匯出圖的 + 左上角另一塊）：兩個都回、不多不少；順序不保證，用集合比對', async () => {
  // 情境：截圖同時框到別人的配裝圖與自己的。`maxNumberOfSymbols: 4` 就是為了這個 ——
  // 只回第一個的話，挑到哪一個全看 zxing 的偵測順序，使用者會覺得「怎麼載到自己的」。
  const u1 = urlWithCode(36)
  const u2 = urlWithCode(79)
  const { frame } = exportLike(u1)
  paintQr(frame, u2, 300, 100, 100)
  const out = await decodeQrTexts(frame)
  assert.equal(out.length, 2, `回了 ${out.length} 個：${JSON.stringify(out.map((t) => t.length))}`)
  assert.deepEqual(new Set(out), new Set([u1, u2]))
})

// ── 防呆：壞輸入不 throw ───────────────────────────────────────────────────────

test('0×0 與 data 長度不足：回 [] 不 throw（呼叫端把它當「沒有 QR」，不是「解碼器壞了」）', async () => {
  // 這兩種輸入來自 canvas 拿不到像素（getImageData 給了空的）之類的邊角狀況；
  // throw 會被 imageImport 歸類成 decoder-failed、對使用者說「解碼器載入失敗」，那是誤導。
  await assert.doesNotReject(async () => {
    assert.deepEqual(await decodeQrTexts({ data: new Uint8ClampedArray(0), width: 0, height: 0 }), [])
    assert.deepEqual(await decodeQrTexts({ data: new Uint8ClampedArray(10 * 10 * 4 - 1), width: 10, height: 10 }), [])
    assert.deepEqual(await decodeQrTexts({ data: new Uint8ClampedArray(0), width: 10, height: 10 }), [])
    assert.deepEqual(await decodeQrTexts({ data: new Uint8ClampedArray(400), width: -10, height: 10 }), [])
  })
})
