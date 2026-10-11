/**
 * 客戶端擷取（陸版圖片擷取工具的輸出）的共用讀取層——比對（diff-game-dump）與匯入（import-game-assets）共用。
 *
 * 擷取根目錄（預設 E:/Mecharashi_Data）底下，每一次擷取一個資料夾：
 *   Data/                  2026-09-25 首次擷取（工具 v1.0.0 之前的版本；含 16／17 類技術貼圖）
 *   一般圖片_<版本碼>/     擷取工具自動命名；遊戲資源一更新就換一個版本碼
 *   完整資源_<版本碼>/     同上，勾了「包含環境反射、體積與光照切片」
 * 每個資料夾都有 圖片索引.csv，`path` 欄相對該資料夾。
 *
 * ⚠ 新版工具用 Python 的 csv 模組寫索引，欄位裡有逗號或引號時會加雙引號——不能直接 split(',')。
 * ⚠ 原始 PNG、圖片索引、擷取工具（設定檔含解密金鑰）一律不進 repo——這裡只讀。
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

export const DUMP_ROOT = 'E:/Mecharashi_Data'
/** repo 外的封存夾（extended／reserve／--ui／--other-icons／--skins 的落點；不進 git、不部署） */
export const ARCHIVE_ROOT = 'E:/Mecharashi_Data/site-archive'

/**
 * 兩張圖的平均像素差（0–255；縮成 64×64、透明處墊黑）——判斷「同名但畫面不同」。
 * 門檻 PIXEL_DIFF_SAME：低於它視為同一張圖（只差重新打包、壓縮）。
 * 2026-10-11 實測：新舊擷取之間 sha256 不同的 1,307 筆裡，1,054 筆是 07 類的 Sprite——圖集重新打包的切片，畫面沒變。
 */
export const PIXEL_DIFF_SAME = 6
export async function pixelDiff(a, b) {
  const raw = (p) => sharp(p).resize(64, 64, { fit: 'fill' }).flatten({ background: '#000' }).removeAlpha().raw().toBuffer()
  const [x, y] = await Promise.all([raw(a), raw(b)])
  let s = 0
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i])
  return s / x.length
}
export const INDEX_FILE = '圖片索引.csv'

/** RFC 4180 CSV → 字串陣列的陣列（支援雙引號欄位、欄位內換行、CRLF） */
export function parseCsv(text) {
  const out = []
  let rec = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') { field += '"'; i++ }
      else quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') { rec.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      rec.push(field); field = ''
      if (rec.length > 1 || rec[0] !== '') out.push(rec)
      rec = []
    } else field += c
  }
  if (field !== '' || rec.length) { rec.push(field); out.push(rec) }
  return out
}

/**
 * 讀一個擷取的 圖片索引.csv → 列物件。數字欄（width／height／bytes）轉成 number。
 * 新舊工具的欄位不完全一樣（新版多 bytes），一律按欄名取值、缺的欄位是 undefined。
 */
export function loadDumpIndex(dir) {
  const file = path.join(dir, INDEX_FILE)
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`)
  const [head, ...recs] = parseCsv(fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, ''))
  for (const need of ['type', 'name', 'width', 'height', 'path', 'sha256']) {
    if (!head.includes(need)) throw new Error(`${file} 少了欄位 ${need}`)
  }
  return recs.map((rec) => {
    const r = Object.fromEntries(head.map((h, i) => [h, rec[i]]))
    r.width = Number(r.width); r.height = Number(r.height)
    if (r.bytes !== undefined) r.bytes = Number(r.bytes)
    return r
  })
}

/** 擷取根目錄下的所有擷取，舊 → 新（以 圖片索引.csv 的修改時間排序） */
export function listDumps(root = DUMP_ROOT) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, INDEX_FILE)))
    .map((e) => {
      const dir = path.join(root, e.name)
      const mtime = fs.statSync(path.join(dir, INDEX_FILE)).mtime
      return { id: e.name, dir, date: localDate(mtime), mtime }
    })
    .sort((a, b) => a.mtime - b.mtime)
}

/**
 * `--src`／`--old`／`--new` 的值 → 擷取資料夾。
 *   latest     最新一次擷取
 *   previous   倒數第二次（比對的預設基準）
 *   其他       資料夾路徑，或擷取根目錄下的資料夾名
 */
export function resolveDump(spec, root = DUMP_ROOT) {
  const dumps = listDumps(root)
  if (spec === 'latest' || spec === 'previous') {
    const d = dumps.at(spec === 'latest' ? -1 : -2)
    if (!d) throw new Error(`擷取根目錄 ${root} 裡找不到${spec === 'latest' ? '任何' : '兩次以上的'}擷取`)
    return d
  }
  const dir = fs.existsSync(spec) ? path.resolve(spec) : path.join(root, spec)
  if (!fs.existsSync(path.join(dir, INDEX_FILE))) throw new Error(`${spec} 不是擷取資料夾（沒有 ${INDEX_FILE}）`)
  const mtime = fs.statSync(path.join(dir, INDEX_FILE)).mtime
  return { id: path.basename(dir), dir, date: localDate(mtime), mtime }
}

/** 同名多筆時的代表列：Texture2D 優先（Sprite 是圖集切片，重新打包就會變位元組）；再取面積大的 */
export function preferTexture(rows) {
  let best
  for (const r of rows) {
    if (!best) { best = r; continue }
    const rt = r.type === 'Texture2D', bt = best.type === 'Texture2D'
    if (rt !== bt) { if (rt) best = r; continue }
    if (r.width * r.height > best.width * best.height) best = r
  }
  return best
}

/** 本機時區的 YYYY-MM-DD（報告檔名用；toISOString 是 UTC，台灣凌晨會差一天） */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
