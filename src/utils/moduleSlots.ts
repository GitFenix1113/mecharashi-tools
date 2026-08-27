import { MechPartPosition, ModuleSlot } from '../types/enums.ts'

/**
 * 模組槽位詞彙（純資料，不含呈現）。
 * Tailwind class 對照留在 components/badges/ModuleBadges.tsx——那是呈現層的事。
 */

export const SLOT_LABELS: Record<string, string> = {
  [ModuleSlot.SLOT_4]:    '特性模組',
  [ModuleSlot.SLOT_8]:    '8級模組',
  [ModuleSlot.UNIVERSAL]: '通用模組',
}

/**
 * 模組圖鑑收錄的槽位，**陣列順序即顯示與排序順序**：特性 → 8級 → 通用。
 * 篩選按鈕與清單排序共用這一份，不會出現「按鈕排一種、結果排另一種」。
 */
export const CATALOG_SLOTS = [ModuleSlot.SLOT_4, ModuleSlot.SLOT_8, ModuleSlot.UNIVERSAL] as const

const SLOT_RANK = new Map<string, number>(CATALOG_SLOTS.map((slot, i) => [slot, i]))

/** 依 CATALOG_SLOTS 排序；不在收錄清單內的槽位（副模組）一律排在最後。 */
export function compareModuleBySlot(a: string, b: string): number {
  return (SLOT_RANK.get(a) ?? CATALOG_SLOTS.length) - (SLOT_RANK.get(b) ?? CATALOG_SLOTS.length)
}

/**
 * 四個模組接口的部位中文名（PLAN-052-G A-3）。
 *
 * ⚠ 這份表在站上**已經被抄了五份**（MechPartStrip／MechSlotPanel／ModuleBoundPart／
 *   PartSlotCard／PlanResult 各一）。新的呼叫端一律用這一份，不要再抄第六份 ——
 *   規則層產生的拒絕文案與 UI 上的欄位標題講的是同一個部位，兩份漂移的症狀是
 *   「卡片寫左臂、拒絕訊息寫 leftArm」。既有那五份的收斂留給 052-G Phase C
 *   （那時它們正好都要改）。
 */
export const PART_LABELS: Record<string, string> = {
  [MechPartPosition.TORSO]:     '軀幹',
  [MechPartPosition.LEFT_ARM]:  '左臂',
  [MechPartPosition.RIGHT_ARM]: '右臂',
  [MechPartPosition.LEGS]:      '腿部',
}

/** 部位的中文名；認不得的值原樣回傳（資料異常時顯示代碼，勝過顯示空白）。 */
export const partLabel = (position: string): string => PART_LABELS[position] ?? position
