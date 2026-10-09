// 機甲自帶模組的分組 —— 機甲詳情頁（useMechWithModules）與引用浮窗（EntityRefView）共用
//
// 分組規則原本寫死在 useMechWithModules 的 useMemo 裡；引用浮窗也要顯示同一組模組，
// 抽出來避免兩邊各寫一份、日後只改到其中一邊。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import type { Mech } from '../types/mech.ts'
import type { Module } from '../types/module.ts'
import { ModuleSlot } from '../types/enums.ts'

export interface MechModuleSet {
  mod4: Module | null
  mod8: Module | null
  fixedMods: Module[]
  exclusiveMods: Module[]
}

type MechModuleFields = Pick<Mech, 'id' | 'module4Id' | 'module8Id' | 'moduleFixedIds'>

/**
 * 依機甲的模組欄位，把模組分成特性／8級／副模組／專屬四組。
 *
 * - 指到的模組槽位不符（例如 module4Id 指到 8 級模組）視為沒有，不硬塞進錯的那格。
 * - 專屬模組以 `boundMechId` 反查；若同時被列在 `moduleFixedIds`，只算專屬、不重複出現在副模組。
 */
export function mechModuleSet(mech: MechModuleFields, modules: Module[]): MechModuleSet {
  const find = (mid: string) => modules.find((m) => m.id === mid) ?? null
  const exclusiveMods = modules.filter(
    (m) => m.boundMechId === mech.id && m.slot === ModuleSlot.EXCLUSIVE,
  )
  const exclusiveIds = new Set(exclusiveMods.map((m) => m.id))
  const mod4Candidate = mech.module4Id ? find(mech.module4Id) : null
  const mod8Candidate = mech.module8Id ? find(mech.module8Id) : null
  return {
    mod4: mod4Candidate?.slot === ModuleSlot.SLOT_4 ? mod4Candidate : null,
    mod8: mod8Candidate?.slot === ModuleSlot.SLOT_8 ? mod8Candidate : null,
    fixedMods: (mech.moduleFixedIds ?? [])
      .map(find)
      .filter((m): m is Module => m !== null && m.slot === ModuleSlot.BUILT_IN && !exclusiveIds.has(m.id)),
    exclusiveMods,
  }
}
