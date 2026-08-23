// ─── 機甲部件（v1.4 新增：獨立部件資料）──────────────────────────────────────

export interface MechPart {
  position: 'torso' | 'leftArm' | 'rightArm' | 'legs'
  durable: number
  armor: number
  firepower: number
  /** 命中（僅左右臂有） */
  hit?: number
  /** 閃避（僅腿部有） */
  dodge?: number
  /** 移動力（僅腿部有） */
  move?: number
  /** 抗暴（僅軀幹有） */
  antiRiot?: number
  /** 出力（僅軀幹有） */
  output?: number
  weight: number
  interface: string
  /** 部件圖示路徑 /images/mechs/{機甲名}/{position}.png */
  icon?: string
  /** 遊戲內部資產名（用於 CDN waparts/ 路徑） */
  mechaIcon?: string
}

// ─── 機甲（v1.4 更新：部件詳細資料 + 模組映射）──────────────────────────────

export interface Mech {
  id: string
  name: string
  armorType: string
  /**
   * ⚠ **爬蟲產物，語意不一致，勿讀。** 請用 `chassisFirepower(mech.parts)`（src/utils/chassisStats.ts）。
   *
   * 實測 90 台（2026-08-23）：**83 台的頂層值 ＝ 單一部位的火力**（不是四部位總和），
   * 2 台 ＝ Σ 四部位、5 台 ≈ Σ（手建有捨入誤差）。直接讀這裡的畫面，對 83/90 台
   * 顯示的是實際火力的 1/4。
   *
   * 保留不刪的理由：它是 scrape-mechs.js 寫入的官方欄位，刪掉會讓每次重抓都產生 diff；
   * 修值也沒用（下次重抓就洗回去）。正解是**顯示層一律 derive**，DB 原樣保存。
   */
  firepower: number
  armor: number
  evasion: number
  mobility: number
  weight: number
  output: number
  /** 各部件詳細資料 */
  parts: {
    torso: MechPart
    leftArm: MechPart
    rightArm: MechPart
    legs: MechPart
  }
  /** → modules.json 四格模組 ID；無特性模組的機甲可省略 */
  module4Id?: string
  /** → modules.json 八格模組 ID；無8級模組的機甲可省略 */
  module8Id?: string
  /** → modules.json 固定模組 ID 列表（多數機甲1個，特殊機甲可有多個） */
  moduleFixedIds: string[]
  /**
   * ⚠ 【凍結中 · PLAN-047 將取代，請勿填寫】
   *
   * 原設計：肩膀／背後武器欄位，三態語意
   *   undefined = 無此槽 ／ null = 空槽（可自由裝備）／ string = 固定武器 ID（部件綁死）
   *
   * 為什麼凍結而不是直接用（PLAN-040 決策六）：
   *   1. **實測 0/63 台機甲有填**，前台零消費端；唯一的寫入端是 MechAdmin 的 SlotEditor。
   *   2. 三態語意撞上 firestoreCore.ts 的 stripUndefined —— SlotEditor 取消勾選時寫的就是
   *      `undefined`，會被整個濾掉而不是寫成「無此槽」→ **一旦某台機甲寫進了值，後台再也無法取消**。
   *   3. scalar 表達不了帕斯卡「**同一把衝擊炮 × 左右兩肩**」。
   *
   * 為什麼不刪：替代品的形狀已經知道了。PLAN-047 定案把固定武裝掛
   *   `MechPart.fixedArmament?: ArmamentMount[]`，`leftArm → 左肩槽` / `rightArm → 右肩槽`
   *   是可程式化的映射，不需要額外資料——依據是 enums.ts 的 WeaponEquipSlot.SHOULDER 註解
   *   逐字「肩膀：左臂或右臂其中一個肩膀」＋ 使用者實測「跟手臂綁在一起，左手綁左肩、右手綁右肩」。
   *   也就是說肩槽與部件是**巢狀**（肩槽附屬於手臂）而非正交，刪掉再加回來是白工。
   */
  leftShoulderSlot?: string | null
  rightShoulderSlot?: string | null
  /** ⚠ 【凍結中 · PLAN-047 將取代，請勿填寫】理由同上方 leftShoulderSlot。 */
  backSlot?: string | null
  portrait?: string
  /** 立繪半身像路徑 */
  halfPortrait?: string
  quality?: string
  /** 登場版本：機甲首次實裝的遊戲版本號（對應 patchVersions，如 '3.3'）；未設定＝尚未回填 */
  debutVersion?: string
  lore?: string
  /**
   * 管理者手動新增的機甲（PLAN-028：官方資料更新前由後台自建）。
   * true = 後台手動建立，爬蟲補丁模式（scrape-mechs.js）整筆跳過、不覆寫或刪除；
   * 純作後端防覆寫用途，前台不因此顯示任何標記。語意比照 Pilot.manual。
   */
  manual?: boolean
}

/** 舊版部件耐久（向後相容） */
export interface MechPartsLegacy {
  torso: number
  leftArm: number
  rightArm: number
  legs: number
}
