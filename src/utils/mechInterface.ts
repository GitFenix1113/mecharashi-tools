// 機甲模組接口的規則 —— 2026-08-27
//
// ── 一句話 ──────────────────────────────────────────────────────────────────
// **接口型別不是機甲的固定屬性，是「品質階級 × 部位」的函式。**
//
// ── 依據 ────────────────────────────────────────────────────────────────────
// 官方 API（`aircraft_data/detail`）的每一格同時有兩個值：
//   `rawPart.Interface`        基礎階
//   `rawPart.manji.Interface`  滿品質階   ← 爬蟲取的是這個（scrape-mechs.js:454）
// 83 台 × 4 部位 ＝ 332 格，逐格轉換零例外：
//
//   quality   基礎階        滿品質階       台數
//   ───────────────────────────────────────────
//   S         Ⅰ Ⅰ Ⅰ Ⅰ     Ⅱ Ⅱ Ⅱ Ⅱ      57
//   A         ·  ·  ·  ·    Ⅰ Ⅱ Ⅱ Ⅰ      16
//   B         ·  ·  ·  ·    ·  ·  ·  ·     10
//
// `armorType` 完全不影響（輕型／中甲／重型在同一 quality 下 pattern 相同，已交叉驗證）。
// 站上一律存**滿品質階**，與全站「數值以滿級／滿品質階計算」的口徑一致。
//
// ── 為什麼是「守門」而不是「取代資料」─────────────────────────────────────
// 這條規則是**今天 83 台的觀察**，不是官方保證。若改成完全由 quality derive、
// 不存 `MechPart.interface`，官方哪天出一台破格的機甲時，公式會**靜默給出錯的答案**
// 而且無處可修。所以：**資料仍是真相源**，本檔只提供「應該是什麼」，
// 由 CI 守門測試（mechInterface.test.ts）在偏離時**讓它被看見**。
//
// 這正是 2026-08-27 修掉的那個 bug 的教訓：星夜女神四格被打成 Ⅰ 型（原值是
// `ⅠⅠ型接口` ＝ 兩個 U+2160 拼出來的假「Ⅱ」，PLAN-052-A D-1 正規化時收錯了方向），
// 而它是**合法的 enum 值**，所以後台的下拉選單擋不住 —— 能擋住的只有規則層。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import { MechPartPosition, PartInterface } from '../types/enums.ts'

/**
 * 某個品質階級的機甲，在某個部位上，**滿品質階**應有的接口型別。
 *
 * 回 `''` ＝ **這台機甲沒有模組接口**（B 品質，官方基礎階與滿階皆空，已佐證）。
 * 回 `null` ＝ 這個 `quality` 我們沒有規則 —— 呼叫端應**跳過**而不是當成「沒有接口」，
 * 那是「不知道」與「沒有」的差別（官方新增品質階時會走到這條路）。
 */
export function expectedInterface(
  quality: string,
  position: MechPartPosition,
): PartInterface | '' | null {
  switch (quality) {
    case 'S':
      return PartInterface.TYPE_II
    case 'A':
      // 軀幹與腿部是 Ⅰ 型、雙臂是 Ⅱ 型（16 台 A 級機甲清一色 Ⅰ／Ⅱ／Ⅱ／Ⅰ）
      return position === MechPartPosition.TORSO || position === MechPartPosition.LEGS
        ? PartInterface.TYPE_I
        : PartInterface.TYPE_II
    case 'B':
      return ''
    default:
      return null
  }
}

/**
 * 這個品質階級的機甲有沒有模組接口。
 *
 * ⚠ **空字串的唯一語意是「這台沒有接口」**（2026-08-27 起）。在那之前它還兼任
 *   「接口資料未建檔」——美杜莎MK2 那 4 格——而兩義共用一個值，只有 `quality` 分得開。
 *   該筆已依 S 級規則補上 Ⅱ 型，於是 44 格空字串收斂成 40 格、全部屬於 B 品質。
 *   **不要再把空字串渲染成「未建檔」**，那句話今天已經不對了。
 */
export const hasModuleInterface = (quality: string): boolean =>
  expectedInterface(quality, MechPartPosition.TORSO) !== ''

/** 一台機甲四個部位的接口，依規則推導。`null` ＝ 沒有這個 quality 的規則。 */
export function expectedInterfaces(
  quality: string,
): Record<MechPartPosition, PartInterface | ''> | null {
  if (expectedInterface(quality, MechPartPosition.TORSO) === null) return null
  return {
    [MechPartPosition.TORSO]: expectedInterface(quality, MechPartPosition.TORSO) as PartInterface | '',
    [MechPartPosition.LEFT_ARM]: expectedInterface(quality, MechPartPosition.LEFT_ARM) as PartInterface | '',
    [MechPartPosition.RIGHT_ARM]: expectedInterface(quality, MechPartPosition.RIGHT_ARM) as PartInterface | '',
    [MechPartPosition.LEGS]: expectedInterface(quality, MechPartPosition.LEGS) as PartInterface | '',
  }
}

/**
 * 這一格的值是否偏離規則。用於後台的偏離提示與 CI 守門。
 *
 * 沒有規則（未知 quality）時一律回 `false` —— 我們不知道，就不該說它錯。
 */
export function isInterfaceOffRule(
  quality: string,
  position: MechPartPosition,
  actual: string | undefined,
): boolean {
  const want = expectedInterface(quality, position)
  return want !== null && (actual ?? '') !== want
}
