// ─── 遊戲身分鍵 gameRef（PLAN-065-A）───────────────────────────────────────────
// 站上實體 → 遊戲設定表記錄的 ID。傷害模擬引擎（私有 repo）只吃這組 ID。
//
// ⚠ 與各實體的 `gameId` 是兩回事：gameId 是圖片／圖示編號（PLAN-054／056），不能當身分；兩欄不互推。
// 寫入：scripts/backfill-game-join-keys.mjs（建議由私有 repo 產生，站長確認後 --write）；後台只唯讀顯示。
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
