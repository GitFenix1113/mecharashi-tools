// 從配裝圖讀回分享碼：瀏覽器膠水層 —— PLAN-052-O Phase B
//
// ── 這一層在做什麼 ──────────────────────────────────────────────────────────
// 使用者把配裝圖貼（Ctrl+V）／拖／選進「貼上分享碼」對話框之後，本檔負責把一個 `Blob`
// 變成一串文字。依序試三條路徑，命中就停：
//   ① PNG 內嵌 `tEXt`（`pngText.ts`）—— 原始匯出圖才有。100% 精確、不受碼長上限、
//      不受畫質影響，連 QR 都不必碰。
//   ② 瀏覽器原生 `BarcodeDetector` —— 有就用，0 KB。
//   ③ zxing-wasm（`qrDecode.ts`）—— 1.1 MB 的 wasm，**只在走到這裡才載**，且由本站自託管。
// 本檔**不認識分享碼的內容**：讀出什麼就回什麼，「是不是本站連結」由對話框拿
// `readShareCode()` 判斷（這裡只拿它來在多個 QR 之間挑一個）。
//
// 零後端：圖片從頭到尾不離開使用者的瀏覽器 —— 零 Storage、零 Firestore read、零 Worker 請求。
//
// ── 陷阱 ────────────────────────────────────────────────────────────────────
// ⚠ **有 `BarcodeDetector` 這個類別不等於能用**（2026-09-08 查證 Chromium 原始碼與 BCD）：
//   Chrome 只在 macOS／ChromeOS／Android 暴露它（Windows／Linux 自 88 起連類別都沒有；
//   83–87 曾經有類別但 `getSupportedFormats()` 回空陣列），macOS 13 在 Chrome 113 之前會
//   **靜默失敗**，Safari 17 起藏在 feature flag 後、iOS 18 起壞掉未修，Firefox 完全沒有。
//   只看 `'BarcodeDetector' in globalThis` 就可能拿到一個永遠 detect 不到東西的偵測器，
//   症狀是「每張圖都說找不到 QR」。一定要先問支援清單含不含 `'qr_code'`，
//   而且它回空也要往下走 —— 對這個站的主要客群（Windows PC 玩家）zxing 才是正式路徑。
// ⚠ 原生偵測器整段 try/catch、失敗或空結果都往下走到 zxing：它是「有就賺到」的加速路徑，
//   不是正式路徑；讓它的例外冒出來會把一張 zxing 讀得到的圖擋在門外。
// ⚠ zxing 的例外**不吞**（`decoder-failed`）：「wasm 載不到」與「圖裡沒有 QR」對使用者
//   是兩句不同的話，前者要請他稍後再試、後者要請他改貼那串碼。
// ⚠ zxing 相關的東西全部 dynamic import（含 wasm 的資產網址）。除了「沒丟圖就不該付
//   那 1.1 MB」之外還有一個理由：Vite 的 `?url` 查詢字串 Node 解析不了，寫成靜態 import
//   會讓本檔在 `node --test` 裡連載入都失敗 —— 而 `imageFromDataTransfer()` 是要進單測的。
// ⚠ 所有 `ImageBitmap` 用完要 `close()`。一張 2000×2400 的匯出圖解碼後是 19 MB 的
//   GPU／記憶體資源，等 GC 不可靠；連續丟幾張圖就會看到分頁記憶體一路往上爬。
//
// 本檔依賴 DOM（canvas／`createImageBitmap`），**不進 Node 測試**；
// 只有 `imageFromDataTransfer()` 是純函式、可單測（`imageImport.test.ts`）。

import { isPng, readPngText, LOADOUT_PNG_KEYWORD } from './pngText.ts'
import { readShareCode } from './shareLink.ts'

/** 讀到文字的來源：`png-text` ＝ 原始匯出圖的內嵌資料；`qr` ＝ 從像素解出來的 QR。 */
export type ImageImportSource = 'png-text' | 'qr'

export type ImageImportFailure =
  /** Blob 不是圖片（type 不是 image/* 且 PNG／JPEG／WebP／GIF 檔頭都對不上） */
  | 'not-image'
  /** 超過 `MAX_IMAGE_BYTES` */
  | 'too-large'
  /** `createImageBitmap` 與 `<img>` 後援都解不開（HEIC、壞檔） */
  | 'unreadable'
  /** 三層都找不到 */
  | 'no-qr'
  /** zxing wasm 載入／執行丟例外（離線、資產壞掉） */
  | 'decoder-failed'

export type ImageImportResult =
  /** `others`：同框其他 QR 的文字（不含 `text`）。 */
  | { ok: true; text: string; source: ImageImportSource; others?: string[] }
  | { ok: false; reason: ImageImportFailure }

/**
 * 收檔上限。40 MB 足夠放任何一張螢幕截圖或原始匯出圖（實測 2000×2400 的匯出 PNG
 * 不到 2 MB），再大多半是丟錯檔；而讀進來要先整份進記憶體（`arrayBuffer()`），
 * 不設上限就是讓一個誤拖的影片檔把分頁弄掛。
 */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024

/**
 * 點陣化時的長邊上限（實體像素）。超過就等比縮到這個尺寸再畫進 canvas ——
 * 4096² × 4 bytes ＝ 64 MB 的 `ImageData` 是記憶體的合理天花板。
 * 匯出圖寬 2000 不受影響；4K 螢幕整頁截圖（3840 寬）也不受影響。
 */
const MAX_EDGE_PX = 4096

/**
 * 像素數上限（在**解碼之前**從檔頭讀尺寸來擋）。
 *
 * ⚠ `MAX_IMAGE_BYTES` 擋的是檔案大小，擋不住尺寸炸彈：一張 1 MB 的 PNG 可以宣告 20000×16000，
 *   `createImageBitmap()` 會老老實實配置 1.28 GB —— 而 `MAX_EDGE_PX` 的縮放發生在那之後。
 *   5,000 萬像素放得下 8K 螢幕整頁截圖（7680×4320 ≈ 3,300 萬），正常使用不會撞到。
 */
export const MAX_IMAGE_PIXELS = 50_000_000

// ─── DataTransfer ──────────────────────────────────────────────────────────

function isImageType(type: string | undefined): boolean {
  return typeof type === 'string' && type.startsWith('image/')
}

/**
 * 從 paste／drop 的 `DataTransfer` 取第一個圖片檔：先看 `files`，再看
 * `items`（`kind === 'file'` 且 type 是 image/*）。沒有回 `null`。
 *
 * 純函式（只讀物件形狀），可單測。`Pick` 是為了讓測試能用假的物件而不必湊出整個 `DataTransfer`。
 */
export function imageFromDataTransfer(dt: Pick<DataTransfer, 'files' | 'items'> | null | undefined): File | null {
  if (!dt) return null
  // ⚠ `type` 是空字串的檔（沒副檔名、或 OS 認不得的副檔名）**當後備收下**，交給
  //   `readLoadoutFromImage()` 看檔頭判定 —— 否則 `looksLikeImage()` 那條後援從貼上／拖放
  //   永遠走不到。但只在完全沒有 image/* 檔時才用它，且 `type` 明確是別的東西（text/plain…）
  //   一律略過：使用者拖一個 .txt 進來，對話框要說「不是圖片」而不是拿去解碼。
  let untyped: File | null = null
  const files = dt.files
  if (files) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (!f) continue
      if (isImageType(f.type)) return f
      if (f.type === '' && !untyped) untyped = f
    }
  }
  const items = dt.items
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it || it.kind !== 'file' || !isImageType(it.type)) continue
      const f = it.getAsFile()
      if (f) return f
    }
  }
  return untyped
}

// ─── 圖片判定 ──────────────────────────────────────────────────────────────

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return ''
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i])
  return s
}

/** 檔頭是不是 PNG／JPEG／GIF／WebP。`file.type` 是空字串（沒副檔名的檔）時的後援。 */
function looksLikeImage(bytes: Uint8Array): boolean {
  if (isPng(bytes)) return true
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true   // JPEG
  if (ascii(bytes, 0, 4) === 'GIF8') return true
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return true
  return false
}

function readU32BE(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

/**
 * 只從檔頭讀出圖片尺寸（PNG／JPEG／GIF），**不解碼像素**。讀不到（WebP、壞檔）回 `null`，
 * 由呼叫端視為「不知道就放行」—— 這支是尺寸炸彈的守門員，不是格式驗證器。
 *
 * 純函式，可單測。
 */
export function imageDimensionsFromHeader(bytes: Uint8Array): { width: number; height: number } | null {
  if (isPng(bytes)) {
    // IHDR 固定緊接在檔頭之後：長度 4 ＋ 'IHDR' 4 ＋ 寬 4 ＋ 高 4
    if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') return null
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // 沿著 marker 走到第一個 SOFn（C0–CF，扣掉 C4 DHT／C8 JPG／CC DAC）；SOS 之後就是資料，沒找到就放棄
    let at = 2
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at++; continue }
      const marker = bytes[at + 1]
      if (marker === 0xff) { at++; continue }                                   // 填充
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue }   // 沒有長度的獨立 marker
      const len = (bytes[at + 2] << 8) | bytes[at + 3]
      if (len < 2) return null
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8] }
      }
      if (marker === 0xda) return null
      at += 2 + len
    }
    return null
  }
  if (ascii(bytes, 0, 4) === 'GIF8' && bytes.length >= 10) {
    // 邏輯畫面尺寸，little-endian 16 位
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  }
  return null
}

// ─── 點陣化 ────────────────────────────────────────────────────────────────

interface Raster {
  /** 給 zxing 的 RGBA 像素（長邊 ≤ `MAX_EDGE_PX`） */
  frame: ImageData
  /** 給原生 `BarcodeDetector` 的來源：有 bitmap 給 bitmap（原尺寸），後援路徑給 `<img>` */
  source: ImageBitmapSource
  /** 釋放 bitmap 與 object URL。**一定要呼叫**（見檔頭 ⚠）。 */
  release(): void
}

/**
 * 把 Blob 解成像素。先走 `createImageBitmap()`（快、不進 DOM），失敗才退回
 * `<img src=objectURL>` ＋ `decode()`（少數格式兩者支援度不同）。兩者都解不開回 `null`。
 */
async function rasterize(file: Blob): Promise<Raster | null> {
  let bitmap: ImageBitmap | null = null
  let img: HTMLImageElement | null = null
  let objectUrl: string | null = null
  const release = () => {
    bitmap?.close()
    // ⚠ object URL 要留到 `release()` 才撤：原生偵測器可能還在讀那個 `<img>`
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }

  try {
    bitmap = await createImageBitmap(file)
  } catch {
    bitmap = null
  }
  if (!bitmap) {
    objectUrl = URL.createObjectURL(file)
    try {
      const el = new Image()
      el.src = objectUrl
      await el.decode()
      img = el
    } catch {
      release()
      return null
    }
  }

  const source: ImageBitmapSource | null = bitmap ?? img
  const sw = bitmap ? bitmap.width : img?.naturalWidth ?? 0
  const sh = bitmap ? bitmap.height : img?.naturalHeight ?? 0
  if (!source || sw <= 0 || sh <= 0) {
    release()
    return null
  }

  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(sw, sh))
    const w = Math.max(1, Math.round(sw * scale))
    const h = Math.max(1, Math.round(sh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context')
    // ⚠ 先鋪白再畫：透明底 PNG 的透明像素在 getImageData 裡是 (0,0,0,0)，而 zxing 只看 RGB、
    //   不看 alpha ⇒ 整塊變成全黑、QR 消失（原生偵測器反而讀得到，結果會依平台而異）。
    //   鋪白之後暗模組落在白底上，正是 QR 規格假設的樣子；反相的圖交給 zxing 的 tryInvert。
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(source, 0, 0, w, h)
    const frame = ctx.getImageData(0, 0, w, h)
    return { frame, source, release }
  } catch {
    release()
    return null
  }
}

// ─── 原生 BarcodeDetector ──────────────────────────────────────────────────
// lib.dom 沒有這個 API 的型別，只宣告用得到的最小介面。

interface BarcodeDetectorLike {
  detect(src: ImageBitmapSource): Promise<{ rawValue: string }[]>
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats(): Promise<string[]>
}

/** 有支援 `qr_code` 才用；任何失敗一律回空陣列（見檔頭 ⚠）。 */
async function detectNative(source: ImageBitmapSource): Promise<string[]> {
  try {
    const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (!Ctor) return []
    const formats = await Ctor.getSupportedFormats()
    if (!formats.includes('qr_code')) return []
    const found = await new Ctor({ formats: ['qr_code'] }).detect(source)
    return found.map((r) => r.rawValue).filter((t): t is string => typeof t === 'string' && t.length > 0)
  } catch {
    return []
  }
}

// ─── zxing-wasm ────────────────────────────────────────────────────────────

/** 整個分頁只登記一次 wasm 位置；之後的呼叫直接解碼。 */
let decoderConfigured = false

/** 例外原樣往上丟（wasm 載不到、解碼器內部錯誤），由 `readLoadoutFromImage()` 分類成 `decoder-failed`。 */
async function detectZxing(frame: ImageData): Promise<string[]> {
  const mod = await import('./qrDecode.ts')
  if (!decoderConfigured) {
    // Vite 資產：打包時把 node_modules 裡的 wasm 複製到 dist/assets 並回它的網址（自託管，不走 jsDelivr）
    const { default: wasmUrl } = await import('zxing-wasm/reader/zxing_reader.wasm?url')
    // ⚠ 參數型別要寫明：`tsconfig.app.json` 的 `types` 只收 vite/client，`@types/emscripten`
    //   進不來，`ZXingModuleOverrides` 在這裡退化成 any，靠推論會變成 implicit any 而被擋下
    mod.configureQrDecoder({
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    })
    decoderConfigured = true
  }
  try {
    return await mod.decodeQrTexts(frame)
  } catch (err) {
    // ⚠ zxing-wasm 會快取 module 的 promise —— 載入失敗（離線、資產 404）那一次的 rejected promise
    //   也會被留著，之後每次重試都直接拿到同一個失敗，而 UI 卻叫使用者「稍後再試」。
    //   失敗就整個清掉（overrides 也一起沒了），讓下一張圖真的重新載入。
    mod.resetQrDecoder()
    decoderConfigured = false
    throw err
  }
}

// ─── 候選挑選 ──────────────────────────────────────────────────────────────

/**
 * 多個 QR 時優先取「看起來像本站分享碼」的那個，否則取第一個；其餘放 `others`。
 * 空陣列回 `null`（由呼叫端判成 `no-qr`）。
 */
function pickCandidate(texts: string[]): ImageImportResult | null {
  if (texts.length === 0) return null
  const preferred = texts.findIndex((t) => readShareCode(t) !== null)
  const idx = preferred >= 0 ? preferred : 0
  const others = texts.filter((_, i) => i !== idx)
  return others.length > 0
    ? { ok: true, text: texts[idx], source: 'qr', others }
    : { ok: true, text: texts[idx], source: 'qr' }
}

// ─── 主入口 ────────────────────────────────────────────────────────────────

const fail = (reason: ImageImportFailure): ImageImportResult => ({ ok: false, reason })

/**
 * 從一張圖讀出裡面的分享連結（或任何 QR 文字）。**不 throw**：所有失敗都以 `reason` 回。
 *
 * 讀到的 `text` **不做任何驗證** —— 是不是分享碼由對話框判斷（同一支 `readShareCode()`，
 * 錯誤訊息才會與貼文字那條路徑一致）。
 */
export async function readLoadoutFromImage(file: Blob): Promise<ImageImportResult> {
  if (file.size > MAX_IMAGE_BYTES) return fail('too-large')

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return fail('unreadable')
  }

  // ① 原始匯出圖：內嵌資料直接回，連解碼都不必
  if (isPng(bytes)) {
    const text = readPngText(bytes, LOADOUT_PNG_KEYWORD)
    if (text) return { ok: true, text, source: 'png-text' }
  }

  if (!isImageType(file.type) && !looksLikeImage(bytes)) return fail('not-image')

  // 尺寸炸彈守門（見 `MAX_IMAGE_PIXELS`）：在任何解碼發生之前，只憑檔頭就拒收
  const dims = imageDimensionsFromHeader(bytes)
  if (dims && dims.width * dims.height > MAX_IMAGE_PIXELS) return fail('too-large')

  const raster = await rasterize(file)
  if (!raster) return fail('unreadable')
  try {
    // ② 原生偵測器（有就賺到）
    const native = pickCandidate(await detectNative(raster.source))
    if (native) return native

    // ③ zxing-wasm
    let texts: string[]
    try {
      texts = await detectZxing(raster.frame)
    } catch {
      return fail('decoder-failed')
    }
    return pickCandidate(texts) ?? fail('no-qr')
  } finally {
    raster.release()
  }
}
