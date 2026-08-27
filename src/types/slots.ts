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

import { MechPartPosition } from './enums.ts'
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

/**
 * 指向某一**武器格**的座標。`slot` 沿用 WeaponEquipSlot，`bank` 是正交的第二軸。
 *
 * ⚠ `kind` **選填且恆為 `'weapon'`**（PLAN-052-G A-2）。刻意不設成必填：全站 70 餘處
 *   都在寫 `{ bank: 'main', slot: … }` 這種字面量，逼它們補一個永遠一樣的欄位只有噪音，
 *   而聯集仍然收斂得了 —— `ref.kind === 'module'` narrow 得出 `ModuleSlotRef`，
 *   `else` 就是這一支。**正規形不帶 `kind`**（見 `slotKey()` / `parseSlotKey()`）。
 */
export interface WeaponSlotRef {
  kind?: 'weapon'
  bank: SlotBank
  slot: WeaponEquipSlot
  side?: SlotSide
}

/**
 * 指向某一個**模組接口**的座標（PLAN-052-G A-2，兌現總綱決策十二）。
 *
 * ⚠ **不是 `WeaponEquipSlot`，也不另造第四套部位詞彙**：接口掛在機甲部位上，
 *   而部位詞彙全站早有 `MechPartPosition`（`ResolvedChassis.parts` / `moduleSlots`
 *   / `LoadoutDraft.modules` 用的都是它）。這裡直接沿用，理由與檔頭那條一致。
 *
 * ⚠ **沒有 `bank`**：模組掛在機甲上、不隨主手／備用組切換，也不隨形態變動
 *   （與 `ndLevels` 同理，見 `LoadoutDraft.modules`）。硬塞一個恆為 `main` 的欄位，
 *   只會讓「換備用組時模組會不會掉」變成一個要有人回答的假問題。
 */
export interface ModuleSlotRef {
  kind: 'module'
  position: MechPartPosition
}

/**
 * 「指向某一格」的統一座標。
 *
 * 擴成聯集的理由不是型別漂亮，是**同型級聯**（PLAN-052-G 決策五）：
 * 換機甲 → 部位換掉 → 模組掉落；換武器 → 元件掉落。分兩套模型就會長出第二、
 * 第三支 `reconcile()`，而「同一件事在三處各寫一次」正是舊 SimulatorPage
 * 三個 bug 的共同病根（見 `loadoutRules.ts` 檔頭）。
 *
 * ⚠ 元件**不在**這個聯集裡：元件內嵌在 `mount.setup` 上，沒有旁掛表也就沒有 key 可撞，
 *   它的座標就是**它所在那把武器的座標**（`WeaponSlotRef` ＋ componentId）。
 *   052-D 已確認這一層元件用不到，別為了對稱補一個 `'component'` kind。
 */
export type SlotRef = WeaponSlotRef | ModuleSlotRef

/** 這個座標指的是模組接口嗎。narrow 用，避免各處自己寫 `ref.kind === 'module'`。 */
export const isModuleSlotRef = (ref: SlotRef): ref is ModuleSlotRef => ref.kind === 'module'

declare const SLOT_KEY_BRAND: unique symbol
/**
 * 槽位的字串鍵。兩種格式，**依 kind 分流且永不撞號**：
 *   武器 `bank:slot:side`（如 `main:singleHand:left`／`main:dualHand`）
 *   模組 `module:position`（如 `module:torso`）
 *
 * ⚠ **武器側的字面格式一個字都不能動**（PLAN-052-G A-2）：分享碼與本機書架裡
 *   已經存著這些鍵，改格式等於讓既存存檔靜默失效。模組走自己的前綴，
 *   而 `module` 不可能與 `bank` 撞（`SLOT_BANKS` 只有 main／backup 兩個值）。
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
 *
 * ⚠ **武器側的正規形不帶 `kind`**（那個欄位選填、且只有一個可能值）；模組側必帶。
 *   這條不變式對兩種 kind 都成立，由 `slotKey.test.ts` 的 round-trip 釘住。
 */
export function slotKey(ref: SlotRef): SlotKey {
  if (isModuleSlotRef(ref)) return `module:${ref.position}` as SlotKey
  return (ref.side ? `${ref.bank}:${ref.slot}:${ref.side}` : `${ref.bank}:${ref.slot}`) as SlotKey
}

/**
 * 模組接口的四個部位。取自 `MechPartPosition` 本身而不是另抄一份陣列 ——
 * 抄一份的代價是官方哪天多一個部位時，這裡會靜默少收一格。
 */
const MODULE_POSITIONS: readonly string[] = Object.values(MechPartPosition)

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
  // ── 模組：`module:position` ──
  //    ⚠ 這裡**校驗** position 值域，與下面武器側的「不校驗 slot」不同調，而那是刻意的：
  //      模組鍵**不進分享碼**（codec 的 §MODULES 存的是 position→shareId 的映射，不是這個字串），
  //      所以沒有「舊碼在新版本失效」的問題；而部位是封閉的四格，認不得就是打錯了。
  if (bank === 'module') {
    if (parts.length !== 2 || !MODULE_POSITIONS.includes(slot)) return null
    return { kind: 'module', position: slot as MechPartPosition }
  }
  if (bank !== 'main' && bank !== 'backup') return null
  if (!slot) return null
  if (parts.length === 3) {
    if (side !== 'left' && side !== 'right') return null
    return { bank, slot: slot as WeaponEquipSlot, side }
  }
  return { bank, slot: slot as WeaponEquipSlot }
}
