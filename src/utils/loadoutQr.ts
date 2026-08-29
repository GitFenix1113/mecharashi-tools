// 匯出圖底的 QR —— PLAN-052-L E-2
//
// ── 為什麼要有 QR ─────────────────────────────────────────────────────────
// 使用者裁決 2026-08-29：圖底的**完整碼與 QR 都留**。理由是「別人螢幕截圖你的圖」——
// 純文字碼在那種二手截圖上要一個字一個字抄（base64url 的 `l/I/1` 與 `O/0` 尤其），
// QR 則是拿手機一掃就好。這是兩條不同的還原路徑，不是同一件事做兩次。
//
// ── 四條硬限制 ─────────────────────────────────────────────────────────────
//
// ⚠ ① **只能離線產生**。匯出是離屏 `toPng()`，而 `waitForRenderReady()` 只等圖與字體 ——
//     任何打 API 的 QR 服務都會讓開拍時機變成不確定的等待（`<img>` 還在飛就被拍下去，
//     圖上是一塊空白，而且不會有任何錯誤訊息）。`uqr` 是零依賴的純 JS，同步回傳矩陣。
//
// ⚠ ② **必須在 render 當下同步畫完**：本支回傳的是一段 `<path>` 的 `d`，呼叫端直接塞進
//     inline `<svg>`。不可以走 `<img src={dataUrl}>`（非同步）也不可以走 canvas ＋ ref
//     （要等 effect，而 effect 跑在拍照之後）。
//     ⚠ inline SVG 在 `html-to-image` 裡是**深拷貝**、子元素不經 `cloneCSSStyle()`
//       ⇒ 顏色只能寫**字面十六進位的 presentation attribute**，一個 `var()` 都不能有
//       （`rigLayout.ts` 檔頭那條的同一個坑）。
//
// ⚠ ③ **編不出來就回 `null`，絕不 throw**。`encode()` 對超長輸入會丟例外，而它是在
//     匯出卡的 render 期間跑的 —— 一個例外會讓整張圖拍不出來，症狀是「按了匯出沒反應」。
//     分享碼上限是 4096 base64 字元，換算成網址遠超過 QR v40 的容量，所以這**不是理論
//     路徑**：一套「號碼全滿 ＋ 4 套形態 ＋ 滿備註」就走得到附近。
//
// ⚠ ④ **掃不動就寧可不畫**（見 `MIN_MODULE_DEVICE_PX`）。看圖的人會先試著掃，
//     失敗之後才回頭找那串碼 —— 一個掃不動的 QR 比沒有 QR 更糟。
//
// 純函式（只依賴 `uqr`），可單測（npm test）。

import { encode } from 'uqr'

export interface LoadoutQr {
  /** 邊長（模組數，含靜區）。`d` 的座標系就是模組格 ⇒ 配 `viewBox="0 0 size size"` */
  size: number
  /** 整塊 QR 的 CSS 邊長。**固定值**，不隨碼長變動（E-3：QR 放右側固定尺寸） */
  boxPx: number
  /** 所有黑模組合成的單一 `<path d>` */
  d: string
}

/**
 * 靜區（quiet zone）。規格要求 4 個模組，**不可以省**：這張圖的底色是 `#0a0c10`，
 * 沒有靜區的話掃描器找不到定位圖案的邊界。
 *
 * ⚠ 靜區要算進 `size`（＝白底本身的一部分），不可以改用外層 padding 充當 ——
 *   那樣算出來的每模組像素數會偏大，於是「掃不掃得動」那道閘門會放行本來該擋的長碼。
 */
const BORDER = 4

/**
 * QR 的 CSS 邊長。**固定**（E-3 逐字：「QR 放右側固定尺寸」）——
 * 讓它隨碼長變動的話，同一張版面在不同配裝上會左右伸縮，而分享碼帶的折行本來就會動。
 *
 * 210 是版面給的位置：分享碼帶整寬 1000、左右內距各 24，扣掉 QR 與間距後留給碼本身
 * 仍有 700+ px（實測 79 字元的碼在 12px 等寬字下只要一行）。
 */
const BOX_PX = 210

/**
 * 一個模組在**最終 PNG** 裡至少要幾個實體像素。
 *
 * 3 是「拿手機對著螢幕上的截圖掃」還讀得到的下限。低於它就整塊不畫（限制④）。
 *
 * ⚠ 判斷要用**實體像素**而不是 CSS px：匯出走 `pixelRatio: 2`，用 CSS px 判斷會少算
 *   一半的餘裕，於是把本來掃得動的長碼擋掉。呼叫端因此必須把 `pixelRatio` 傳進來。
 */
const MIN_MODULE_DEVICE_PX = 3

/**
 * 把一段網址編成可以直接畫的 QR。**編不出來、或畫出來會掃不動時回 `null`**。
 *
 * `ecc: 'L'`（7% 容錯）是刻意的：這張 QR 印在數位圖上、不會有污損或褶皺，
 * 而容錯每升一級就換來更大的版本、更小的模組 —— 在「掃得到」這件事上是淨虧。
 *
 * @param pixelRatio 匯出時的 `toPng({ pixelRatio })`。傳錯會讓閘門判斷失準，見 ⚠。
 */
export function loadoutQr(url: string, pixelRatio: number): LoadoutQr | null {
  let res: { size: number; data: boolean[][] }
  try {
    res = encode(url, { ecc: 'L', border: BORDER })
  } catch {
    // 超過 v40 容量。分享碼上限 4096 走得到這裡 —— 這是預期路徑，不是錯誤
    return null
  }

  if ((BOX_PX * pixelRatio) / res.size < MIN_MODULE_DEVICE_PX) return null

  // 逐列把連續的黑模組合併成一段 `h` 指令：v40 有 31,329 格，一格一個 `<rect>` 會讓
  // `html-to-image` 深拷貝三萬個節點。合併後典型碼只有數百段，而畫出來一模一樣。
  const parts: string[] = []
  for (let y = 0; y < res.size; y++) {
    const row = res.data[y]
    let x = 0
    while (x < res.size) {
      if (!row[x]) { x++; continue }
      const start = x
      while (x < res.size && row[x]) x++
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`)
    }
  }

  return { size: res.size, boxPx: BOX_PX, d: parts.join('') }
}
