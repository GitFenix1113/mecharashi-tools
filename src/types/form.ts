// ─── 機師形態 forms（PLAN-041）──────────────────────────────────────────────
//
// 調構師（海莉絲）駕駛的機甲會在戰鬥中切換「形態」。形態**既不是技能也不是 buff**：
// 它要承載 restrict union / order / grantedBuffIds / isSignature，PilotSkill 與 GameBuff
// 兩個既有型別都裝不下（計畫書問題二）。故獨立成 forms 集合。
//
// 設計前提：官方 API 與 WIKI 都沒有這份資料 → 100% 手動維護 →
// 【降低填寫摩擦是第一目標】：能 derive 的不落盤，今天填不進去的一個都不開。

import type { DescriptionRefs } from './common'
import type { WeaponType } from './enums'

/**
 * 形態的裝備限制。刻意用 discriminated union（sum type）而非 product：
 *
 * 1. 三個戰鬥形態＝WeaponType 過濾（先鋒=['格鬥','射擊'] / 突擊=['突擊'] / 戰術=['戰術']）
 *    → 就是 WeaponType[]，不需要新 enum。
 * 2. 虛粒子形態不是 WeaponType 限制，而是鎖死武裝與技能 → 同一 union 的另一支。
 *
 * ⚠ **「突擊／先鋒形態的右手備用／左手備用槽」不是形態的能力**（2026-08-09 實機實測）：
 *    備用槽來自「強襲者背包」（`backpacks/60101706`、`type: 'BackupEquipment'`，全庫僅此 1 筆），
 *    +300 出力（3375→3675）同樣來自 `bpskill_強襲者驅動·增傷`。
 *    → 突擊形態要表達的仍然只有 `allow: ['突擊']` 一件事，**restrict 不需要變成 product**。
 *    看到官方截圖的備用槽而想把這裡改成「白名單＋槽位」兩欄的人，先讀這段。
 *
 * ⚠ **「特殊」（WeaponType.Special）不參與 `allow` 的計算**（承接 PLAN-040 決策九）。
 *    固定武裝本來就無法更換，武器過濾器對它沒有意義。原本三個戰鬥形態把 WeaponType
 *    切成無重疊無遺漏的 partition，PLAN-040 新增「特殊」後那個 partition 不再完整，
 *    正確表述是「特殊不參與過濾」而非「partition 壞了」。
 *
 * 副作用（刻意）：「有無固定武裝」由 `kind === 'fixedArmament'` derive，不存平行布林；
 * union 也讓 TypeScript 逼你選邊、逼你填 weaponIds。
 */
export type FormRestrict =
  | {
      kind: 'weaponType'
      /** 可裝備的武器類型白名單。不含 '特殊'——見上方型別註解 */
      allow: WeaponType[]
    }
  | {
      kind: 'fixedArmament'
      /**
       * 該形態焊死的武器（海莉絲虛粒子形態＝耀星／隕星／千星，由 PLAN-040 建立）。
       *
       * ⚠ **目前刻意只存 id、不存槽位。** 未來要標明「耀星右手／隕星左手／千星背部」時，
       *    應升級成 PLAN-047 的 `ArmamentMount[]`（`{ weaponId; slot; side? }`），
       *    **不可另造第四套部位詞彙**——全站已有 `WeaponEquipSlot` / `boundPart` /
       *    `Backpack.slot` 三套。
       */
      weaponIds: string[]
      /**
       * 該形態下被鎖死、無法更換的固有技能（指**基礎版**，如 `skill_虛粒子刃`）。
       *
       * ⚠ **純語意標記，前台形態卡不渲染它**（PLAN-041 決策十）。三個理由：
       *  (a) 會與武器卡重複顯示 —— PLAN-040 C-3 已把 `skill_虛粒子矩陣` 掛成
       *      `weapon_178_千星` 的 WeaponSkillRef，武器詳情頁本來就渲染它；
       *  (b) 會誤導 —— 虛粒子形態下這三支其實被 `skill_虛粒子程式` 強化為 EX 版，
       *      形態卡上列基礎版名稱等於顯示玩家在該形態下看不到的東西；
       *  (c) 今天沒有消費端 —— 模擬器的形態 gate 明文不在 PLAN-041 範圍內。
       * 形態卡上呈現的是官方正文「無法變更武裝和技能」＋ weaponIds 的固定武裝 chip。
       */
      lockedSkillIds?: string[]
    }

/**
 * forms Collection 文件。
 *
 * ⚠ `kind === 'fixedArmament'` 的語意是【鎖定全部槽位】——雙手＋雙肩＋背部全部不可調整，
 *   **不只是**被 `weaponIds` 那三把佔住的三格。2026-08-09 實機實測逐字：
 *   「不只是不能帶背包，虛粒子形態沒辦法調整任何裝備」；截圖中雙肩顯示為空的 `[+]`
 *   但不可用——**空槽 ≠ 可填**。
 *   對應 PLAN-047 的「全鎖型」derive（`lockedSlots()`）；帕斯卡／破曉者-01／霸王的
 *   肩槽封鎖是正交的「佔據型」（`occupiedSlots()`），不歸本型別。
 */
export interface MechForm {
  /** id 格式：`form_<機師名>_<形態名>`，如 `form_海莉絲_先鋒` */
  id: string
  pilotId: string
  /** 「先鋒形態」——用「形」不用「型」（舊 pilotSkills 文件 id 是「型」態，見計畫書決策六） */
  name: string
  /** 顯示順序。形態數不固定（海莉絲 4、新調構師可能 2）→ UI 一律 map，不寫死欄數 */
  order: number
  icon?: string
  /** 官方形態卡固有正文，逐字。**這是形態效果的唯一真相源**（見下方「不設 effects」） */
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?: DescriptionRefs
  restrict: FormRestrict
  /**
   * 形態增益（指向 `BUFF_型態增益`）。與 description 逐句零重疊，故分兩層各自標來源、不合併：
   * **固有＝形態的身分，永遠生效 → 住 description；增益＝天賦另給的一次性 buff
   * （正文均有「觸發效果後移除」）→ 續留 buffs。**
   */
  grantedBuffIds?: string[]
  /** 入場／退場條件，官方正文逐字。刻意不結構化——全站沒有回合模型可以消費它 */
  entryNote?: string
  /** 天賦專屬（虛粒子）。今天就有消費端：決定 UI 是否與三個戰鬥形態同排 */
  isSignature?: boolean
  /** 手建文件保護旗標。官方無此資料、100% 手動維護，補丁腳本應略過 */
  manual?: boolean

  // ─── 以下【刻意不開】，理由寫死在型別註解裡，避免三個月後有人再問一次 ───
  //
  // ⚠ 不設 effects：形態固有九條正文，現行 SkillEffect + STAT_OPTIONS（封閉 34 key select）
  //    只表達得出約 2 條。填不進去的：移動力+1（無 move 維度）、不消耗彈藥（無資源維度）、
  //    可行動2次（無回合維度）、每1AP+5%上限25%（minApCost 只有門檻無 scale/max）、
  //    每回合最多2次（maxTriggers 無 per-turn reset）、免疫[反擊先手]（無 immunity tag）、
  //    子彈數+1（BULLET_ADD 是 Component 專用 enum）。
  //    缺的是四個結構性軸，屬 Phase 7 傷害公式範疇，不是補幾個 stat key。
  //    佐證：全庫 effects 非空 0 個。→ description 是唯一真相源。
  //    另注：3375→3675 的出力差是**強襲者背包**給的，形態身上沒有任何數值可寫進 effects。
  //
  // ⚠ 不設 skillsByWeaponKind：42 筆「形態 × 武器種類 → 子技能」矩陣的擁有者是【技能】
  //    不是形態（「聚類映射依當前形態變化」是聚類映射的性質）。掛在 Form 上的話，
  //    新增一支子技能要改 4 個形態文件。→ 歸 SkillVariant，箭頭 skill → form。
  //
  // ⚠ 不設 hasFixedArmament → 由 restrict.kind derive。
  //
  // ⚠ 不設「當前裝備重量」：官方形態卡左側的 1125 / 3125 / 1895 / 1825 是**配裝總重**，
  //    隨玩家配裝即時改變的 derived 值。落盤等於製造第二個真相源。
  //
  // ⚠ 不設 per-form 武器背包 loadout：天賦原文「可以獨立裝備武器背包」屬模擬器範疇
  //    （Build.weaponId 是單值 string，改成 weaponIdByForm 是 userBuilds 的 breaking change）。
  //    已由 PLAN-047 承接。
}
