// 裝甲類型／執照的詞彙對齊 —— PLAN-052-A Phase D / D-2
//
// ── 問題：同一個概念在三處有兩套名字 ────────────────────────────────────────
//   `Mech.armorType`（ArmorType）              ：輕型 ／ **中甲** ／ 重型
//   `Pilot.license`（MechLicense）             ：輕型 ／ **中型** ／ 重型
//   `globalResearch.mechResearchByType[].armorType`：輕型 ／ **中型** ／ 重型
//
// 只有中階不同名，而且兩邊的「輕型」「重型」完全相同 —— 於是
// `find(x => x.armorType === mech.armorType)` 在測試資料裡看起來完全正常，
// 上線後 36/90 台中甲**靜默拿 0 加成**。錯誤不會有任何徵兆，只是數字偏低。
//
// ── 為什麼是轉換層而不是改資料 ──────────────────────────────────────────────
// 「中型」是官方科研頁與駕駛執照的用詞，不是打錯；把 globalResearch 的鍵改成「中甲」
// 等於用站內詞彙覆蓋官方說法，而且任何一支 seed／匯入腳本重跑就會寫回來。
// 轉換層則是一次寫好、可單測、對兩種寫法都成立。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type { GlobalResearch, MechTypeResearchBonus, ClassResearchBonus, WeaponTypeResearchBonus } from '../types'
import { ArmorType, MechLicense } from '../types/enums.ts'

/** 科研表／執照的裝甲用詞 → `ArmorType`。認不得的值回 `null`（不猜）。 */
export function toArmorType(raw: string | null | undefined): ArmorType | null {
  switch (raw) {
    case ArmorType.LIGHT:  return ArmorType.LIGHT     // '輕型'：兩套同名
    case ArmorType.HEAVY:  return ArmorType.HEAVY     // '重型'：兩套同名
    case ArmorType.MEDIUM: return ArmorType.MEDIUM    // '中甲'：已經是 ArmorType
    case MechLicense.MEDIUM: return ArmorType.MEDIUM  // '中型' → '中甲'（唯一需要翻譯的一個）
    default: return null
  }
}

/**
 * 這張執照能不能駕駛這個裝甲類型的機甲。
 *
 * 規則：重型執照全開、中型執照可駕駛輕型與中甲、輕型執照只能駕駛輕型。
 * 抽成函式是因為它有三個消費端（模擬器過濾、圖鑑標記、未來的分享碼驗證），
 * 而它正是那個「中型 vs 中甲」最容易寫錯的地方。
 */
export function licenseAllows(
  license: MechLicense | string | null | undefined,
  armorType: ArmorType | string | null | undefined,
): boolean {
  if (!license) return true                       // 未設定執照＝不過濾
  const armor = toArmorType(armorType)
  if (!armor) return true                         // 認不得的裝甲類型不擋（寧可多顯示，不要少）
  switch (license) {
    case MechLicense.HEAVY:  return true
    case MechLicense.MEDIUM: return armor !== ArmorType.HEAVY
    case MechLicense.LIGHT:  return armor === ArmorType.LIGHT
    default: return true
  }
}

/**
 * 依機甲的裝甲類型查機甲科研加成。查不到回 `null`。
 *
 * ⚠ **不要**自己寫 `gr.mechResearchByType.find(x => x.armorType === mech.armorType)`，
 *   那正是會讓中甲靜默拿 0 的寫法。
 */
export function findMechResearch(
  gr: Pick<GlobalResearch, 'mechResearchByType'> | null | undefined,
  armorType: string | null | undefined,
): MechTypeResearchBonus | null {
  const want = toArmorType(armorType)
  if (!want) return null
  return (gr?.mechResearchByType ?? []).find((x) => toArmorType(x.armorType) === want) ?? null
}

/**
 * 依職業查機師科研加成。查不到回 `null`。
 *
 * ⚠ 實測（2026-08-24）表內只有 **6 個職業**（格鬥家／突擊手／狙擊手／戰術家／守護者／機械師），
 *   **沒有調構師** —— 海莉絲與後續的調構師一律查不到，回 `null`。
 *   呼叫端該把 `null` 當「這個職業還沒有科研資料」呈現，不要當成「加成為 0」。
 */
export function findPilotResearch(
  gr: Pick<GlobalResearch, 'pilotResearchByClass'> | null | undefined,
  className: string | null | undefined,
): ClassResearchBonus | null {
  if (!className) return null
  return (gr?.pilotResearchByClass ?? []).find((x) => x.className === className) ?? null
}

/** 依武器種類查武器科研加成。查不到回 `null`（表內只有 5 種，多數武器沒有）。 */
export function findWeaponResearch(
  gr: Pick<GlobalResearch, 'weaponResearchByType'> | null | undefined,
  weaponKind: string | null | undefined,
): WeaponTypeResearchBonus | null {
  if (!weaponKind) return null
  return (gr?.weaponResearchByType ?? []).find((x) => x.weaponType === weaponKind) ?? null
}
