// PLAN-052-L E-2：匯出圖底的 QR
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這一組測的是三件**在圖上看不出來**的事：
//   ① 超長碼不可以 throw（它跑在匯出卡的 render 期間，一個例外＝按了匯出沒反應）；
//   ② 掃不動就不要畫（看圖的人會先試著掃，失敗才回頭找那串碼）；
//   ③ path 真的畫得出那個矩陣（一個角落畫錯，圖上仍是一塊「看起來像 QR」的方塊）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encode } from 'uqr'
import { loadoutQr } from './loadoutQr.ts'

/** 匯出用的 `toPng({ pixelRatio })`。與 `exportTheme.EXPORT_PIXEL_RATIO` 同值。 */
const RATIO = 2

const urlWithCode = (n: number) => `https://mecharashi.wiki/simulator?b=${'A'.repeat(n)}`

test('典型長度的碼畫得出來，而且尺寸是固定的（E-3：QR 放右側固定尺寸）', () => {
  // 實測的四個長度：空草稿 7、典型 36、含元件與算力 79、三套 119
  const boxes = [7, 36, 79, 119].map((n) => loadoutQr(urlWithCode(n), RATIO)?.boxPx)
  assert.equal(boxes.every((b) => b === boxes[0]), true, `尺寸不該隨碼長變動：${boxes}`)
  assert.ok(boxes[0] && boxes[0] > 0)
})

test('加了滿備註（約 +410 字元）之後仍然畫得出來 —— 那是 C 上線後的常態長度', () => {
  assert.notEqual(loadoutQr(urlWithCode(530), RATIO), null)
})

test('「號碼全滿 ＋ 4 套形態 ＋ 滿備註」那種最壞情況仍在可掃範圍內', () => {
  assert.notEqual(loadoutQr(urlWithCode(1461), RATIO), null)
})

test('超出 QR 容量時回 null 而不是 throw（分享碼上限 4096 走得到這裡）', () => {
  assert.doesNotThrow(() => loadoutQr(urlWithCode(4096), RATIO))
  assert.equal(loadoutQr(urlWithCode(4096), RATIO), null)
})

test('編得出來但每個模組不到 3 個實體像素時**不畫** —— 掃不動的 QR 比沒有 QR 更糟', () => {
  // 這個長度編得出 QR（uqr 不丟例外），被擋下的理由只可能是「太小」
  assert.doesNotThrow(() => encode(urlWithCode(2000), { ecc: 'L', border: 4 }))
  assert.equal(loadoutQr(urlWithCode(2000), RATIO), null)
})

test('pixelRatio 是閘門的一部分：同一串碼在 1x 下會被擋、2x 下放行', () => {
  const url = urlWithCode(900)
  assert.notEqual(loadoutQr(url, 2), null)
  assert.equal(loadoutQr(url, 1), null)
})

test('靜區算在 size 裡（外框四圈必須是空的，否則掃描器找不到定位圖案的邊界）', () => {
  const qr = loadoutQr(urlWithCode(36), RATIO)!
  const raw = encode(urlWithCode(36), { ecc: 'L', border: 4 })
  assert.equal(qr.size, raw.size)
  for (let i = 0; i < raw.size; i++) {
    for (const [x, y] of [[i, 0], [i, 1], [i, 2], [i, 3], [0, i], [1, i], [2, i], [3, i]]) {
      assert.equal(raw.data[y][x], false, `靜區內不該有黑模組：(${x},${y})`)
    }
  }
})

test('path 逐格還原得回原矩陣（每一段 h 指令覆蓋的格子就是黑模組，一格不多一格不少）', () => {
  const url = urlWithCode(36)
  const qr = loadoutQr(url, RATIO)!
  const raw = encode(url, { ecc: 'L', border: 4 })

  const painted = Array.from({ length: raw.size }, () => new Array<boolean>(raw.size).fill(false))
  for (const seg of qr.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, len] = [Number(seg[1]), Number(seg[2]), Number(seg[3])]
    for (let i = 0; i < len; i++) painted[y][x + i] = true
  }
  for (let y = 0; y < raw.size; y++) {
    for (let x = 0; x < raw.size; x++) {
      assert.equal(painted[y][x], raw.data[y][x], `(${x},${y}) 對不上`)
    }
  }
})

test('相鄰的黑模組合併成一段，不是一格一段（一格一個節點會讓深拷貝背三萬個元素）', () => {
  const url = urlWithCode(36)
  const qr = loadoutQr(url, RATIO)!
  const raw = encode(url, { ecc: 'L', border: 4 })
  const black = raw.data.flat().filter(Boolean).length
  const segments = [...qr.d.matchAll(/M/g)].length
  assert.ok(segments < black, `段數 ${segments} 應少於黑模組數 ${black}`)
})
