// 機甲故事館的素材命名規則（PLAN-042-B F-1／F-2）——匯入（import-game-assets.mjs --mech-lore）、
// 索引（generate-art-index.mjs）、擷取差異報告（diff-game-dump.mjs）共用同一份，規則只寫一次。
//
//   塗裝      擷取 Img_Skin_wap<wap>_<code>（1600×1500 去背；轉盤活動另有逐像素相同的 _Raw 版，不重複收）
//             → game/mechs/<wap>/skins/Img_Skin_wap<wap>_<code>.webp ＋ 縮圖 …_thumb.webp（塗裝列的按鈕用）
//   廠商舞台  擷取 Skynet_Wap_BG_<key>_Raw（2048×1024，遊戲內機甲圖鑑的背景）
//             → game/makers/Skynet_Wap_BG_<key>_Raw.webp；<key> 就是 mechMakers 的文件 ID（或它的 stage 欄位）
//   招募插畫  擷取 Img_1_mechcard_illustration_<卡池鍵><1|2>_Raw 兩片 1024²（貼圖為了 2 的次方被壓成正方）
//             → 拼回卡池 prefab 裡的真實比例 2600×1080（兩片 RawImage 各 1300×1080）
//             → game/mechs/<wap>/card/mechcard_illustration_<卡池鍵>.webp
//             卡池鍵是英文名、檔名裡沒有 wap ⇒ 哪台用哪組寫在 scripts/lib/mechGachaCards.json（人工對照）
//
// ⚠ 色票 Img_custom_wap* 不用：37 套塗裝只有 34 張，編號還有錯位（2003 的塗裝 S71、色票 S2），
//   而且它是貼花條、不是這套塗裝的樣子。塗裝列的縮圖由塗裝圖本身裁出來（匯入時產）。

/** `Img_Skin_wap1014_02`、`Img_Skin_wap1014_02_Raw` → { wap, code, raw } */
export const MECH_SKIN_RE = /^Img_Skin_wap(\d{4})_([A-Za-z0-9]+?)(_Raw)?$/
/** 招募插畫切片：`…_Dopplesoldner1_Raw`、`…_Dias_1_Raw`、`…illustrationNightglow2_Raw`、`…_Dreadtalon_1_Raw.png` */
export const MECH_CARD_TILE_RE = /^Img_1_mechcard_illustration_?(.*?)_?([1-4])_Raw(?:\.png)?$/
/** `Skynet_Wap_BG_Doll_Raw` → Doll */
export const MAKER_STAGE_RE = /^Skynet_Wap_BG_([A-Za-z]+)_Raw$/

export const MECH_SKIN_DIR = 'skins'
export const MECH_CARD_DIR = 'card'
export const MAKER_STAGE_DIR = 'makers'
export const SKIN_THUMB_SUFFIX = '_thumb'

/** 招募插畫的真實比例（卡池 prefab：兩片 RawImage 各 1300×1080） */
export const CARD_W = 2600
export const CARD_H = 1080
/** 塗裝縮圖的邊長（塗裝列按鈕 42px，兩倍密度再留一點） */
export const SKIN_THUMB_SIZE = 96

export const mechSkinFile = (wap, code) => `Img_Skin_wap${wap}_${code}`
export const mechCardFile = (key) => `mechcard_illustration_${key}`
export const makerStageFile = (key) => `Skynet_Wap_BG_${key}_Raw`

/** 檔名 → 塗裝資訊；不是塗裝回 null */
export function parseMechSkin(name) {
  const m = MECH_SKIN_RE.exec(name)
  return m ? { wap: m[1], code: m[2], raw: !!m[3] } : null
}
/** 檔名 → 招募插畫切片；卡池鍵是空的（常駐池 mechase 那組）回 null */
export function parseCardTile(name) {
  const m = MECH_CARD_TILE_RE.exec(name)
  return m && m[1] ? { key: m[1], n: Number(m[2]) } : null
}
