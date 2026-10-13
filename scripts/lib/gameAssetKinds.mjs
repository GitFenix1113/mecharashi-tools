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
 *   NPC   public/images/game/npc/<號碼>/        （2026-10-12）還沒對應到可抽機師的官方立繪——劇情 NPC、尚未上線的新角色
 *         <artKey>_half／_head／_Raw            同機師三種（沒有機師卡）；一個號碼可以有 A／B 多套
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

import fs from 'node:fs'
import path from 'node:path'

/** 相對 public/ 的根目錄 */
export const GAME_DIR = 'images/game'

/** 機師的四種圖。值＝接在 artKey 後面的尾碼（card 不吃 artKey，見 pilotFileName） */
export const PILOT_KINDS = /** @type {const} */ (['half', 'head', 'raw', 'card'])
const PILOT_SUFFIX = { half: '_half', head: '_head', raw: '_Raw' }
/**
 * 場景外觀的鑑賞版：`<立繪鍵>_Raw_view.webp`，與該套外觀的 Raw 放在同一個資料夾（PLAN-042-D，見 scripts/lib/sceneArt.mjs）。
 * **衍生檔、不是官方檔名**——classifyPilotFile／classifyNpcFile 刻意認不得它（回 null），索引另外查。
 */
export const SCENE_VIEW_SUFFIX = '_Raw_view'

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

/** NPC 圖庫的立繪檔名 */
export const NPC_ART_RE = /^Pilot_\d+[A-Z]{0,2}_(half|head|Raw)$/

/** 反向：NPC 圖庫的一個檔名是哪一種圖（只有 half／head／raw，沒有機師卡）；不是立繪回 null。 */
export function classifyNpcFile(name) {
  if (!NPC_ART_RE.test(name)) return null
  return classifyPilotFile(name, '')
}

/**
 * NPC 立繪放哪個資料夾：立繪鍵的號碼段（`Pilot_13046B` → `13046`；`Pilot_101031200` → `101031200`）。
 * 只給匯入端用——前台不拼路徑，資料夾記在 build 產生的索引裡（GAME_NPC_ART 的 dir）。
 */
export function npcDirOf(artKey) {
  return artKey.match(/^Pilot_(\d+)/)?.[1]
}

/**
 * 可抽機師的立繪號碼 → gameId：掃 `public/images/game/pilots/<gameId>/` 裡的 `<artKey>_*`（號碼＝npcDirOf(artKey)）。
 * 這些號碼的立繪（連同其他造型）都不算 NPC：預設造型在 core，其他造型由 `--skins` 封存到 repo 外的 pilots/<gameId>/。
 * 同一個號碼出現在兩個 gameId 資料夾時取第一個（目前 0 筆）。
 */
export function playableArtDirs(pilotRoot) {
  const out = new Map()
  for (const id of fs.existsSync(pilotRoot) ? fs.readdirSync(pilotRoot).sort() : []) {
    for (const f of fs.readdirSync(path.join(pilotRoot, id))) {
      const c = f.endsWith('.webp') && classifyPilotFile(f.slice(0, -5), id)
      const dir = c?.key && npcDirOf(c.key)
      if (dir && !out.has(dir)) out.set(dir, id)
    }
  }
  return out
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
