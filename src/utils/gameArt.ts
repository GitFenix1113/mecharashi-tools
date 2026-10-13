// 官方原檔的讀取端 helper —— PLAN-054
//
// ── 一句話 ──────────────────────────────────────────────────────────────────
// 圖片由**遊戲 ID** 定位：`/images/game/{pilots/<gameId>,mechs/<wap>}/<官方檔名>.webp`。
// 呼叫端統一寫成「本地官方原檔 → 舊本地檔 → 官方 CDN」：
//
//     imageCandidates(pilotGameArt(p, 'half'), p.portrait, p.portraitUrl)
//
// 主路徑從此不必先打第三方網域；舊檔還在的期間，任何一處漏切都還有圖可退。
//
// ── 為什麼回 undefined 而不是硬拼路徑 ───────────────────────────────────────
// 索引（src/data/gameArtIndex.ts，build 掃 public/images/game 產生）沒有的就回 undefined，
// 讓 `imageCandidates()` 直接跳到下一個來源——一條必然 404 的請求只會讓圖晚出現。
// 機師另外比對 DB 的 `artKey` 與資料夾裡實際的立繪主鍵：對不上（資料打錯）也回 undefined，
// 寧可退回舊圖，也不給一個看起來合理、實際上不存在的路徑。
//
// ── NPC 圖庫（2026-10-12）─────────────────────────────────────────────────────
// `game/npc/<dir>/` 放還沒對應到可抽機師的官方立繪（劇情 NPC、尚未上線的新角色）。
// NPC 轉正的機師官方常沿用 NPC 時期那張立繪：DB 的 `artKey` 指過去，`pilotGameArt()` 在 gameId 資料夾找不到時
// 就改查 NPC 圖庫——所以**不必等機師卡**（gameId）也有立繪；機師卡只有 gameId 資料夾才有。
//
// ⚠ 命名規則與 scripts/lib/gameAssetKinds.mjs 是同一套（build 腳本要能在 Node 20 跑，不能 import .ts），
//   兩邊由 scripts/lib/gameAssetKinds.test.mjs 交叉比對。改一邊就要改另一邊。
// ⚠ 路徑不含 BASE_URL，呼叫端套 imageCandidates()／assetUrl()——與 assets.ts 其他 helper 相同，
//   這樣本檔不碰 import.meta.env、可以 node --test。

import { GAME_MECH_ART, GAME_NPC_ART, GAME_PILOT_ART, GAME_PILOT_NPC_SKINS, GAME_PILOT_SKINS } from '../data/gameArtIndex.ts'

/** 機師的四種官方圖：頭像 340²／頭部特寫 90²／半身 1240×1080／機師卡 340² */
export type PilotGameArtKind = 'half' | 'head' | 'raw' | 'card'
/** 機甲的官方圖：立繪 560×340／全身大圖 2000×1080／四個部件 340² */
export type MechGameArtKind = 'icon' | 'sn' | 'torso' | 'leftArm' | 'rightArm' | 'legs'

const GAME_ROOT = '/images/game'
const PILOT_SUFFIX = { half: '_half', head: '_head', raw: '_Raw' } as const
/** 官方部件編號：Icon_wap<wap>_1~4 ＝ 軀幹／左臂／右臂／腿 */
export const GAME_PART_NO = { torso: 1, leftArm: 2, rightArm: 3, legs: 4 } as const

/** 機師某種圖的官方檔名（不含副檔名）。gameId 與 artKey 分開給——兩者不互推。 */
export function pilotGameFileName(kind: PilotGameArtKind, gameId: string | undefined, artKey: string | undefined): string | undefined {
  if (kind === 'card') return gameId ? `Icon_item_${gameId}A` : undefined
  return artKey ? `${artKey}${PILOT_SUFFIX[kind]}` : undefined
}

/** 機甲某種圖的官方檔名（不含副檔名）。 */
export function mechGameFileName(kind: MechGameArtKind, wap: string | undefined): string | undefined {
  if (!wap) return undefined
  if (kind === 'icon') return `Icon_mecha_wap${wap}`
  if (kind === 'sn') return `Icon_mecha_wap${wap}_SN_Raw`
  return `Icon_wap${wap}_${GAME_PART_NO[kind]}`
}

/**
 * 機師的官方原檔路徑；這位沒有這種圖（或 DB 的 artKey 哪裡都對不上）回 undefined。
 *
 * 查找順序：
 *   ① gameId 資料夾（game/pilots/<gameId>/），artKey 要等於資料夾裡實際的立繪主鍵；機師卡只看這裡
 *   ② NPC 圖庫（game/npc/），以 artKey 查——NPC 轉正、官方還沒出機師卡（或卡號還沒匯入）時走這條
 *
 * ⚠ `raw` 就是舊的 `full.webp`（1240×1080 橫式半身），`half` 就是舊的 `half.webp`——同一張圖的官方版本。
 *   `head`（90²）是**另一種構圖**（頭部特寫），不是 half 的縮圖。
 */
export function pilotGameArt(
  pilot: { gameId?: string; artKey?: string } | null | undefined,
  kind: PilotGameArtKind,
): string | undefined {
  const id = pilot?.gameId
  const key = pilot?.artKey
  const entry = id ? GAME_PILOT_ART.get(id) : undefined
  if (id && entry?.[kind] && (kind === 'card' || (key && key === entry.key))) {
    return `${GAME_ROOT}/pilots/${id}/${pilotGameFileName(kind, id, key)}.webp`
  }
  return kind === 'card' ? undefined : npcGameArt(key, kind)
}

/** NPC 圖庫裡某套立繪的路徑；索引沒有這個立繪鍵（或這套缺這種圖）回 undefined。 */
export function npcGameArt(artKey: string | null | undefined, kind: Exclude<PilotGameArtKind, 'card'>): string | undefined {
  const npc = artKey ? GAME_NPC_ART.get(artKey) : undefined
  return npc?.[kind] ? `${GAME_ROOT}/npc/${npc.dir}/${artKey}${PILOT_SUFFIX[kind]}.webp` : undefined
}

/** 一套造型（外觀）的路徑與屬性。`scene`＝帶背景的場景插畫（故事館換一種構圖）。 */
export interface PilotSkinArt {
  /** 官方立繪鍵（`Pilot_10103146B`），也是網址 `?skin=` 的值 */
  key: string
  /** 顯示名稱：scripts/lib/pilotSkinMeta.json 有填就用，沒有就「外觀 N」（N 從 1 起、依索引順序） */
  label: string
  scene: boolean
  raw: string
  half?: string
  head?: string
}

/**
 * 機師的造型／外觀（PLAN-042-D F-2）。兩個來源依序串起來：
 *   ① `game/pilots/<gameId>/skins/`（`--skins` 匯入，以 gameId 查）
 *   ② NPC 圖庫裡屬於這位的外觀（npcArtNotes.json 的 owner＝文件 ID、且有外觀卡；以文件 ID 查）
 * 沒有就回空陣列（多數機師沒有外觀，這不是錯誤）。預設造型**不在**清單裡——呼叫端自己放在第一個。
 */
export function pilotSkins(pilot: { id?: string; gameId?: string } | null | undefined): PilotSkinArt[] {
  const own = (pilot?.gameId ? GAME_PILOT_SKINS.get(pilot.gameId) : undefined) ?? []
  const npc = (pilot?.id ? GAME_PILOT_NPC_SKINS.get(pilot.id) : undefined) ?? []
  const file = (base: string, key: string, kind: keyof typeof PILOT_SUFFIX) => `${base}/${key}${PILOT_SUFFIX[kind]}.webp`
  const list = [
    ...own.map((s) => ({ s, base: `${GAME_ROOT}/pilots/${pilot!.gameId}/skins` })),
    ...npc.map((s) => ({ s, base: `${GAME_ROOT}/npc/${s.dir}` })),
  ]
  return list
    .filter(({ s }) => s.raw)
    .map(({ s, base }, i) => ({
      key: s.key,
      label: s.name ?? `外觀 ${i + 1}`,
      scene: !!s.scene,
      raw: file(base, s.key, 'raw'),
      half: s.half ? file(base, s.key, 'half') : undefined,
      head: s.head ? file(base, s.key, 'head') : undefined,
    }))
}

/** 機甲的官方原檔路徑；這台沒有這種圖（或根本沒有遊戲 ID）回 undefined。 */
export function mechGameArt(mech: { gameId?: string } | null | undefined, kind: MechGameArtKind): string | undefined {
  const wap = mech?.gameId
  const entry = wap ? GAME_MECH_ART.get(wap) : undefined
  if (!wap || !entry) return undefined
  const has = kind === 'icon' ? entry.icon : kind === 'sn' ? entry.sn : entry.parts.includes(String(GAME_PART_NO[kind]))
  return has ? `${GAME_ROOT}/mechs/${wap}/${mechGameFileName(kind, wap)}.webp` : undefined
}

// ── 反向：圖片路徑 → 官方 ID（後台選圖時順手帶入 gameId）──────────────────────────
// PLAN-054 起圖片資料夾就是遊戲 ID，選到的路徑本身就寫著它屬於誰。
// 只認**索引裡真的有**的 ID：舊的名字資料夾（pilots/<中文名>、mechs/<中文名>）與打錯的數字都推不出來 → undefined，
// 呼叫端照樣只寫圖片、不動 ID。路徑可帶 BASE_URL 或完整網址前綴（只看 images/ 之後那段）。

const PILOT_DIR_RE = /(?:^|\/)images\/(?:game\/)?pilots\/([^/]+)\/[^/]+$/
const MECH_DIR_RE = /(?:^|\/)images\/game\/mechs\/([^/]+)\/[^/]+$/

/**
 * 機師圖片路徑 → `{ gameId, artKey }`。官方原檔夾（game/pilots/<id>/）與站上原稿夾（pilots/<id>/，PLAN-054 D-2 起也是 gameId）都認。
 * artKey 取自索引裡資料夾實際的立繪主鍵——不從 gameId 拼，5 位例外（維娜等）才對得上。
 */
export function pilotGameIdFromPath(path: string | null | undefined): { gameId: string; artKey?: string } | undefined {
  const id = path?.match(PILOT_DIR_RE)?.[1]
  const entry = id ? GAME_PILOT_ART.get(id) : undefined
  return id && entry ? { gameId: id, artKey: entry.key } : undefined
}

/** 機甲圖片路徑 → wap（只認官方原檔夾 game/mechs/<wap>/；舊的 mechs/<中文名>/ 推不出來）。 */
export function mechGameIdFromPath(path: string | null | undefined): string | undefined {
  const wap = path?.match(MECH_DIR_RE)?.[1]
  return wap && GAME_MECH_ART.has(wap) ? wap : undefined
}
