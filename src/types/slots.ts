// ─── 槽位模型（PLAN-052-A Phase B / B-1，吞下 PLAN-047 決策一）─────────────────
//
// 全站唯一的「一格裝備位」詞彙。存在的理由：機甲側過去說不出「我有幾個槽、哪個槽被佔住」——
// 武器說得出自己的限制（`Weapon.equipSlot` / `Weapon.mechRestriction`），但反方向完全空白。
//
// ⚠ **不另造第四套部位詞彙**（PLAN-047 決策一）。全站已經有三套：
//   `WeaponEquipSlot`（武器）／`Module.boundPart`（模組）／`Backpack.slot`（背包）。
//   本檔的 `slot` 直接**沿用** `WeaponEquipSlot`，靠共用同一個 enum，D-3 的校驗腳本才寫得出
//   「mount.slot 必須等於該武器的 equipSlot」這條規則 —— 那是共用型別最直接的回報。
//
// `SlotBank` 是唯一的新維度，且與 `slot` **正交**（不是第四套部位詞彙）：
//   同一個「左手」在主手組與備用組各有一格，兩者不同時上場（見 loadoutWeight 的取較重組）。

import type { WeaponEquipSlot } from './enums'

/** 左右。單手與肩部才有側別；雙手（佔滿雙臂）與背部沒有。 */
export type SlotSide = 'left' | 'right'

/**
 * 武器組。`backup` 由**背包**給（`type === 'BackupEquipment'`，
 * 全庫 181 筆背包僅 `backpacks/60101706` 強襲者背包一筆），**不是形態的能力**
 * ——2026-08-09 實機實測，見 `MechForm.restrict` 的型別註解。
 */
export type SlotBank = 'main' | 'backup'

export const SLOT_BANKS: readonly SlotBank[] = ['main', 'backup'] as const

/**
 * 一件「焊死在某處」的武裝：機甲部件的固定武裝、或機師形態鎖死的武裝。
 *
 * ⚠ **硬不變式**：`mount.slot === weapons[mount.weaponId].equipSlot`，允許 0 例外。
 *   由 `scripts/validate-mech-slots.mjs`（D-3）全庫校驗。兩邊不一致代表資料錯，不是彈性。
 *
 * ⚠ 用**陣列**承載而不是選填 scalar：`stripUndefined`（firestoreCore.ts）會把取消勾選寫的
 *   `undefined` 整個濾掉，導致「一旦填了值就再也無法取消」——PLAN-040 決策六踩過的坑，
 *   被凍結的 `Mech.leftShoulderSlot` 就是那個受害者。
 */
export interface ArmamentMount {
  weaponId: string
  slot: WeaponEquipSlot
  /** 單手／肩部必填；雙手與背部不得填（D-3 校驗） */
  side?: SlotSide
}

/** 指向某一格的座標。`slot` 沿用 WeaponEquipSlot，`bank` 是正交的第二軸。 */
export interface SlotRef {
  bank: SlotBank
  slot: WeaponEquipSlot
  side?: SlotSide
}

declare const SLOT_KEY_BRAND: unique symbol
/**
 * 槽位的字串鍵，格式 `bank:slot:side`（如 `main:singleHand:left`／`main:dualHand`）。
 *
 * ⚠ **禁止手寫字面量**：它是字串，打錯 tsc 不會擋。故加上品牌型別——
 *   手寫的 `'main:singleHand:left'` **不可**指派給 `SlotKey`，只有 `slotKey()` 的回傳值可以。
 *   這是本型別存在的全部理由，不要為了圖方便把它退回成 `string`。
 *
 * ⚠ **`bank` 這一段不可省**：少了它，主手左手與備用左手會撞成同一個鍵，
 *   兩把武器掛的元件會互相覆蓋（而且是靜默的）。
 */
export type SlotKey = string & { readonly [SLOT_KEY_BRAND]: true }

/**
 * 一台機甲（含背包貢獻）各類槽位的格數。
 *
 * `backupHand` 與其餘三者不同層 —— 它是 bank 而非 slot，放在同一個介面是因為
 * UI 要的就是「這台總共有幾格可填」這一個答案。由 `mechSlotCapacity()` 產出時恆為 0，
 * 加上背包後才可能是 2（見 `loadoutSlotCapacity()`）。
 */
export interface SlotCapacity {
  singleHand: number
  shoulder: number
  back: number
  backupHand: number
}

/**
 * 該槽位是否有左右之分。
 * 單手／肩部有（各兩格），雙手（同時佔據左右臂）與背部沒有。
 */
export function slotAcceptsSide(slot: WeaponEquipSlot): boolean {
  return slot === 'singleHand' || slot === 'shoulder'
}

/**
 * 產生槽位鍵。**全站取得 SlotKey 的唯一入口**（React key、元件掛載表、分享碼皆走它）。
 *
 * 不做正確性校驗（side 該不該有由 D-3 的校驗腳本負責），只保證與 `parseSlotKey()`
 * 互為反函式：`parseSlotKey(slotKey(ref))` 恆等於 `ref` 的正規形。
 */
export function slotKey(ref: SlotRef): SlotKey {
  return (ref.side ? `${ref.bank}:${ref.slot}:${ref.side}` : `${ref.bank}:${ref.slot}`) as SlotKey
}

/**
 * `slotKey()` 的反函式。格式不合（段數不對／bank 不認得／side 不是 left|right）一律回 `null`——
 * 分享碼與 URL 參數會把外部字串餵進來，優雅降級勝過拋例外。
 *
 * ⚠ 不校驗 `slot` 是否為合法的 `WeaponEquipSlot` 值：那份 enum 會隨遊戲改版增值，
 *   在這裡擋下來只會讓舊分享碼在新版本靜默失效。合法性由消費端（容量表）自然過濾。
 */
export function parseSlotKey(key: string): SlotRef | null {
  const parts = key.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const [bank, slot, side] = parts
  if (bank !== 'main' && bank !== 'backup') return null
  if (!slot) return null
  if (parts.length === 3) {
    if (side !== 'left' && side !== 'right') return null
    return { bank, slot: slot as WeaponEquipSlot, side }
  }
  return { bank, slot: slot as WeaponEquipSlot }
}
