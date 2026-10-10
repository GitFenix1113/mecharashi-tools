// 槽位真相入口 —— PLAN-052-A Phase B / B-2（吞下 PLAN-047 Phase A）
//
// 「這台機甲有幾格、哪一格被佔住、整套是不是被鎖死」——全站只由本檔回答。
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type { ArmamentMount, SlotCapacity, SlotKey, WeaponSlotRef, SlotSide } from '../types'
import type { MechForm } from '../types'
import { slotKey, slotAcceptsSide } from '../types/slots.ts'
import { ArmorType, MechPartPosition, BackpackType, WeaponEquipSlot } from '../types/enums.ts'

/**
 * 全庫唯一給備用武器槽的背包（`type === 'BackupEquipment'`，181 筆背包中僅此一筆）。
 * 判定一律用 `type` 而不是這個 id —— 常數只是給註解與測試指名道姓用。
 */
export const BACKUP_EQUIPMENT_BACKPACK_ID = '60101706'   // 強襲者背包

/** 強襲者背包給的備用格數：左手備用 ＋ 右手備用（官方整備截圖，見 MechForm.restrict 註解）。 */
export const BACKUP_HAND_SLOTS = 2

/** 機甲本身的槽位容量（**不含**背包貢獻）。 */
export function mechSlotCapacity(mech: { armorType: string } | null | undefined): SlotCapacity {
  return {
    // 雙臂各一格。裝雙手武器時同時佔滿兩格 —— 那是佔用規則，不是容量差異
    singleHand: 2,
    // ⚠ 條件一律寫 ArmorType.MEDIUM，**禁止中文字面量**：
    //   SimulatorPage.tsx 的 '中甲' 就是打錯字面量而 tsc 抓不到的現成教訓。
    //   實測 90/90 無例外：25 把肩部武器 100% mechRestriction='medium'，
    //   三台有肩部固定武裝的宿主機甲（帕斯卡／破曉者-01／霸王）也全是中甲。
    shoulder: mech?.armorType === ArmorType.MEDIUM ? 2 : 0,
    // ⚠ 背槽**全機種都有**。背部「武器」22 把雖然 100% 限中甲，但背槽同時是背包的位置，
    //   給 0 會讓 35 個「僅輕型可裝」的背包永遠無處可裝。
    //   槽存不存在（本檔）與武器裝不裝得上（Weapon.mechRestriction）是兩件事。
    back: 1,
    // 機甲自己不提供備用槽，由背包給 —— 見 loadoutSlotCapacity()
    backupHand: 0,
  }
}

/** 背包提供的備用手格數；非 BackupEquipment 一律 0。 */
export function backpackBackupHandSlots(
  backpack: { type?: string } | null | undefined,
): number {
  return backpack?.type === BackpackType.BACKUP_EQUIPMENT ? BACKUP_HAND_SLOTS : 0
}

/**
 * 一套配裝的實際容量 ＝ 機甲容量 ＋ 背包貢獻。
 *
 * ⚠ 背包同時**佔掉背槽**又**給出備用格**。這裡只算容量，背槽被誰佔用是呼叫端的事
 *   （背包與背部武器互斥，見 `LoadoutWeightSet.back` 只有一格）。
 */
export function loadoutSlotCapacity(
  mech: { armorType: string } | null | undefined,
  backpack?: { type?: string } | null,
): SlotCapacity {
  return { ...mechSlotCapacity(mech), backupHand: backpackBackupHandSlots(backpack) }
}

/**
 * 把容量表展開成 UI 要逐格渲染的座標清單（固定順序，可直接 map）。
 *
 * ⚠ 刻意**不**列出 `dualHand`：雙手武器佔的是兩格 singleHand，不是第三格手部。
 *   把它也列成一格，畫面上會多出一個永遠不該存在的空位。
 */
export function enumerateSlots(capacity: SlotCapacity): WeaponSlotRef[] {
  const out: WeaponSlotRef[] = []
  const sides: SlotSide[] = ['left', 'right']
  for (let i = 0; i < capacity.singleHand; i++) {
    out.push({ bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: sides[i] })
  }
  for (let i = 0; i < capacity.shoulder; i++) {
    out.push({ bank: 'main', slot: WeaponEquipSlot.SHOULDER, side: sides[i] })
  }
  for (let i = 0; i < capacity.back; i++) out.push({ bank: 'main', slot: WeaponEquipSlot.BACK })
  for (let i = 0; i < capacity.backupHand; i++) {
    out.push({ bank: 'backup', slot: WeaponEquipSlot.SINGLE_HAND, side: sides[i] })
  }
  return out
}

// ─── 佔據型（機甲部件層）─────────────────────────────────────────────────────

/** 某一格被固定武裝佔住的事實。`sourcePart` 讓 UI 講得出「這是右臂帶來的」。 */
export interface OccupiedSlot {
  ref: WeaponSlotRef
  mount: ArmamentMount
  sourcePart: MechPartPosition
}

/** 手臂 → 肩膀的側別映射：左臂帶左肩、右臂帶右肩（肩槽附屬於手臂，非正交）。 */
const ARM_SIDE: Partial<Record<MechPartPosition, SlotSide>> = {
  [MechPartPosition.LEFT_ARM]: 'left',
  [MechPartPosition.RIGHT_ARM]: 'right',
}

type PartWithArmament = { fixedArmament?: readonly ArmamentMount[] } | number | null | undefined

/**
 * **佔據型**：機甲部件焊死的固定武裝佔住了哪幾格（帕斯卡衝擊炮 ×2、破曉者-01 嵐質儲能艙 ×2、
 * 霸王多功能彈倉）。只擋那幾格，其餘照常可換。
 *
 * ⚠ 與 `lockedSlots()` **禁止合併成一個函式**（計畫書決策三）：UI 必須講得出
 *   「這格被嵐質儲能艙佔住」與「這個形態不能換任何裝備」的差別；
 *   且兩者落盤層級不同（機甲資料 vs 形態資料）。
 *
 * ⚠ 回傳 Map 而不是陣列：呼叫端問的永遠是「**這一格**被佔了嗎」，
 *   陣列會逼每一格做一次線性搜尋，而且很容易寫成用 `weaponId` 比對 ——
 *   帕斯卡同一把衝擊炮掛左右兩肩，用 weaponId 當鍵會少一格。
 */
export function occupiedSlots(
  parts: Partial<Record<MechPartPosition, PartWithArmament>> | null | undefined,
): Map<SlotKey, OccupiedSlot> {
  const out = new Map<SlotKey, OccupiedSlot>()
  for (const pos of Object.values(MechPartPosition)) {
    const part = parts?.[pos]
    if (!part || typeof part === 'number') continue
    for (const mount of part.fixedArmament ?? []) {
      // side 未填時由部件位置補：左臂 → 左，右臂 → 右（可程式化的映射，不需額外資料）
      const side = mount.side ?? (slotAcceptsSide(mount.slot) ? ARM_SIDE[pos] : undefined)
      const ref: WeaponSlotRef = side ? { bank: 'main', slot: mount.slot, side } : { bank: 'main', slot: mount.slot }
      out.set(slotKey(ref), { ref, mount, sourcePart: pos })
    }
  }
  return out
}

// ─── 全鎖型（機師形態層）─────────────────────────────────────────────────────

/** 整套配裝被某個形態鎖死的事實。 */
export interface FormSlotLock {
  formId: string
  formName: string
  /** 該形態焊死的武器 id（虛粒子 ＝ 耀星／隕星／千星）。PLAN-041 起就有，恆可用。 */
  weaponIds: readonly string[]
  /**
   * 帶槽位的版本。**C-3 落盤前為 `undefined`** —— 呼叫端要顯示「哪一格」時必須先判空。
   *
   * ⚠ 不要拿 `weaponIds` 去猜槽位補上這個欄位：耀星／隕星在手上、**千星在背部**，
   *   猜一律填 singleHand 會把一件錯的事寫成肯定陳述。沒有就是沒有。
   */
  mounts?: readonly ArmamentMount[]
}

/**
 * **全鎖型**：該形態是否鎖死**整套**配裝。有鎖回 `FormSlotLock`，沒鎖回 `null`。
 *
 * ⚠ 刻意**不回傳槽位清單**，儘管函式叫 lockedSlots。回清單會讓呼叫端誤以為
 *   「只有被 mounts 佔住的那三格被鎖」——2026-08-09 實機實測逐字：
 *   「不只是不能帶背包，虛粒子形態沒辦法調整任何裝備」；截圖中雙肩顯示為空的 `[+]`
 *   但不可用 —— **空槽 ≠ 可填**。鎖的就是「全部」，型別上就不該長得像一份清單。
 *
 * ⚠ 過渡期相容：PLAN-041 落盤的是 `restrict.weaponIds: string[]`（只有 id、**沒有槽位**），
 *   C-3 會升級成 `mounts: ArmamentMount[]`。兩種形狀都吃：`weaponIds` 恆有值，
 *   `mounts` 在升級前是 undefined，**不從 weaponIds 反推槽位**（見 FormSlotLock.mounts）。
 */
export function lockedSlots(form: MechForm | null | undefined): FormSlotLock | null {
  if (!form || form.restrict?.kind !== 'fixedArmament') return null
  const r = form.restrict as { weaponIds?: string[]; mounts?: ArmamentMount[] }
  return {
    formId: form.id,
    formName: form.name,
    weaponIds: r.mounts?.map((m) => m.weaponId) ?? r.weaponIds ?? [],
    mounts: r.mounts,
  }
}

// ─── 反查：這把固定武裝焊在誰身上 ─────────────────────────────────────────────

/**
 * 某把固定武裝的一個宿主：一台機甲、或一個機師形態。
 *
 * `refs` 是這把武器在該宿主上佔的格子（帕斯卡的衝擊炮 ＝ 左肩＋右肩兩格）。
 * ⚠ 形態若還停在 C-3 之前的 `weaponIds` 形狀，`refs` 是**空陣列** —— 不從 weaponIds 反推槽位，
 *   理由同 `FormSlotLock.mounts`（千星在背部，猜一律填手部會把錯的事寫成肯定陳述）。
 */
export type FixedArmamentHost =
  | { kind: 'mech'; id: string; name: string; refs: WeaponSlotRef[] }
  | { kind: 'form'; id: string; name: string; pilotId: string; refs: WeaponSlotRef[] }

/**
 * 反查一把固定武裝的宿主（2026-10-10）。
 *
 * ── 為什麼是反查而不是在武器上存 `boundMechId` ─────────────────────────────
 * 固定武裝與宿主是**一對一**（站長 2026-10-10：造型與故事設定都綁死單台，幾乎不可能共用），
 * 所以「這把屬於誰」從宿主那側一定查得到。兩側都存只會漂移，與官配／登場版本「只存一邊、
 * 另一邊推導」同一個原則。掛載關係留在宿主上還有兩個理由：
 *   · 模擬器混搭部件時，固定武裝**跟著手臂走**（見 loadoutRules.ts 的 `occupied`），
 *     存在武器上就得再記「哪一隻手臂」，繞一圈回到原點；
 *   · 形態武裝（耀星／隕星／千星、幽弧／夜燼）本來就是宿主存掛載，兩邊同一套規則。
 *
 * 一對一由 `scripts/validate-mech-slots.mjs` 的 ⑦ 守著；這支照實回傳**全部**宿主，
 * 不替呼叫端挑一個 —— 真的出現兩個時，畫面該把兩個都列出來，而不是靜默藏掉一個。
 *
 * 機甲側的格子走 `occupiedSlots()`（side 未填時由部件位置補），不另寫一份映射。
 */
export function fixedArmamentHosts(
  weaponId: string,
  mechs: readonly { id: string; name: string; parts?: Parameters<typeof occupiedSlots>[0] }[],
  forms: readonly MechForm[],
): FixedArmamentHost[] {
  const out: FixedArmamentHost[] = []
  for (const mech of mechs) {
    const refs = [...occupiedSlots(mech.parts).values()]
      .filter((o) => o.mount.weaponId === weaponId)
      .map((o) => o.ref)
    if (refs.length) out.push({ kind: 'mech', id: mech.id, name: mech.name, refs })
  }
  for (const form of forms) {
    const lock = lockedSlots(form)
    if (!lock?.weaponIds.includes(weaponId)) continue
    const refs = (lock.mounts ?? [])
      .filter((m) => m.weaponId === weaponId)
      .map((m): WeaponSlotRef => (m.side ? { bank: 'main', slot: m.slot, side: m.side } : { bank: 'main', slot: m.slot }))
    out.push({ kind: 'form', id: form.id, name: form.name, pilotId: form.pilotId, refs })
  }
  return out
}

// ─── 顯示標籤 ───────────────────────────────────────────────────────────────

const SLOT_LABEL: Record<string, string> = {
  singleHand: '手',
  dualHand:   '雙手',
  shoulder:   '肩',
  back:       '背部',
}

const SIDE_LABEL: Record<SlotSide, string> = { left: '左', right: '右' }

/**
 * 槽位的顯示名：`左手`／`右肩`／`背部`／`備用左手`。
 *
 * 放在 utils 而不是 badges/：機甲詳情頁、形態卡、後台編輯器三處都要用同一組字，
 * 而它是純字串運算、沒有 React 依賴。與 `EQUIP_SLOT_LABELS`（武器徽章用「單手／雙手／
 * 肩膀／背後」）刻意分開——那組講的是「這把武器裝在哪類槽」，這組講的是「機甲上的哪一格」。
 */
export function slotLabel(ref: WeaponSlotRef): string {
  const base = SLOT_LABEL[ref.slot] ?? ref.slot
  const sided = ref.side && slotAcceptsSide(ref.slot) ? `${SIDE_LABEL[ref.side]}${base}` : base
  return ref.bank === 'backup' ? `備用${sided}` : sided
}

/** `ArmamentMount` 的顯示名（主手組）。固定武裝與形態武裝都掛在 main bank。 */
export function mountLabel(mount: ArmamentMount): string {
  return slotLabel({ bank: 'main', slot: mount.slot, side: mount.side })
}
