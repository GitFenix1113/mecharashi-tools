/**
 * 社群預覽卡片用的 JPEG 立繪（PLAN-038 follow-up）。
 *
 * 為什麼需要這支腳本：站上的立繪是 WebP，而 **WebP 在連結預覽器裡幾乎沒人支援**
 * —— Facebook 的 OGP 只吃 JPEG/PNG/GIF，LINE 同樣抓不出縮圖（實測：標題與描述
 * 都正常，就是沒有圖）。Discord 是少數支援 webp 的，所以只有它看起來是好的。
 *
 * 做法：把「會被當成 og:image 的那些立繪」各轉一份 JPEG 到 public/images/og/entities/，
 * 路徑鏡射原始結構，Worker 端據此推導（見 workers/src/socialPreview.ts 的 absoluteImage）：
 *
 *   /images/pilots/曜/half.webp  →  /images/og/entities/pilots/曜/half.jpg
 *
 * ⚠ 產出物**不進版控**（.gitignore 已忽略），由 build/dev 前置每次重跑。
 *   因此新增機師／機甲不需要任何額外動作，也不會讓 repo 一直長大。
 *
 * ⚠ 來源清單（SOURCES）與 Worker 的推導規則是一組的，改一邊要改另一邊。
 *   實測資料層的檔名高度一致：pilots 87/88 是 half.webp、mechs 88/89 是 portrait.webp，
 *   weapons 則 170/178 本來就是 png（不需要轉）。
 *
 * 用法：node scripts/generate-og-entity-images.mjs
 */

import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMAGES = path.join(ROOT, 'public', 'images')
const OUT_ROOT = path.join(IMAGES, 'og', 'entities')

/** 立繪帶透明通道，轉 JPEG 必須填底；用站台底色而非白色，深色 App 上才不突兀。 */
const FLATTEN_BG = { r: 10, g: 12, b: 16 }

/**
 * 哪些檔案要轉。刻意**不是**「所有 webp 都轉」——
 * pilots 目錄下還有 full.webp（每張近 200KB、177 張共 11MB），
 * 那些不會出現在 og:image 裡，轉了只是讓 build 變慢、dist 變大。
 */
const SOURCES = [
  { dir: 'pilots', depth: 1, match: name => name === 'half.webp' },
  { dir: 'mechs', depth: 1, match: name => name === 'portrait.webp' },
  { dir: 'weapons', depth: 0, match: name => name.endsWith('.webp') },
]

/** 收集 dir 下第 depth 層（0 = 直接放在 dir 底下）符合 match 的檔案，回相對 IMAGES 的路徑。 */
function collect({ dir, depth, match }) {
  const base = path.join(IMAGES, dir)
  if (!fs.existsSync(base)) return []
  const out = []
  const walk = (cur, level) => {
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name)
      if (ent.isDirectory()) {
        if (level < depth) walk(full, level + 1)
      } else if (level === depth && match(ent.name)) {
        out.push(path.relative(IMAGES, full))
      }
    }
  }
  walk(base, 0)
  return out
}

async function convert(rel) {
  const src = path.join(IMAGES, rel)
  const dest = path.join(OUT_ROOT, rel).replace(/\.webp$/i, '.jpg')

  // 增量：來源沒比產物新就跳過（本機重跑 build 時省下大部分時間；CI 是全新 checkout，會全轉）
  if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) {
    return { skipped: true, bytes: fs.statSync(dest).size }
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const info = await sharp(src)
    .flatten({ background: FLATTEN_BG })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(dest)
  return { skipped: false, bytes: info.size }
}

async function main() {
  const files = SOURCES.flatMap(collect)
  if (files.length === 0) {
    console.log('[og-entities] 找不到任何來源圖，略過')
    return
  }

  let made = 0
  let skipped = 0
  let bytes = 0
  for (const rel of files) {
    try {
      const r = await convert(rel)
      r.skipped ? skipped++ : made++
      bytes += r.bytes
    } catch (e) {
      // 單張失敗不該中斷 build：那張的 og:image 會 404，卡片退回預設圖而已。
      console.warn(`[og-entities] 轉檔失敗（略過）：${rel} — ${e.message}`)
    }
  }

  console.log(
    `[og-entities] ${files.length} 張（新轉 ${made}／沿用 ${skipped}），` +
      `共 ${(bytes / 1048576).toFixed(1)} MB → public/images/og/entities/`,
  )
}

main().catch(err => {
  console.error('[og-entities] 失敗：', err)
  process.exit(1)
})
