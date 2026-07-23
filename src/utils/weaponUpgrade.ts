import type { Weapon, Backpack } from '../types'

/**
 * PLAN-031 武器製作關係層 — 進階圖 derive 工具。
 *
 * 只處理「進階圖」本身（正向／反向關係、融合技能差集、複合武器判別）。
 * 背包圖鑑投影（BackpackListItem union）與裝甲對照（fitsArmor）刻意延到 B-2 才建，
 * 避免 Phase A 觸及 SimulatorPage 的裝甲對照敏感區。
 *
 * 設計原則：只讀 Firestore 上存的「事實」（upgrade.fromWeaponId），
 * 反向索引與融合技能一律前端 derive，不存任何可推導值。
 */

/** 進階圖索引：正向（直接讀 upgrade）＋反向（derive，不存 Firestore）。 */
export interface UpgradeIndex {
  /** childId → fromWeaponId（母武器）。直接來自 upgrade.fromWeaponId。 */
  parentOf: Map<string, string>
  /**
   * parentId → childId[]（子武器們）。反向 derive。
   * 回傳陣列以承受 fan-out —— 目前實測每個母武器最多 1 個子，但未來一把武器
   * 可能有多個進階分支，型別先留陣列，屆時前端零改動。
   */
  childrenOf: Map<string, string[]>
}

/**
 * 一次掃出正向與反向進階關係。
 * 反向表只在記憶體建立，Firestore 不存（雙向欄位失同步無機制可察）。
 */
export function buildUpgradeIndex(weapons: Weapon[]): UpgradeIndex {
  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()
  for (const w of weapons) {
    const from = w.upgrade?.fromWeaponId
    if (!from) continue
    parentOf.set(w.id, from)
    const kids = childrenOf.get(from)
    if (kids) kids.push(w.id)
    else childrenOf.set(from, [w.id])
  }
  return { parentOf, childrenOf }
}

/**
 * 融合／進階帶來的技能名 = 子武器技能名 − 母武器技能名（差集）。
 *
 * ⚠ 刻意接收「技能名陣列」而非 Weapon —— 這樣 PLAN-032 把 weapon.skills 改成引用後，
 *   呼叫端只要先 resolve 成技能名再傳入，本函式零改動（差集自動換算）。
 * ⚠ 差集鍵一律用技能 name，不可用 icon（name→icon 1:1，icon→name 非 1:1）。
 */
export function deriveFusedSkillNames(
  childSkillNames: readonly string[],
  parentSkillNames: readonly string[],
): string[] {
  const parentSet = new Set(parentSkillNames)
  return childSkillNames.filter(n => !parentSet.has(n))
}

/**
 * 複合武器判別：官方以「特種背包製作」產出者。
 * 資料層唯一真相 = upgrade.station === 'specialBackpack'（推導腳本已用
 * 「同稀有度邊 + 背包 buffId」雙判別式確認後才寫入該值）。
 */
export function isCompositeWeapon(w: Weapon): boolean {
  return w.upgrade?.station === 'specialBackpack'
}

// ── B-2 背包圖鑑投影（PLAN-031）──────────────────────────────────────────────
// 讓複合武器（資料形狀是武器）投影進背包圖鑑的「特種背包製作」清單，
// 但不改變其儲存集合／refType —— 純呈現層的 union，不偽造欄位。

/** 背包圖鑑合併列表的條目：背包或（投影的）複合武器，discriminated union。 */
export type BackpackListItem =
  | { kind: 'backpack'; data: Backpack }
  | { kind: 'weapon'; data: Weapon }

/**
 * 背包側「特種背包製作」判定 —— 完全 derived（SS 背包即屬該製作清單），不在 Firestore 存推論值。
 * 打開該 facet ＝ 所有 SS 背包 ＋ 所有複合武器（isCompositeWeapon）＝ 遊戲內特種背包製作清單。
 */
export function isSpecialBackpackCraft(bp: Backpack): boolean {
  return bp.rarity === 'SS'
}

/**
 * 複合武器投影進背包圖鑑時的「類型」：由 upgrade.fusedBackpackId 查 backpacks 取 type
 * （讓它在「出力」等類型分類下也找得到）。fusedBackpackId 未填（待實機）時回 null。
 */
export function projectedBackpackType(w: Weapon, backpackById: Map<string, Backpack>): string | null {
  const id = w.upgrade?.fusedBackpackId
  if (!id) return null
  return backpackById.get(id)?.type ?? null
}

/**
 * 武器 mechRestriction → 背包 assemblableArmorType 的英文 key，供背包圖鑑 armor 篩選比對。
 * 兩者皆英文（mechRestriction 小寫 / armor config 首字大寫），此處單純換算，不涉 Mech.armorType（中文）。
 * 'none'（無限制）→ []，語意同背包 assemblableArmorType 空陣列。
 */
const MECH_RESTRICTION_TO_ARMOR: Record<string, string[]> = {
  none: [], light: ['Light'], medium: ['Medium'], heavy: ['Heavy'],
}
export function weaponArmorTypes(w: Weapon): string[] {
  return MECH_RESTRICTION_TO_ARMOR[w.mechRestriction] ?? []
}
