// ⚠ 自動產生，請勿手動編輯 —— node scripts/import-game-assets.mjs --equip-icons --apply（PLAN-056 A-1）
//
// 武器／背包官方檔名的大小寫例外：gameId → 檔名一般是 Icon_<family>_<gameId>，
// 但官方有幾個背包寫成 Icon_BackPack_（大寫）。圖庫照官方檔名逐字存，GitHub Pages 分大小寫，所以要查表。

export const EQUIP_ICON_KEY_CASE: Record<string, string> = {
  'backpack:60350101': 'Icon_BackPack_60350101',
  'backpack:60500101': 'Icon_BackPack_60500101',
}
