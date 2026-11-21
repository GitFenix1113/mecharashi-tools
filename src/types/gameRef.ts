// ─── 遊戲身分鍵 gameRef（PLAN-065-A）───────────────────────────────────────────
// 站上實體 → 遊戲設定表記錄的 ID。傷害模擬引擎（私有 repo）只吃這組 ID。
//
// ⚠ 與各實體的 `gameId` 是兩回事：gameId 是圖片／圖示編號（PLAN-054／056），不能當身分；兩欄不互推。
// 寫入：scripts/backfill-game-join-keys.mjs（建議由私有 repo 產生，站長確認後 --write）；後台只唯讀顯示。
//   **例外是 BUFF（BuffGameRef）**：後台可以編輯，回填腳本只補空欄、不覆寫人工填的值。理由見 BuffGameRef。
// 未設定＝未連結：傷害模擬不會把它算進去，後台顯示「未連結」。

/** 機師：機師記錄 ID。 */
export interface PilotGameRef {
  pilotInfoId: number
}

/** 機甲：套裝 ID。 */
export interface MechGameRef {
  suitId: number
}

/** 武器：武器記錄 ID。 */
export interface WeaponGameRef {
  weaponInfoId: number
}

/** 模組：效果族 ID；itemId 選填，指定同族的特定道具記錄。 */
export interface ModuleGameRef {
  entryId: number
  itemId?: number
}

/** 元件：元件記錄 ID。 */
export interface ComponentGameRef {
  weaponEntryId: number
}

/** 背包：背包記錄 ID。 */
export interface BackpackGameRef {
  backpackInfoId: number
}

/** 技能文件：候選技能 ID（同一份文件可能對到多個 ID，由引擎決定用哪一個）。 */
export interface SkillGameRef {
  mainSkillIds?: number[]
  passiveSkillIds?: number[]
  activeSkillIds?: number[]
}

/** 機師形態：形態被動 ID。 */
export interface FormGameRef {
  passiveSkillId: number
}

/**
 * BUFF：官方 BUFF 記錄 ID（可多個）。
 * 同一個狀態在官方常有多筆記錄：每個來源各一份副本（武器阻礙 3 份），或同一級、持續回合不同（傷害提升Ⅱ 兩份）。
 * 全部列入，模擬遇到任何一份都認得出來。
 * 900000 起的「關鍵字記錄」也存在這裡：它沒有數值、從不會被掛上，只給說明文字連結用。
 *
 * 和其他 8 種不同，這一種**後台可以編輯**：BUFF 本來就是人工建檔的概念（文件 ID 用名稱），
 * 對不到官方記錄時也要能由人補上；沒有解包的管理者照樣能新增 BUFF，只是不填 ID。
 * 放的位置：無等級 BUFF 放 GameBuff.gameRef；分級 BUFF 每一級放自己的 BuffLevel.gameRef，
 * 頂層只放關鍵字記錄（以及不分級時才用得到的 ID）。
 */
export interface BuffGameRef {
  bufIds: number[]
}
