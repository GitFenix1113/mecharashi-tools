// 匯出長圖的顏色與字體（PLAN-052-L B-2）
//
// 這一份**只服務匯出圖**，與螢幕版的 `loadoutTheme.ts` 沒有關係，也刻意不吃它。
//
// ⚠ **顏色一律寫死十六進位、尺寸一律寫死 px**（052-I E-2 的既有原則）。兩個理由：
//   ① `html-to-image` 會把 computed style 內聯，用 CSS 變數與 Tailwind 類別在這裡
//      沒有好處，只讓「圖上為什麼長這樣」得跨三個檔案才查得到；
//   ② 本站 root 字級**使用者可調**（17／19／21px），用 `rem` 會讓同一套配裝
//      在不同人手上匯出成不同尺寸的圖 —— 而那不會有任何錯誤訊息。
//
// ⚠ 這一檔是 2026-08-29 從 `LoadoutExportCard.tsx` **原值搬出來**的（B-2 起匯出圖
//   拆成多個元件，各自抄一份調色盤就是漂移的起點）。搬出來的只有常數，
//   語意與值一個都沒動。

import type { SegKey } from '../loadoutTheme'

/** 分段條與圖例的顏色。 */
export const SEG_HEX: Record<SegKey, string> = {
  chassis: 'rgba(107,114,128,0.55)',
  hands: '#06b6d4',
  shoulder: '#a855f7',
  back: '#3b82f6',
}

export const C = {
  bg: '#0a0c10',
  panel: '#14161d',
  line: '#262c3a',
  lineStrong: '#3f4859',
  text: '#e8eaed',
  sub: '#9ca3af',
  dim: '#6b7280',
  orange: '#ff6b2b',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  pink: '#ec4899',
  /** 攜帶技能區的抬頭色（PLAN-052-L D-5）。與出力分段條的 `hands` 同一支青色 */
  cyan: '#06b6d4',
} as const

export const ORB = "'Orbitron', sans-serif"
export const MONO = "'JetBrains Mono', ui-monospace, monospace"

/** 卡片寬度是硬限制（`toPng` 的產出尺寸就是這個元素的尺寸）。 */
export const CARD_WIDTH = 1000

/**
 * `toPng({ pixelRatio })`。**只有這一份**（PLAN-052-L E-2）：
 * `loadoutQr()` 拿它換算「一個 QR 模組在最終 PNG 裡有幾個實體像素」，據以決定畫不畫。
 * 兩邊各寫一個 2 的話，改動時只會改到一邊 —— 而症狀是圖上多了一塊掃不動的 QR。
 */
export const EXPORT_PIXEL_RATIO = 2
/** 十字區塊的左右內距。`CARD_WIDTH − 2×PAD` 就是十字的可用寬。 */
export const RIG_PAD = 20
