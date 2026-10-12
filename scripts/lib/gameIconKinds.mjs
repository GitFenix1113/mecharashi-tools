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
 *   Icon_pilotclass_<3 碼>_<l|s>                      機師職業（PLAN-059）：001 格鬥家…006 守護者、010 調構師；l 340²、s 72×80
 *   Icon_wanzertype_<3 碼>_<l|s>                      駕駛許可＝機甲類型（PLAN-059）：001 輕型、002 中型、003 重型、004 三者合一
 *   Icon_logo_<4 碼>_<00|01>                          陣營徽章（PLAN-059）：00 白色單色、01 彩色
 *
 * 落點：public/images/game/icons/{skill,buff,weapon,backpack,class,license,camp}/<官方檔名>.webp —— 扁平、一張圖一份。
 *
 * ⚠ 圖示不等於技能：同一張圖常被多個技能共用（main_1106＝乘勝追擊／崩山／拘敵猛襲），
 *   key 只代表外觀，不能當主鍵或拿來推導技能（PLAN-032 結論）。
 * ⚠ 前台 src/utils/gameIcons.ts 有同一套規則的 TS 版（build 腳本要能在 Node 20 跑，不能 import .ts）。
 *   兩份由 scripts/lib/gameIconKinds.test.mjs 交叉比對——改一邊、另一邊的測試會掛。
 */
import fs from 'node:fs'

/** 相對 public/ 的根目錄 */
export const ICON_DIR = 'images/game/icons'

/** 屬於圖庫的官方前綴（武器、背包自 PLAN-056、職業／駕照／陣營徽章自 PLAN-059 起也收進圖庫） */
const LIBRARY_RE = /^Icon_(?:skill_|entry_|RnD_|commandskill_|zoneskill_|roguelike_|coopclimb_|buff_|debuff_|weapon_|backpack_|BackPack_|pilotclass_|wanzertype_|logo_)[A-Za-z0-9_]+$/

/** 是不是圖庫裡的官方檔名（ASCII；中文佔位名一律 false） */
export function isLibraryKey(key) {
  return typeof key === 'string' && LIBRARY_RE.test(key)
}

/**
 * `import-game-assets.mjs --icons` 從擷取收哪些資料夾（PLAN-055 A-2）。diff-game-dump.mjs 也用它判斷
 * 「圖庫沒有、但 --icons 也不會收」的圖示（例：肉鴿的 Icon_roguelike_* 住在 itemroguelike_abs，不在這裡）。
 *   技能類整夾（Texture2D）＋ BUFF 字形（只有 Sprite——它們住在一張圖集裡）
 *   ＋ 神經驅動分區圖示（住在晶片圖集旁，但 pilots.neuralDrive[].icon 引用了 1,190 處）
 */
export const ICON_POOLS = [
  { dir: '/uiicons/skilltype_abs', type: 'Texture2D' },
  { dir: '/uiicons/bufftype_abs', type: 'Sprite', name: /^Icon_(de)?buff_/ },
  { dir: '/uiicons/itemchips_abs', type: 'Texture2D', name: /^Icon_zoneskill_/ },
]
/** 擷取的一列（官方資源路徑、型別、檔名）屬於哪個 --icons 來源；不收的回 -1 */
export function iconPoolIndex(assetPath, type, name) {
  return ICON_POOLS.findIndex((p) => !!assetPath?.includes(p.dir) && type === p.type && (!p.name || p.name.test(name)))
}
/** `--equip-icons` 整夾全收的兩個資料夾（PLAN-056 A-1） */
export const EQUIP_POOLS = [['weapon', '/uiicons/wapweapons_abs/'], ['backpack', '/uiicons/wapbackpack_abs/']]

/**
 * `--emblems` 收哪些（PLAN-059 A-2）：
 *   class    Icon_pilotclass_*  機師職業。_l／_s 都在 occupationtype_abs；bufftype 圖集裡另有同名的小圖副本
 *   license  Icon_wanzertype_*  駕駛許可＝機甲類型。_l 在 occupationtype_abs，_s **只在** uicom_abs 的共用圖集（只有 Sprite）
 *   camp     Icon_logo_*        陣營徽章，**只收 camptype_abs**
 * class／license 依檔名認（同名的副本都是同一張圖，交給 pickRow 挑 Texture2D）。
 * camp 要依資料夾認：factory_abs（機甲廠商 GeekX／SparkingPlug／InnoDrive…）有 Icon_logo_0024~0027，
 * 與陣營徽章**同檔名、不同圖**——依檔名認會把廠商 logo 混進來。
 * 範圍限 ui/uiimages/：ui/textimages/ 也有 Icon_wanzertype_*，那是烘了簡中字（輕型机甲）的戰鬥用圖，不收。
 */
export const EMBLEM_POOLS = [
  { family: 'class', dir: '/ui/uiimages/', name: /^Icon_pilotclass_\d{3}_[ls]$/ },
  { family: 'license', dir: '/ui/uiimages/', name: /^Icon_wanzertype_\d{3}_[ls]$/ },
  { family: 'camp', dir: '/uiicons/camptype_abs/', name: /^Icon_logo_\d{4}_\d{2}$/ },
]
/** 站長 2026-10-13：NVIDIA 聯動的兩張不收（沒有機師屬於它，純第三方商標）——它們留在 --other-icons 的封存夾 */
export const EMBLEM_EXCLUDE = /^Icon_logo_00(28|32)_/
/** 擷取的一列（name／asset_path）屬於 --emblems 的哪一族；不收的回 undefined */
export function emblemFamilyOf(row) {
  if (EMBLEM_EXCLUDE.test(row.name)) return undefined
  return EMBLEM_POOLS.find((p) => !!row.asset_path?.includes(p.dir) && p.name.test(row.name))?.family
}

// ── 其他圖示（--other-icons，2026-10-12）──────────────────────────────────────
/**
 * 客戶端 ui/uiimages/uiicons/ 底下、其他匯入模式都不收的圖示 → repo 外封存夾 <archive>/game/icons/<官方資料夾>/。
 * 「其他模式收的」：--icons（ICON_POOLS）、--equip-icons（EQUIP_POOLS 裡的圖庫命名檔）、--emblems（EMBLEM_POOLS）、
 * 機甲 core 三種與機師卡（--wap／--id／v3）。同名只要有一筆屬於它們，整個名字就交給它們，不在封存夾另存一份。
 * 例外是陣營徽章：它依資料夾認，factory_abs 的同名廠商 logo 不是它收的，照樣封存。
 * 其餘一律收：道具、勳章、肉鴿、敵方車輛、塗裝色、機師外觀卡、機甲塗裝小圖……博物館原則，現在用不到不代表以後用不到。
 * 資料夾＝官方資料夾名去掉 _abs（itemtype_abs → itemtype）。下面的中文只給封存夾的 README 看，沒登記的資料夾照樣收。
 */
export const OTHER_ICON_FOLDERS = {
  itemtype: '道具：貨幣、材料、機甲卡、機師外觀卡、機甲塗裝小圖、頭像框',
  itemroguelike: '肉鴿道具（圖庫命名，但 --icons 不收）',
  unitedbattle: '聯合作戰',
  honormedal: '榮譽勳章',
  mecha: '敵方單位、建築、車輛的立繪（可抽機甲在 game/mechs/）',
  vehicletype: '敵方單位、建築、車輛的頭像',
  camptype: '陣營徽章裡 --emblems 不收的（NVIDIA 聯動；PLAN-059 前的舊封存也在這）',
  frameicon: '頭像框',
  pvpcollect: 'PVP 收藏',
  paintingcolor: '塗裝色',
  wapweapons: '武器資料夾裡不是圖庫命名的（關卡物件：建築、直升機…）',
  itemchips: '晶片（分區圖示 Icon_zoneskill_ 在 --icons）',
  occupationtype: '機師職業、駕照（PLAN-059 起由 --emblems 上站，這裡是之前的舊封存）',
  autochesspveicon: '自走棋',
  propertytype: '屬性',
  pvprating: 'PVP 段位',
  rndicon: '研發（--icons 不收的部分）',
  bufftype: 'BUFF 資料夾裡不是 BUFF 字形的（機師職業小圖的副本；PLAN-059 起由 --emblems 收，這裡是之前的舊封存）',
  skynetwapbg: '天網機甲背景',
  statetype: '狀態',
  factory: '機甲廠商徽章（Icon_logo_0024~0027 與陣營徽章同檔名、不同圖）',
  playercollect: '玩家收藏',
  wapparts: '機甲部件（--wap 不收的部分）',
  skynetwap: '機甲全身大圖（--wap 不收的部分）',
}
const UIICONS_RE = /\/ui\/uiimages\/uiicons\/([^/]+)\//
/** 機甲 core 三種＋機師卡（Icon_item_<8 碼 gameId>A）：由 --wap／--id／v3 收 */
const CORE_ENTITY_RE = /^(Icon_mecha_wap\d+(_SN_Raw)?|Icon_wap\d+_[1-4]|Icon_item_\d{8}A)$/

/** 擷取的一列（name／type／asset_path）是不是屬於別的匯入模式 */
export function iconHandledElsewhere(row) {
  if (CORE_ENTITY_RE.test(row.name)) return true
  if (iconPoolIndex(row.asset_path, row.type, row.name) >= 0) return true
  if (emblemFamilyOf(row)) return true
  return EQUIP_POOLS.some(([family, dir]) => !!row.asset_path?.includes(dir) && isLibraryKey(row.name) && iconFamily(row.name) === family)
}

/**
 * 擷取的列（name／type／asset_path）→ Map<封存相對路徑 `icons/<資料夾>/<官方檔名>`（不含副檔名）, 列[]>。
 * 同一路徑的多筆（Sprite＋Texture2D）交給呼叫端挑；同名只要有一筆屬於別的模式就整個不收。
 * 陣營徽章例外：只排除 camptype 那一列本身，factory 的同名廠商 logo 照樣封存（見 EMBLEM_POOLS）。
 */
export function otherIconPaths(rows) {
  const isCamp = (r) => emblemFamilyOf(r) === 'camp'
  const handled = new Set(rows.filter((r) => iconHandledElsewhere(r) && !isCamp(r)).map((r) => r.name))
  const out = new Map()
  for (const r of rows) {
    const m = r.asset_path?.match(UIICONS_RE)
    if (!m || handled.has(r.name) || isCamp(r) || r.name.startsWith('sactx-')) continue
    const rel = `icons/${m[1].replace(/_abs$/, '')}/${r.name}`
    ;(out.get(rel) ?? out.set(rel, []).get(rel)).push(r)
  }
  return out
}

/**
 * 圖庫子資料夾：照官方客戶端的分法——BUFF 字形、武器、背包、職業、駕照、陣營徽章各一夾，其餘（技能、模組詞條、研發…）一夾。
 * ⚠ Icon_logo_ 一律當陣營徽章：圖庫只收 camptype 那份，factory 的同名廠商 logo 若日後要上站，得另立命名空間。
 */
export function iconFamily(key) {
  if (/^Icon_(?:de)?buff_/.test(key)) return 'buff'
  if (key.startsWith('Icon_weapon_')) return 'weapon'
  if (/^Icon_backpack_/i.test(key)) return 'backpack'
  if (key.startsWith('Icon_pilotclass_')) return 'class'
  if (key.startsWith('Icon_wanzertype_')) return 'license'
  if (key.startsWith('Icon_logo_')) return 'camp'
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
 *          class／license／camp：與 family 同名（PLAN-059）
 *   category  武器：種類前綴 3 碼（'102'＝打樁機；linked 是 '902' 這類、enemy 是 '4001' 這類）；背包：類型 3 碼（'035'＝飛行）
 *             職業／駕照：尺寸 'l'／'s'；陣營徽章：變體 '00'（白色單色）／'01'（彩色）
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
  if (family === 'class' || family === 'license') {
    if ((m = key.match(/^Icon_(?:pilotclass|wanzertype)_(\d{3})_([ls])$/))) return { key, family, kind: family, category: m[2], num: Number(m[1]) }
    return { key, family, kind: family }
  }
  if (family === 'camp') {
    if ((m = key.match(/^Icon_logo_(\d{4})_(\d{2})$/))) return { key, family, kind: 'camp', category: m[2], num: Number(m[1]) }
    return { key, family, kind: 'camp' }
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
