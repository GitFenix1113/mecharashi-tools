const BASE = import.meta.env.BASE_URL

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
 * 將任何指向技能圖示的路徑正規化到實體所在子資料夾。
 *
 * skills/ 下的技能圖示已依檔名前綴分到子資料夾（主動/指令/被動/pp/天賦技能），但既有
 * 資料（DB 內的舊扁平路徑、後台輸入框的 bare key、scraper 寫入的 /images/skills/<檔名>）
 * 仍可能是扁平寫法。此函式只看檔名前綴推回正確子資料夾，讓新舊兩種寫法都能解析；
 * 已分類的新路徑會對應到相同結果（冪等），非技能路徑原樣返回。
 */
function normalizeSkillPath(path: string): string {
  const m = path.match(/(^|\/)images\/skills\/(.+)$/)
  if (!m) return path
  const file = m[2].split('/').pop() ?? '' // 取檔名，忽略中間任何（可能過時的）子資料夾
  const sub = SKILL_PREFIX_FOLDERS.find(([p]) => file.startsWith(p))?.[1]
  return sub ? `${m[1]}images/skills/${sub}/${file}` : path
}

export function assetUrl(path: string): string {
  return `${BASE}${normalizeSkillPath(path).replace(/^\//, '')}`
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
 * 解析版本前瞻圖 URL 給 <img src> 使用。
 * - 遠端 URL（http/https，如 Cloudinary 上傳）原樣返回
 * - 本地路徑（/images/banners/...）套上 BASE_URL
 */
export function resolveBannerSrc(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return assetUrl(url)
}

export async function fetchData<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}data/${file}`)
  if (!res.ok) throw new Error(`Failed to load ${file}`)
  return res.json()
}
