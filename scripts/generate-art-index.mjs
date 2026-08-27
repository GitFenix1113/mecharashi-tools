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
 * ⚠ 機甲**不在**這份索引裡，這是刻意的：`art.webp`（1600×864，比例 1.85）與
 *   `portrait.webp`（560×340，比例 1.65）比例接近，同一個橫框放兩張都成立，
 *   直接交給 `imageCandidates(art, portrait)` 逐層退回即可，不需要分支。
 *   把用不到的 83 個名字寫進來只會讓檔案變大、讓讀的人以為機甲那邊也有分支。
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
const OUT_FILE = path.join(ROOT, 'src', 'data', 'artIndex.ts')

const ART_FILE = 'art.webp'

function main() {
  if (!fs.existsSync(PILOTS_DIR)) {
    console.error(`❌ 找不到機師圖庫：${PILOTS_DIR}`)
    process.exit(1)
  }

  const dirs = fs
    .readdirSync(PILOTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  const withArt = dirs
    .filter((d) => fs.existsSync(path.join(PILOTS_DIR, d, ART_FILE)))
    // localeCompare 讓 diff 穩定：readdir 的順序在不同檔案系統上不保證一致，
    // 沒排序的話每次在不同機器重跑都會產生一份假 diff
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))

  const body = withArt.map((n) => `  '${n}',`).join('\n')

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
 * ⚠ 機甲**不需要**這種索引：\`art.webp\`（1.85）與 \`portrait.webp\`（1.65）比例接近，
 *   同一個橫框通吃，交給 \`imageCandidates()\` 逐層退回就好。
 */
export const PILOT_ART_INDEX: ReadonlySet<string> = new Set([
${body}
])
`

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, out, 'utf-8')

  const pct = dirs.length ? ((withArt.length / dirs.length) * 100).toFixed(0) : '0'
  console.log(
    `✅ 原稿索引已產生：${path.relative(ROOT, OUT_FILE)}（${withArt.length}/${dirs.length} 位機師有 art，${pct}%）`,
  )
}

main()
