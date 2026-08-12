// ─── 武器 ──────────────────────────────────────────────────────────────────

import type { DescriptionRefs } from './common'
import type { SkillEffect } from './buff'

/**
 * 內嵌武器技能（舊格式）。
 *
 * ⚠ **刻意永久保留，不是待清死碼**（PLAN-032 決策四）。這點與 PLAN-004 機師版不同：
 * 那邊的 union 是「該收斂卻沒收斂」，這邊是**設計上不收斂**——
 * 官方 API 的 PassiveSkill 就是這個形狀，爬蟲抓到全新武器時仍會產出內嵌格式，
 * 由 scrape-weapons.js 的 normalize 步驟才轉成 WeaponSkillRef。
 * 看到「全站已無內嵌資料」就把它刪掉，下次改版爬蟲會直接爆掉。
 */
export interface WeaponSkill {
  name: string
  /** 技能圖示遠端 URL（API 原始路徑） */
  icon?: string
  /** 技能圖示本地路徑（如 /images/weapons/skills/Icon_skill_xxxxx.png）；前端縮圖顯示用 */
  iconLocal?: string
  type: string
  /** 生效方式："carry" 攜帶即生效 / "equip" 裝備中生效 / "use" 僅使用時生效 */
  activation: 'carry' | 'equip' | 'use'
  description: string
  /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
  descriptionRefs?:            DescriptionRefs
  effects:                     SkillEffect[]
  buffIds:                     string[]
  enhancesTalentName?:         string
  /** 天賦被此專武強化後的完整描述文字（遊戲原文）；用於與天賦原文做 DiffHighlight 差異對比 */
  enhancedTalentDescription?:  string
}

/**
 * 武器對技能庫的掛載關係（PLAN-032 新格式）。
 *
 * 只承載「**這把武器怎麼用這個技能**」，技能本身的名稱/描述/效果/buffIds 一律住在
 * pilotSkills 集合（技能庫）的 skillId 那份 doc，改一處全站生效。
 *
 * ⚠ **activation 為什麼必須留在掛載側**（決策三）：它是遊戲規則造成的真實每武器變異，
 * 不是資料漂移。實測 44 個重複技能名群組中 **38 個在此欄衝突**——
 *   [赤狐·改 S+] 凝神待發 = 'carry'（攜帶即生效）
 *   [魔笛   SS ] 凝神待發 = 'use'  （僅使用該武器時生效）
 * S+ 一般武器 39/39 全為 carry，SS 專武才可能是 use。把它併進技能 doc 會強迫兩者二選一。
 *
 * 鑑別鍵是 `'skillId' in entry`——內嵌 WeaponSkill 沒有這個欄位（見 isWeaponSkillRef）。
 */
export interface WeaponSkillRef {
  /** 技能庫（pilotSkills 集合）的文件 id */
  skillId: string
  /** 生效方式："carry" 攜帶即生效 / "equip" 裝備中生效 / "use" 僅使用時生效 */
  activation: 'carry' | 'equip' | 'use'
}

/**
 * 武器製作／進階關係（PLAN-031）。有值 = 此武器由 fromWeaponId 製作而來。
 * 只存「事實」，不存 UI 顯示決策，也不存任何可推導值。
 *
 * ⚠ upgrade 不改變本武器的儲存集合、doc id 或 refType —— 複合武器（裁決者等）
 *   在官方介面歸類為「特種背包製作」，但資料形狀是武器，故仍存於 weapons、refType 仍為 'weapon'，
 *   官方介面歸類改由本欄位 station 這類正交欄位表達（跨界實體判準）。
 *
 * 刻意不加的可推導值：
 *   - upgradeTo（反向索引由 buildUpgradeIndex 前端 derive；雙向欄位失同步無機制可察）
 *   - fusedSkillName（＝子武器 skills − 母武器 skills 差集，前端 derive）
 *   - fusedBackpackType（由 fusedBackpackId 查 backpacks 取得）
 *   - isComposite（＝ station === 'specialBackpack'）
 *
 * 材料擴充點（現在不建欄位，0/5 定律）：未來的
 *   materials?: { itemId: string; qty: number }[] 屬於本型別（邊的屬性，非武器的屬性）。
 *   前置條件：items 集合與武裝討伐掉落資料，兩者皆尚未存在。
 */
export interface WeaponUpgrade {
  /** 母武器 doc id（必填 —— 實測 42 條邊皆有母武器） */
  fromWeaponId: string
  /** 官方製作工作台。未填 = 一般武裝生產；'specialBackpack' = 特種背包製作（複合武器） */
  station?: 'specialBackpack'
  /**
   * 融合進來的背包 doc id（複合武器專用），如 '60102405'。
   * ⚠ 此為實機確認的事實值，不可由武器 buffId 推定 ——
   *   實測融合技能 buffId 600433 由多個背包共用，且確認正解 60102405 反而不含該 buffId。
   */
  fusedBackpackId?: string
}

export interface WeaponFixedModEffect {
  stat: 'attack' | 'crit' | 'accuracy' | string
  value: number
}

export interface WeaponFloatingModEffect {
  stat: 'attack' | 'crit' | 'accuracy' | 'firepower' | string
  condition: string | null
  min: number
  max: number
}

export interface Weapon {
  id: string
  name: string
  /** 武器背景故事文字（API: describe） */
  description?: string
  /** 武器圖示本地路徑，如 /images/weapons/Icon_weapon_10001.png */
  icon?: string
  type:            string  // WeaponType：射擊 / 格鬥 / 突擊 / 戰術
  kind:            string  // 武器種類：機槍 / 狙擊步槍 / 刀劍…
  kindCoefficient: number
  attack: number           // API: WeaponBasicAttackingPower
  accuracy: number         // API: WeaponHitPoint（命中）
  critValue: number        // API: WeaponUnderstanding（暴擊值）
  rangeType:  string  // RangeType：'manhattan' | 'orthogonal' | 'ring'
  minRange:   number
  maxRange:   number
  weight: number      // API: WeaponWeight（重量）
  ammoCount: number
  hitCount: number
  rarity: string  // WeaponRarity：'SS' | 'S+' | 'S' | 'A' | 'B'
  mechRestriction: string  // MechRestriction：'none' | 'light' | 'medium' | 'heavy' · API: LimitedModelOfWeapon
  equipSlot: string        // WeaponEquipSlot：singleHand / dualHand / shoulder / back · API: RestrictionsPositionOfWeapon
  isExclusive: boolean
  exclusiveFor?: string
  triggerSlots: number
  effectSlots: number
  /** 元件上限：觸元件＋應元件總數不可超過此值（SS/S+=4, S=3, 其他=0） */
  componentLimit: number
  fixedMod: {
    planName: string
    maxLevel: number
    effects: WeaponFixedModEffect[]
  }
  floatingMod: {
    planName: string
    slots: number
    possibleEffects: WeaponFloatingModEffect[]
  }
  /**
   * PLAN-032 過渡雙格式：`WeaponSkillRef` = 已引用化（技能本體在技能庫）；
   * `WeaponSkill` = 尚未遷移的內嵌拷貝（爬蟲產出的原始形狀，見 WeaponSkill 註解）。
   * 一律以 `resolveWeaponSkills(weapon.skills, skillMap)` 解析，前端不需在意目前是哪種。
   *
   * ⚠ **不要對這個陣列直接取 .length 當顯示 gate**——union 兩個成員都有 length，
   * tsc 抓不到，而引用可能解析不到（技能庫未載入 / doc 被刪），會渲染出一塊空的技能區。
   * 用 hasWeaponSkills() 或 gate 在解析後的陣列上。
   */
  skills: (WeaponSkillRef | WeaponSkill)[]    // API: PassiveSkill[]
  /** 製作／進階關係（PLAN-031）。有值 = 由 upgrade.fromWeaponId 製作而來；不影響本武器的儲存集合／refType。 */
  upgrade?: WeaponUpgrade

  /**
   * [固定武裝]：無法更換的武器（PLAN-040）。
   *
   * 已窮舉 6 種（2026-08-09 使用者確認，就目前遊戲版本而言即為全部）：
   *   衝擊炮（帕斯卡）、嵐質儲能艙（破曉者-01）、多功能彈倉（霸王）、
   *   耀星／隕星／千星（彌造者 · 海莉絲虛粒子形態）。
   *
   * 純粹供 badge 渲染 + 圖鑑／模擬器過濾，**不編碼「來源」也不編碼「佔哪個槽」**。
   * 三種來源（部件／機師形態／機甲底盤）一律由來源端指向武器，箭頭永不反向。
   *
   * ⚠ 命名刻意避開既有的 fixedMod（:126「固定改裝」）——
   *    同一個 interface 上同時有 fixed(固定武裝) 與 fixedMod(固定改裝) 是維護地雷。
   * ⚠ 【不要】複用 isExclusive(:120) / exclusiveFor(:121)：那是「機師專武、可選裝、SS、強化天賦」，
   *    與固定武裝「強制、鎖死、無法更換」語意相反；且 exclusiveFor 被 useFirestore.ts 與
   *    PilotsPage.tsx 當「機師→專武」索引消費，塞進去會被渲染成金框專武，
   *    並破壞 isExclusive ⇔ rarity === 'SS' 的既有不變式。
   * ⚠ 槽位歸屬（誰佔了哪個肩／背槽）**不在這裡**，見 PLAN-047（掛 MechPart.fixedArmament）。
   */
  isFixedArmament?: boolean

  /**
   * 手建文件保護旗標。官方 API / WIKI 無這六筆資料、100% 手動維護，補丁腳本應略過。
   * weapon.ts 原本是唯一缺此旗標的主要型別（對照 mech.ts / pilot.ts 皆已有）。
   */
  manual?: boolean

  /**
   * 不適用的數值欄位 key 清單；渲染層對列入者一律顯示「—」，不顯示數字（DB 仍存 0）。
   *
   * **為什麼不直接填 0**：ammoCount === 0 在本專案已被佔用為「無限彈藥 ∞」
   * （WeaponsPage.tsx / WeaponDetailPage.tsx 皆為 `ammoCount === 0 ? '∞'`，172 筆中 129 筆靠這條規則），
   * 填 0 會讓「沒有彈藥」被渲染成「無限彈藥」——與遊戲相反的**肯定陳述**。
   * 旁證此值安全：全庫 attack === 0 與 weight === 0 皆 0 筆，0 對這兩欄是從未出現過的值。
   *
   * **為什麼不把必填改選填**：至少 9 處渲染點要補 `??`，且讓 172 筆正常武器永遠帶一個
   * undefined 分支，只為服務 2 筆。
   *
   * ⚠ 本欄只標「**不適用**」，不標「**未知**」。反例：衝擊炮的 ammoCount: 1 是真彈藥
   *   （可由戰術家［裝填］補充），**不得**因為「看起來像技能次數」而列進來；射程 3 同理。
   *
   * 定案值（PLAN-040 C-1）：
   *   衝擊炮 → ['attack','accuracy','critValue','weight','kindCoefficient']
   *   嵐質儲能艙 / 多功能彈倉 → 全部數值欄位（遊戲連數值區塊都不渲染）
   *   耀星 / 隕星 / 千星 → 不需要（改用 variableStats，見下）
   */
  naStats?: string[]

  /**
   * **無固定值**的數值欄位 key 清單：有數值，但由當下掛載情境決定，不是這把武器自己的屬性。
   * 渲染層對列入者**整格不顯示**，並在區塊末尾用一行說明交代原因（見 variableStatNote）。
   *
   * ⚠ **與 naStats 是兩件事，不要合併**（2026-08-13 維護者回報後新增）：
   *     naStats       =「這把武器沒有這個數值」→ 欄位在、值顯示「—」
   *     variableStats =「有數值，但不固定」   → 整格收掉
   *   併成一欄會讓「嵐質儲能艙沒有攻擊力」與「耀星的攻擊力不固定」變成同一句話；
   *   而後者顯示「—」等於對「這把武器沒有攻擊力」做出錯誤的肯定陳述。
   *
   * ⚠ **DB 仍保留原本的觀測值**（耀星 attack 757 等，PLAN-040 C-1 建檔時實測），
   *   只在渲染層攔下來。那批值是「某次觀測時的搭配結果」，之後若要做傷害模擬仍是有用的樣本，
   *   洗成 0 就再也回不來了。
   *
   * 定案值：耀星 / 隕星 / 千星 → 除 minRange/maxRange 外的全部數值欄位
   *   （維護者實測：這三把是海莉絲虛粒子形態的形態武裝，數值繼承自機甲當下裝備的武器，
   *     連重量都不是自己的；只有射程與射程型態是武裝本身固定的）。
   */
  variableStats?: string[]
}
