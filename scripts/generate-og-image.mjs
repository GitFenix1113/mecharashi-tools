// PLAN-038 A-2：產出全站預設 og:image（1200×630）。
//
// 為什麼是腳本而不是手工出圖：站名、標語、品牌色之後都可能再調，
// 有腳本就能重跑一次覆蓋，不必再找一次原始檔（同 scripts/ 既有影像工具的取向）。
//
// 用法：node scripts/generate-og-image.mjs
// 輸出：public/images/og/default.jpg（見 public/images/og/README.md 的目錄慣例）

import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BG = join(ROOT, 'public/images/General/homepage_background.webp')
const CAT = join(ROOT, 'public/images/cat_no_bg.png')
const OUT_DIR = join(ROOT, 'public/images/og')
const OUT = join(OUT_DIR, 'default.jpg')

const W = 1200
const H = 630

// 站名與標語與 index.html 的 <title> / og:* 同源；改這裡記得一起改 index.html。
const TITLE = '米赫瑪超吉情豹站'
const SUBTITLE = 'MILKHAMA PAWINFO STATION'
const TAGLINE = '機師 · 機甲 · 武器資料查詢與配裝模擬'

const ORANGE = '#ff6b2b'
const CYAN = '#06b6d4'

// 中文走系統字型（Windows：Microsoft JhengHei）。專案自託管的 woff2 只有拉丁子集，
// librsvg 吃不到，故此處一律指定系統字型名稱 + 逐層 fallback。
const CJK = 'Microsoft JhengHei, PingFang TC, Noto Sans TC, sans-serif'
const LATIN = 'Segoe UI, Helvetica Neue, Arial, sans-serif'

/** 左側暗化漸層：背景是亮色場景圖，不壓暗的話白字會糊在裡面。 */
const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#0a0c10" stop-opacity="0.94"/>
      <stop offset="55%"  stop-color="#0a0c10" stop-opacity="0.80"/>
      <stop offset="100%" stop-color="#0a0c10" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
</svg>`

const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect x="0" y="0" width="10" height="${H}" fill="${ORANGE}"/>
  <text x="88" y="258" font-family="${LATIN}" font-size="26" letter-spacing="6"
        fill="${CYAN}" font-weight="600">${SUBTITLE}</text>
  <text x="84" y="352" font-family="${CJK}" font-size="70" letter-spacing="3"
        fill="#ffffff" font-weight="700">${TITLE}</text>
  <rect x="88" y="388" width="96" height="4" fill="${ORANGE}"/>
  <text x="88" y="444" font-family="${CJK}" font-size="28" letter-spacing="2"
        fill="#c3c8d2">${TAGLINE}</text>
</svg>`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  // 貓吉祥物：去背 PNG 直接疊在暗底上（透明區塊在深色底變黑的問題，只在「拿它當整張圖」時才會發生）。
  const cat = await sharp(CAT).resize({ height: 340, fit: 'inside' }).toBuffer()
  const catMeta = await sharp(cat).metadata()

  const info = await sharp(BG)
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .composite([
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
      { input: cat, top: H - catMeta.height - 26, left: W - catMeta.width - 46 },
      { input: Buffer.from(textSvg), top: 0, left: 0 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(OUT)

  console.log(`✅ ${OUT}  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)} KB`)
}

main().catch(err => {
  console.error('❌ 產圖失敗：', err)
  process.exit(1)
})
