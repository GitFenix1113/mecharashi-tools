/**
 * 原稿立繪索引產生器 —— 掃 public/images 產出 `src/data/artIndex.ts`
 *
 * 為什麼需要它：機師的原稿 `art.webp`（863×1600 直式全身）與既有的 `full.webp`
 * （1240×1080 橫式半身特寫）**構圖不同、共用不了同一個框**，而原稿只有 52/88 位有。
 * 版面必須在渲染前就知道「這位有沒有 art」才選得出構圖。
 *
 * 為什麼不能用 `FallbackImage` 解決：它是「載失敗就換下一個候選」，
 * **不會回報最後載到哪一張**。就算加上回報，那也是圖片載完之後的事 ——
 * 而立繪是非同步載入的，等它回報再決定版面就等於讓卡片在載入完成那一刻跳動一次
 * （`PilotIdentityCard` 的「卡片高度寫死」正是為了避免這件事）。
 *
 * 為什麼不用現成的 `public/images/manifest.json`：那份 65KB、且是後台選圖器
 * **開啟時才 lazy fetch** 的。讓模擬器首屏為了一個布林值多一次網路往返，
 * 而且那次往返正好卡在版面要決定怎麼排的時候。
 *
 * ⚠ **機甲後來也進來了**（2026-08-29）。原註解寫「機甲不需要索引，因為 art.webp（1.85）
 *   與 portrait.webp（1.65）比例接近，同一個橫框通吃」——**比例接近是真的，但那不是重點**：
 *   兩者差在**解析度**（1600×864 vs 560×340）。匯出圖把機甲放大到 421 高時，art 是縮小、
 *   portrait 是放大 1.24 倍，後者會糊。兩者要用**不同的構圖**（小尺寸、不出血），
 *   所以機甲也需要在渲染前就知道有沒有原稿。
 *
 * ⚠ **這裡不判斷去背與否**（2026-08-29 更正）：實測全 88 台的 alpha，`portrait.webp`
 *   **也是去背圖**（透明像素 10–36%，88/88）。曾有一台例外（星夜女神），已換圖修掉。
 *   一台的資料瑕疵不值得多一條索引維度 —— 遇到就修圖。
 *
 * 產出物**進版控**（不像 og/entities 那樣被 gitignore）：它是 TS 原始碼，
 * 型別檢查與 import 都要看得到它，缺檔會直接讓 `tsc -b` 失敗而不是靜默降級。
 *
 * 使用：node scripts/generate-art-index.mjs
 * 已接進 package.json 的 build / predev，匯入新原稿後重跑即可。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PILOTS_DIR = path.join(ROOT, 'public', 'images', 'pilots')
const MECHS_DIR = path.join(ROOT, 'public', 'images', 'mechs')
const OUT_FILE = path.join(ROOT, 'src', 'data', 'artIndex.ts')

const ART_FILE = 'art.webp'

/**
 * 某個圖庫底下，哪些資料夾有 `art.webp`。回傳 `[全部實體資料夾, 有 art 的]`。
 *
 * ⚠ **`markers` 用來認出「這是一個實體資料夾」**（2026-08-29）：`images/mechs/` 底下
 *   混著 `mech_badges/`、`mech_models/` 這種非機甲的素材夾，照單全收會讓分母虛胖 ——
 *   原本印出來的「83/90」其實是 83/88，而那個數字被抄進了三個檔案的註解裡。
 *
 * ⚠ **每個 marker 都要備 `.png`**：圖庫至今仍有未轉檔的歷史值（機師「阿列娜」只有
 *   `full.png` / `half.png`）。只認 `.webp` 的話那一位會被整個當成非機師資料夾漏掉。
 */
function scan(dir, label, markers) {
  if (!fs.existsSync(dir)) {
    console.error(`❌ 找不到${label}圖庫：${dir}`)
    process.exit(1)
  }
  const dirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((d) => markers.some((f) => fs.existsSync(path.join(dir, d, f))))
  const withArt = dirs
    .filter((d) => fs.existsSync(path.join(dir, d, ART_FILE)))
    // localeCompare 讓 diff 穩定：readdir 的順序在不同檔案系統上不保證一致，
    // 沒排序的話每次在不同機器重跑都會產生一份假 diff
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  return [dirs, withArt]
}

function main() {
  const [dirs, withArt] = scan(PILOTS_DIR, '機師', ['full.webp', 'full.png', 'half.webp', 'half.png'])
  const [mechDirs, mechsWithArt] = scan(MECHS_DIR, '機甲', ['portrait.webp', 'portrait.png'])

  const body = withArt.map((n) => `  '${n}',`).join('\n')
  const mechBody = mechsWithArt.map((n) => `  '${n}',`).join('\n')

  const out = `// ⚠ 本檔由 scripts/generate-art-index.mjs 自動產生，請勿手動編輯。
// 重新產生：node scripts/generate-art-index.mjs（build / predev 會自動跑）

/**
 * 有官方原稿全身立繪（\`/images/pilots/<名>/art.webp\`）的機師資料夾名。
 *
 * 用途：\`art.webp\` 是直式全身（863×1600），既有的 \`full.webp\` 是橫式半身特寫
 * （1240×1080），兩者構圖不同、共用不了同一個框。版面要在**渲染前**就知道
 * 該用哪一套構圖，而不是等圖載完才知道 —— 後者會讓卡片在載入完成那一刻跳動。
 *
 * ⚠ 這裡存的是**圖片資料夾名**，也就是 \`pilot.portrait\` 路徑裡的那一段，
 *   不一定等於 \`pilot.name\`（少數機師的資料夾名與顯示名有簡繁／譯名差異）。
 *   查詢一律走 \`hasPilotArt(pilot)\`，不要自己用名字去比對。
 *
 */
export const PILOT_ART_INDEX: ReadonlySet<string> = new Set([
${body}
])

/**
 * 有官方**去背原稿**（\`/images/mechs/<名>/art.webp\`，1600×864 透明底）的機甲資料夾名。
 *
 * 用途與機師那份相同，但判準不是構圖而是**撐不撐得起放大出血的版面**：
 *   · \`art.webp\`      1600×864 ⇒ 放到 421 高是縮小，銳利，可以出血
 *   · \`portrait.webp\`  560×340  ⇒ 同樣尺寸要放大 1.24 倍，糊；只能走小尺寸版面
 * 匯出圖的主視覺因此要**在渲染前**就分流，不能靠 \`imageCandidates()\` 逐層退回
 * （那只答得出「載到了沒」，答不出「載到的是哪一種」）。
 *
 * ⚠ 兩者**都是去背圖**（實測 88/88，portrait 的透明像素佔 10–36%）。
 *
 * ⚠ 存的是**圖片資料夾名**（\`mech.portrait\` 路徑裡的那一段），不一定等於 \`mech.name\`。
 *   查詢一律走 \`hasMechArt(mech)\`。
 */
export const MECH_ART_INDEX: ReadonlySet<string> = new Set([
${mechBody}
])
`

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, out, 'utf-8')

  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(0) : '0')
  console.log(
    `✅ 原稿索引已產生：${path.relative(ROOT, OUT_FILE)}` +
    `（機師 ${withArt.length}/${dirs.length}，${pct(withArt.length, dirs.length)}%；` +
    `機甲 ${mechsWithArt.length}/${mechDirs.length}，${pct(mechsWithArt.length, mechDirs.length)}%）`,
  )
}

main()
