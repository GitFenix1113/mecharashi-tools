/**
 * 官方原檔的命名規則（PLAN-054）—— 匯入、索引、引用掃描三處共用這一份。
 *
 * 規則來自陸版客戶端全圖擷取（2026-09-25）與 v3 定版對照（2026-10-03），檔名＝官方資產名逐字：
 *
 *   機師  public/images/game/pilots/<gameId>/
 *         <artKey>_half      340²         頭像（＝站上舊的 half.webp）
 *         <artKey>_head      90²          頭部特寫（構圖與 half 不同）
 *         <artKey>_Raw       1240×1080    半身（＝站上舊的 full.webp）
 *         Icon_item_<gameId>A  340²       機師卡
 *   機甲  public/images/game/mechs/<wap>/
 *         Icon_mecha_wap<wap>          560×340     立繪（＝站上舊的 portrait.webp）
 *         Icon_wap<wap>_1~4            340²        部件：軀幹／左臂／右臂／腿
 *         Icon_mecha_wap<wap>_SN_Raw   2000×1080   全身大圖（取代站上的 art.webp）
 *
 * ⚠ 機師的 gameId（資料夾）與 artKey（檔名）**不互推**：維娜 10103144／Pilot_13019A 等 5 位例外，
 *   見 src/types/pilot.ts。這裡的函式一律吃兩個參數，不從一個拼出另一個。
 * ⚠ 前台 src/utils/gameArt.ts 有同一套規則的 TS 版（build 腳本要能在 Node 20 跑，不能 import .ts）。
 *   兩份由 scripts/lib/gameAssetKinds.test.mjs 交叉比對——改一邊、另一邊的測試會掛。
 */

/** 相對 public/ 的根目錄 */
export const GAME_DIR = 'images/game'

/** 機師的四種圖。值＝接在 artKey 後面的尾碼（card 不吃 artKey，見 pilotFileName） */
export const PILOT_KINDS = /** @type {const} */ (['half', 'head', 'raw', 'card'])
const PILOT_SUFFIX = { half: '_half', head: '_head', raw: '_Raw' }

/** 機甲部件的編號：官方 Icon_wap<wap>_1~4 的順序是 軀幹／左臂／右臂／腿 */
export const PART_NO = { torso: 1, leftArm: 2, rightArm: 3, legs: 4 }
export const MECH_KINDS = /** @type {const} */ (['icon', 'sn', 'torso', 'leftArm', 'rightArm', 'legs'])

/** 機師某種圖的官方檔名（不含副檔名）；缺參數回 undefined。 */
export function pilotFileName(kind, gameId, artKey) {
  if (kind === 'card') return gameId ? `Icon_item_${gameId}A` : undefined
  const sfx = PILOT_SUFFIX[kind]
  return sfx && artKey ? `${artKey}${sfx}` : undefined
}

/** 機甲某種圖的官方檔名（不含副檔名）；缺參數回 undefined。 */
export function mechFileName(kind, wap) {
  if (!wap) return undefined
  if (kind === 'icon') return `Icon_mecha_wap${wap}`
  if (kind === 'sn') return `Icon_mecha_wap${wap}_SN_Raw`
  const no = PART_NO[kind]
  return no ? `Icon_wap${wap}_${no}` : undefined
}

/**
 * 反向：機師資料夾裡的一個檔名（不含副檔名）是哪一種圖。
 * 回 `{ kind, key }`（key＝立繪主鍵，card 沒有）或 null（不是讀取端會用到的種類）。
 */
export function classifyPilotFile(name, gameId) {
  if (name === `Icon_item_${gameId}A`) return { kind: 'card' }
  const m = name.match(/^(.+)_(half|head|Raw)$/)
  if (!m) return null
  return { kind: m[2] === 'Raw' ? 'raw' : m[2], key: m[1] }
}

/** 反向：機甲資料夾裡的一個檔名是哪一種圖；不是讀取端會用到的種類回 null。 */
export function classifyMechFile(name, wap) {
  if (name === `Icon_mecha_wap${wap}`) return { kind: 'icon' }
  if (name === `Icon_mecha_wap${wap}_SN_Raw`) return { kind: 'sn' }
  const m = name.match(new RegExp(`^Icon_wap${wap}_([1-4])$`))
  if (!m) return null
  const kind = Object.keys(PART_NO).find((k) => PART_NO[k] === Number(m[1]))
  return { kind }
}

/**
 * v3 對照裡的素材分組 → 部署層級。
 *   core      讀取端會用到、要部署上線（進 public/images/game/、進版控）
 *   extended  保存但目前沒有消費端（站長 2026-10-04 定案 A：**不進 git**、不部署，
 *             匯到 repo 外的封存夾——repo 是公開的，進 repo 就等於公開台版未上線的造型）
 * 不在這兩組的（text／model3d／battle／fx／spine／gachaSeq）一律不匯。
 */
export const TIER_GROUPS = {
  core: { pilots: ['art', 'card'], mechs: ['icon', 'parts', 'sn'] },
  extended: {
    pilots: ['skin', 'skincard', 'gacha', 'banner', 'lobby', 'bg'],
    mechs: ['skin', 'skinicon', 'lobby', 'card'],
  },
}
