// 機師故事館的素材命名規則（PLAN-042-A Phase J）——匯入（import-game-assets.mjs --pilot-lore）、
// 索引（generate-art-index.mjs）、擷取差異報告（diff-game-dump.mjs）共用同一份，規則只寫一次。
//
//   招募插畫  擷取 Img_1_pilot_gacha_<卡池鍵><1|2>_Raw 兩片 1024²（貼圖為了 2 的次方被壓成正方）
//             → 拼回卡池 prefab 裡的真實比例 2600×1080（Img_BG 底下兩片 RawImage 各 1300×1080，與機甲完全相同）
//             → game/pilots/<gameId>/card/pilot_gacha_<卡池鍵>.webp
//             卡池鍵＝卡池 prefab PilotGacha<卡池鍵>ItemPrefab 的英文名，檔名裡沒有 gameId
//             ⇒ 哪位用哪組寫在 scripts/lib/pilotGachaCards.json（人工對照；export-gacha-prefab.py --kind pilot 也讀它）
//
// ⚠ 切片命名不全照規則（2026-10-17 實測）：虹 `…gacha_Hong_1_Raw`、葉夫根尼 `Img_1_pilot_Yevgeny_001_Raw`、
//   零 `Img_1_pilot_AyanamiRei1_Raw`、明日香只有第 3／4 片（`Img_1_pilot_Asuka3_Raw`，拼起來就是卡池背景）、
//   插畫鍵與卡池鍵不同名（Diracca／Diracca1、Hardaway／VillarsHardaway、sylvieroussel／Sylvie）。
//   這些寫在對照表的 tiles，不在這裡猜。

import { CARD_H, CARD_W } from './mechLoreAssets.mjs'

export { CARD_H, CARD_W }

/**
 * 一般命名的招募插畫切片：`Img_1_pilot_gacha_HailisMill1_Raw` → { key: 'HailisMill', n: 1 }。
 * banner_／title_ 不是切片；鍵要以英文字母開頭——`Img_1_pilot_gacha_001_Raw`／`002_Raw` 是沒有鍵名的通用卡池背景，不是誰的插畫
 */
export const PILOT_CARD_TILE_RE = /^Img_1_pilot_gacha_(?!banner_|title_)([A-Za-z][A-Za-z0-9]*?)_?([1-5])_Raw$/
export const PILOT_CARD_DIR = 'card'
export const PILOT_CARD_PREFIX = 'pilot_gacha_'

export const pilotCardFile = (key) => `${PILOT_CARD_PREFIX}${key}`

/** 卡池鍵的兩片切片檔名：對照表的 tiles 有寫就用它，否則照一般命名 */
export function pilotCardTiles(key, tiles = {}) {
  return tiles[key] ?? [`Img_1_pilot_gacha_${key}1_Raw`, `Img_1_pilot_gacha_${key}2_Raw`]
}

/** 檔名 → 招募插畫切片；不是一般命名的切片回 null（例外命名靠對照表的 tiles，不靠這裡） */
export function parsePilotCardTile(name) {
  const m = PILOT_CARD_TILE_RE.exec(name)
  return m ? { key: m[1], n: Number(m[2]) } : null
}
