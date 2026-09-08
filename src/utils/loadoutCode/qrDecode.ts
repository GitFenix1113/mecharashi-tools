// 從像素裡找 QR —— PLAN-052-O Phase A
//
// ── 這一層在做什麼 ──────────────────────────────────────────────────────────
// 收一張 RGBA 像素圖，回裡面每個 QR 的文字。**它不認識分享碼**：解出來是什麼就回什麼，
// 「是不是本站連結」由呼叫端拿 `readShareCode()` 判斷。這樣切的理由是本檔要能在
// Node 測試裡跑 —— 那裡沒有 DOM，也不該知道分享碼長什麼樣。
//
// ── 為什麼是 zxing-wasm 而不是純 JS 的 jsQR ─────────────────────────────────
// 2026-09-08 兩者都實測過（`_local-notes/2026-09/2026-09-08_qr-sanity*.mts`）。
// jsQR 對**非整數的模組間距**很脆弱：匯出圖的 QR 方塊固定 420 實體像素，v21 以上的碼
// 每模組只有 3.07–3.85px、寬度在 3 與 4 之間交錯，jsQR 從 1000 字元起就全部解不開；
// 而同一批圖 zxing-wasm **全部解回來、且快 5–10 倍**（22–41ms vs 100–400ms）。
// 代價是 1.1MB 的 wasm —— 但它**只在使用者真的丟圖進來時才載**（本檔整個走
// dynamic import），且由本站自託管（見 `imageImport.ts`；不走 jsDelivr，中國使用者
// 連不到那個 CDN，字體自託管是同一個理由）。
//
// ⚠ **絕不吞例外。** 載不到 wasm（離線、CDN 壞掉）與「圖裡沒有 QR」是兩件事，
//   對使用者要講兩句不同的話；吞成空陣列會讓前者被誤報成後者。由呼叫端 catch 並分類。
//
// 純函式（只依賴 `zxing-wasm/reader`），可單測（npm test）：測試用 `configureQrDecoder()`
// 把本機的 wasm 二進位餵進去，不碰網路。

import { prepareZXingModule, purgeZXingModule, readBarcodes, type ReaderOptions, type ZXingModuleOverrides } from 'zxing-wasm/reader'

/** RGBA 像素圖。`data.length === width * height * 4`。 */
export interface PixelFrame {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

/**
 * 告訴 zxing 去哪裡拿 wasm。**要在第一次 `decodeQrTexts()` 之前呼叫**，否則它會走
 * 套件預設的 jsDelivr CDN。瀏覽器端傳 `locateFile`（指向 Vite 打包出來的資產網址），
 * Node 測試傳 `wasmBinary`（直接讀 node_modules 裡的檔）。
 *
 * 只登記、不立刻載入（`fireImmediately: false`）：載入的時機交給第一次真的要解碼的呼叫。
 */
export function configureQrDecoder(overrides: ZXingModuleOverrides): void {
  prepareZXingModule({ overrides, fireImmediately: false })
}

/**
 * 丟掉已快取的 wasm module（含**失敗的那一次**）。
 *
 * ⚠ zxing-wasm 會把 module 的 promise 快取起來重用 —— 載入失敗（離線、資產 404）那次的
 *   rejected promise 也一樣被留著，之後每次 `readBarcodes()` 都直接拿到同一個失敗；
 *   而對話框卻叫使用者「稍後再試」。呼叫端在解碼丟例外時要呼叫這支，下一次才會真的重新載入。
 *   呼叫之後要再 `configureQrDecoder()` 一次（overrides 也一起被清掉了）。
 */
export function resetQrDecoder(): void {
  purgeZXingModule()
}

/**
 * 只找 QR、盡力找（`tryHarder`）。`maxNumberOfSymbols: 4` 是為了「一張截圖裡有兩個 QR」
 * （例如同時截到別人的圖與自己的圖）—— 全部回給呼叫端挑，而不是只回第一個。
 * 縮放／旋轉／反相都交給 zxing 自己試，它做得比我們手寫的階梯好。
 */
const OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
}

/**
 * 回圖裡每個解得開的 QR 的文字（依 zxing 的偵測順序）。沒有就回空陣列。
 * **wasm 載入失敗或解碼器本身出錯會 throw**（見檔頭）。
 */
export async function decodeQrTexts(frame: PixelFrame): Promise<string[]> {
  if (frame.width <= 0 || frame.height <= 0) return []
  if (frame.data.length < frame.width * frame.height * 4) return []
  // zxing 只讀 data／width／height；Node 沒有 ImageData 類別，所以用結構相容的物件而不是 `new ImageData()`
  const input = { data: frame.data, width: frame.width, height: frame.height, colorSpace: 'srgb' } as ImageData
  const results = await readBarcodes(input, OPTIONS)
  return results.filter((r) => r.isValid && r.text).map((r) => r.text)
}
