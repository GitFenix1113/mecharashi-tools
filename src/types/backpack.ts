// ─── 背包 ──────────────────────────────────────────────────────────────────

import type { DescriptionRefs } from './common'

/**
 * SS 特種背包的製作關係（PLAN-036）。
 *
 * 遊戲【特種背包製作】台配方固定：圖紙 + 前置主背包 + 複合背包(S+) + 任意 3 個 S 級背包。
 * 其中只有「前置主背包」是<b>無法從名字 derive</b> 的變動事實（征服者背包 ← 某前置背包，
 * 名字無關聯），故只存這一個 id；種類/線/變體皆由此 id 查 backpacks 表 derive。
 *
 * · 圖紙 ＝ derive（name + '設計圖'），材料來源（武裝討伐）為未來擴充點，不存。
 * · 任意 3 個 S 級背包 ＝ 萬用材料，非特定，不存（顯示為固定文案）。
 * · 複合背包(S+) 核心材料 ＝ 未來擴充點（決策五），本階段不存。
 * · 形態二（特種背包武器，如裁決者）產物是武器，已由 PLAN-031 weapon.upgrade 涵蓋，不在此。
 */
export interface BackpackCraft {
  /** 前置主背包 doc id（specific，後台手輸；僅 SS 特種背包會有值）。 */
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
