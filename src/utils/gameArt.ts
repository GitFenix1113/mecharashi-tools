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
// ⚠ 命名規則與 scripts/lib/gameAssetKinds.mjs 是同一套（build 腳本要能在 Node 20 跑，不能 import .ts），
//   兩邊由 scripts/lib/gameAssetKinds.test.mjs 交叉比對。改一邊就要改另一邊。
// ⚠ 路徑不含 BASE_URL，呼叫端套 imageCandidates()／assetUrl()——與 assets.ts 其他 helper 相同，
//   這樣本檔不碰 import.meta.env、可以 node --test。

import { GAME_MECH_ART, GAME_PILOT_ART } from '../data/gameArtIndex.ts'

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
 * 機師的官方原檔路徑；這位沒有這種圖（或 DB 的 artKey 與檔案對不上）回 undefined。
 *
 * ⚠ `raw` 就是舊的 `full.webp`（1240×1080 橫式半身），`half` 就是舊的 `half.webp`——同一張圖的官方版本。
 *   `head`（90²）是**另一種構圖**（頭部特寫），不是 half 的縮圖。
 */
export function pilotGameArt(
  pilot: { gameId?: string; artKey?: string } | null | undefined,
  kind: PilotGameArtKind,
): string | undefined {
  const id = pilot?.gameId
  const entry = id ? GAME_PILOT_ART.get(id) : undefined
  if (!id || !entry?.[kind]) return undefined
  if (kind !== 'card' && (!pilot?.artKey || pilot.artKey !== entry.key)) return undefined
  return `${GAME_ROOT}/pilots/${id}/${pilotGameFileName(kind, id, pilot?.artKey)}.webp`
}

/** 機甲的官方原檔路徑；這台沒有這種圖（或根本沒有遊戲 ID）回 undefined。 */
export function mechGameArt(mech: { gameId?: string } | null | undefined, kind: MechGameArtKind): string | undefined {
  const wap = mech?.gameId
  const entry = wap ? GAME_MECH_ART.get(wap) : undefined
  if (!wap || !entry) return undefined
  const has = kind === 'icon' ? entry.icon : kind === 'sn' ? entry.sn : entry.parts.includes(String(GAME_PART_NO[kind]))
  return has ? `${GAME_ROOT}/mechs/${wap}/${mechGameFileName(kind, wap)}.webp` : undefined
}
