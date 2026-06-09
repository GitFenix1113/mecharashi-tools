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
   * 肩膀武器欄位（有肩膀武器槽的機甲才有此欄位）
   * null = 空槽（可自由裝備肩膀武器）
   * string = 固定武器 ID（部件綁死，不可更換）
   */
  leftShoulderSlot?: string | null
  rightShoulderSlot?: string | null
  /**
   * 背後武器欄位（有背後武器槽的機甲才有此欄位）
   * null = 空槽，string = 固定武器 ID
   */
  backSlot?: string | null
  portrait?: string
  /** 立繪半身像路徑 */
  halfPortrait?: string
  quality?: string
  lore?: string
}

/** 舊版部件耐久（向後相容） */
export interface MechPartsLegacy {
  torso: number
  leftArm: number
  rightArm: number
  legs: number
}
