import type { ArmamentMount } from './slots'
import type { ArmorType, PartInterface, NoInterface } from './enums'

// ─── 機甲部件（v1.4 新增：獨立部件資料）──────────────────────────────────────

/**
 * 一個部位提供的天生模組貢獻（PLAN-052-K）。
 *
 * `level` 是**這個部位單獨貢獻的級數**，不是該模組的最終等級 ——
 * 最終等級是四個部位加總後再封頂（見 `src/utils/innateModules.ts`）。
 */
export interface InnateModuleEntry {
  /** → modules 集合的文件 ID */
  moduleId: string
  /** 這個部位貢獻幾級（今天的值域是 1 或 2） */
  level: number
}

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
  /**
   * 模組接口型別（PLAN-052-A D-1 由 `string` 收成 enum）。
   *
   * ⚠ `''` ＝ **這台機甲沒有模組接口**，是合法值，今天只有 B 品質機甲（10 台 40 格）
   *   屬於這一種 —— 官方 API 的基礎階與滿品質階皆為空，是「沒有」而不是「不知道」。
   *   渲染層對空值應顯示「無模組接口」，**不要**留白、更不要講成「未建檔」。
   *
   * ⚠ 值由「品質階級 × 部位」決定，不是每台機甲各自的自由欄位 ——
   *   規則與 CI 守門在 `src/utils/mechInterface.ts`（S ⇒ ⅡⅡⅡⅡ／A ⇒ ⅠⅡⅡⅠ／B ⇒ 無）。
   *   存的是**滿品質階**的值（爬蟲取 `manji`），與全站滿級口徑一致。
   */
  interface: PartInterface | NoInterface
  /**
   * 焊死在這個部件上的固定武裝（PLAN-052-A）。左臂帶左肩、右臂帶右肩——
   * 肩槽**附屬於手臂**而非與部件正交（enums.ts 的 `WeaponEquipSlot.SHOULDER` 逐字：
   * 「肩膀：左臂或右臂其中一個肩膀」），所以掛在部件上而不是機甲頂層。
   *
   * ⚠ 硬不變式：`mount.slot === weapons[mount.weaponId].equipSlot`，允許 0 例外
   *   （由 `scripts/validate-mech-slots.mjs` 全庫校驗）。
   * ⚠ 用**陣列**不用選填 scalar：帕斯卡是**同一把衝擊炮掛左右兩肩**，scalar 表達不了；
   *   而且 scalar 的三態語意會撞上 `stripUndefined`（取消勾選寫的 `undefined` 被整個濾掉
   *   ⇒ 一旦填了就再也取消不掉）——被本欄位取代的三個死槽位就是栽在這裡。
   * ⚠ 渲染時 React key 一律用 `slotKey(ref)`，**不可**用 `weaponId`：
   *   帕斯卡兩肩是同一個 weaponId，會撞 key。
   *
   * 由 derive 層 `occupiedSlots(mech.parts)` 消費（src/utils/mechSlots.ts）。
   */
  fixedArmament?: ArmamentMount[]
  /**
   * 天生模組的**人工覆寫**（PLAN-052-K 決策三）。
   *
   * `undefined` ＝ 照規則推導（**絕大多數台走這條**，見 `src/utils/innateModules.ts`）。
   * 一旦填了就**整格取代**推導結果。
   *
   * ⚠ **不做部分合併，這是刻意的。** 半推導半覆寫是最難查的狀態 ——
   *   畫面上那個數字來自哪一半，看的人永遠不確定。要覆寫就整格自己說清楚。
   * ⚠ `[]`（空陣列）與 `undefined` **不同**：空陣列的語意是「這個部位沒有任何天生模組」，
   *   `undefined` 才是「照規則算」。後台的「清除」要寫回 `undefined`。
   * ⚠ 為什麼掛在部位不掛在模組：異常的形狀一定是「某台機甲的某個部位很奇怪」，
   *   而專屬模組本來就 `boundMechId` 綁單台 ⇒ 模組層級的覆寫是這個的特例。
   *
   * 存在的理由：官方 `aircraft_data` 停在 v3.2 而站上已到 v3.6，v3.3 之後的機甲
   * 沒有任何官方資料可比對 —— 規則算錯時要有一條不必改程式的出路。
   */
  innateModules?: InnateModuleEntry[]
  /** 部件圖示路徑 /images/mechs/{機甲名}/{position}.png */
  icon?: string
  /** 遊戲內部資產名（用於 CDN waparts/ 路徑） */
  mechaIcon?: string
}

// ─── 機甲（v1.4 更新：部件詳細資料 + 模組映射）──────────────────────────────

export interface Mech {
  id: string
  name: string
  /** 裝甲類型。PLAN-052-A D-1 由 `string` 收成 enum（實測值域乾淨：中甲 36／輕型 27／重型 27）。 */
  armorType: ArmorType
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
