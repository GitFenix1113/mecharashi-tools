/**
 * 鋼嵐工具站 — PNG/JPG 批次轉 WebP
 *
 * GitHub Pages 沒有圖片最佳化層，public/images 的原圖是多大就讓使用者下載多大。
 * 本腳本用 sharp 把 PNG/JPG 轉成 WebP（保留 alpha），並在轉檔前檢查透明度，
 * 避免把「看起來去背、其實把棋盤格底紋畫進像素」的圖當成去背圖轉進站內。
 *
 * 預設是 dry-run（只報告不寫檔），要實際產出必須加 --apply。
 *
 * 使用方式：
 *   node scripts/convert-images-to-webp.mjs                          ← 掃全部 public/images，只報告
 *   node scripts/convert-images-to-webp.mjs pilots/曜                ← 只掃某個子資料夾
 *   node scripts/convert-images-to-webp.mjs pilots --apply           ← 實際產出 .webp
 *   node scripts/convert-images-to-webp.mjs --apply --quality=90     ← 指定品質（預設 82）
 *   node scripts/convert-images-to-webp.mjs --apply --max=1600       ← 長邊上限 1600px（預設不縮）
 *   node scripts/convert-images-to-webp.mjs --apply --delete-src     ← 轉檔成功後刪除原始 PNG/JPG
 *   node scripts/convert-images-to-webp.mjs --apply --force          ← 已存在的 .webp 也重轉
 *   node scripts/convert-images-to-webp.mjs --min-kb=0               ← 連小圖也轉（預設只處理 ≥100KB）
 *   node scripts/convert-images-to-webp.mjs mechs --no-recurse       ← 只處理本層，不進子資料夾
 *   node scripts/convert-images-to-webp.mjs mechs --exclude=mech_models,mech_badges
 *
 * 轉檔後續步驟：
 *   1. node scripts/generate-image-manifest.mjs   ← 後台 IconPicker 才看得到新檔
 *   2. node scripts/patch-image-paths.mjs         ← 把 Firestore 內引用的 .png 路徑改指 .webp
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const IMAGES_DIR = path.join(ROOT, 'public', 'images')

const SRC_EXT = new Set(['.png', '.jpg', '.jpeg'])

// ── 參數 ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const FORCE = args.includes('--force')
const DELETE_SRC = args.includes('--delete-src')
const numArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.slice(name.length + 3)) : fallback
}
const QUALITY = numArg('quality', 82)
const MAX_EDGE = numArg('max', 0)          // 0 = 不縮
const MIN_KB = numArg('min-kb', 100)       // 小圖（icon）轉了省不到什麼，預設跳過
// 只處理本層、不進子資料夾。用途：程式碼裡有硬編副檔名的路徑（例如 MechsPage 的
// `images/mechs/{名稱}.png` 縮圖 fallback）時，該層必須「全轉或全不轉」才不會有的是
// .webp 有的還是 .png；此時要對該層單獨下 --min-kb=0 --no-recurse。
const NO_RECURSE = args.includes('--no-recurse')
// 排除子資料夾（逗號分隔的資料夾名）。用途同上：mech_models / mech_badges 的路徑
// 在 planner 元件裡是硬編 .png 的，遞迴轉檔時要跳過它們。
const EXCLUDE = (args.find((a) => a.startsWith('--exclude='))?.slice(10) ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean)
const SUBDIR = args.find((a) => !a.startsWith('--')) ?? ''

const TARGET_DIR = path.join(IMAGES_DIR, SUBDIR)

// ── 工具 ─────────────────────────────────────────────────────────────────────
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`
const rel = (abs) => path.relative(IMAGES_DIR, abs).replace(/\\/g, '/')

function collect(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) { if (!NO_RECURSE && !EXCLUDE.includes(ent.name)) collect(full, out) }
    else if (SRC_EXT.has(path.extname(ent.name).toLowerCase())) out.push(full)
  }
  return out
}

/**
 * 透明度檢查。回傳 { hasAlpha, isOpaque, checkerboard }
 *
 * checkerboard：偵測「棋盤格被畫進像素」的常見誤匯出。原理是沿著圖片頂端第 3 列掃描，
 * 若出現大量等寬、灰白交替（約 200 與 255）的色塊，就幾乎確定是繪圖軟體的透明底紋被一起輸出。
 * 這種圖檔案大、alpha 全 255，轉成 WebP 只是把錯誤原封不動搬過去，所以要在轉檔前擋下。
 */
async function inspectAlpha(file) {
  const img = sharp(file)
  const meta = await img.metadata()
  const stats = await img.stats()
  const hasAlpha = !!meta.hasAlpha
  const isOpaque = stats.isOpaque

  let checkerboard = false
  if (isOpaque) {
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
    const y = Math.min(2, info.height - 1)
    const at = (x) => data[(y * info.width + x) * info.channels]
    const widths = []
    let prev = at(0)
    let start = 0
    for (let x = 1; x < info.width; x++) {
      const v = at(x)
      if (Math.abs(v - prev) > 20) { widths.push({ w: x - start, v: prev }); start = x; prev = v }
    }
    widths.push({ w: info.width - start, v: prev })
    // 縮放過的棋盤格邊界會有 1～3px 的過渡色塊，先濾掉才看得出主節奏
    const blocks = widths.filter((b) => b.w >= 4)
    if (blocks.length >= 8) {
      const tally = new Map()
      for (const b of blocks) tally.set(b.w, (tally.get(b.w) ?? 0) + 1)
      const mode = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const onBeat = blocks.filter((b) => Math.abs(b.w - mode) <= 2).length / blocks.length
      const light = blocks.filter((b) => b.v >= 235).length
      const gray = blocks.filter((b) => b.v >= 180 && b.v <= 225).length
      // 條件：多數色塊等寬（棋盤節奏），且明暗兩群分別落在近白與淺灰
      checkerboard = onBeat >= 0.6 && light >= 3 && gray >= 3
    }
  }
  return { hasAlpha, isOpaque, checkerboard, width: meta.width, height: meta.height }
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(TARGET_DIR)) {
    console.error(`❌ 找不到目錄：${TARGET_DIR}`)
    process.exit(1)
  }

  const files = collect(TARGET_DIR).filter((f) => fs.statSync(f).size >= MIN_KB * 1024)
  if (!files.length) {
    console.log(`（${SUBDIR || 'public/images'} 底下沒有 ≥${MIN_KB}KB 的 PNG/JPG 可轉）`)
    return
  }

  console.log(`掃描 public/images/${SUBDIR}　共 ${files.length} 個檔案`)
  console.log(`模式：${APPLY ? '實際寫入' : 'DRY-RUN（不寫檔）'}　品質 ${QUALITY}${MAX_EDGE ? `　長邊上限 ${MAX_EDGE}px` : ''}${DELETE_SRC ? '　轉檔後刪原檔' : ''}\n`)

  let srcTotal = 0, outTotal = 0, converted = 0, skipped = 0
  const warnings = []

  for (const file of files) {
    const out = file.replace(/\.(png|jpe?g)$/i, '.webp')
    const srcSize = fs.statSync(file).size

    if (!FORCE && fs.existsSync(out)) {
      skipped++
      continue
    }

    let info
    try {
      info = await inspectAlpha(file)
    } catch (err) {
      console.log(`  ⚠ ${rel(file)}　讀取失敗：${err.message}`)
      skipped++
      continue
    }

    // 有 alpha 通道但整張全不透明 → 極可能是「以為去背了但沒有」。
    // 只對 PNG 判定：JPG 本來就不帶透明（sharp 偶爾仍回報 hasAlpha），警告它只是雜訊。
    if (path.extname(file).toLowerCase() === '.png' && info.hasAlpha && info.isOpaque) {
      const why = info.checkerboard
        ? '偵測到棋盤格被畫進像素，這不是去背圖'
        : 'alpha 通道全為 255，等同沒有去背'
      warnings.push(`${rel(file)}　${why}`)
      if (info.checkerboard) {
        console.log(`  ⛔ ${rel(file)}　${why} → 跳過，請取得真正的去背原圖`)
        skipped++
        continue
      }
    }

    let pipeline = sharp(file)
    if (MAX_EDGE && Math.max(info.width, info.height) > MAX_EDGE) {
      pipeline = pipeline.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    }
    // alphaQuality 100：去背邊緣的半透明過渡若被壓壞，頭髮邊緣會出現鋸齒白邊。
    // effort 6：壓縮較久但檔案更小；離線腳本不在乎這點時間。
    const buf = await pipeline.webp({ quality: QUALITY, alphaQuality: 100, effort: 6 }).toBuffer()

    srcTotal += srcSize
    outTotal += buf.length
    converted++

    const pct = ((1 - buf.length / srcSize) * 100).toFixed(0)
    const alphaTag = info.isOpaque ? '不透明' : '有去背'
    console.log(`  ${APPLY ? '✅' : '·'} ${rel(file)}　${kb(srcSize)} → ${kb(buf.length)}（省 ${pct}%）　${alphaTag}`)

    if (APPLY) {
      fs.writeFileSync(out, buf)
      if (DELETE_SRC) fs.unlinkSync(file)
    }
  }

  console.log('')
  console.log(`轉換 ${converted} 個、略過 ${skipped} 個`)
  if (converted) {
    const pct = ((1 - outTotal / srcTotal) * 100).toFixed(0)
    console.log(`總計 ${kb(srcTotal)} → ${kb(outTotal)}　省下 ${kb(srcTotal - outTotal)}（${pct}%）`)
  }

  if (warnings.length) {
    console.log(`\n⚠ 透明度警告（${warnings.length} 個）：`)
    for (const w of warnings) console.log(`   ${w}`)
    console.log('   立繪類圖片若應為去背，請回到原始檔重新匯出並確認有保留 alpha 通道。')
  }

  if (!APPLY) console.log('\n以上為預覽。確認無誤後加上 --apply 實際寫入。')
  else console.log('\n下一步：node scripts/generate-image-manifest.mjs　然後　node scripts/patch-image-paths.mjs')
}

main().catch((err) => { console.error('❌ 失敗：', err); process.exit(1) })
