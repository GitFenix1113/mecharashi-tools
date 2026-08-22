/**
 * 後台 IconPicker — public/images 圖檔清單產生器。
 *
 * 後台「選取圖片」挑選器需要列出 public/images 底下所有圖檔，但瀏覽器無法在執行期
 * 列舉靜態目錄。此腳本掃描 public/images，輸出 public/images/manifest.json 供前端
 * 開啟挑選器時 lazy fetch。
 *
 * 結構（依資料夾分組、只存檔名以壓縮體積）：
 *   {
 *     "folders": {
 *       ".":            ["cat_no_bg.png", ...],   // 直接放在 images/ 下的檔
 *       "skills":       ["Icon_skill_main_1020.png", ...],
 *       "pilots/亞瑟":  ["xxx.png", ...],
 *       ...
 *     }
 *   }
 * 完整路徑 = "/images/" + (folder === "." ? "" : folder + "/") + filename
 *
 * 使用：node scripts/generate-image-manifest.mjs
 * 已接進 package.json 的 build / predev，圖檔異動後重跑即可。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const IMAGES_DIR = path.join(ROOT, 'public', 'images')
const OUT_FILE = path.join(IMAGES_DIR, 'manifest.json')

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'])

/**
 * 不列入挑選器的資料夾（相對 public/images）。
 * og/entities 是 build 時由 generate-og-entity-images.mjs 產生的社群卡片用 JPEG
 * （177 張、每張都是既有立繪的副本），對後台選圖只是雜訊，也會讓 manifest 白白變大。
 */
const EXCLUDED_DIRS = new Set(['og/entities'])

/** 遞迴收集 dir 底下所有圖檔，folders[相對資料夾] = [檔名...] */
function collect(dir, relDir, folders) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const childRel = relDir ? `${relDir}/${ent.name}` : ent.name
      if (EXCLUDED_DIRS.has(childRel)) continue
      collect(path.join(dir, ent.name), childRel, folders)
    } else if (IMAGE_EXT.has(path.extname(ent.name).toLowerCase()) && ent.name !== 'manifest.json') {
      files.push(ent.name)
    }
  }
  if (files.length) {
    files.sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    folders[relDir || '.'] = files
  }
}

function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`❌ 找不到圖檔目錄：${IMAGES_DIR}`)
    process.exit(1)
  }
  const folders = {}
  collect(IMAGES_DIR, '', folders)

  const total = Object.values(folders).reduce((n, arr) => n + arr.length, 0)
  const manifest = { folders }
  fs.writeFileSync(OUT_FILE, JSON.stringify(manifest), 'utf-8')
  console.log(`✅ 圖檔清單已產生：${path.relative(ROOT, OUT_FILE)}（${Object.keys(folders).length} 個資料夾、${total} 個檔案）`)
}

main()
