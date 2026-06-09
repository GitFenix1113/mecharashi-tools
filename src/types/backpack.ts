// ─── 背包 ──────────────────────────────────────────────────────────────────

import type { DescriptionRefs } from './common'

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
