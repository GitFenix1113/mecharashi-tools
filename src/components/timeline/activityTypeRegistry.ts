// PLAN-048 Phase 1（任務 1-5）：活動型別登錄表 —— 顏色收斂 + 第二編碼通道
// 帶 .ts 副檔名：KNOWN_ACTIVITY_TYPES 是 runtime 值（非純型別），而本檔受
// node --test 覆蓋，Node 原生 ESM 解析需要明確副檔名（同 src/utils/ 既有慣例）
import { KNOWN_ACTIVITY_TYPES, type ActivityTypeId } from '../../data/patchVersions/types.ts'

/**
 * 為什麼從 9 色收斂成 5 個族群色：
 * 原本角色池 `#79c0ff`、機甲池 `#58a6d4`、限時活動 `#06b6d4` 是三個相鄰冷藍，
 * 而撞色的正好是語意上最需要分辨的角色池 vs 機甲池。九個色相在深色底 + banner
 * 背景圖上根本分不開。
 *
 * 收斂之後靠「第二編碼通道」補回可辨識度 —— 色彩不該是唯一的資訊通道
 * （對色覺障礙者而言那等於沒有編碼）：
 *   1. `shape`：長條左端點的形狀（圓／方／菱／三角／長條）
 *   2. `label`：永遠可見的型別文字，就印在甘特列的左欄
 */
export type BarShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'bar'

export interface ActivityTone {
  /** 端點小圓點的底色 class */
  dot: string
  /** 長條膠囊的底色 + 邊框 + 文字色 class */
  chip: string
  /** 純文字色 class（列標籤、詳情標題用） */
  text: string
  /** 卡片左緣色條的 border-color class */
  edge: string
  /** 第二編碼通道：端點形狀 */
  shape: BarShape
  /** 型別顯示名 */
  label: string
}

// ── 五個族群色 ────────────────────────────────────────────────────────────────
// gacha（暖橙）／banner（藍）／event（青）／login（綠）／pass（灰）

const GACHA = {
  dot: 'bg-accent-orange',
  chip: 'bg-[rgba(255,107,43,0.18)] border-accent-orange/50 text-accent-orange',
  text: 'text-accent-orange',
  edge: 'border-l-accent-orange',
} as const

const BANNER = {
  dot: 'bg-[#79c0ff]',
  chip: 'bg-[rgba(121,192,255,0.18)] border-[rgba(121,192,255,0.5)] text-[#79c0ff]',
  text: 'text-[#79c0ff]',
  edge: 'border-l-[#79c0ff]',
} as const

const EVENT = {
  dot: 'bg-accent-cyan',
  chip: 'bg-[rgba(6,182,212,0.18)] border-accent-cyan/50 text-accent-cyan',
  text: 'text-accent-cyan',
  edge: 'border-l-accent-cyan',
} as const

const LOGIN = {
  dot: 'bg-accent-green',
  chip: 'bg-[rgba(34,197,94,0.18)] border-accent-green/50 text-accent-green',
  text: 'text-accent-green',
  edge: 'border-l-accent-green',
} as const

const PASS = {
  dot: 'bg-gray-500',
  chip: 'bg-[rgba(107,114,128,0.18)] border-gray-500/50 text-gray-300',
  text: 'text-gray-400',
  edge: 'border-l-gray-500',
} as const

/** 未登錄型別的中性色：看得見、但明確不宣稱自己屬於哪個族群 */
const UNKNOWN: ActivityTone = {
  dot: 'bg-accent-purple',
  chip: 'bg-[rgba(168,85,247,0.15)] border-accent-purple/40 border-dotted text-accent-purple',
  text: 'text-accent-purple',
  edge: 'border-l-accent-purple',
  shape: 'square',
  label: '其他',
}

const REGISTRY: Record<string, ActivityTone> = {
  // 抽卡族（暖橙）—— 形狀分辨刮刮樂／輪盤／特遣
  skinGacha:           { ...GACHA,  shape: 'diamond',  label: '刮刮樂' },
  roulette:            { ...GACHA,  shape: 'circle',   label: '輪盤' },
  pilotMission:        { ...GACHA,  shape: 'triangle', label: '特遣' },
  topUpEvent:          { ...GACHA,  shape: 'square',   label: '儲值' },

  // 卡池族（藍）—— 角色／機甲／海運靠形狀分
  specificPilotBanner: { ...BANNER, shape: 'circle',   label: '角色池' },
  specificMechBanner:  { ...BANNER, shape: 'square',   label: '機甲池' },
  crossShipping:       { ...BANNER, shape: 'triangle', label: '海運' },

  // 活動族（青）
  limitedEvent:        { ...EVENT,  shape: 'circle',   label: '限時活動' },

  // 簽到族（綠）
  loginEvent:          { ...LOGIN,  shape: 'circle',   label: '簽到' },

  // 戰令（灰）—— 幾乎橫跨整版，用長條端點暗示「延續性」
  battlePass:          { ...PASS,   shape: 'bar',      label: '戰令' },
}

/**
 * 取得型別的呈現設定。未登錄型別回中性色，`typeLabel` 可覆寫顯示名。
 * 已登錄型別一律以 registry 的 label 為準，所以日後補登錄某個型別時，
 * 先前為它填的 typeLabel 會自動被蓋過，無需回頭清資料。
 */
export function activityTone(type: ActivityTypeId, typeLabel?: string): ActivityTone {
  const known = REGISTRY[type]
  if (known) return known
  return { ...UNKNOWN, label: typeLabel?.trim() || UNKNOWN.label }
}

export function isKnownActivityType(type: string): boolean {
  return type in REGISTRY
}

/** 後台下拉選單用：已知型別的 [value, label] 清單，順序同 KNOWN_ACTIVITY_TYPES */
export const ACTIVITY_TYPE_OPTIONS: { value: string; label: string }[] =
  KNOWN_ACTIVITY_TYPES.map(t => ({ value: t, label: REGISTRY[t].label }))

/**
 * 長條左端點的形狀 class（第二編碼通道）。
 *
 * 三角形用 clip-path 而非 border trick：後者要把 background 換成 border-color，
 * 五個族群色就得各自再多一組 class；clip-path 讓所有形狀共用同一個 `dot` 底色 class。
 */
export function shapeClass(shape: BarShape): string {
  switch (shape) {
    case 'circle':   return 'w-1.5 h-1.5 rounded-full'
    case 'square':   return 'w-1.5 h-1.5 rounded-[1px]'
    case 'diamond':  return 'w-1.5 h-1.5 rotate-45 rounded-[1px]'
    case 'triangle': return 'w-2 h-2 [clip-path:polygon(50%_0%,100%_100%,0%_100%)]'
    case 'bar':      return 'w-0.5 h-3 rounded-[1px]'
  }
}
