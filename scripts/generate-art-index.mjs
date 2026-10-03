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
import sharp from 'sharp'
import { GAME_DIR, PART_NO, classifyMechFile, classifyPilotFile } from './lib/gameAssetKinds.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GAME_ROOT = path.join(ROOT, 'public', GAME_DIR)
const GAME_OUT_FILE = path.join(ROOT, 'src', 'data', 'gameArtIndex.ts')
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
  // PLAN-054 D-2：機師資料夾全面改成遊戲 ID（純數字），名字就是實體的標記，不必再看裡面有沒有 half／full
  const isEntity = (d) => /^\d+$/.test(d) || markers.some((f) => fs.existsSync(path.join(dir, d, f)))
  const dirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter(isEntity)
  const withArt = dirs
    .filter((d) => fs.existsSync(path.join(dir, d, ART_FILE)))
    // localeCompare 讓 diff 穩定：readdir 的順序在不同檔案系統上不保證一致，
    // 沒排序的話每次在不同機器重跑都會產生一份假 diff
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  return [dirs, withArt]
}

/**
 * 官網 hero 圖層（PLAN-042-C C-1）：`official-{color,line,name}.webp` 三張齊全的機師資料夾。
 * 只有官網做過的 8 位有。這裡連尺寸一起記進索引 —— 版面要在渲染前知道名字層的長寬比才擺得出位置；
 * color 與 line 裁的是同一個 bbox，尺寸必須相同（兩層要對得齊）。
 * 三張不齊或尺寸不合直接讓 build 失敗，不要靜默降級成「少一層」。
 */
async function scanOfficial(dir, dirs) {
  const out = []
  for (const d of dirs) {
    const p = (f) => path.join(dir, d, f)
    if (!fs.existsSync(p('official-color.webp'))) continue
    if (!fs.existsSync(p('official-line.webp')) || !fs.existsSync(p('official-name.webp'))) {
      console.error(`❌ ${d} 的官方圖層不齊：official-color / official-line / official-name 三張都要有`)
      process.exit(1)
    }
    const [c, l, n] = await Promise.all(
      ['official-color.webp', 'official-line.webp', 'official-name.webp'].map((f) => sharp(p(f)).metadata()),
    )
    if (c.width !== l.width || c.height !== l.height) {
      console.error(`❌ ${d} 的 official-color（${c.width}×${c.height}）與 official-line（${l.width}×${l.height}）尺寸不同，兩層對不齊`)
      process.exit(1)
    }
    out.push({ d, w: c.width, h: c.height, nameW: n.width, nameH: n.height })
  }
  return out.sort((a, b) => a.d.localeCompare(b.d, 'zh-Hant'))
}

/**
 * 官方原檔索引（PLAN-054 B-4）：掃 `public/images/game/`，每個 ID 記「有哪幾種圖」。
 *
 * 只記讀取端用得到的種類（機師 half／head／raw／card、機甲 icon／sn／部件 1~4），
 * 不把近千個檔名打進前台 bundle——路徑由 `src/utils/gameArt.ts` 依命名規則拼。
 * 機師另記資料夾裡實際的立繪主鍵：讀取端拿它跟 DB 的 `artKey` 比對，對不上就不給路徑（寧可退回舊圖也不給 404）。
 * 同一個資料夾出現兩種立繪主鍵直接讓 build 失敗——那代表有人把造型圖放進了 core 資料夾。
 */
function scanGame() {
  const listDirs = (d) => fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : []
  const webps = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5))
  const pilots = []
  for (const id of listDirs(path.join(GAME_ROOT, 'pilots'))) {
    const e = { id, key: undefined, kinds: new Set() }
    for (const name of webps(path.join(GAME_ROOT, 'pilots', id))) {
      const c = classifyPilotFile(name, id)
      if (!c) continue
      if (c.key) {
        if (e.key && e.key !== c.key) {
          console.error(`❌ game/pilots/${id} 裡有兩種立繪主鍵：${e.key}／${c.key}（core 資料夾只放預設造型）`)
          process.exit(1)
        }
        e.key = c.key
      }
      e.kinds.add(c.kind)
    }
    if (e.kinds.size) pilots.push(e)
  }
  const mechs = []
  for (const wap of listDirs(path.join(GAME_ROOT, 'mechs'))) {
    const e = { wap, kinds: new Set() }
    for (const name of webps(path.join(GAME_ROOT, 'mechs', wap))) {
      const c = classifyMechFile(name, wap)
      if (c) e.kinds.add(c.kind)
    }
    if (e.kinds.size) mechs.push(e)
  }
  return { pilots, mechs }
}

function writeGameIndex({ pilots, mechs }) {
  const flags = (kinds, list) => list.filter((k) => kinds.has(k)).map((k) => `${k}: true`).join(', ')
  const pilotBody = pilots
    .map((e) => `  ['${e.id}', { ${[e.key ? `key: '${e.key}'` : '', flags(e.kinds, ['half', 'head', 'raw', 'card'])].filter(Boolean).join(', ')} }],`)
    .join('\n')
  const mechBody = mechs
    .map((e) => {
      const parts = Object.keys(PART_NO).filter((k) => e.kinds.has(k)).map((k) => PART_NO[k]).join('')
      return `  ['${e.wap}', { ${[flags(e.kinds, ['icon', 'sn']), `parts: '${parts}'`].filter(Boolean).join(', ')} }],`
    })
    .join('\n')
  const out = `// ⚠ 本檔由 scripts/generate-art-index.mjs 自動產生，請勿手動編輯。
// 重新產生：node scripts/generate-art-index.mjs（build / predev 會自動跑）

/**
 * 官方原檔（PLAN-054）：\`public/images/game/pilots/<gameId>/\` 裡有哪幾種圖。
 *
 * 版面要在**渲染前**就知道某個 ID 有沒有某種圖（與 \`PILOT_ART_INDEX\` 同理），
 * 所以由 build 掃資料夾產生，而不是等圖載失敗才換構圖。
 * \`key\` 是資料夾裡實際的立繪主鍵——讀取端會拿它跟 DB 的 \`artKey\` 比對。
 * 查詢一律走 \`pilotGameArt()\`（src/utils/gameArt.ts），不要自己拼路徑。
 */
export interface GamePilotArt { key?: string; half?: true; head?: true; raw?: true; card?: true }
export const GAME_PILOT_ART: ReadonlyMap<string, GamePilotArt> = new Map<string, GamePilotArt>([
${pilotBody}
])

/**
 * 官方原檔（PLAN-054）：\`public/images/game/mechs/<wap>/\` 裡有哪幾種圖。
 * \`parts\` 是有圖的部件編號（1 軀幹／2 左臂／3 右臂／4 腿）。查詢一律走 \`mechGameArt()\`。
 */
export interface GameMechArt { icon?: true; sn?: true; parts: string }
export const GAME_MECH_ART: ReadonlyMap<string, GameMechArt> = new Map<string, GameMechArt>([
${mechBody}
])
`
  fs.writeFileSync(GAME_OUT_FILE, out, 'utf-8')
  const has = (list, k) => list.filter((e) => e.kinds.has(k)).length
  console.log(
    `✅ 官方原檔索引已產生：${path.relative(ROOT, GAME_OUT_FILE)}` +
    `（機師 ${pilots.length} 位：half ${has(pilots, 'half')}／head ${has(pilots, 'head')}／raw ${has(pilots, 'raw')}／card ${has(pilots, 'card')}；` +
    `機甲 ${mechs.length} 台：icon ${has(mechs, 'icon')}／sn ${has(mechs, 'sn')}）`,
  )
}

async function main() {
  const [dirs, withArt] = scan(PILOTS_DIR, '機師', ['full.webp', 'full.png', 'half.webp', 'half.png'])
  const [mechDirs, mechsWithArt] = scan(MECHS_DIR, '機甲', ['portrait.webp', 'portrait.png'])
  const official = await scanOfficial(PILOTS_DIR, dirs)

  const body = withArt.map((n) => `  '${n}',`).join('\n')
  const mechBody = mechsWithArt.map((n) => `  '${n}',`).join('\n')
  const officialBody = official
    .map((o) => `  ['${o.d}', { w: ${o.w}, h: ${o.h}, nameW: ${o.nameW}, nameH: ${o.nameH} }],`)
    .join('\n')

  const out = `// ⚠ 本檔由 scripts/generate-art-index.mjs 自動產生，請勿手動編輯。
// 重新產生：node scripts/generate-art-index.mjs（build / predev 會自動跑）

/**
 * 有站上原稿全身立繪（\`/images/pilots/<gameId>/art.webp\`）的機師資料夾名＝遊戲 ID（PLAN-054 D-2 起）。
 *
 * 用途：\`art.webp\` 是直式全身（863×1600），既有的 \`full.webp\` 是橫式半身特寫
 * （1240×1080），兩者構圖不同、共用不了同一個框。版面要在**渲染前**就知道
 * 該用哪一套構圖，而不是等圖載完才知道 —— 後者會讓卡片在載入完成那一刻跳動。
 *
 * ⚠ 這裡存的是**圖片資料夾名**——PLAN-054 D-2 起一律是遊戲 ID（沒有 gameId 的才退回 \`portrait\` 路徑那一段）。
 *   查詢一律走 \`hasPilotArt(pilot)\`（內部用 \`pilotArtDir()\`），不要自己用名字去比對。
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

/** 官網 hero 圖層的尺寸：color／line 共用一個 bbox（w×h），name 是名字層自己的 bbox。 */
export interface OfficialArtGeometry { w: number; h: number; nameW: number; nameH: number }

/**
 * 有官網 hero 圖層（\`/images/pilots/<名>/official-{color,line,name}.webp\`）的機師資料夾名
 * （PLAN-042-C C-1）。官網只做了 8 位；其餘機師走濾鏡線稿。
 *
 * ⚠ 存的是**圖片資料夾名**，查詢一律走 \`hasOfficialArt(pilot)\` / \`pilotOfficialArt(pilot)\`。
 */
export const PILOT_OFFICIAL_INDEX: ReadonlyMap<string, OfficialArtGeometry> = new Map([
${officialBody}
])
`

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, out, 'utf-8')

  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(0) : '0')
  console.log(
    `✅ 原稿索引已產生：${path.relative(ROOT, OUT_FILE)}` +
    `（機師 ${withArt.length}/${dirs.length}，${pct(withArt.length, dirs.length)}%；` +
    `機甲 ${mechsWithArt.length}/${mechDirs.length}，${pct(mechsWithArt.length, mechDirs.length)}%；` +
    `官網圖層 ${official.length} 位）`,
  )

  writeGameIndex(scanGame())
}

await main()
