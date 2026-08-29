// 已裝武器／已裝模組攤平成清單（PLAN-052-I D-3、PLAN-052-L E-1）
//
// 「這一套裝了哪幾把武器、各自能放幾個元件」——右欄的武器與元件列、
// 以及匯出長圖的「武器與元件」明細帶（PLAN-052-L B-5）都問這一支。
//
// 「四個接口上各裝了什麼、那一族現在幾級、該級的官方敘述是什麼」——匯出長圖的
// 「模組效果」帶與**純文字摘要**（E-1）都問 `moduleRows()`。
// ⚠ 模組那一組是 E-1 從 `LoadoutExportCard` 的 `ModuleBand` **原樣抽出來**的：
//   摘要與圖必須列出同一批模組、同一個等級、同一段敘述，而各留一份的漂移症狀是
//   「圖上寫 Lv4、複製出來的文字寫 Lv2」—— 兩邊都不會報錯。
//
// ⚠ **不要直接 map `ctx.set.mounts`**：那份清單少了機甲固定武裝（`ctx.occupied`）與
//   全鎖形態的武裝（`ctx.lock`），而那兩種**一樣佔槽、一樣吃元件、一樣計入總重**。
//   漏掉它們的症狀是靜默的：畫面上少一列，而少的那一列正好是玩家改不了、也因此
//   最想確認自己有沒有看漏的那一把。
//
// ⚠ 順序一律走 `enumerateSlots()`，不是玩家的裝備順序 —— 右邊的清單要和左邊的槽位圖
//   對得起來，否則兩份東西講同一件事卻排不成同一個順序。
//
// 純函式、無 React 依賴，可單測（npm test）。

import type { Weapon } from '../types/index.ts'
import type { MechPartPosition } from '../types/enums.ts'
import type { SlotKey, WeaponSlotRef } from '../types/slots.ts'
import { slotKey } from '../types/slots.ts'
import { enumerateSlots, slotLabel } from './mechSlots.ts'
import { mountedComponentIds, slotOccupant, weaponSiteAt, type LoadoutContext } from './loadoutRules.ts'
import { MECH_PART_ORDER } from './chassisStats.ts'
import { partLabel } from './moduleSlots.ts'
import { interfaceState, moduleFamilyKey, moduleLevelAt, type ModuleStack } from './moduleRules.ts'

/** 一列。`rowKey` 取自**佔用者自己的 ref**，於是雙手武器橫跨兩格也只出現一次。 */
export interface WeaponRow {
  rowKey: SlotKey
  /** 這把武器自己的座標（雙手武器 ＝ `dualHand`，不是它蓋住的兩格之一） */
  ref: WeaponSlotRef
  label: string
  /** 查無資料時為 null —— 呼叫端要能畫出「斷鏈」而不是靜默留白 */
  weapon: Weapon | null
  /** 顯示名。武器查無時退回 doc id，讓斷鏈被看見 */
  name: string
  weight: number
  /**
   * 不可更換的來源：機甲部件焊死的 / 全鎖形態的。
   *
   * ⚠ 兩者都**不可裝元件**（PLAN-052-D 計畫書決策四）：全部 8 筆固定武裝
   *   （衝擊炮／嵐質儲能艙／多功能彈倉／耀星／隕星／千星／幽弧／夜燼）的
   *   `componentLimit` 實測皆為 0，雖然它們都是 S 品質而 S 的標準值是 3。
   *   本欄位在 052-I 建立時註記「兩者都仍可換元件」，那是當時的假設，已被盤點推翻。
   *   程式上不需要為此加任何判斷 —— 照讀 `componentLimit` 就自動正確。
   */
  locked: 'fixed' | 'form' | null
  /** 已裝元件數（觸 ＋ 應）。052-D Phase C 起是實數 */
  used: number
  /** 觸 ＋ 應的**合計**上限（SS／S+ = 4、S = 3、其餘 0）。不是觸 3 加應 3 的 6 */
  limit: number
}

export function weaponRows(ctx: LoadoutContext): WeaponRow[] {
  const seen = new Set<SlotKey>()
  const out: WeaponRow[] = []

  for (const ref of enumerateSlots(ctx.capacity)) {
    const occ = slotOccupant(ctx, ref)
    let own: WeaponSlotRef
    let weapon: Weapon | null
    let fallbackId: string
    let locked: WeaponRow['locked']

    switch (occ.kind) {
      case 'weapon':
        own = { bank: occ.mount.bank, slot: occ.mount.slot, side: occ.mount.side }
        weapon = occ.weapon
        fallbackId = occ.mount.weaponId
        locked = null
        break
      case 'fixed':
        own = occ.occupied.ref
        weapon = occ.weapon
        fallbackId = occ.occupied.mount.weaponId
        locked = 'fixed'
        break
      case 'formLocked':
        own = occ.ref
        weapon = occ.weapon
        fallbackId = occ.weaponId
        locked = 'form'
        break
      default:
        // empty / backpack —— 背包沒有 componentLimit，列進來只會讓「元件 n / N」的分母失去意義
        continue
    }

    const rowKey = slotKey(own)
    if (seen.has(rowKey)) continue   // 雙手武器橫跨兩格 → 只留一列
    seen.add(rowKey)

    const setup = occ.kind === 'weapon' ? occ.mount.setup : undefined
    out.push({
      rowKey,
      ref: own,
      label: slotLabel(own),
      weapon,
      name: weapon?.name ?? fallbackId,
      weight: weapon?.weight ?? 0,
      locked,
      used: (setup?.triggerComponentIds?.length ?? 0) + (setup?.effectComponentIds?.length ?? 0),
      limit: weapon?.componentLimit ?? 0,
    })
  }
  return out
}

/**
 * 這一列武器上掛的元件**顯示名**（觸在前、應在後）。
 *
 * ⚠ 在這裡解析而不是讓呼叫端各查一次：右欄的武器列與匯出圖的明細帶要的是同一份名字，
 *   兩邊各寫一份的下場是同一顆元件在一處叫本名、另一處叫 doc id。
 *   查無時**退回 doc id**，讓斷鏈看得見 —— 匯出圖是印刷品，看的人沒辦法點開來對帳。
 *
 * 收的是 `ref` 而不是整列：呼叫端手上不見得有 `WeaponRow`（挑選器只有座標）。
 */
export function slotComponentNames(ctx: LoadoutContext, ref: WeaponSlotRef): string[] {
  const { trigger, effect } = mountedComponentIds(weaponSiteAt(ctx, ref))
  return [...trigger, ...effect].map((id) => ctx.world.components.get(id)?.name ?? id)
}

// ─── 模組：四個接口攤平成清單（PLAN-052-L E-1，自 `ModuleBand` 抽出）──────────

/** 一格接口上的模組。**不可用的接口（無／不明）不進來**，見 `moduleRows()`。 */
export interface ModuleRow {
  position: MechPartPosition
  /** 部位顯示名（軀幹／左臂…） */
  label: string
  /** 顯示名。有 id 卻查不到模組 ＝ 資料斷鏈，退回 doc id 讓它被看見，不靜默消失 */
  name: string
  /** 縮圖路徑。⚠ 缺圖的 4 顆（凌嘯框架／滅卻模組／獵群模組／異步感應器）為 null */
  icon: string | null
  /** 這一族的堆疊結果（含天生貢獻）。資料斷鏈時為 null */
  stack: ModuleStack | null
  /** 這一族在前面的部位已經印過了 ⇒ 只標「同族疊加」，不重印一次敘述 */
  dup: boolean
  /** 該族**目前等級**那一階的官方敘述。`dup` 或查無資料時為空字串 */
  description: string
}

/**
 * 四個接口上各裝了什麼。順序固定走 `MECH_PART_ORDER`。
 *
 * ⚠ **同族只算一次**（PLAN-052-G C-7）：同一顆模組裝兩格是升它的等級、不是兩份效果。
 *   逐格印敘述會讓四顆刀劍模組Ⅱ 看起來像四倍加成 —— 第二格起因此只回 `dup: true`。
 *
 * ⚠ 等級一律取自 `ctx.stacks`（含天生貢獻，PLAN-052-K D-1），**不要在呼叫端自己再算
 *   一次 `moduleStacks()`**：圖上的 Lv 與畫面上的 Lv 對不起來是最難查的一種錯。
 *
 * ⚠ 敘述取**該族目前等級**那一階（不是滿階），與螢幕版 `EquippedEffects` 同一個來源。
 *   ⚠ 也**不要退回 `statText()` 那種攤平數值**（PLAN-052-L A-3）：候選池 186 顆有 119 顆
 *     滿級數值欄全為 0 ⇒ 三分之二的模組只剩一個名字；而且它會省略觸發條件卻看起來像
 *     完整答案（猛擊裝置攤平成「格鬥傷害+15%」，官方敘述是「有 70% 的概率發動」）。
 *
 * ⚠ 接口型別**不印**（A-2，團隊逐字：「不需要解釋接口類型」），但仍決定這一格要不要
 *   進清單 —— 只拿掉顯示、不拿掉計算。
 */
export function moduleRows(ctx: LoadoutContext): ModuleRow[] {
  const { chassis } = ctx
  if (!ctx.mech || !chassis) return []

  const seen = new Set<string>()
  const out: ModuleRow[] = []

  for (const pos of MECH_PART_ORDER) {
    const id = ctx.modules[pos]
    if (!id) continue
    const iface = interfaceState(chassis.moduleSlots[pos].iface)
    if (iface === 'none' || iface === 'unknown') continue

    const mod = ctx.world.modules.get(id) ?? null
    const stack = mod ? ctx.stacks.get(moduleFamilyKey(mod)) ?? null : null
    const key = mod ? moduleFamilyKey(mod) : ''
    const dup = !!mod && seen.has(key)
    if (mod) seen.add(key)

    out.push({
      position: pos,
      label: partLabel(pos),
      name: mod?.name ?? id,
      icon: mod?.icon ?? null,
      stack,
      dup,
      description: mod && !dup && stack
        ? moduleLevelAt(stack.mod, stack.level)?.description || stack.mod.description || ''
        : '',
    })
  }
  return out
}

/**
 * 裝超過上限、**多出來的級數不生效**的那幾族（PLAN-052-L A-4）。玩家會照著調配置，
 * 所以圖上與文字摘要都必留。
 *
 * ⚠ `positions.length > 0` 不可省：`ctx.stacks` 同時含**天生模組**（PLAN-052-K D-1，
 *   兩者共用同一個等級池），而天生模組一格接口都沒佔。少了這個條件，會印出
 *   「裝了 0 顆、合計 8 級」這種話。
 */
export function wastedModuleStacks(ctx: LoadoutContext): ModuleStack[] {
  return [...ctx.stacks.values()].filter((st) => st.overflow > 0 && st.positions.length > 0)
}
