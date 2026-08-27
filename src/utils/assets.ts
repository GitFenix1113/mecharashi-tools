// ⚠ 帶 `.ts` 副檔名：本檔要能被 `node --test` 直接載入（見下方 `base()` 的說明），
//   而 node 的 ESM 解析不補副檔名。專案既有慣例同此（buffPool.ts、entityRefs.ts…）。
import { PILOT_ART_INDEX } from '../data/artIndex.ts'

/**
 * 刻意做成函式而非模組層級常數：`import.meta.env` 在 node --test 下不存在，
 * 模組層級取值會讓整個檔案一 import 就拋 TypeError，連純函式都測不了。
 * Vite 對 `import.meta.env.X` 是靜態文字替換，寫在函式內同樣會被替換掉，無額外成本。
 */
const base = (): string => import.meta.env.BASE_URL

/**
 * 技能圖示分類規則：依檔名前綴對應 public/images/skills/ 下的子資料夾。
 * 與後台 IconPicker、scripts/generate-image-manifest 產生的實體資料夾命名一致。
 */
const SKILL_PREFIX_FOLDERS: [string, string][] = [
  ['Icon_skill_main',    '主動技能'],
  ['Icon_skill_order',   '指令技能'],
  ['Icon_skill_passive', '被動技能'],
  ['Icon_skill_pp',      'pp技能'],
  ['Icon_skill_talent',  '天賦技能'],
]

/**
 * skills/ 下實際存在的子資料夾。**含前綴推導不出來的資料夾**，這正是它與
 * SKILL_PREFIX_FOLDERS 分開列的原因（PLAN-043）。
 *
 * 背包技能圖示沿用官方的 `Icon_skill_passive_*` 檔名卻放在「背包技能/」，
 * 純靠前綴推導會把它洗成「被動技能/」→ 圖片 404 或指到同名但不同來源的檔案。
 */
const SKILL_SUBFOLDERS = new Set([
  ...SKILL_PREFIX_FOLDERS.map(([, folder]) => folder),
  '背包技能',   // PLAN-043：與被動技能圖大量重複，刻意獨立以維持圖庫來源可辨識
])

/**
 * 將任何指向技能圖示的路徑正規化到實體所在子資料夾。
 *
 * skills/ 下的技能圖示已依檔名前綴分到子資料夾（主動/指令/被動/pp/天賦/背包技能），但既有
 * 資料（DB 內的舊扁平路徑、後台輸入框的 bare key、scraper 寫入的 /images/skills/<檔名>）
 * 仍可能是扁平寫法。處理順序刻意是「先信任明確寫出的已知子資料夾，其次才用檔名前綴推導」：
 *
 *  · 已在已知子資料夾內 → 原樣返回。檔名前綴與資料夾不一致是**合法**的（背包技能用
 *    passive 前綴），推導反而會改錯。
 *  · 扁平或未知子資料夾 → 依檔名前綴推回，讓舊資料仍解析得到。
 *  · 非技能路徑 → 原樣返回。
 *
 * 兩條路徑對已分類的新路徑都對應到相同結果（冪等）。
 */
export function normalizeSkillPath(path: string): string {
  const m = path.match(/(^|\/)images\/skills\/(.+)$/)
  if (!m) return path
  const parts = m[2].split('/')
  const file = parts.pop() ?? ''
  // 明確寫出的已知子資料夾優先於前綴推導（見上方 SKILL_SUBFOLDERS）
  if (parts.length && SKILL_SUBFOLDERS.has(parts[parts.length - 1])) return path
  const sub = SKILL_PREFIX_FOLDERS.find(([p]) => file.startsWith(p))?.[1]
  return sub ? `${m[1]}images/skills/${sub}/${file}` : path
}

export function assetUrl(path: string): string {
  return `${base()}${normalizeSkillPath(path).replace(/^\//, '')}`
}

/**
 * 解析 icon URL 給 <img src> 使用。
 * - 遠端 URL（http/https）原樣返回
 * - 本地路徑一律正規化為 /images/... 後套上 BASE_URL
 *   （容錯處理舊資料殘留的 mecharashi-tools/public/ 前綴）
 */
export function resolveIconSrc(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const idx = url.indexOf('/images/')
  const path = idx >= 0 ? url.slice(idx) : url
  return assetUrl(path)
}

/**
 * 依序展開圖片候選路徑，交給 <FallbackImage> 逐層退回。
 *
 * 每個來源展開成「資料存的原樣 → 換 .webp」兩個候選，再接下一個來源。順序是刻意的：
 * 先試資料自己寫的路徑，正常情況第一發就中、零多餘請求；只有真的 404 才往下試 webp 版本，
 * 最後才退到次要來源（例如機甲的 halfPortrait → portrait）。
 *
 * 起因是 mechs 有 57 筆 halfPortrait 指向 /images/mechs/{名稱}/half.png，而該檔從未進過版控，
 * hover 卡因此長期載破圖；同樣的漂移在 PNG→WebP 轉檔後也可能再發生。與其要求資料永遠正確，
 * 不如讓顯示層自己退得下去。
 *
 * 遠端 URL（官方 CDN）不展開 webp 變體 —— 對方沒有那個檔，試了只是白費一次請求。
 */
export function imageCandidates(...sources: (string | null | undefined)[]): string[] {
  const out: string[] = []
  const push = (u: string) => { if (u && !out.includes(u)) out.push(u) }
  for (const src of sources) {
    if (!src) continue
    const resolved = resolveIconSrc(src)
    push(resolved)
    if (!/^https?:\/\//i.test(src)) push(resolved.replace(/\.(png|jpe?g)$/i, '.webp'))
  }
  return out
}

/** 官方素材 CDN（機甲部件圖 waparts/ 掛在這底下）。 */
const MECH_CDN_BASE = 'https://media.zlongame.com/media/pictures/cn/community/img/gl/gameInfo'

/**
 * 機甲縮圖來源：優先本地立繪，沒有才退回官方 CDN 的軀幹部件圖。
 *
 * 抽成共用函式是因為「哪張圖代表這台機甲」有兩個後台要用同一個答案——版本濃縮表的 Icon
 * 同步與灰燼行動名單的同步。規則若各寫一份，同一台機甲在兩張表可能長得不一樣。
 *
 * 回傳 undefined = 兩個來源都沒有，呼叫端該讓該筆維持無圖（而不是硬湊一個會 404 的路徑）。
 */
export function mechIconUrl(mech: { portrait?: string; parts?: { torso?: { mechaIcon?: string } } }): string | undefined {
  if (mech.portrait) return mech.portrait
  const mechaIcon = mech.parts?.torso?.mechaIcon
  return mechaIcon ? `${MECH_CDN_BASE}/waparts/${mechaIcon}.png` : undefined
}

/**
 * 解析版本前瞻圖 URL 給 <img src> 使用。
 * - 遠端 URL（http/https，如 Cloudinary 上傳）原樣返回
 * - 本地路徑（/images/banners/...）套上 BASE_URL
 */
export function resolveBannerSrc(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return assetUrl(url)
}

export async function fetchData<T>(file: string): Promise<T> {
  const res = await fetch(`${base()}data/${file}`)
  if (!res.ok) throw new Error(`Failed to load ${file}`)
  return res.json()
}

/**
 * 機師**全身立繪**的路徑（PLAN-052-I C-1）。回 `undefined` ＝ 推導不出來。
 *
 * DB 的 `pilot.portrait` 存的是頭像（`/images/pilots/<名>/half.webp`），全身立繪是
 * 同一個資料夾裡的 `full.*`。沒有欄位存它，只能由頭像路徑推導 —— 推導規則收在這裡
 * 而不是散在元件裡，是因為它有三個踩得到的邊界：
 *
 *   · 副檔名不一定是 `.webp`：阿列娜是 `half.png`（88 個資料夾裡的唯一例外）。
 *     故只換檔名主體、保留原副檔名，再交給 `imageCandidates()` 補 `.webp` 變體。
 *   · `portrait` 可能是**空字串**：賽拉沒有立繪資料夾（89 位機師 vs 88 個資料夾）。
 *     回 `undefined`，呼叫端該顯示佔位而不是一個 404 的破圖。
 *   · `portraitUrl`（官方 CDN）指的是 `characterHalf/` 底下的**頭像**，
 *     推導不出全身像，所以呼叫端**不該**把它列入候選 —— 那只是白費一次必然 404 的請求。
 *
 * ⚠ 刻意只做「推路徑」不做 `imageCandidates()`：後者會讀 `import.meta.env.BASE_URL`，
 *   在 `node --test` 下不存在（見本檔開頭 `base()` 的說明），包進來這條規則就測不了。
 *   呼叫端寫 `imageCandidates(pilotFullArtPath(pilot))`。
 */
export function pilotFullArtPath(pilot: { portrait?: string } | null | undefined): string | undefined {
  const p = pilot?.portrait
  if (!p) return undefined
  const full = p.replace(/(^|\/)half(\.[a-z0-9]+)$/i, '$1full$2')
  // 換不動 ＝ 這不是預期的 half.* 命名，不要硬猜一個路徑出來
  return full === p ? undefined : full
}

/**
 * 機師**官方原稿全身立繪**的路徑（`/images/pilots/<名>/art.webp`）。
 *
 * 與 `pilotFullArtPath()` 是**兩張不同構圖的圖**，不是同一張的兩種尺寸：
 *   · `full.webp` 1240×1080  橫式半身特寫（官方 CDN 的裁切圖，名為 full 其實只到大腿）
 *   · `art.webp`   863×1600  直式**完整全身**（2026-08 取得的原稿）
 *
 * ⚠ 副檔名固定 `.webp`，不跟著 `portrait` 走：原稿是由 `scripts/import-source-art.mjs`
 *   統一輸出的，不存在 `full.*` 那種 `阿列娜/half.png` 的歷史例外。
 */
export function pilotKeyArtPath(pilot: { portrait?: string } | null | undefined): string | undefined {
  const dir = pilotArtDir(pilot)
  return dir ? `/images/pilots/${dir}/art.webp` : undefined
}

/**
 * 由 `pilot.portrait` 取出圖片資料夾名（`/images/pilots/<這一段>/half.webp`）。
 *
 * ⚠ **不能用 `pilot.name` 代替**：少數機師的資料夾名與顯示名有簡繁／譯名差異
 *   （素材端的「羅斯瑪莉」對到站上的「羅斯瑪麗」等 7 筆，見 import-source-art.mjs
 *   的 NAME_FIXES）。資料夾名才是 `portrait` 路徑實際指向的那一段。
 */
export function pilotArtDir(pilot: { portrait?: string } | null | undefined): string | undefined {
  const m = pilot?.portrait?.match(/(?:^|\/)pilots\/([^/]+)\/[^/]+$/)
  return m ? m[1] : undefined
}

/**
 * 這位機師**有沒有**原稿全身立繪。52/88 位有 —— 缺的那 36 位不是例外，是常態的一半。
 *
 * ⚠ 版面必須在**渲染前**就問這件事，不能等 `FallbackImage` 載失敗才知道：
 *   直式全身與橫式半身的構圖不同，等圖載完再換版面會讓卡片在那一刻跳動一次，
 *   而 `PilotIdentityCard` 寫死高度的用意正是杜絕這種跳動。
 *
 * 索引由 `scripts/generate-art-index.mjs` 在 build/predev 掃圖庫產生。
 */
export function hasPilotArt(pilot: { portrait?: string } | null | undefined): boolean {
  const dir = pilotArtDir(pilot)
  return !!dir && PILOT_ART_INDEX.has(dir)
}

/**
 * 機甲**官方原稿全身圖**的路徑（`/images/mechs/<名>/art.webp`，1600×864 橫式含武裝）。
 *
 * ⚠ 機甲**不需要**索引（對照 `hasPilotArt()`）：`art` 與既有的 `portrait`（560×340）
 *   長寬比只差 0.2，同一個橫框放兩張都成立，所以呼叫端一律寫
 *   `imageCandidates(mechKeyArtPath(mech), mech.portrait)`，缺原稿的 5 台自動退回。
 *
 * ⚠ 只換最後一段檔名、**不沿用原副檔名**：`mech.portrait` 至今仍有 `.png` 的歷史值
 *   （爬蟲寫入端未跟上），而原稿一律是 `.webp`。
 */
export function mechKeyArtPath(mech: { portrait?: string } | null | undefined): string | undefined {
  const p = mech?.portrait
  if (!p) return undefined
  const art = p.replace(/(^|\/)[^/]+$/, '$1art.webp')
  // 換不動 ＝ 這不是預期的 `<資料夾>/<檔名>` 形式，不要硬猜一個路徑出來
  return art === p ? undefined : art
}
