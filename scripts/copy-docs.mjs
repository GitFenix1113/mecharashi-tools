/**
 * 文件頁 — docs 白名單複製器。
 *
 * 文件頁（/documents）要展示 docs/ 內的「計畫類 + 遊戲機制」文件，但 docs/ 位於 repo
 * 根目錄、不在 Vite 的發布範圍（deploy.yml 只發布 dist/）。此腳本把**白名單**目錄複製到
 * public/docs/，讓 Vite build 一起打包進 dist/docs/ 並部署。
 *
 * 安全邊界：未列入 INCLUDE 的目錄（尤其 02_技術文件/04_Firebase 安全規則、後端設定指南、
 * 資料模型）一律不複製 → 任何指向它們的連結都會自然 404，不會外洩。這是靠「不複製」而非
 * 「隱藏連結」來保證。
 *
 * 使用：node scripts/copy-docs.mjs
 * 已接進 package.json 的 build / predev，docs 異動後重跑即可。
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DOCS_DIR = path.join(ROOT, 'docs')
const OUT_DIR = path.join(ROOT, 'public', 'docs')

// 白名單：只有這些目錄/檔案會被公開（相對 docs/）
const INCLUDE = [
  '01_規劃書',
  '03_頁面規劃',
  '04_進度表',
  '05_階段性開發計畫',
  '02_技術文件/03_遊戲機制', // 遊戲機制（傷害公式、配裝模擬器流程）— 不含 Firebase/資料模型/架構
  '_shared',                  // style.css，所有文件共用，必須一起複製
]

function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`❌ 找不到文件目錄：${DOCS_DIR}`)
    process.exit(1)
  }

  // 每次先清掉舊輸出，避免殘留已從白名單移除的文件
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  let copied = 0
  for (const rel of INCLUDE) {
    const src = path.join(DOCS_DIR, rel)
    if (!fs.existsSync(src)) {
      console.warn(`⚠️  白名單項目不存在，略過：docs/${rel}`)
      continue
    }
    const dest = path.join(OUT_DIR, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest, { recursive: true })
    copied++
  }

  console.log(`✅ 文件已複製到 ${path.relative(ROOT, OUT_DIR)}（${copied}/${INCLUDE.length} 個白名單項目）`)
}

main()
