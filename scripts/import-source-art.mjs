/**
 * 官方原稿藝術大圖 → public/images 匯入器
 *
 * 背景：站上原本的機師 / 機甲圖都是從官方 CDN 抓的**裁切圖**——
 *   pilots/<名>/half.webp     340×340    頭像
 *   pilots/<名>/full.webp     1240×1080  半身特寫（名為 full，其實只到大腿）
 *   mechs/<名>/portrait.webp  560×340    機體 3/4 特寫（只有上半身）
 * 2026-08 取得的原稿是**完整全身圖**（機師約 4800×8900、機甲 2000×1080，PNG 帶去背），
 * 構圖與上面任何一張都不同，屬於**新增的一層**，不是既有圖的高清版，因此不覆蓋任何舊檔。
 *
 * 產出檔名統一為 `art.webp`，與既有檔案並存於同一個實體資料夾：
 *   pilots/<名>/art.webp   長邊 ≤1600（直式 → 約 863×1600）
 *   mechs/<名>/art.webp    長邊 ≤1600（橫式 → 約 1600×864）
 * 取 art（原稿）而非 full/original 之類，是因為 `full.webp` 已被上述裁切圖佔用，
 * 用「來源」而非「構圖」當命名軸，日後多解析度就是 art@2x.webp，不會再撞名。
 *
 * ⚠ 原稿 PNG（總計約 1GB）**不進版控**，留在原始素材夾即可；本腳本只把壓過的 WebP 寫進 repo。
 *
 * 目的地（PLAN-054 D-2 起）：**遊戲 ID 資料夾** `pilots/<gameId>/art.webp`。
 * 素材檔名是中文名 → 先用 MATERIAL_NAME_FIXES 收掉簡繁／譯名差異 → 在 Firestore 找**顯示名完全相符**的機師 → 取它的 gameId。
 * 找不到唯一對應、或那位沒有 gameId 就列進待處理，寧可漏也不要寫進錯的人。
 * 機甲不再匯入原稿：官方全身大圖 `_SN_Raw`（2000×1080）已全面取代站上的 art.webp（91／92 台）。
 *
 * 使用方式：
 *   node scripts/import-source-art.mjs                       ← dry-run，只報告
 *   node scripts/import-source-art.mjs --apply               ← 實際寫入
 *   node scripts/import-source-art.mjs --apply --force       ← 連已存在的 art.webp 也重轉
 *   node scripts/import-source-art.mjs --src="D:/其他素材"    ← 換素材來源
 *   node scripts/import-source-art.mjs --apply --max=2000 --quality=86
 *
 * 匯入後：node scripts/generate-image-manifest.mjs（後台 IconPicker 才看得到）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMAGES = path.join(ROOT, 'public', 'images')

// ── 參數 ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const FORCE = args.includes('--force')
const strArg = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d
const numArg = (n, d) => Number(strArg(n, d))

const SRC = strArg('src', 'E:/Pictures/Mecharashi素材')
const MAX_EDGE = numArg('max', 1600)
const QUALITY = numArg('quality', 82)
const OUT_NAME = strArg('name', 'art.webp')

/**
 * 素材檔名 → 站上**顯示名**（不再是資料夾名：PLAN-054 D-2 起資料夾是遊戲 ID）。
 * 多數是簡繁差異（奥/奧、托/託），少數是譯名不同（維若妮卡/維羅妮卡）。
 * 站上有幾個名字其實是簡轉繁轉壞的（芬裡厄 應為 芬里厄、葛裡高利 應為 葛里高利），
 * 但那是 Firestore 既有資料的問題，**不在這支腳本的守備範圍**——這裡只負責對上，不改名。
 */
const MATERIAL_NAME_FIXES = {
  奈奥米: '奈奧米',
  奥德莉: '奧德莉',
  維若妮卡: '維羅妮卡',
  繪梨莎: '繪梨沙',
  羅斯瑪莉: '羅斯瑪麗',
  塔納托斯: '塔納託斯',
  芬里厄: '芬裡厄',
}

// ── 工具 ─────────────────────────────────────────────────────────────────────
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory()

/** 顯示名 → { gameId, artKey }（唯讀讀 Firestore；金鑰同 scripts/temp_scripts 的慣例） */
async function loadPilotsByName() {
  const require = createRequire(path.join(ROOT, 'package.json'))
  const admin = require('firebase-admin')
  for (const f of ['.env', '.env.migration']) {
    const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue
    for (const l of fs.readFileSync(p, 'utf-8').split('\n')) { const i = l.indexOf('='); if (i > 0) { const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim(); if (k && v && !k.startsWith('#')) process.env[k] = v } }
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.resolve(ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf-8'))) })
  const snap = await admin.firestore().collection('pilots').get()
  return new Map(snap.docs.map((d) => [d.data().name, { gameId: d.data().gameId, artKey: d.data().artKey }]))
}
let PILOTS_BY_NAME = new Map()

/** 遞迴收集素材 PNG/JPG，回傳絕對路徑 */
function collect(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) collect(full, out)
    else if (/\.(png|jpe?g)$/i.test(ent.name)) out.push(full)
  }
  return out
}

/**
 * 由素材檔名解析出 { kind, dir, artKey }。
 * 步驟：去副檔名 → 去 `Icon_` 前綴 → 查 MATERIAL_NAME_FIXES → 在 Firestore 找顯示名完全相符的機師 → 取 gameId。
 * 找不到、沒有 gameId 就回 `{ error }`，由呼叫端列進待處理清單而不是硬猜。
 */
function resolve(file) {
  const raw = path.basename(file).replace(/\.(png|jpe?g)$/i, '').replace(/^Icon_/, '')
  const name = MATERIAL_NAME_FIXES[raw] ?? raw
  const p = PILOTS_BY_NAME.get(name)
  if (!p) return { error: `「${raw}」在站上找不到同名機師${raw !== name ? `（已試 ${name}）` : ''}——機甲原稿已由官方 _SN_Raw 取代，不再匯入` }
  if (!p.gameId) return { error: `「${name}」沒有 gameId（PLAN-054），請先在後台補上再匯入` }
  return { kind: 'pilots', dir: p.gameId, artKey: p.artKey, raw }
}

/** 站上既有的官方半身（＝舊的 full.webp），用來判斷素材是不是根本沒帶新東西 */
const referenceOf = (r) => r.artKey ? `game/pilots/${r.dir}/${r.artKey}_Raw.webp` : undefined

/** 產出的 buf 是否與參考圖像素完全相同 */
async function isSameAs(refRel, r, outMeta, buf) {
  if (!refRel) return false
  const ref = path.join(IMAGES, refRel)
  if (!fs.existsSync(ref)) return false
  const refMeta = await sharp(ref).metadata()
  if (refMeta.width !== outMeta.width || refMeta.height !== outMeta.height) return false
  // 參考圖是官方原檔另外壓過的 WebP（PLAN-054），與素材重壓的結果不會逐位元組相同。
  // 只比**看得見的像素**：全透明處底下的 RGB 是編碼器隨意留的值（實測維娜那張全圖平均差 45，
  // 可見像素只差 2.8、alpha 只差 0.3——其實是同一張）。可見 RGB < 5 且 alpha < 2 就當同一張。
  const raw = (x) => sharp(x).ensureAlpha().raw().toBuffer()
  const [a, b] = await Promise.all([raw(buf), raw(ref)])
  if (a.length !== b.length) return false
  let rgb = 0, alpha = 0, visible = 0
  for (let i = 0; i < a.length; i += 4) {
    alpha += Math.abs(a[i + 3] - b[i + 3])
    if (a[i + 3] > 16 || b[i + 3] > 16) {
      rgb += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
      visible++
    }
  }
  return alpha / (a.length / 4) < 2 && (visible === 0 || rgb / visible < 5)
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  if (!isDir(SRC)) {
    console.error(`❌ 找不到素材目錄：${SRC}`)
    process.exit(1)
  }

  PILOTS_BY_NAME = await loadPilotsByName()
  const files = collect(SRC)
  console.log(`素材來源：${SRC}　共 ${files.length} 個檔案`)
  console.log(`模式：${APPLY ? '實際寫入' : 'DRY-RUN（不寫檔）'}　長邊上限 ${MAX_EDGE}px　品質 ${QUALITY}　輸出 ${OUT_NAME}\n`)

  const unresolved = []
  const lowRes = []
  const redundant = []
  const seen = new Map() // 目的地 → 已處理的來源，用來擋重複素材
  let written = 0, skipped = 0, outTotal = 0

  for (const file of files.sort((a, b) => a.localeCompare(b, 'zh-Hant'))) {
    const r = resolve(file)
    if (r.error) { unresolved.push(`${path.relative(SRC, file)}　${r.error}`); continue }

    const outPath = path.join(IMAGES, r.kind, r.dir, OUT_NAME)
    const key = `${r.kind}/${r.dir}`

    if (seen.has(key)) {
      console.log(`  ↔ ${key}　已由 ${seen.get(key)} 產出，略過重複素材 ${path.relative(SRC, file)}`)
      continue
    }
    if (!FORCE && fs.existsSync(outPath)) { skipped++; continue }

    const meta = await sharp(file).metadata()
    // 少數素材本身就不到目標解析度（例：提費斯 857×1342）。withoutEnlargement 會讓它
    // 維持原尺寸而非放大糊掉，但要記下來，日後補到更好的原稿時知道該重跑哪幾張。
    if (Math.max(meta.width, meta.height) < MAX_EDGE) {
      lowRes.push(`${key}　原稿僅 ${meta.width}×${meta.height}`)
    }

    const buf = await sharp(file)
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      // alphaQuality 100：去背邊緣的半透明過渡若被壓壞，髮絲邊緣會出現白邊鋸齒
      .webp({ quality: QUALITY, alphaQuality: 100, effort: 6 })
      .toBuffer()
    const outMeta = await sharp(buf).metadata()

    // 這批素材不是每一張都真的是原稿：機師「維娜」給的就是站上 full.webp 那張同尺寸的
    // 官方裁切圖，寫進去只是多一份 154KB 的重複。先比尺寸（便宜）再比像素（貴），
    // 相同就不寫檔 —— 否則每次重跑都會把它生回來。
    if (await isSameAs(referenceOf(r), r, outMeta, buf)) {
      redundant.push(`${key}　與官方半身 ${referenceOf(r)} 是同一張圖，這不是原稿`)
      continue
    }

    seen.set(key, path.relative(SRC, file))
    written++
    outTotal += buf.length
    console.log(`  ${APPLY ? '✅' : '·'} ${key}/${OUT_NAME}　${meta.width}×${meta.height} → ${outMeta.width}×${outMeta.height}　${kb(buf.length)}`)

    if (APPLY) fs.writeFileSync(outPath, buf)
  }

  console.log('')
  console.log(`產出 ${written} 個、略過 ${skipped} 個（已存在，加 --force 可重轉）　合計 ${kb(outTotal)}`)

  if (redundant.length) {
    console.log(`\n⚠ 素材其實不是原稿（${redundant.length} 個，未寫檔）：`)
    for (const l of redundant) console.log(`   ${l}`)
  }
  if (lowRes.length) {
    console.log(`\n⚠ 原稿解析度低於 ${MAX_EDGE}px（${lowRes.length} 個，已維持原尺寸不放大）：`)
    for (const l of lowRes) console.log(`   ${l}`)
  }
  if (unresolved.length) {
    console.log(`\n❌ 無法對應（${unresolved.length} 個，未處理）：`)
    for (const u of unresolved) console.log(`   ${u}`)
    console.log('   請確認站上機師名，或補進本腳本的 MATERIAL_NAME_FIXES。')
  }

  if (!APPLY) console.log('\n以上為預覽。確認無誤後加上 --apply 實際寫入。')
  else console.log('\n下一步：node scripts/generate-image-manifest.mjs')
}

main().catch((err) => { console.error('❌ 失敗：', err); process.exit(1) })
