// 已裝武器攤平成清單（PLAN-052-I D-3）
//
// 「這一套裝了哪幾把武器、各自能放幾個元件」——右欄的武器與元件列、以及未來的匯出長圖
// （052-I E-2）都問這一支。
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
import type { SlotKey, SlotRef } from '../types/slots.ts'
import { slotKey } from '../types/slots.ts'
import { enumerateSlots, slotLabel } from './mechSlots.ts'
import { WeaponEquipSlot } from '../types/enums.ts'
import { slotExists } from './loadoutRules.ts'
import { slotOccupant, type LoadoutContext } from './loadoutRules.ts'

/** 一列。`rowKey` 取自**佔用者自己的 ref**，於是雙手武器橫跨兩格也只出現一次。 */
export interface WeaponRow {
  rowKey: SlotKey
  /** 這把武器自己的座標（雙手武器 ＝ `dualHand`，不是它蓋住的兩格之一） */
  ref: SlotRef
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
    let own: SlotRef
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

// ─── 匯出長圖的完整槽位表（PLAN-052-I E-2）──────────────────────────────────
//
// 與 `weaponRows()` 的差別是**空槽與無槽也要出現**：匯出圖是印刷品，看的人沒辦法
// 點開來確認「是沒裝，還是這台根本沒有這一格」。表上少一列，讀者只會得出
// 「這張圖漏了」而不是「這一格不存在」。
//
// ⚠ 「整排不存在」只寫一列（沿用 LoadoutRig B-2 的裁決）：沒有肩槽時畫成左右兩格一樣的
//   「沒有肩槽」，等於把同一句話說兩遍。備用槽同理。

export type SheetRowState = 'weapon' | 'backpack' | 'fixed' | 'formLocked' | 'empty' | 'absent'

export interface SheetRow {
  key: string
  /** 部位名。整排不存在時是「肩部」／「備用槽」這種群組名，不是「左肩」 */
  label: string
  state: SheetRowState
  /** 裝備名；空槽與無槽為 null */
  name: string | null
  /** 這一列要多講的一句（無槽原因／不可更換的來源／背包解鎖了什麼） */
  note: string | null
  /** 「類型」欄。無槽與空槽印「—」 */
  typeLabel: string
  /** 重量；空槽與無槽為 null（不是 0 —— 0 是「這件裝備真的不佔重量」，見固定武裝） */
  weight: number | null
  /** 掛在這把武器上的元件 doc id（觸在前、應在後） */
  componentIds: string[]
  /**
   * 同一批元件的顯示名（PLAN-052-D D-2）。匯出圖印的是這一份。
   *
   * ⚠ 在**這裡**解析而不是讓匯出卡自己查：`SheetLine` 只拿得到一列，
   *   要它查名字就得把整個 `ctx` 傳進每一列 —— 而那一層是純呈現，
   *   不該認得 `LoadoutWorld`。查無時退回 doc id，讓斷鏈在圖上看得見。
   */
  componentNames: string[]
}

const TYPE_LABEL: Record<string, string> = {
  [WeaponEquipSlot.SINGLE_HAND]: '單手',
  [WeaponEquipSlot.DUAL_HAND]: '雙手',
  [WeaponEquipSlot.SHOULDER]: '肩膀',
  [WeaponEquipSlot.BACK]: '背後',
}

/** 匯出圖用：所有**可能**的槽位各一列（存在的照狀態、不存在的整排一列）。 */
export function loadoutSheetRows(ctx: LoadoutContext): SheetRow[] {
  const out: SheetRow[] = []
  const cap = ctx.capacity

  const push = (ref: SlotRef, labelOverride?: string) => {
    const occ = slotOccupant(ctx, ref)
    const label = labelOverride ?? slotLabel(ref)
    const key = slotKey(ref)
    switch (occ.kind) {
      case 'weapon': {
        const mountedIds = [
          ...(occ.mount.setup?.triggerComponentIds ?? []),
          ...(occ.mount.setup?.effectComponentIds ?? []),
        ]
        out.push({
          key, label, state: 'weapon',
          name: occ.weapon?.name ?? occ.mount.weaponId,
          note: null,
          typeLabel: TYPE_LABEL[occ.mount.slot] ?? '—',
          weight: occ.weapon?.weight ?? null,
          componentIds: mountedIds,
          componentNames: mountedIds.map((id) => ctx.world.components.get(id)?.name ?? id),
        })
        break
      }
      case 'fixed':
        out.push({
          key, label, state: 'fixed',
          name: occ.weapon?.name ?? occ.occupied.mount.weaponId,
          note: '機甲固定武裝',
          typeLabel: TYPE_LABEL[occ.occupied.mount.slot] ?? '—',
          // ⚠ 固定武裝的 weight 常態是 0（純封鎖型），那是真的 0 不是「沒有值」
          weight: occ.weapon?.weight ?? null,
          componentIds: [], componentNames: [],
        })
        break
      case 'formLocked':
        out.push({
          key, label, state: 'formLocked',
          name: occ.weapon?.name ?? occ.weaponId,
          note: `${ctx.form?.name ?? '形態'}鎖定`,
          typeLabel: TYPE_LABEL[occ.ref.slot] ?? '—',
          weight: occ.weapon?.weight ?? null,
          componentIds: [], componentNames: [],
        })
        break
      case 'backpack':
        out.push({
          key, label, state: 'backpack',
          name: occ.backpack.name,
          note: cap.backupHand > 0 ? '解鎖備用武器槽' : null,
          typeLabel: '背包',
          weight: occ.backpack.weight,
          componentIds: [], componentNames: [],
        })
        break
      default:
        out.push({ key, label, state: 'empty', name: null, note: null, typeLabel: '—', weight: null, componentIds: [], componentNames: [] })
    }
  }

  const absent = (key: string, label: string, note: string) =>
    out.push({ key, label, state: 'absent', name: null, note, typeLabel: '—', weight: null, componentIds: [], componentNames: [] })

  // ── 手部：雙手武器佔滿兩格 → 只印一列 ──
  const dualMounted = ctx.set.mounts.some((m) => m.bank === 'main' && m.slot === WeaponEquipSlot.DUAL_HAND)
  const dualLocked = !!ctx.lock?.mounts?.some((m) => m.slot === WeaponEquipSlot.DUAL_HAND)
  if (dualMounted || dualLocked) {
    push({ bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }, '雙手')
  } else {
    push({ bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' })
    push({ bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' })
  }

  // ── 肩部：整排不存在時只寫一列 ──
  if (cap.shoulder <= 0) {
    absent('main:shoulder:none', '肩部', '肩部槽位只有中甲機甲才有')
  } else {
    for (const side of ['left', 'right'] as const) {
      const ref: SlotRef = { bank: 'main', slot: WeaponEquipSlot.SHOULDER, side }
      if (slotExists(cap, ref)) push(ref)
      else absent(slotKey(ref), slotLabel(ref), '此機甲沒有這一格')
    }
  }

  // ── 背部（背包與背部武器共用） ──
  const backRef: SlotRef = { bank: 'main', slot: WeaponEquipSlot.BACK }
  if (slotExists(cap, backRef)) push(backRef)
  else absent(slotKey(backRef), '背部', '此機甲沒有背部槽')

  // ── 備用組：由強襲者背包解鎖，沒解鎖時整排不存在 ──
  if (cap.backupHand <= 0) {
    absent('backup:none', '備用槽', '未裝強襲者背包 → 沒有備用武器槽')
  } else {
    for (const side of ['left', 'right'] as const) {
      push({ bank: 'backup', slot: WeaponEquipSlot.SINGLE_HAND, side })
    }
  }

  return out
}
