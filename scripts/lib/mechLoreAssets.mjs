// 機甲故事館的素材命名規則（PLAN-042-B F-1／F-2）——匯入（import-game-assets.mjs --mech-lore）、
// 索引（generate-art-index.mjs）、擷取差異報告（diff-game-dump.mjs）共用同一份，規則只寫一次。
//
//   塗裝      擷取 Img_Skin_wap<wap>_<code>（1600×1500 去背；轉盤活動另有逐像素相同的 _Raw 版，不重複收）
//             → game/mechs/<wap>/skins/Img_Skin_wap<wap>_<code>.webp ＋ 縮圖 …_thumb.webp（塗裝列的按鈕用）
//   兵裝組件  擷取 Img_Skin_wap<兵裝號>（沒有代碼後綴；1600×1500 去背）——換掉整套模型的商城外觀（官方 WapAdvancedPaintingPlan），
//             所以自己有一個 wap 號，圖鑑大圖、部件圖示也是自己的。檔名看不出是哪台的 ⇒ 本體登記在下面的 ARMAMENT_SKINS
//             → game/mechs/<本體 wap>/skins/Img_Skin_wap<兵裝號>.webp（保留官方檔名）＋ 縮圖；塗裝代碼＝`wap<兵裝號>`
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
/** 兵裝組件 `Img_Skin_wap3132` → 兵裝號 */
export const ARMAMENT_SKIN_RE = /^Img_Skin_wap(\d{4})$/
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

/**
 * 兵裝組件 → 本體機甲（兵裝號 → 本體 wap）。怎麼查：遊戲參數資料包的 ConfigDataTacticalUnitSuitInfo（本體）.WapPaintingPlanIdList
 * 列的方案裡，ConfigDataWapPaintingPlanInfo.PaintingPanelPictureResource＝`Img_Skin_wap<兵裝號>` 的那筆；或看遊戲內該機甲的塗裝畫面。
 * 2026-10-19 整份擷取只有這一筆機甲兵裝（同系列的長槍「破軍」、背包「常勝」是武器／背包外觀，站上沒有那種外觀列，不收）。
 */
export const ARMAMENT_SKINS = {
  3132: '3032',   // 龍膽（遊騎兵；商城禮包「兵裝禮盒·龍膽」）
}

export const mechSkinFile = (wap, code) => `Img_Skin_wap${wap}_${code}`
export const mechCardFile = (key) => `mechcard_illustration_${key}`
export const makerStageFile = (key) => `Skynet_Wap_BG_${key}_Raw`

/**
 * 檔名 → 塗裝資訊 { wap：掛在哪台, code：塗裝代碼（＝網址 `?skin=` 的值）, raw, file：落地檔名（不含副檔名） }；不是塗裝回 null。
 * 兵裝組件還沒登記本體的也回 null——用 unregisteredArmament() 問。
 */
export function parseMechSkin(name) {
  const a = ARMAMENT_SKIN_RE.exec(name)
  if (a) return ARMAMENT_SKINS[a[1]] ? { wap: ARMAMENT_SKINS[a[1]], code: `wap${a[1]}`, raw: false, file: name } : null
  const m = MECH_SKIN_RE.exec(name)
  return m ? { wap: m[1], code: m[2], raw: !!m[3], file: mechSkinFile(m[1], m[2]) } : null
}
/** 本體還沒登記的兵裝組件 → 兵裝號（該到 ARMAMENT_SKINS 補一行）；其餘回 null */
export function unregisteredArmament(name) {
  const a = ARMAMENT_SKIN_RE.exec(name)
  return a && !ARMAMENT_SKINS[a[1]] ? a[1] : null
}
/** 檔名 → 招募插畫切片；卡池鍵是空的（常駐池 mechase 那組）回 null */
export function parseCardTile(name) {
  const m = MECH_CARD_TILE_RE.exec(name)
  return m && m[1] ? { key: m[1], n: Number(m[2]) } : null
}
