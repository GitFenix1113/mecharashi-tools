// ─── 背包 ──────────────────────────────────────────────────────────────────

import type { DescriptionRefs } from './common'

/**
 * 背包的製作前置關係（PLAN-036）。前置主背包一律是「低一階」的背包：
 *   · SS 特種背包 ← S+ 前置主背包（無法從名字 derive，後台手輸；如 征服者背包 ← 某 S+）
 *   · S+ 複合背包 ← S 變體背包（可從名字 derive，腳本填；
 *       如 出力強化背包·首攻 ＝ 出力背包(S) + 強化背包·首攻(S)，存變體背包「強化背包·首攻」）
 * 只存前置主背包這一個 id；種類/線/變體皆由此 id 查 backpacks 表 derive。
 *
 * · 圖紙 ＝ derive（name + '設計圖'），材料來源（武裝討伐）為未來擴充點，不存。
 * · S+ 的另一材料「功能背包」（出力背包）可由 base derive，不存；任意 3 個 S ＝萬用，不存。
 * · 形態二（特種背包武器，如裁決者）產物是武器，已由 PLAN-031 weapon.upgrade 涵蓋，不在此。
 */
export interface BackpackCraft {
  /** 前置主背包 doc id（低一階背包；SS←S+ 手輸、S+←S 名稱可推）。 */
  prereqBackpackId: string
}

export interface Backpack {
  id: string
  name: string
  /** 背包圖示 URL · https://media.zlongame.com/media/pictures/cn/community/img/gl/gameInfo/pack/Icon_backpack_{ID}.png */
  icon?: string
  type: string            // BackpackType：'Heal' | 'Ammo' | 'Interference' | 'Invisible' | 'BackupEquipment' | 'MovePointAdd' | 'Flow'
  rarity: string          // WeaponRarity（與武器共用）：'SS' | 'S+' | 'S' | 'A' | 'B' · API quality: SSSR→SS / UR→S+ / SSR→S / SR→A / R→B
  weight: number          // 重量（佔機甲出力）· API: weight
  slot: string                // WeaponEquipSlot：固定為 'back'（WeaponEquipSlot.BACK）；與武器共用 enum 供裝備計算器統一判斷部位
  assemblableArmorType: string[]  // AssemblableArmorType 陣列（正向邏輯）：[] = 無限制；['Light'] / ['Medium'] / ['Heavy'] / 複數 = 指定機甲類型 · API: AssemblableAirmenType
  repairAmount: number    // 修理量；非修理類背包填 0 · API: AmountOfRepair
  /** SS 特種背包製作關係（PLAN-036）；僅 SS 且後台已輸入者有值。無值＝未關聯，前台優雅降級。 */
  craft?: BackpackCraft
  /** 背包附帶技能（API: WithPassiveSkills[0]）；僅 SS 稀有度（API quality: SSSR）有此欄位 */
  mainSkill?: {
    id: string            // API: WithPassiveSkills[0].ID
    name: string          // API: WithPassiveSkills[0].name
    icon?: string         // API: WithPassiveSkills[0].SkillIcon / .icon（鍵名格式）
    description: string   // API: WithPassiveSkills[0].SpecificEffects（清洗 rich text 標籤後）
    /** 描述內 [xxx] 引用側錄（PLAN-019 Layer 1） */
    descriptionRefs?: DescriptionRefs
    buffIds: string[]     // API: WithPassiveSkills[0].BufCarried（'/' 分隔 → split）
    // 以下為管理員手動填入的結構化效果數值
    dmg?: number
    crit?: number
    critDmg?: number
    acc?: number
    specialEffects?: string[]
  }
}
