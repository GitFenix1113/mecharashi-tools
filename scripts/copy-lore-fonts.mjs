/**
 * 故事館正文字型（PLAN-042-D D-2）—— 從 node_modules 的 Fontsource 套件複製 unicode-range woff2 分片
 * 到 `public/fonts/lore/`，並產生 `public/fonts/lore/lore-fonts.css`。
 *
 * 為什麼是分片而不是子集：名字是封閉集合（`generate-lore-fonts.mjs` 子集化），**逸聞正文不是**——
 * 章節會一直增加，依內容子集的話每次新增都要重跑，漏跑時新字會退回別的字型、同一段混兩套字。
 * unicode-range 分片讓瀏覽器只下載畫面上真的用到的字（一頁通常幾百 KB），而且新內容不需要任何人重跑。
 *
 * 為什麼不用 Google Fonts：中國連不上（PLAN-029 字型一律自託管）。
 * 為什麼不直接 `import '@fontsource/…'`：那會讓 Vite 把 woff 備援也一起打包（多一倍體積），
 *   而且 CSS 會進主 bundle——這裡改成只在故事館由 LoreLayout 掛 `<link>` 載入。
 *
 * 字型家族名刻意**改名**（Lore Serif／Lore Kai），不沿用 'LXGW WenKai TC'：
 *   index.css 已有同名的「名字子集」@font-face，兩組同名 face 疊在一起時哪一組先被選到取決於宣告順序，難以預期。
 *
 * 產出物**不進版控**（.gitignore 的 public/fonts/lore/）：build／predev 會重跑，CI 從 package-lock 安裝同一版字型。
 *
 * 用法：node scripts/copy-lore-fonts.mjs （已接進 package.json 的 predev／build）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'fonts', 'lore')
/** 相對 lore-fonts.css 自己的位置：不管站台掛在哪個 base path 都對 */
const PUBLIC_URL = '.'

/** 要哪些字重：明體正文 400、標題 700；楷體（引文、旁白、名字、首字）只要 400。 */
const SPECS = [
  { pkg: '@fontsource/noto-serif-tc', css: ['400.css', '700.css'], family: 'Lore Serif' },
  { pkg: '@fontsource/lxgw-wenkai-tc', css: ['400.css'], family: 'Lore Kai' },
]

fs.mkdirSync(OUT_DIR, { recursive: true })
const faces = []
let copied = 0, files = 0, bytes = 0
for (const spec of SPECS) {
  const pkgDir = path.join(ROOT, 'node_modules', ...spec.pkg.split('/'))
  if (!fs.existsSync(pkgDir)) {
    console.error(`❌ 找不到 ${spec.pkg}——先跑 npm install（它在 devDependencies）`)
    process.exit(1)
  }
  for (const cssName of spec.css) {
    const css = fs.readFileSync(path.join(pkgDir, cssName), 'utf8')
    for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
      const woff2 = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1]
      const weight = block.match(/font-weight:\s*(\d+)/)?.[1]
      const range = block.match(/unicode-range:\s*([^;]+);/)?.[1]
      if (!woff2 || !weight) continue
      const src = path.join(pkgDir, 'files', woff2)
      const dest = path.join(OUT_DIR, woff2)
      const size = fs.statSync(src).size
      if (!fs.existsSync(dest) || fs.statSync(dest).size !== size) { fs.copyFileSync(src, dest); copied++ }
      files++; bytes += size
      faces.push(`@font-face{font-family:'${spec.family}';font-style:normal;font-display:swap;font-weight:${weight};` +
        `src:url(${PUBLIC_URL}/${woff2}) format('woff2');${range ? `unicode-range:${range};` : ''}}`)
    }
  }
}
const header = `/* 由 scripts/copy-lore-fonts.mjs 產生，請勿手動編輯（PLAN-042-D D-2）。來源：${SPECS.map((s) => s.pkg).join('、')}（SIL OFL 1.1） */\n`
fs.writeFileSync(path.join(OUT_DIR, 'lore-fonts.css'), header + faces.join('\n') + '\n')
console.log(`✅ 故事館字型：${faces.length} 個 @font-face、${files} 個 woff2（${(bytes / 1048576).toFixed(1)} MB，本次複製 ${copied}）→ public/fonts/lore/`)
