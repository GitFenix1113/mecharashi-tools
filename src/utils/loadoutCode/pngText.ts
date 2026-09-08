// 匯出圖的 PNG 內嵌分享碼 —— PLAN-052-O Phase A（A-1；寫入端在 Phase C 的匯出流程）
//
// ── 這一層在做什麼 ──────────────────────────────────────────────────────────
// 匯出配裝圖時，把完整分享連結塞進 PNG 的一個 `tEXt` chunk；讀圖時先找它，找到就
// **不必碰 QR**。這條路徑 100% 精確、不受碼長上限、不受畫質影響 —— 剛好補上 QR 的
// 兩個天生缺口：① 長碼在匯出時根本不畫 QR（`loadoutQr()` 的閘門）；② 二手截圖被
// Discord／LINE 壓過之後 `ecc: 'L'` 的容錯餘裕很薄。
//
// 代價是它**只對原始 PNG 檔有效**：轉成 JPEG、或再截一次圖，chunk 就沒了。
// 所以它與 QR 是互補而不是取代 —— 原檔走 metadata、二手截圖走 QR（`qrDecode.ts`）。
//
// ── 為什麼是 tEXt 不是 iTXt ─────────────────────────────────────────────────
// `tEXt` 只收 Latin-1，而分享連結是純 ASCII（網域 ＋ base64url）。`iTXt` 多一段
// 壓縮旗標與語言標籤，換來的 UTF-8 能力這裡用不到。**遇到非 Latin-1 一律回 `null`**
// 而不是偷偷改寫 —— 寫出一個規格外的 chunk，某些看圖軟體會直接判整張圖壞掉。
//
// ── 三條硬限制 ───────────────────────────────────────────────────────────────
// ⚠ ① **絕不 throw**。`insertPngText()` 跑在匯出流程尾端，一個例外會讓整張圖存不下來，
//     而症狀是「按了匯出沒反應」。任何不對勁一律回 `null`，呼叫端退回原圖照存。
// ⚠ ② **讀取要能吃任何位元組**。使用者丟進來的可能是 JPEG、WebP、截斷的檔、甚至不是
//     圖片。每一步都要先檢查界限再讀，不能假設 chunk 長度是誠實的。
// ⚠ ③ **chunk 放在 IHDR 之後、IDAT 之前**。規格允許 tEXt 出現在 IHDR 與 IEND 之間任何
//     位置，但放前面讀取時走不到幾步就命中，不必掃過幾 MB 的像素資料。
//
// 純函式（零 DOM、零 React），可單測（npm test）。

/** PNG 檔頭 8 bytes。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/**
 * 我們寫進 PNG 的 keyword。**改它會讓已流出的匯出圖全部讀不到內嵌碼**（退回走 QR），
 * 等同升格式版本。規格：1–79 個 Latin-1 可見字元，不可有前後空白。
 */
export const LOADOUT_PNG_KEYWORD = 'mecharashi-loadout'

/**
 * 讀取端願意看的單一 tEXt chunk 上限。我們寫的內容是一條分享連結（碼上限 4096 字元），
 * 64 KB 是它的十幾倍；再大的 chunk 只可能是別人塞的 —— 一張 ≤40 MB 的惡意 PNG 可以放一個
 * 幾十 MB 的 tEXt，逐字元拼成字串會讓主執行緒卡住、heap 衝上 GB，最後還把整串塞進 textarea。
 * 超過就跳過那個 chunk（不是整張圖判死：後面可能還有正常的）。
 */
export const MAX_TEXT_CHUNK_BYTES = 65_536

// ─── CRC-32 ────────────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  crcTable = t
  return t
}

/**
 * PNG 用的 CRC-32（ISO 3309，與 zlib 相同）。算的是 `[start, end)` 這一段。
 * 回傳無號 32 位元整數。
 */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const t = getCrcTable()
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ─── 讀寫工具 ──────────────────────────────────────────────────────────────

/** 是不是 PNG（只看檔頭 8 bytes）。 */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false
  return true
}

function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

function writeU32(bytes: Uint8Array, at: number, v: number): void {
  bytes[at] = (v >>> 24) & 0xff
  bytes[at + 1] = (v >>> 16) & 0xff
  bytes[at + 2] = (v >>> 8) & 0xff
  bytes[at + 3] = v & 0xff
}

function chunkType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
}

/** Latin-1 字串 → bytes。**呼叫前要先驗過每個字元 ≤ 0xff**。 */
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** bytes → Latin-1 字串。逐字元拼，不用 `String.fromCharCode(...spread)` —— 那會在幾萬個引數時炸堆疊。 */
function latin1String(bytes: Uint8Array, start: number, end: number): string {
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i])
  return s
}

/**
 * keyword 是否符合 PNG 規格：1–79 字元、Latin-1 可見字元（0x20–0x7e、0xa1–0xff）、
 * 不可有前後空白、不可連續空白。
 */
function validKeyword(keyword: string): boolean {
  if (keyword.length < 1 || keyword.length > 79) return false
  if (keyword !== keyword.trim()) return false
  if (/ {2}/.test(keyword)) return false
  for (let i = 0; i < keyword.length; i++) {
    const c = keyword.charCodeAt(i)
    if (!((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff))) return false
  }
  return true
}

/** text 是否寫得進 tEXt：Latin-1 且不含 NUL（NUL 是 keyword 與 text 的分隔符）。 */
function validText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0 || c > 0xff) return false
  }
  return true
}

/**
 * 在 PNG 的 IHDR 之後插入一個 `tEXt` chunk。**回新的 Uint8Array，不改輸入**。
 *
 * 任何不對勁一律回 `null`（限制①）：不是 PNG、第一個 chunk 不是 IHDR、keyword 或
 * text 不符規格、檔案在 IHDR 處就已截斷。呼叫端拿到 `null` 就存原圖 —— 少一條還原
 * 路徑，好過一張存不下來的圖。
 */
export function insertPngText(png: Uint8Array, keyword: string, text: string): Uint8Array | null {
  if (!isPng(png)) return null
  if (!validKeyword(keyword) || !validText(text)) return null

  // 第一個 chunk 一定要是 IHDR（規格強制），且要完整
  const ihdrAt = PNG_SIGNATURE.length
  if (png.length < ihdrAt + 12) return null
  const ihdrLen = readU32(png, ihdrAt)
  if (chunkType(png, ihdrAt + 4) !== 'IHDR') return null
  // IHDR 的資料**固定 13 bytes**（規格）。長度欄位造假但仍落在檔內時，照它算插入點會把 tEXt
  // 塞進下一個 chunk 中間、產出一張壞掉的 PNG —— 那比回 null 存原圖糟得多
  if (ihdrLen !== 13) return null
  const insertAt = ihdrAt + 12 + ihdrLen
  if (insertAt > png.length) return null

  const kw = latin1Bytes(keyword)
  const tx = latin1Bytes(text)
  const dataLen = kw.length + 1 + tx.length
  // chunk ＝ 長度 4 ＋ 型別 4 ＋ 資料 ＋ CRC 4；CRC 涵蓋「型別 ＋ 資料」
  const chunk = new Uint8Array(12 + dataLen)
  writeU32(chunk, 0, dataLen)
  chunk.set([0x74, 0x45, 0x58, 0x74], 4)          // 'tEXt'
  chunk.set(kw, 8)
  chunk[8 + kw.length] = 0
  chunk.set(tx, 9 + kw.length)
  writeU32(chunk, 8 + dataLen, crc32(chunk, 4, 8 + dataLen))

  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, insertAt), 0)
  out.set(chunk, insertAt)
  out.set(png.subarray(insertAt), insertAt + chunk.length)
  return out
}

/**
 * 從 PNG 找出指定 keyword 的 `tEXt` 內容。找不到、不是 PNG、檔案壞掉一律回 `null`。
 *
 * 逐 chunk 走訪到 IEND 為止；**每一步先驗界限**（限制②）—— 長度欄位是檔案裡的數字，
 * 一個宣告「接下來有 4GB」的 chunk 不該讓這裡讀出界或無窮迴圈。
 *
 * ⚠ 不驗 CRC：讀取端的目的是「找得到就用」，而內容還要過 `decodeLoadout()` 的
 *   checksum；在這裡再驗一次 CRC 只會讓一張被某些工具改壞 CRC 的圖白白失去這條路徑。
 */
export function readPngText(png: Uint8Array, keyword: string): string | null {
  if (!isPng(png)) return null
  let at = PNG_SIGNATURE.length
  // 每個 chunk 至少 12 bytes（長度 ＋ 型別 ＋ CRC）
  while (at + 12 <= png.length) {
    const len = readU32(png, at)
    const type = chunkType(png, at + 4)
    const dataStart = at + 8
    const dataEnd = dataStart + len
    if (dataEnd + 4 > png.length) return null          // 宣告的長度超出檔案 ⇒ 截斷或造假
    if (type === 'IEND') return null
    if (type === 'tEXt' && len <= MAX_TEXT_CHUNK_BYTES) {
      // keyword ＋ NUL ＋ text
      let nul = -1
      for (let i = dataStart; i < dataEnd; i++) if (png[i] === 0) { nul = i; break }
      if (nul >= 0 && latin1String(png, dataStart, nul) === keyword) {
        return latin1String(png, nul + 1, dataEnd)
      }
    }
    at = dataEnd + 4
  }
  return null
}

/**
 * `data:` URL → bytes。`html-to-image` 的 `toPng()` 回的是 base64 data URL，
 * 要插 chunk 得先拆成位元組。非 data URL、base64 壞掉一律回 `null`。
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const m = /^data:([^,]*?)(;base64)?,([\s\S]*)$/.exec(dataUrl)
  if (!m) return null
  try {
    if (m[2]) {
      const bin = atob(m[3])
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
    return new TextEncoder().encode(decodeURIComponent(m[3]))
  } catch {
    return null
  }
}
