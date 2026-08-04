import { ModuleSlot } from '../types/enums'

/**
 * 模組槽位詞彙（純資料，不含呈現）。
 * Tailwind class 對照留在 components/ModuleBadges.tsx——那是呈現層的事。
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
