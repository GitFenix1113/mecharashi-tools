/**
 * 官方圖示的命名規則（PLAN-055）—— 匯入、索引、引用掃描三處共用這一份。
 *
 * 官方把分類寫在檔名裡，不靠資料夾（陸版客戶端的 skilltype_abs 是一個扁平資料夾）：
 *
 *   Icon_skill_<種類>_<色系><批次><流水>     例：Icon_skill_passive_5302
 *     種類   main 主動▲／order 指令■／passive 被動●／talent 天賦◆／pp（青綠水滴＋P）＝外框形狀
 *     色系   首位數 1 紅／2 藍／3 綠／4 金／5 紫／9 聯動（9 之後兩碼是角色槽，如 97 零）
 *     流水   同色系內照建檔順序遞增 → 新角色的圖在序列尾端
 *   Icon_entry_<5 碼>       模組詞條
 *   Icon_RnD_<E|N|P>_<n>、Icon_skill_RnD_P_<n>   研發
 *   Icon_buff_<n>／Icon_buff_<英文>／Icon_debuff_<英文>   BUFF 白色字形（遊戲執行時才上色）
 *   Icon_weapon_<種類3><系列3><變體2>[A][_字尾]       武器（PLAN-056）：種類 101 拳套…501 電磁炮；
 *                                                     9xxxxxxx 機甲綁定的肩部、400x_* 敵方 BOSS 裝備
 *   Icon_backpack_6<類型3><階2><流水2>                背包（PLAN-056）；有 2 個官方檔名是 Icon_BackPack_（大寫）
 *
 * 落點：public/images/game/icons/{skill,buff,weapon,backpack}/<官方檔名>.webp —— 扁平、一張圖一份。
 *
 * ⚠ 圖示不等於技能：同一張圖常被多個技能共用（main_1106＝乘勝追擊／崩山／拘敵猛襲），
 *   key 只代表外觀，不能當主鍵或拿來推導技能（PLAN-032 結論）。
 * ⚠ 前台 src/utils/gameIcons.ts 有同一套規則的 TS 版（build 腳本要能在 Node 20 跑，不能 import .ts）。
 *   兩份由 scripts/lib/gameIconKinds.test.mjs 交叉比對——改一邊、另一邊的測試會掛。
 */
import fs from 'node:fs'

/** 相對 public/ 的根目錄 */
export const ICON_DIR = 'images/game/icons'

/** 屬於圖庫的官方前綴（武器、背包自 PLAN-056 起也收進圖庫） */
const LIBRARY_RE = /^Icon_(?:skill_|entry_|RnD_|commandskill_|zoneskill_|roguelike_|coopclimb_|buff_|debuff_|weapon_|backpack_|BackPack_)[A-Za-z0-9_]+$/

/** 是不是圖庫裡的官方檔名（ASCII；中文佔位名一律 false） */
export function isLibraryKey(key) {
  return typeof key === 'string' && LIBRARY_RE.test(key)
}

/** 圖庫子資料夾：照官方客戶端的分法——BUFF 字形、武器、背包各一夾，其餘（技能、模組詞條、研發…）一夾 */
export function iconFamily(key) {
  if (/^Icon_(?:de)?buff_/.test(key)) return 'buff'
  if (key.startsWith('Icon_weapon_')) return 'weapon'
  if (/^Icon_backpack_/i.test(key)) return 'backpack'
  return 'skill'
}

// ── 武器／背包的官方編號 gameId（PLAN-056）────────────────────────────────────────
// gameId＝圖示檔名的編號部分（Icon_weapon_<gameId>）。它是「外觀編號」：EX／·改／·LW 與本體共用，不是武器身分。
// 檔名大小寫的例外（Icon_BackPack_60350101）由匯入腳本寫進 equipIconKeyCase.json，這裡不寫死。

const KEY_CASE_FILE = new URL('./equipIconKeyCase.json', import.meta.url)
let keyCase = null
function loadKeyCase() {
  if (keyCase) return keyCase
  keyCase = fs.existsSync(KEY_CASE_FILE) ? JSON.parse(fs.readFileSync(KEY_CASE_FILE, 'utf-8')).keyCase ?? {} : {}
  return keyCase
}

/** gameId → 官方檔名（family：weapon｜backpack）；空值回 undefined */
export function equipIconKey(family, gameId) {
  const id = typeof gameId === 'string' ? gameId.trim() : ''
  if (!id) return undefined
  return loadKeyCase()[`${family}:${id}`] ?? `Icon_${family}_${id}`
}

/** 官方檔名 → gameId（大小寫不拘）；不是武器／背包檔名回 undefined */
export function equipGameIdOf(key) {
  const m = typeof key === 'string' ? key.match(/^Icon_(?:weapon|backpack)_(.+)$/i) : null
  return m ? m[1] : undefined
}

/** 圖庫路徑（相對 public/）；不是圖庫 key 回 undefined */
export function iconPath(key) {
  return isLibraryKey(key) ? `${ICON_DIR}/${iconFamily(key)}/${key}.webp` : undefined
}

/**
 * 任何舊寫法（裸 key、扁平路徑、子資料夾路徑、完整路徑、遠端 URL、帶副檔名）→ 檔名（不含副檔名）。
 * 不驗證是不是圖庫 key——呼叫端自己用 isLibraryKey 判斷（中文佔位名也會原樣回傳）。
 */
export function keyFromValue(value) {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  if (!s) return undefined
  const base = s.split(/[?#]/)[0].split('/').pop() ?? ''
  const key = base.replace(/\.(png|webp|jpe?g)$/i, '')
  return key || undefined
}

/** 以圖搜圖特徵的邊長（12×12 RGB＝432 bytes／張） */
export const ICON_FEATURE_DIM = 12

/**
 * 以圖搜圖的特徵（PLAN-055 B-4）：RGBA 像素 → 先裁到不透明區域的外框 → 切 dim×dim 區塊、墊黑平均。
 * 先裁外框是因為截圖的留白不一（實測站上 40 張截圖佔位：圖示佔畫布 65%～100%），不裁就對不上。
 * 整張都不透明（截圖沒去背）時，外框就是整張——請使用者裁到只剩圖示。
 * ⚠ 前台 src/utils/gameIcons.ts 的 iconFeature 是同一份邏輯，由 gameIconKinds.test.mjs 交叉比對。
 */
export function iconFeature(data, w, h, dim = ICON_FEATURE_DIM) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1 }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const sum = new Float64Array(dim * dim * 3), cnt = new Float64Array(dim * dim)
  for (let y = y0; y <= y1; y++) {
    const by = Math.min(dim - 1, Math.floor(((y - y0) * dim) / bh))
    for (let x = x0; x <= x1; x++) {
      const bx = Math.min(dim - 1, Math.floor(((x - x0) * dim) / bw))
      const i = (y * w + x) * 4, a = data[i + 3] / 255, c = by * dim + bx
      sum[c * 3] += data[i] * a; sum[c * 3 + 1] += data[i + 1] * a; sum[c * 3 + 2] += data[i + 2] * a; cnt[c]++
    }
  }
  const out = new Uint8Array(dim * dim * 3)
  for (let c = 0; c < dim * dim; c++) for (let k = 0; k < 3; k++) out[c * 3 + k] = cnt[c] ? Math.round(sum[c * 3 + k] / cnt[c]) : 0
  return out
}

const BUFF_SERIES = { 1: 'stat', 2: 'status', 3: 'repair', 4: 'unique', 5: 'stack', 9: 'misc' }

/**
 * 解析官方檔名。回 { key, family, kind, category?, color?, num? } 或 null（不是圖庫 key）。
 *   kind   skill：main／order／passive／talent／pp／entry／rnd／command／refactoring／other
 *          buff ：generic（buff_attack 這類通用增益）／debuff／stat／status／repair／unique／stack／misc
 *          weapon：series（主序列）／variant（字尾變體，如 _b 外型變化）／linked（9 開頭，機甲綁定肩部）／enemy（400x，敵方 BOSS）／other
 *          backpack：backpack
 *   category  武器：種類前綴 3 碼（'102'＝打樁機；linked 是 '902' 這類、enemy 是 '4001' 這類）；背包：類型 3 碼（'035'＝飛行）
 *   color  只有 main／order／passive／talent 有：首位數 1–5、9
 *   num    編號（排序用；流水號倒序＝最新在前）
 */
export function parseIconKey(key) {
  if (!isLibraryKey(key)) return null
  const family = iconFamily(key)
  let m
  if (family === 'weapon') {
    if ((m = key.match(/^Icon_weapon_(9\d{2})(\d{3})(\d{2})$/))) return { key, family, kind: 'linked', category: m[1], num: Number(m[1] + m[2] + m[3]) }
    if ((m = key.match(/^Icon_weapon_(400\d)_/))) return { key, family, kind: 'enemy', category: m[1] }
    if ((m = key.match(/^Icon_weapon_(\d{3})(\d{3})(\d{2})[A-Z]?(_[A-Za-z0-9_]+)?$/))) {
      return { key, family, kind: m[4] ? 'variant' : 'series', category: m[1], num: Number(m[1] + m[2] + m[3]) }
    }
    return { key, family, kind: 'other' }
  }
  if (family === 'backpack') {
    if ((m = key.match(/^Icon_backpack_6(\d{3})(\d{2})(\d{2})$/i))) return { key, family, kind: 'backpack', category: m[1], num: Number(`6${m[1]}${m[2]}${m[3]}`) }
    return { key, family, kind: 'backpack' }
  }
  if (family === 'buff') {
    if (key.startsWith('Icon_debuff_')) return { key, family, kind: 'debuff' }
    if ((m = key.match(/^Icon_buff_(\d)(\d{3})$/))) return { key, family, kind: BUFF_SERIES[m[1]] ?? 'misc', num: Number(m[1] + m[2]) }
    if (/^Icon_buff_1_\d{3}$/.test(key)) return { key, family, kind: 'stat' }
    return { key, family, kind: 'generic' }
  }
  if ((m = key.match(/^Icon_skill_(main|order|passive|talent)_(\d{4})$/))) {
    return { key, family, kind: m[1], color: Number(m[2][0]), num: Number(m[2]) }
  }
  if ((m = key.match(/^Icon_skill_pp_(\d+)$/))) return { key, family, kind: 'pp', num: Number(m[1]) }
  if ((m = key.match(/^Icon_entry_(\d+)$/))) return { key, family, kind: 'entry', num: Number(m[1]) }
  if ((m = key.match(/^Icon_(?:skill_)?RnD_[A-Z]_(\d+)$/))) return { key, family, kind: 'rnd', num: Number(m[1]) }
  if ((m = key.match(/^Icon_(?:command|zone)skill_(\d+)$/))) return { key, family, kind: 'command', num: Number(m[1]) }
  if ((m = key.match(/^Icon_skill_refactoring_(\d+)$/))) return { key, family, kind: 'refactoring', num: Number(m[1]) }
  return { key, family, kind: 'other' }
}
