// 配裝合法性與重量帳 —— PLAN-052-B Phase A / A-2
//
// ── 這支存在的理由：三個 bug 全都是「同一件事在三處各寫一次」──────────────────
// 舊 SimulatorPage 把「什麼裝得上」拆散在三個 useCallback 裡，於是：
//   ① 執照過濾寫 `license === '中甲'`（那是 ArmorType 的值），中型執照那條**恆為 false**；
//   ② 背包過濾不看背槽是否已被背部武器佔住（181/181 背包 slot='back'，22 把背部武器可並存）；
//   ③ 重量帳順序相依 —— 選背包時扣武器重、選武器時不扣背包重，跳著選會得到兩份清單。
// 三者的共同病根是「沒有單一入口」。本檔就是那個入口：**任何挑選器都問同一支函式**。
//
// ── 職責邊界 ────────────────────────────────────────────────────────────────
//   本檔（loadoutRules）        ：「什麼合法」＋「重量／出力是多少」——純查詢，不產生新 draft。
//   simReducer.ts 的 reconcile()：「換東西時怎麼連動」——唯一會產生新 draft 的地方。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type { Backpack, Component, Mech, MechForm, Module, Pilot, Weapon } from '../types'
import type { EquipSet, LoadoutMount } from '../types/loadout'
import type { ModuleSlotRef, SlotCapacity, SlotKey, WeaponSlotRef } from '../types/slots.ts'
import { slotKey, slotAcceptsSide } from '../types/slots.ts'
import { ArmorType, COMPONENT_WEAPON_TYPES, MechLicense, MechRestriction, MechPartPosition, WeaponEquipSlot, WeaponKind } from '../types/enums.ts'
import { fromAssemblableArmorType, licenseAllows, toArmorType } from './normalizeArmorType.ts'
import { resolveChassis, partOf, chassisWeight, type ResolvedChassis } from './chassisStats.ts'
import { compareModuleBySlot, partLabel } from './moduleSlots.ts'
import {
  enumerateSlots, loadoutSlotCapacity, occupiedSlots, lockedSlots, slotLabel,
  type FormSlotLock, type OccupiedSlot,
} from './mechSlots.ts'
import { weightBreakdown, type LoadoutWeightSet, type WeightBreakdown } from './loadoutWeight.ts'
import { effectiveOutput, type OutputBreakdown } from './effectiveOutput.ts'
import { DEFAULT_EQUIP_SET_KEY } from './forms.ts'
import { isSameFamily, isWTypeComponent } from './componentRules.ts'
import {
  interfaceAcceptsRarity, interfaceState, isModuleCandidate, moduleCandidates,
  moduleAddLevel, moduleFamilyKey, moduleMaxLevel, moduleStacks,
} from './moduleRules.ts'

// ─── 拒絕原因：封閉聯集 ─────────────────────────────────────────────────────
//
// 這一段是把「玩家看不懂為什麼選不到」擋在型別層的裝置。新增一個原因時，tsc 逼你：
//   (1) 在 REJECTION_TIER 選邊（Record 的完整性）—— 決定它被摺疊還是被灰掉；
//   (2) 在 REJECTION_LABEL 填中文短語（Record 的完整性）；
//   (3) 若選了 situational，`rejectSituational()` 的簽章逼你附上 resolution。
// 少了 (3) 就會出現「灰掉但沒有解法按鈕」的列 —— 那正是玩家會來問客服的那一種。

/** 八組：骨架／機甲／槽位／武器／背部／負重／元件／模組。 */
export const REJECTION_CODES = [
  // 骨架 —— 前置選擇還沒做
  'NO_PILOT', 'NO_MECH',
  // 機甲 —— 這台機甲本身不能用
  'LICENSE', 'DATA_INCOMPLETE',
  // 槽位 —— 這一格的定義問題
  'SLOT_MISMATCH', 'NO_SLOT', 'SLOT_OCCUPIED', 'FORM_LOCKED',
  // 武器 —— 這把武器本身裝不上
  'MECH_RESTRICTION', 'FORM_WEAPON_TYPE', 'FIXED_ARMAMENT', 'SHIELD_LIMIT',
  // 背部 —— 背槽的擇一問題
  'BACK_SLOT_TAKEN', 'BACKPACK_ARMOR_TYPE',
  // 負重
  'OVERWEIGHT',
  // 元件 —— 掛在武器上的那一層（PLAN-052-D）
  'COMP_NO_SLOTS', 'COMP_W_TYPE', 'COMP_WEAPON_TYPE',
  'COMP_SLOTS_FULL', 'COMP_KIND_FULL', 'COMP_FAMILY',
  // 模組 —— 掛在機甲四個接口上的那一層（PLAN-052-G）
  'MOD_NO_INTERFACE', 'MOD_IFACE_UNKNOWN', 'MOD_IFACE_RARITY',
  'MOD_NOT_CANDIDATE', 'MOD_DATA_INCOMPLETE',
  // 部件混搭 —— 四個部位各自換來源機甲（PLAN-052-G Phase D）
  'PART_INCOMPATIBLE', 'PART_DATA_INCOMPLETE',
] as const

export type RejectionCode = typeof REJECTION_CODES[number]

/**
 * 拒絕的呈現層級。決策二逐字：這是「玩家會不會來問客服」的分水嶺。
 *
 * · `structural`  玩家改別的選擇也解不掉 → **摺疊隱藏 ＋ 計數 ＋ [顯示並說明原因]**
 * · `situational` 改別的就能解           → **灰掉 ＋ 原因 ＋ 解法按鈕**
 * · `omitted`     不是拒絕，是槽的定義   → **不列入清單**（列了清單會長 5 倍）
 * · `blocked`     整個挑選器不該開       → **降級並說明**，不是給一個空清單
 */
export type RejectionTier = 'structural' | 'situational' | 'omitted' | 'blocked'

export const REJECTION_TIER = {
  NO_PILOT:            'blocked',
  NO_MECH:             'blocked',
  LICENSE:             'structural',
  DATA_INCOMPLETE:     'blocked',
  SLOT_MISMATCH:       'omitted',
  NO_SLOT:             'omitted',
  SLOT_OCCUPIED:       'blocked',
  FORM_LOCKED:         'blocked',
  MECH_RESTRICTION:    'structural',
  FORM_WEAPON_TYPE:    'structural',
  FIXED_ARMAMENT:      'omitted',
  SHIELD_LIMIT:        'situational',
  BACK_SLOT_TAKEN:     'situational',
  BACKPACK_ARMOR_TYPE: 'structural',
  OVERWEIGHT:          'situational',
  COMP_NO_SLOTS:       'blocked',
  COMP_W_TYPE:         'structural',
  COMP_WEAPON_TYPE:    'structural',
  COMP_SLOTS_FULL:     'situational',
  COMP_KIND_FULL:      'situational',
  COMP_FAMILY:         'situational',
  MOD_NO_INTERFACE:    'blocked',
  MOD_IFACE_UNKNOWN:   'blocked',
  MOD_IFACE_RARITY:    'structural',
  MOD_NOT_CANDIDATE:   'structural',
  MOD_DATA_INCOMPLETE: 'structural',
  // ⚠ 兩者都選 structural（＝玩家改別的選擇也解不掉），因此**不會出現在挑選器清單裡**
  //   （PickerShell 自 052-I 起把 structural 整批不列）。這是刻意的：
  //   · 裝甲類型不符 —— 來源池本來就只列同型，這條擋的是**外來草稿**（分享碼／舊存檔）。
  //   · 數值未公布 —— 列成一組重量 0 的「免費部件」會讓玩家配出一台不存在的機體。
  //   被濾掉的數量由挑選器的 hint 一句話交代（同 052-F B-3 的做法），不是靜默消失。
  PART_INCOMPATIBLE:   'structural',
  PART_DATA_INCOMPLETE: 'structural',
} as const satisfies Record<RejectionCode, RejectionTier>

/** 摺疊列的短標籤（「因形態限定隱藏 90」的那個「形態限定」）。 */
export const REJECTION_LABEL = {
  NO_PILOT:            '尚未選機師',
  NO_MECH:             '尚未選機甲',
  LICENSE:             '執照不符',
  DATA_INCOMPLETE:     '數值未建檔',
  SLOT_MISMATCH:       '槽位不符',
  NO_SLOT:             '無此槽位',
  SLOT_OCCUPIED:       '固定武裝佔用',
  FORM_LOCKED:         '形態鎖定',
  MECH_RESTRICTION:    '機種限定',
  FORM_WEAPON_TYPE:    '形態限定',
  FIXED_ARMAMENT:      '固定武裝',
  SHIELD_LIMIT:        '盾已達上限',
  BACK_SLOT_TAKEN:     '背槽已佔用',
  BACKPACK_ARMOR_TYPE: '機種限定',
  OVERWEIGHT:          '出力不足',
  COMP_NO_SLOTS:       '不可裝元件',
  COMP_W_TYPE:         '僅雙手／背部',
  COMP_WEAPON_TYPE:    '武器種類限定',
  COMP_SLOTS_FULL:     '元件槽已滿',
  COMP_KIND_FULL:      '該類已滿',
  COMP_FAMILY:         '同族已裝',
  MOD_NO_INTERFACE:    '無模組接口',
  MOD_IFACE_UNKNOWN:   '接口型別不明',
  MOD_IFACE_RARITY:    '僅可裝 A 級',
  MOD_NOT_CANDIDATE:   '不可自由裝配',
  MOD_DATA_INCOMPLETE: '數值未建檔',
  PART_INCOMPATIBLE:   '裝甲類型不符',
  PART_DATA_INCOMPLETE: '數值未公布',
} as const satisfies Record<RejectionCode, string>

type CodesOfTier<T extends RejectionTier> =
  { [K in RejectionCode]: typeof REJECTION_TIER[K] extends T ? K : never }[RejectionCode]

export type StructuralCode  = CodesOfTier<'structural'>
export type SituationalCode = CodesOfTier<'situational'>
export type OmittedCode     = CodesOfTier<'omitted'>
export type BlockedCode     = CodesOfTier<'blocked'>

/**
 * 解法：情境性拒絕附帶的「按一下就能裝」動作。
 *
 * ⚠ 形狀與 reducer 的 action 相容，但**定義在這裡**而不是 import 過來：
 *   解法與原因必須同源 —— UI 若自己組動作，就會出現「按鈕寫卸下左肩、實際卸右肩」
 *   這種只有玩家看得到的錯。reducer 的 action union 反過來包含這兩個形狀。
 */
export type ResolutionAction =
  | { type: 'unequip'; ref: WeaponSlotRef }
  | { type: 'unequipBackpack' }
  /** 卸下某一把武器上的某顆元件（PLAN-052-D A-5）。`ref` 是**武器自己的座標** */
  | { type: 'unequipComponent'; ref: WeaponSlotRef; componentId: string }
  /**
   * 卸下某一個接口上的模組（PLAN-052-G A-3）。
   *
   * ⚠ **reducer 的對應分支在 C-1 才落地**，在那之前這個 action 派進去會走到
   *   `simReducer` 的 `default: return state` —— 也就是**靜默沒反應**。今天走不到
   *   （Phase A 不接任何 UI，沒有人會產生這個 action），但 C-1 的第一件事就是補上它。
   */
  | { type: 'unequipModule'; ref: ModuleSlotRef }

export interface Resolution {
  /** 按鈕文案，如「卸下 左肩 熔火 可裝」 */
  label: string
  action: ResolutionAction
}

export type Rejection =
  | { code: StructuralCode;  tier: 'structural';  reason: string }
  | { code: SituationalCode; tier: 'situational'; reason: string; resolution: Resolution }
  | { code: OmittedCode;     tier: 'omitted';     reason: string }
  | { code: BlockedCode;     tier: 'blocked';     reason: string }

function reject(code: StructuralCode | OmittedCode | BlockedCode, reason: string): Rejection {
  return { code, tier: REJECTION_TIER[code], reason } as Rejection
}

/** situational 專用建構子。第三個參數**不是選填** —— 那正是它獨立存在的全部理由。 */
function rejectSituational(code: SituationalCode, reason: string, resolution: Resolution): Rejection {
  return { code, tier: 'situational', reason, resolution }
}

// ─── 世界（資料查詢面）──────────────────────────────────────────────────────

/**
 * 規則層需要的全部遊戲資料。用 Map 而不是陣列：挑選器每一列都要查一次武器，
 * 180 筆 × 每列線性搜尋在 hover 預覽時會明顯掉幀。
 */
export interface LoadoutWorld {
  pilots: ReadonlyMap<string, Pilot>
  mechs: ReadonlyMap<string, Mech>
  weapons: ReadonlyMap<string, Weapon>
  backpacks: ReadonlyMap<string, Backpack>
  forms: readonly MechForm[]
  /**
   * 元件（PLAN-052-D A-3）。自 `equip` 階段起載入 —— 元件掛在武器上，
   * 沒有武器的階段一筆都用不到。
   *
   * ⚠ **空 Map 的意思是「還沒載入」，不是「這個世界沒有元件」。**
   *   規則層必須據此**跳過**元件驗證而不是把元件當成查無資料清掉：
   *   草稿會在載入完成前就被 `loadDraft` 灌進來（分享碼／本機書架／雲端存檔都走那條），
   *   照著武器那套「查不到就刪」做，症狀是**貼一次分享碼、元件就被靜默清空一次**。
   */
  components: ReadonlyMap<string, Component>
  /**
   * 模組（PLAN-052-G A-4）。自 `equip` 階段起載入 —— 四個接口掛在機甲上，
   * 選完機甲之前一筆都用不到。
   *
   * ⚠ **空 Map 的意思是「還沒載入」，不是「這個世界沒有模組」**，與 `components`
   *   逐字同一條（計畫書決策六）。規則層必須據此**跳過**模組驗證、`reconcile()` 必須
   *   **不動** `draft.modules`：草稿會在載入完成前就被 `loadDraft` 灌進來
   *   （分享碼／本機書架／052-E 雲端存檔都走那條），照著武器那套「查不到就刪」做，
   *   症狀是**貼一次分享碼、四顆模組就被靜默清空一次**。
   */
  modules: ReadonlyMap<string, Module>
}

export const EMPTY_WORLD: LoadoutWorld = {
  pilots: new Map(), mechs: new Map(), weapons: new Map(), backpacks: new Map(), forms: [],
  components: new Map(), modules: new Map(),
}

export function buildWorld(data: {
  pilots: readonly Pilot[]
  mechs: readonly Mech[]
  weapons: readonly Weapon[]
  backpacks: readonly Backpack[]
  /** ⚠ 空陣列 ＝ 尚未載入（見 `reconcile()` 的形態載入 gate），不是「這個世界沒有形態」 */
  forms?: readonly MechForm[]
  components?: readonly Component[]
  modules?: readonly Module[]
}): LoadoutWorld {
  const index = <T extends { id: string }>(xs: readonly T[]): Map<string, T> =>
    new Map(xs.map((x) => [x.id, x]))
  return {
    pilots: index(data.pilots),
    mechs: index(data.mechs),
    weapons: index(data.weapons),
    backpacks: index(data.backpacks),
    // 與 components／modules 同一條：缺欄位 ＝ 那個階段還沒載入，該是空的。
    // 給預設而不是讓它變 undefined —— 一個 undefined 會讓 reconcile 的載入 gate 直接爆炸，
    // 而那條 gate 存在的理由正是「集合晚到時不要出事」。
    forms: data.forms ?? [],
    // 選填：`equip` 之前的階段根本沒有這個欄位，而那時它應該是空的（＝尚未載入）
    components: index(data.components ?? []),
    modules: index(data.modules ?? []),
  }
}

// ─── 情境（一次組好，全頁共用）───────────────────────────────────────────────

/**
 * 「目前這一頁所處的狀態」。所有規則查詢與所有數字都由它導出，頁面不重新拼一次 ——
 * 拼第二次就是順序相依 bug（③）的溫床。
 */
export interface LoadoutContext {
  pilot: Pilot | null
  mech: Mech | null
  /** 機體數值的唯一入口。四部位不齊時為 null（實測 90/90 齊全，今天走不到） */
  chassis: ResolvedChassis | null
  /** 目前分頁對應的形態；`default` 分頁為 null */
  form: MechForm | null
  /** 該形態鎖死整套配裝（虛粒子／巡航）→ 整個挑選器不開，見 FORM_LOCKED */
  lock: FormSlotLock | null
  set: EquipSet
  backpack: Backpack | null
  /** 含背包貢獻的實際容量 */
  capacity: SlotCapacity
  /** 機甲部件焊死的固定武裝佔住的格 */
  occupied: ReadonlyMap<SlotKey, OccupiedSlot>
  /**
   * 四個模組接口上各裝了什麼：**部位 → 模組 doc id**（PLAN-052-G A-4）。
   *
   * ⚠ 取自 `draft.modules` 而**不是** `set`：模組掛在機甲上、不隨形態分頁變動
   *   （與 `ndLevels` 同理，見 `LoadoutDraft.modules`）。放進 `EquipSet` 會讓
   *   海莉絲的四個分頁各存一份模組，而那是同一台機甲的同四個接口。
   */
  modules: Readonly<Partial<Record<MechPartPosition, string>>>
  world: LoadoutWorld
}

/**
 * 建立情境。`setKey` 一律取自 `equipSetKeys()`，不要傳 `Object.keys(sets)` 的成員。
 *
 * ⚠ 全鎖形態不在 `draft.sets` 裡（總綱決策四），所以這裡的 `set` 會是空的 ——
 *   那是正確的：那一套 100% 由 `form.restrict.mounts` derive，見 `lockedMounts()`。
 */
export function buildContext(
  draft: {
    pilotId?: string
    mechId?: string
    sets: Record<string, EquipSet>
    modules?: Partial<Record<MechPartPosition, string>>
    parts?: Partial<Record<MechPartPosition, string>>
  },
  setKey: string,
  world: LoadoutWorld,
): LoadoutContext {
  const pilot = (draft.pilotId ? world.pilots.get(draft.pilotId) : null) ?? null
  const mech = (draft.mechId ? world.mechs.get(draft.mechId) : null) ?? null
  const form = setKey === DEFAULT_EQUIP_SET_KEY
    ? null
    : world.forms.find((f) => f.id === setKey) ?? null
  const set = draft.sets[setKey] ?? { mounts: [] }
  const backpack = (set.backpackId ? world.backpacks.get(set.backpackId) : null) ?? null

  // ── 部件混搭（PLAN-052-G Phase D）────────────────────────────────────────
  //
  // `draft.parts` 是**部位 → 來源機甲 id**，只記與原廠不同的那幾格。
  // `resolveChassis()` 的 `partOverrides` 自 052-A B-2 就實作好了，本行只是接上。
  //
  // ⚠ 查不到來源機甲時**當作沒換**（退回原廠）而不是整台解不出來：
  //   草稿是外來的（分享碼／書架／雲端存檔），而 `world.mechs` 可能還沒載入完。
  //   真正不合法的那些由 `reconcile()` 帶著原因清掉並進 toast，這裡只負責算得出畫面。
  const partOverrides = draft.parts && mech
    ? Object.fromEntries(
        Object.entries(draft.parts).flatMap(([pos, srcId]) => {
          const src = srcId ? world.mechs.get(srcId) : null
          return src && src.id !== mech.id ? [[pos, { id: src.id, parts: src.parts }] as const] : []
        }),
      )
    : undefined
  const chassis = resolveChassis(mech, { moduleMap: world.modules, partOverrides })

  return {
    pilot,
    mech,
    // ⚠ `moduleMap` 一定要傳：少了它 `moduleLevelOf()` 恆回 0，而 0 的語意是「查無此模組」。
    //   模組等級一律由這裡 derive、**不存進草稿**（總綱決策六：存下來就是第二真相源）。
    chassis,
    form,
    lock: lockedSlots(form),
    set,
    backpack,
    capacity: loadoutSlotCapacity(mech, backpack),
    // ⚠ 固定武裝要讀**混搭後**的部件，不是 `mech.parts`（PLAN-052-G Phase D）。
    //   固定武裝住在部件上（帕斯卡的衝擊炮在雙肩、破曉者-01 的嵐質儲能艙、霸王的多功能彈倉），
    //   換掉右臂就等於換掉它帶來的那一格。讀基底機甲的症狀是**兩邊都錯**：
    //   換走的部件仍然佔著格子，換進來的部件帶的固定武裝卻不見了 —— 而且沒有任何錯誤訊息。
    occupied: occupiedSlots(chassis
      ? { torso: chassis.parts.torso.part, leftArm: chassis.parts.leftArm.part,
          rightArm: chassis.parts.rightArm.part, legs: chassis.parts.legs.part }
      : mech?.parts),
    modules: draft.modules ?? {},
    world,
  }
}

// ─── 槽位查詢 ───────────────────────────────────────────────────────────────

/** 這一格上是誰。`fixed` 來自機甲部件、`formLocked` 來自全鎖形態，兩者都不可更換。 */
export type SlotOccupant =
  | { kind: 'empty' }
  | { kind: 'weapon'; mount: LoadoutMount; weapon: Weapon | null }
  | { kind: 'backpack'; backpack: Backpack }
  | { kind: 'fixed'; occupied: OccupiedSlot; weapon: Weapon | null }
  | { kind: 'formLocked'; weaponId: string; ref: WeaponSlotRef; weapon: Weapon | null }

/**
 * 一筆 mount 實際佔住哪幾格。
 *
 * ⚠ `dualHand` 佔的是**兩格 singleHand**，不是第三格手部（`enumerateSlots()` 刻意不列它）。
 *   少了這條，畫面會同時渲染出「一把雙手武器」與「兩個空著的手格」。
 */
export function mountCoverage(mount: Pick<WeaponSlotRef, 'bank' | 'slot' | 'side'>): SlotKey[] {
  if (mount.slot === WeaponEquipSlot.DUAL_HAND) {
    return [
      slotKey({ bank: mount.bank, slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }),
      slotKey({ bank: mount.bank, slot: WeaponEquipSlot.SINGLE_HAND, side: 'right' }),
    ]
  }
  return [slotKey({ bank: mount.bank, slot: mount.slot, side: mount.side })]
}

/**
 * 這把武器裝進這一格時，**實際會佔住的座標**。
 *
 * 雙手武器 ＋ 手部座標 ⇒ `{ bank, slot:'dualHand' }`；其餘原樣回傳。
 *
 * ── 為什麼需要這一層（PLAN-052-J）────────────────────────────────────────────
 * `enumerateSlots()` **刻意不產生** `dualHand` 座標（雙手佔的是兩格 singleHand，
 * 不是第三格手部），所以挑選器只會拿著 `singleHand` 的 ref 來問。而
 * `canEquipWeapon()` 原本第一條就是 `weapon.equipSlot !== ref.slot → 'omitted'`，
 * 於是全庫 40/182 把雙手武器**在任何清單裡都不會出現**——不是灰掉，是連列都不列。
 * 修法不是去產生第三格（那會讓槽位圖同時畫出「一把雙手武器」與「兩個空手格」），
 * 而是讓手部座標願意接受它，再由這支把座標換算成它真正佔住的那個。
 *
 * ⚠ **不帶 `side`**。寫了會讓 `slotKey()` 產出 `main:dualHand:left`，
 *   而 `mountCoverage()` 產的是不帶 side 的鍵 —— 兩者永遠對不上，
 *   症狀是「裝上去了，但那一格顯示還是空的」。
 */
export function mountRefFor(weapon: Pick<Weapon, 'equipSlot'>, ref: WeaponSlotRef): WeaponSlotRef {
  return weapon.equipSlot === WeaponEquipSlot.DUAL_HAND && ref.slot === WeaponEquipSlot.SINGLE_HAND
    ? { bank: ref.bank, slot: WeaponEquipSlot.DUAL_HAND }
    : ref
}

/**
 * 盾 —— 手盾與大盾，**每組最多一面**。
 *
 * 遊戲不允許同時裝兩面盾，而且手盾與大盾**合計**只能一面（左手大盾＋右手手盾也不行）。
 * 全庫 24 面：大盾 12（限重型，260–390 重）＋ 手盾 12（無機種限制，50–70 重），
 * 全部 `equipSlot: 'singleHand'` —— 也就是說沒有規則的話，兩隻手各掛一面是選得出來的。
 *
 * ⚠ 判定範圍是**單一 bank**：主手組與備用組各自算一面（使用者裁決 2026-08-26）。
 *   兩組是替換關係而非並存——與重量帳「主備取較重者」同一個道理。
 */
const SHIELD_KINDS: readonly string[] = [WeaponKind.Shield, WeaponKind.Buckler]

/** 這把是不是盾。用 `kind` 而非 `type`：格鬥類共 63 把，盾只有 24 面。 */
export const isShield = (weapon: Pick<Weapon, 'kind'>): boolean => SHIELD_KINDS.includes(weapon.kind)

/** 兩個座標是否碰到同一格。 */
export function slotsOverlap(a: Pick<WeaponSlotRef, 'bank' | 'slot' | 'side'>, b: Pick<WeaponSlotRef, 'bank' | 'slot' | 'side'>): boolean {
  const bs = mountCoverage(b)
  return mountCoverage(a).some((k) => bs.includes(k))
}

/** 全鎖形態焊死的武裝（含槽位）。沒鎖、或 mounts 尚未落盤時回空陣列。 */
export function lockedMounts(ctx: LoadoutContext): { weaponId: string; ref: WeaponSlotRef }[] {
  return (ctx.lock?.mounts ?? []).map((m) => ({
    weaponId: m.weaponId,
    ref: { bank: 'main' as const, slot: m.slot, side: slotAcceptsSide(m.slot) ? m.side : undefined },
  }))
}

/** 這一格現在是誰。查詢順序 ＝ 不可更換者優先，玩家配的最後。 */
export function slotOccupant(ctx: LoadoutContext, ref: WeaponSlotRef): SlotOccupant {
  const key = slotKey(ref)
  const lookup = (id: string) => ctx.world.weapons.get(id) ?? null

  const locked = lockedMounts(ctx).find((m) => mountCoverage(m.ref).includes(key))
  if (locked) return { kind: 'formLocked', weaponId: locked.weaponId, ref: locked.ref, weapon: lookup(locked.weaponId) }

  const occ = ctx.occupied.get(key)
  if (occ) return { kind: 'fixed', occupied: occ, weapon: lookup(occ.mount.weaponId) }

  const mount = ctx.set.mounts.find((m) => mountCoverage(m).includes(key))
  if (mount) return { kind: 'weapon', mount, weapon: lookup(mount.weaponId) }

  if (ref.bank === 'main' && ref.slot === WeaponEquipSlot.BACK && ctx.backpack) {
    return { kind: 'backpack', backpack: ctx.backpack }
  }

  return { kind: 'empty' }
}

/** 這一格存不存在（容量問題，與裝不裝得上無關）。 */
export function slotExists(capacity: SlotCapacity, ref: Pick<WeaponSlotRef, 'bank' | 'slot' | 'side'>): boolean {
  const sideIndex = ref.side === 'right' ? 2 : 1
  switch (ref.slot) {
    case WeaponEquipSlot.SINGLE_HAND:
      return (ref.bank === 'backup' ? capacity.backupHand : capacity.singleHand) >= sideIndex
    case WeaponEquipSlot.DUAL_HAND:
      // 雙手要兩格單手都在。備用組只有 0 或 2 格，故同一條對兩個 bank 都成立
      return (ref.bank === 'backup' ? capacity.backupHand : capacity.singleHand) >= 2
    case WeaponEquipSlot.SHOULDER:
      return ref.bank === 'main' && capacity.shoulder >= sideIndex
    case WeaponEquipSlot.BACK:
      return ref.bank === 'main' && capacity.back >= 1
    default:
      return false
  }
}

// ─── 重量與出力：單一入口 ───────────────────────────────────────────────────

/**
 * 假想異動。挑選器的 hover 預覽、超重判定、[卸下並裝上] 的預期結果全部走它 ——
 * 預覽與實際落地必須是同一支函式算出來的，否則「預覽說裝得下、按下去卻超重」。
 */
export interface BudgetHypothesis {
  /** 假想裝上：`weight` 是它的重量；`backpackId` 有值代表這是背包（會取代背槽武器） */
  add?: { ref: WeaponSlotRef; weight: number; backpackId?: string }
  /** 假想卸下這幾格（背槽的 ref 同時卸掉背包） */
  remove?: readonly Pick<WeaponSlotRef, 'bank' | 'slot' | 'side'>[]
}

const w0 = (x: { weight?: number } | null | undefined) => ({ weight: x?.weight ?? 0 })
const isHandSlot = (slot: string) =>
  slot === WeaponEquipSlot.SINGLE_HAND || slot === WeaponEquipSlot.DUAL_HAND

/**
 * 把一套裝備攤成 `loadoutWeight` 吃的形狀。**全站唯一組裝這個結構的地方。**
 *
 * ⚠ 固定武裝要**計入**：golden fixture ④虛粒子形態 1125 ＝ 825 ＋（耀星 100 ＋ 隕星 100）＋ 千星 100，
 *   三把都是焊死的固定武裝。以為「玩家改不了的就不用算」會少算 300。
 * ⚠ 純封鎖型固定武裝（嵐質儲能艙／多功能彈倉）weight 恆為 0 —— 它們照樣走這條路，
 *   加 0 不影響結果，而特例判斷會多一條永遠不會被測到的分支。
 */
export function loadoutWeightSet(ctx: LoadoutContext, hypo: BudgetHypothesis = {}): LoadoutWeightSet {
  const weapon = (id: string) => ctx.world.weapons.get(id)

  // 全鎖形態：整套由 form.restrict.mounts derive，draft 那一份（必為空）與假想異動都不參與
  const locked = lockedMounts(ctx)
  if (locked.length > 0) {
    const pick = (test: (slot: string) => boolean) =>
      locked.filter((m) => test(m.ref.slot)).map((m) => w0(weapon(m.weaponId)))
    const back = locked.find((m) => m.ref.slot === WeaponEquipSlot.BACK)
    return {
      mainHand: pick(isHandSlot),
      shoulder: pick((s) => s === WeaponEquipSlot.SHOULDER),
      back: back ? w0(weapon(back.weaponId)) : null,
    }
  }

  // 1. 先算出「異動後」的玩家配裝（純結構，不含機甲固定武裝）
  const dropped = [...(hypo.remove ?? []), ...(hypo.add ? [hypo.add.ref] : [])]
  const droppingBack = dropped.some((r) => r.bank === 'main' && r.slot === WeaponEquipSlot.BACK)
  const entries = ctx.set.mounts
    .filter((m) => !dropped.some((r) => slotsOverlap(m, r)))
    .map((m) => ({ bank: m.bank as string, slot: m.slot as string, weight: weapon(m.weaponId)?.weight ?? 0 }))
  if (hypo.add) {
    entries.push({ bank: hypo.add.ref.bank, slot: hypo.add.ref.slot, weight: hypo.add.weight })
  }

  // 2. 背槽：背包 XOR 背部武器 XOR 固定武裝。裝背包 ⇒ 背部武器已在上一步被 drop
  const backEntry = entries.find((e) => e.slot === WeaponEquipSlot.BACK)
  const backpackKept = hypo.add?.backpackId !== undefined
    ? ctx.world.backpacks.get(hypo.add.backpackId)
    : (droppingBack || backEntry ? null : ctx.backpack)
  const fixed = [...ctx.occupied.values()].map((o) => ({ slot: o.mount.slot, weight: weapon(o.mount.weaponId)?.weight ?? 0 }))
  const backFixed = fixed.find((f) => f.slot === WeaponEquipSlot.BACK)

  const sumOf = (test: (e: { bank: string; slot: string }) => boolean) =>
    entries.filter(test).map((e) => ({ weight: e.weight }))

  return {
    mainHand: [
      ...sumOf((e) => e.bank === 'main' && isHandSlot(e.slot)),
      ...fixed.filter((f) => isHandSlot(f.slot)).map(w0),
    ],
    backupHand: sumOf((e) => e.bank === 'backup' && isHandSlot(e.slot)),
    shoulder: [
      ...sumOf((e) => e.slot === WeaponEquipSlot.SHOULDER),
      ...fixed.filter((f) => f.slot === WeaponEquipSlot.SHOULDER).map(w0),
    ],
    back: backpackKept ? w0(backpackKept)
      : backEntry ? { weight: backEntry.weight }
      : backFixed ? w0(backFixed)
      : null,
  }
}

/** 出力預算的完整答案。UI 要的所有數字都在這裡，不要在元件裡重算任何一項。 */
export interface LoadoutBudget {
  weight: WeightBreakdown
  output: OutputBreakdown
  /** 可用出力 − 總重。負數 ＝ 超重（不阻擋存檔，見決策三） */
  remaining: number
  over: boolean
  /**
   * 機體數值未公布（新機甲的佔位：先建檔、數值全 0）。出力 0 會讓所有東西都判成超重 ——
   * UI 應顯示「官方數值未公布」而不是渲染一台什麼都裝不下的機甲。
   *
   * ⚠ **今天全庫 0 台會讓這個旗標為 true**（2026-08-28 直讀正式庫核對）：原註解舉的
   *   `mech_090_美杜莎MK2` 已補完數值。這條路徑因此**只剩測試在走**，但它不是死碼——
   *   下一台新機甲建檔時就會再被走到（見 `resolveChassis()` 的佔位慣例註解）。
   */
  dataIncomplete: boolean
}

export function loadoutBudget(ctx: LoadoutContext, hypo: BudgetHypothesis = {}): LoadoutBudget {
  const chassis = ctx.chassis
  const weight = weightBreakdown(loadoutWeightSet(ctx, hypo), { weight: chassis?.weight ?? 0 })

  // 出力只看背槽上的那一件（武器無加成、背包才有）。與重量走同一份異動假設。
  const dropped = [...(hypo.remove ?? []), ...(hypo.add ? [hypo.add.ref] : [])]
  const droppingBack = dropped.some((r) => r.bank === 'main' && r.slot === WeaponEquipSlot.BACK)
  const backWeapon = ctx.set.mounts.find(
    (m) => m.slot === WeaponEquipSlot.BACK && !dropped.some((r) => slotsOverlap(m, r)),
  )
  const backpack = hypo.add?.backpackId !== undefined
    ? ctx.world.backpacks.get(hypo.add.backpackId) ?? null
    : (droppingBack ? null : ctx.backpack)
  const back = backpack ?? (backWeapon ? ctx.world.weapons.get(backWeapon.weaponId) ?? null : null)

  // ⚠ 模組必須一起傳進去。`effectiveOutput` 的第三個參數自 052-A 就在、
  //   `moduleOutputBonus()` 也有測試，但**呼叫端一直沒接** ⇒ `OutputBreakdown.modules` 恆為 0。
  //   052-F A-2 查出這條時模組還不能裝（latent）；052-G Phase C 讓四個接口上線之後，
  //   它就變成「裝上出力模組，可用出力不動」。實測候選池 186 筆裡有 2 筆會命中
  //   （`mod_4026` 出力模組Ⅰ／`mod_4026_2` 出力模組Ⅱ，來源皆為商店，滿級各 +100）。
  //
  // ⚠ 走 `moduleStacks()` 而**不是**逐格取滿級——這是本機實測抓到的第二層錯：
  //   接口上的模組是同族堆疊制（052-G C-7），裝一顆通用Ⅱ 是 **Lv2**、裝兩顆才是 Lv4。
  //   逐格取滿級會讓 OutputBar 加 +100，而右欄的已裝效果彙總（走 `stackLevelOf()`）印 +50，
  //   同一頁兩個數字互相打臉；同族兩顆還會被算成兩份加成。
  //   `moduleStacks()` 回的就是**每族一筆＋已收斂的等級**，與 `EquippedEffects` / 匯出圖同一支。
  const stacks = moduleStacks(ctx.modules, (id) => ctx.world.modules.get(id))
  const mods = [...stacks.values()].map((st) => ({ mod: st.mod, level: st.level }))
  const output = effectiveOutput({ output: chassis?.output ?? 0 }, { back }, mods)
  return {
    weight,
    output,
    remaining: output.total - weight.total,
    over: weight.total > output.total,
    dataIncomplete: !!chassis && chassis.output === 0,
  }
}

// ─── canEquip：裝不裝得上 ───────────────────────────────────────────────────

/** 武器 `mechRestriction` 對應的裝甲類型；`none` 回 null（不限）。 */
function restrictedTo(restriction: string | undefined): ArmorType | null {
  switch (restriction) {
    case MechRestriction.LIGHT_ONLY:  return ArmorType.LIGHT
    case MechRestriction.MEDIUM_ONLY: return ArmorType.MEDIUM
    case MechRestriction.HEAVY_ONLY:  return ArmorType.HEAVY
    default: return null
  }
}

/** 武器自己的槽位說法（「這把裝在肩膀」），與 `slotLabel()` 的「機甲上的哪一格」刻意分開。 */
const OWN_SLOT_LABEL: Record<string, string> = {
  [WeaponEquipSlot.SINGLE_HAND]: '單手',
  [WeaponEquipSlot.DUAL_HAND]:   '雙手',
  [WeaponEquipSlot.SHOULDER]:    '肩膀',
  [WeaponEquipSlot.BACK]:        '背後',
}

/**
 * 這把武器能不能裝進這一格。合法回 `null`，否則回一筆帶中文原因的 `Rejection`。
 *
 * ⚠ 機種 gate 一律用 `weapon.mechRestriction`，**絕不可用 `type === '戰術'` 代替**
 *   （總綱決策十一）：實測 medium 49 筆 vs 戰術 44 筆，差 5 筆 ＝ 3 把肩掛固定武裝 ＋ 耀星 ＋ 隕星。
 * ⚠ 判斷順序刻意由「這格根本不該列它」→「這把裝不上」→「現在裝不下」：
 *   負重放最後，因為前面任何一條成立時，重量根本不該被拿來當理由。
 */
export function canEquipWeapon(ctx: LoadoutContext, weapon: Weapon, ref: WeaponSlotRef): Rejection | null {
  if (!ctx.pilot) return reject('NO_PILOT', '請先選擇機師')
  if (!ctx.mech || !ctx.chassis) return reject('NO_MECH', '請先選擇機甲')
  if (ctx.lock) return reject('FORM_LOCKED', `${ctx.lock.formName}的武裝已鎖死，無法調整任何裝備`)

  // ── 槽位：不是拒絕，是槽的定義 ──
  // `mount` 是這把武器**實際佔住**的座標：雙手武器進手部格時會換成 dualHand（見 mountRefFor）。
  // 底下每一條檢查都必須用 `mount` 而非 `ref`，否則雙手武器只會被當成佔住單邊那一格——
  // 佔用漏掃另一手、重量少算被擠掉的那把。
  const mount = mountRefFor(weapon, ref)
  if (weapon.equipSlot !== mount.slot) {
    return reject('SLOT_MISMATCH', `${weapon.name}是${OWN_SLOT_LABEL[weapon.equipSlot] ?? weapon.equipSlot}武器`)
  }
  if (!slotExists(ctx.capacity, mount)) return reject('NO_SLOT', `這台機甲沒有${slotLabel(mount)}`)
  if (weapon.isFixedArmament) return reject('FIXED_ARMAMENT', '固定武裝焊死在機甲上，不是可選裝備')

  // ── 這一格被不可更換的東西佔住 ──
  for (const key of mountCoverage(mount)) {
    const occ = ctx.occupied.get(key)
    if (occ) {
      const src = ctx.world.weapons.get(occ.mount.weaponId)
      return reject('SLOT_OCCUPIED', `${slotLabel(occ.ref)}已由固定武裝${src ? `「${src.name}」` : ''}佔用`)
    }
  }

  // ── 武器本身 ──
  const need = restrictedTo(weapon.mechRestriction)
  if (need && toArmorType(ctx.chassis.armorType) !== need) {
    return reject('MECH_RESTRICTION', `僅${need}機甲可裝備`)
  }
  const allow = ctx.form?.restrict.kind === 'weaponType' ? ctx.form.restrict.allow : null
  if (allow && !(allow as readonly string[]).includes(weapon.type)) {
    return reject('FORM_WEAPON_TYPE', `${ctx.form!.name}只能裝備${allow.join('／')}類武器`)
  }

  // ── 盾擇一：手盾與大盾**合計**每組一面 ──
  // 放在機種／形態限定之後、負重之前：那兩條是「這把武器你根本用不了」，
  // 而這一條是「你得先卸下另一面」——照決策二的順序，解得掉的排後面。
  if (isShield(weapon)) {
    const other = ctx.set.mounts.find((m) => {
      if (m.bank !== mount.bank) return false            // 主手組／備用組各自一面
      if (slotsOverlap(m, mount)) return false           // 這一格自己等下會被取代，不算衝突
      const w = ctx.world.weapons.get(m.weaponId)
      return !!w && isShield(w)
    })
    if (other) {
      const w = ctx.world.weapons.get(other.weaponId)
      const otherRef: WeaponSlotRef = { bank: other.bank, slot: other.slot, side: other.side }
      return rejectSituational('SHIELD_LIMIT', `${slotLabel(otherRef)}已裝${w?.name ?? '盾'}，盾一次只能裝一面`, {
        label: `卸下${w?.name ?? '盾'}並裝上`,
        action: { type: 'unequip', ref: otherRef },
      })
    }
  }

  // ── 背槽擇一：背包 XOR 背部武器（SlotCapacity.back = 1）──
  if (mount.slot === WeaponEquipSlot.BACK && ctx.backpack) {
    return rejectSituational('BACK_SLOT_TAKEN', `背槽已裝${ctx.backpack.name}`, {
      label: `替換背包並裝上`,
      action: { type: 'unequipBackpack' },
    })
  }

  return overweightRejection(ctx, { ref: mount, weight: weapon.weight }, weapon.name)
}

// ─── 元件：掛在武器上的那一層（PLAN-052-D Phase A）──────────────────────────

/**
 * 這一格上的武器、以及掛在它上面的元件設定。
 *
 * ⚠ **不要用 `slotOccupant()` 代替**：那一支比對的是 `slotKey(ref)`，而雙手武器的
 *   `mountCoverage()` 產出的是**兩格 singleHand** 的鍵、不含 `main:dualHand` 自己——
 *   拿 `weaponRows()` 給的 dualHand 座標去問它，會得到「這一格是空的」。
 *   本支改用 `slotsOverlap()`（比對的是覆蓋範圍的交集），三種來源一視同仁。
 */
export interface WeaponSite {
  weapon: Weapon | null
  /** 玩家配的那一筆。固定武裝與全鎖形態的武裝**不在 mounts 裡**，故為 null */
  mount: LoadoutMount | null
  /** 不可更換的來源。兩者的 `componentLimit` 實測 8/8 皆為 0，見計畫書決策四 */
  locked: 'fixed' | 'form' | null
}

export function weaponSiteAt(ctx: LoadoutContext, ref: WeaponSlotRef): WeaponSite {
  const lookup = (id: string) => ctx.world.weapons.get(id) ?? null

  const locked = lockedMounts(ctx).find((m) => slotsOverlap(m.ref, ref))
  if (locked) return { weapon: lookup(locked.weaponId), mount: null, locked: 'form' }

  for (const occ of ctx.occupied.values()) {
    if (slotsOverlap(occ.ref, ref)) return { weapon: lookup(occ.mount.weaponId), mount: null, locked: 'fixed' }
  }

  const mount = ctx.set.mounts.find((m) => slotsOverlap(m, ref)) ?? null
  return { weapon: mount ? lookup(mount.weaponId) : null, mount, locked: null }
}

/** 掛在這一把上的元件 doc id（觸在前、應在後）。查無武器時回空陣列。 */
export function mountedComponentIds(site: WeaponSite): { trigger: string[]; effect: string[] } {
  return {
    trigger: site.mount?.setup?.triggerComponentIds ?? [],
    effect: site.mount?.setup?.effectComponentIds ?? [],
  }
}

/**
 * W 型元件只吃**雙手／背部**武器。實測 W 型 80 筆，符合條件的武器 49 把。
 */
const W_TYPE_SLOTS: readonly string[] = [WeaponEquipSlot.DUAL_HAND, WeaponEquipSlot.BACK]

/**
 * `allowedWeaponTypes` 的判定：**空陣列或填滿全部種類，都等於不限**。
 *
 * ⚠ 後台的「全選」寫進去的就是四個值全填（實測 208 筆裡 201 筆是這個形狀），
 *   把它當成「限定這四種」在語意上雖然等價，但少一種武器類型時就會出錯——
 *   所以用「長度大於等於全部種類數」而不是「長度等於 4」。
 *   （沿用 052-I `componentBlockReason()` 已經寫對的那一條。）
 */
function componentTypeAllows(comp: Pick<Component, 'allowedWeaponTypes'>, weaponType: string): boolean {
  const allow = comp.allowedWeaponTypes ?? []
  if (allow.length === 0 || allow.length >= COMPONENT_WEAPON_TYPES.length) return true
  return allow.includes(weaponType)
}

/** 觸／應的中文短稱。錯誤訊息裡要講「觸元件已滿」而不是「Condition 已滿」。 */
const KIND_LABEL: Record<string, string> = { Condition: '觸元件', Function: '應元件' }

/**
 * 這顆元件能不能裝到這一格的武器上。合法回 `null`。
 *
 * ── 五條規則（總綱決策五）與它們的順序 ──────────────────────────────────────
 *   ① 這把武器有沒有元件槽（`componentLimit`）      → blocked，整個面板降級
 *   ② W 型只給雙手／背部                            → structural，摺疊
 *   ③ `allowedWeaponTypes`                          → structural，摺疊
 *   ④ 同族互斥（**單把武器內**，使用者裁決）        → situational，附解法
 *   ⑤ 數量：分項上限、總槽上限                      → situational，附解法
 *
 * 順序與 `canEquipWeapon()` 同一條原則：「這格根本不該列它」→「這顆裝不上」→
 * 「現在裝不下」。數量放最後，因為前面任一條成立時，槽位滿不滿根本不是理由。
 *
 * ⚠ **`conditionType` 不參與判定**（計畫書決策五）：106 個觸元件裡 always 103 筆、
 *   dualWield 3 筆，而「同時使用兩把武器攻擊」是戰鬥中的出手指令、不是配裝狀態。
 *   配裝層判不了，猜了就會出現「站上說不會觸發、遊戲裡卻觸發了」。
 *
 * ⚠ **載入未完成時本支只會漏擋、不會誤擋**，那是刻意的安全方向：呼叫端手上已經有一顆
 *   `Component` 物件（清單本身來自 `world.components`），所以走到這裡時集合必然已載入；
 *   唯一會受影響的是同族互斥那一段用 id 反查已裝元件——查無時當成「不同族」放行。
 *   真正需要**載入 gate** 的是 `reconcile()`：那裡是拿 id 反查、查不到就移除，
 *   照著武器那套做會在分享碼比集合早到時把元件靜默清空（見 `LoadoutWorld.components`）。
 */
export function canEquipComponent(ctx: LoadoutContext, comp: Component, ref: WeaponSlotRef): Rejection | null {
  if (!ctx.pilot) return reject('NO_PILOT', '請先選擇機師')
  if (!ctx.mech || !ctx.chassis) return reject('NO_MECH', '請先選擇機甲')

  const site = weaponSiteAt(ctx, ref)
  const weapon = site.weapon
  if (!weapon) return reject('COMP_NO_SLOTS', '這一格還沒有武器，元件掛在武器上')

  // ── ① 這把武器有沒有元件槽 ──
  //    A／B 品質 39 把、固定武裝 8 把（實測 componentLimit 皆為 0，計畫書決策四）
  if (weapon.componentLimit <= 0) {
    const why = site.locked === 'fixed' ? '固定武裝' : site.locked === 'form' ? '形態鎖定的武裝' : `${weapon.rarity} 品質武器`
    return reject('COMP_NO_SLOTS', `${weapon.name}不可裝元件（${why}）`)
  }

  // ── ② W 型只給雙手／背部 ──
  if (isWTypeComponent(comp) && !W_TYPE_SLOTS.includes(weapon.equipSlot)) {
    return reject('COMP_W_TYPE', `W 型元件只能裝在雙手或背部武器上，${weapon.name}是${OWN_SLOT_LABEL[weapon.equipSlot] ?? weapon.equipSlot}武器`)
  }

  // ── ③ 武器種類限定 ──
  if (!componentTypeAllows(comp, weapon.type)) {
    return reject('COMP_WEAPON_TYPE', `僅限${(comp.allowedWeaponTypes ?? []).join('・')}武器 —— ${weapon.name}是${weapon.type}`)
  }

  const { trigger, effect } = mountedComponentIds(site)
  const isCondition = comp.componentType === 'Condition'
  const sameKind = isCondition ? trigger : effect
  const kindLabel = KIND_LABEL[comp.componentType] ?? '元件'

  // 已經裝著這一顆 ⇒ 不是「同族衝突」而是「已裝上」，兩者的文案完全不同。
  // 呼叫端（面板）自己畫已裝狀態，這裡只要不把它誤報成同族衝突即可。
  const already = sameKind.includes(comp.id)

  // ── ④ 同族互斥：**單把武器內**（使用者裁決 2026-08-26）──
  //    右手裝憑逸、左手也裝憑逸是可以的，所以只看這一筆 mount 的 setup。
  if (!already) {
    const clash = sameKind
      .map((id) => ctx.world.components.get(id))
      .find((other): other is Component => !!other && isSameFamily(other, comp))
    if (clash) {
      return rejectSituational('COMP_FAMILY', `已裝同族的${clash.name}，一把武器同族只能裝一顆`, {
        label: `卸下${clash.name}`,
        action: { type: 'unequipComponent', ref, componentId: clash.id },
      })
    }
  }

  // ── ⑤ 數量：分項上限 ＋ 總槽上限 ──
  //    ⚠ 讀欄位不寫死 3（計畫書決策八）：實測 limit>0 的 135 把恆為 3／3，
  //      但官方哪天出一把「觸 4 應 2」時，寫死的版本會安靜地擋掉合法配置。
  if (!already) {
    const kindCap = isCondition ? weapon.triggerSlots : weapon.effectSlots
    if (sameKind.length >= kindCap) {
      return rejectSituational('COMP_KIND_FULL', `${kindLabel}已達 ${kindCap} 個上限`, unloadFirst(ctx, ref, sameKind))
    }
    if (trigger.length + effect.length >= weapon.componentLimit) {
      return rejectSituational('COMP_SLOTS_FULL', `${weapon.name}的元件槽已滿（${weapon.componentLimit} 個）`, unloadFirst(ctx, ref, [...trigger, ...effect]))
    }
  }

  return null
}

/**
 * 「先卸下一顆」的解法。挑**清單上的第一顆**而不是「最沒用的那顆」——
 * 後者需要一套元件強弱的評分，而本站沒有那份資料（觸發機率表待建檔）。
 *
 * ⚠ 按鈕文案照實寫「卸下 X」，**不寫「卸下 X 並裝上」**：
 *   `resolve` 只會送出 unequip，接著裝上那一步從來沒有實作過（052-J 收尾記下的懸案）。
 *   承諾一個不會發生的第二步，是玩家會來問客服的那一種落差。
 */
function unloadFirst(ctx: LoadoutContext, ref: WeaponSlotRef, ids: readonly string[]): Resolution {
  const first = ids[0]
  const comp = first ? ctx.world.components.get(first) : undefined
  return {
    label: `卸下${comp?.name ?? '一顆元件'}`,
    action: { type: 'unequipComponent', ref, componentId: first ?? '' },
  }
}

// ─── 模組（PLAN-052-G A-3）──────────────────────────────────────────────────

/**
 * 這顆模組能不能裝進這個接口。合法回 `null`。
 *
 * ── 五條規則與它們的順序 ────────────────────────────────────────────────────
 *   ① 這一格有沒有接口（空字串 ＝ 沒有）        → blocked，整個面板降級
 *   ② 接口型別認不認得                          → blocked，整個面板降級
 *   ③ 這顆玩家拿不拿得到（候選池）              → structural，摺疊
 *   ④ 這顆有沒有各階數值（`levels[]`）          → structural，摺疊
 *   ⑤ Ⅰ型接口只收 A 級                          → structural，摺疊
 *   ⑥ 這一格已經裝了別顆                        → situational，附解法
 *
 * 順序與 `canEquipWeapon()` / `canEquipComponent()` 同一條原則：
 * 「這格根本不該列它」→「這顆裝不上」→「現在裝不下」。已裝放最後，
 * 因為前面任一條成立時，這格空不空根本不是理由。
 *
 * ⚠ **①②③ 三種不可裝的狀態不可共用一句話**（C-2 會逐字用到這裡的 reason）：
 *   「這台沒有模組接口」（B 品質）／「接口型別不明」（資料異常）／「僅可裝 A 級模組」
 *   是三件不同的事，含糊或留白會被讀成一個我們並不知道的否定陳述。
 *
 * ⚠ **載入未完成時本支只會漏擋、不會誤擋**，與 `canEquipComponent()` 同一個安全方向：
 *   呼叫端手上已經有一顆 `Module` 物件（清單來自 `world.modules`），走到這裡時集合必然已載入。
 *   真正需要**載入 gate** 的是 `reconcile()` —— 那裡是拿 id 反查、查不到就移除，
 *   照著武器那套做會在分享碼比集合早到時把四顆模組靜默清空（見 `LoadoutWorld.modules`）。
 */
export function canEquipModule(ctx: LoadoutContext, mod: Module, ref: ModuleSlotRef): Rejection | null {
  if (!ctx.pilot) return reject('NO_PILOT', '請先選擇機師')
  if (!ctx.mech || !ctx.chassis) return reject('NO_MECH', '請先選擇機甲')

  const iface = interfaceState(ctx.chassis.moduleSlots[ref.position]?.iface)

  // ── ① 這台機甲沒有模組接口（B 品質 10 台 40 格，官方基礎階與滿階皆空）──
  if (iface === 'none') return reject('MOD_NO_INTERFACE', `${ctx.mech.name}沒有模組接口`)

  // ── ② 認不得的接口型別 ──
  //    今天走不到（全庫 360 格零例外，由 mechInterface.test.ts 守著），留著是因為
  //    官方新增型別時，「不知道」必須降級說明，而不是被當成「沒有接口」。
  if (iface === 'unknown') return reject('MOD_IFACE_UNKNOWN', `${partLabel(ref.position)}的接口型別無法辨識`)

  // ── ③ 玩家拿不到的模組 ──
  //    挑選器本來就只列 `moduleCandidates()`，這條擋的是**外來草稿**：
  //    分享碼／舊存檔可能帶著一顆綁在別台機甲上的專屬模組。
  if (!isModuleCandidate(mod)) {
    const why = mod.boundMechId != null
      ? `${ctx.world.mechs.get(mod.boundMechId)?.name ?? '另一台機甲'}的專屬模組`
      : '機甲自帶的副模組'
    return reject('MOD_NOT_CANDIDATE', `${mod.name}是${why}，不可自由裝配`)
  }

  // ── ④ 沒有各階數值 ──
  //    ⚠ 判準是 `levels[]` 而**不是**頂層那排平坦欄位：候選池 186 筆全有 levels，
  //      而頂層全 0 者有 163 筆（計畫書決策四）。看頂層的症狀是「裝上去沒有任何效果」。
  if (!mod.levels?.length) return reject('MOD_DATA_INCOMPLETE', `${mod.name}的各階數值未建檔`)

  // ── ⑤ Ⅰ型接口只收 A 級 ──
  if (!interfaceAcceptsRarity(iface, mod.rarity)) {
    return reject('MOD_IFACE_RARITY', `${iface}只能裝 A 級模組，${mod.name}是 ${mod.rarity} 級`)
  }

  // ── ⑥ 這一格已經裝了別顆 ⇒ **不是拒絕**（使用者裁決 2026-08-27，PLAN-052-G C-9）──
  //
  //    第一版把它做成 situational 拒絕 ＋「卸下 X」按鈕（照抄元件那一層）。那是錯的：
  //    元件有**容量帳**（觸／應各 3、合計 4），所以「先卸一顆」是真的在解一個限制；
  //    模組一格就是一顆，**換上去就是換掉**，沒有任何東西需要先騰出來。
  //
  //    副作用比想像的大 —— 實測畫面上那一格只要裝了東西，整份清單就變成
  //    「可裝 0 / 62 顆」全部灰掉，玩家得先卸再裝，兩步做一件事。
  //
  //    使用者逐字：「模組不要用『卸下』，直接替換，模組頂多超限，如果我們一開始
  //    就把不符合接口的模組篩除，就不存在無法替換的限制。」—— 前半句是結論，
  //    後半句是理由：①②③④⑤ 已經把裝不上的擋光了，走到這裡的每一顆都合法，
  //    於是「這格已裝別顆」不構成任何一種拒絕。
  //
  //    ⇒ 直接放行。替換由 reducer 的 `equipModule` 完成，被換掉的那顆進 toast
  //      （見 simReducer 的 `equipModule`）—— 玩家仍然知道自己換掉了什麼。
  //
  // ⚠ `unequipModule` 這個 action **沒有跟著移除**：模組面板的「已裝上」區塊仍留著
  //   一顆卸下鍵，那是「我要讓這一格空著」的唯一入口，與替換是兩件不同的事。

  return null
}

// ─── 機師的專武變體（使用者要求 2026-08-27）───────────────────────────────────
//
// 「如果他裝備了熠光，那按鈕就變成裁決者；裝了裁決者，按鈕就變成熠光。」——使用者逐字。
//
// ⚠ **一位機師可以有不只一把專武**（實測 2026-08-27）：3 位機師各有兩把，
//   而且**母武器與進階版都掛 `isExclusive` 並指向同一位機師**：
//       肖妮      熠光 → 裁決者
//       洛莎·審判  諸神黃昏 → 天燼審判
//       菲婭      草莓通心粉 → 糖衣毀滅者
//   三對全是背部武器，而且**兩把都強化同一個天賦**（熠光與裁決者都強化「晨星科技」）。
//
// ⚠ 這使得「找出這位機師的專武」**不能寫成 `find()`**：那會回傳 Map 迭代順序上
//   先遇到的那一把 —— 對這三位機師來說，站上顯示哪一把是碰運氣的。
//   本函式回**整條鏈**，由母到子排好，呼叫端自己決定要用哪一把。

/**
 * 這位機師的全部專武，**依升級鏈由母到子**排序。
 *
 * ⚠ 排序不是 `sort()` 而是**走鏈**：先找出鏈頭（`upgrade.fromWeaponId` 不在這批裡的那把），
 *   再一路往下接。`sort()` 的比較函式對「A 是 B 的母武器」這種偏序不可靠 ——
 *   兩兩比較之外的元素會讓結果取決於實作的排序演算法。
 *   接不上的（資料異常：鏈斷了、或有兩條獨立的鏈）一律附在後面，不吞掉。
 */
export function pilotExclusiveWeapons(ctx: LoadoutContext, pilotId: string): Weapon[] {
  const mine: Weapon[] = []
  for (const w of ctx.world.weapons.values()) {
    if (w.isExclusive && w.exclusiveFor === pilotId) mine.push(w)
  }
  if (mine.length <= 1) return mine

  const ids = new Set(mine.map((w) => w.id))
  const childOf = new Map<string, Weapon>()
  for (const w of mine) {
    const from = w.upgrade?.fromWeaponId
    if (from && ids.has(from)) childOf.set(from, w)
  }

  const out: Weapon[] = []
  const used = new Set<string>()
  for (const head of mine) {
    const from = head.upgrade?.fromWeaponId
    if (from && ids.has(from)) continue        // 不是鏈頭
    for (let cur: Weapon | undefined = head; cur && !used.has(cur.id); cur = childOf.get(cur.id)) {
      used.add(cur.id)
      out.push(cur)
    }
  }
  // 鏈接不上的（理論上不該有）附在後面 —— 少列一把專武是靜默的，而它會讓玩家找不到東西
  for (const w of mine) if (!used.has(w.id)) out.push(w)
  return out
}

// ─── 一鍵升級（使用者要求 2026-08-27）─────────────────────────────────────────
//
// 「這個熠光有進階版的背包武器叫做裁決者，如果遇到這種情況，請讓使用者可以直接 UPGRADE。」
//
// PLAN-031 已經把製作關係存成 `Weapon.upgrade.fromWeaponId`，但那份資料在模擬器裡
// 一直沒有消費端 —— 玩家得自己記得「熠光還能再做成裁決者」，然後回挑選器從 180 把裡找它。
//
// ── 全庫實測（2026-08-27，42 條邊）──────────────────────────────────────────
//   · **一對多為 0** ⇒ 一把武器最多一個進階版，按鈕不必問「升級成哪一個」
//   · 39 條同重、2 條變輕（炎嘯·改 480 → 迦具土 400）、**0 條變重**
//     ⇒ 升級**永遠不會**把配裝壓成超重，這顆按鈕幾乎不可能被 OVERWEIGHT 擋下
//   · 3 條是特種背包製作（複合武器）：熠光→裁決者、草莓通心粉→糖衣毀滅者、諸神黃昏→天燼審判
//   · 存在**多段鏈**：炬塔·改 → 熠光 → 裁決者。升完一段之後下一段的按鈕會自己長出來
//     ——本函式只看一步，不遞迴（多跳一次是玩家的決定，不是站上替他做完）
//
// ⚠ 仍然要問 `canEquipWeapon()`：子武器的 `mechRestriction` / `type` 未必與母武器相同，
//   而那兩者會讓升級在特定機甲或形態上不合法。「幾乎不可能」不是「不會」。

/** `planWeaponUpgrade()` 的結果。`rejection` 有值 ＝ 有進階版但這一套裝不上。 */
export interface WeaponUpgradePlan {
  /** 目前這一格裝著的那把 */
  from: Weapon
  /** 它的進階版 */
  to: Weapon
  /** 升級後要寫進哪一格（已過 `mountRefFor()`，直接丟 `equipWeapon`） */
  ref: WeaponSlotRef
  /** 重量差。負數＝變輕。實測 0 或負，沒有正的 */
  weightDelta: number
  rejection: Rejection | null
}

/**
 * 這一格裝著的武器有沒有可以直接做上去的進階版。**唯讀。**
 *
 * 回 `null` ＝ 這一格沒有武器、或那把沒有進階版（呼叫端整條不畫）。
 *
 * ⚠ **只認 `kind === 'weapon'`**：機甲固定武裝與形態鎖定的武裝是焊死的，
 *   給它們一顆升級鍵等於承諾一個做不到的動作（`equipWeapon` 也會被規則層擋下）。
 */
export function planWeaponUpgrade(ctx: LoadoutContext, ref: WeaponSlotRef): WeaponUpgradePlan | null {
  const occ = slotOccupant(ctx, ref)
  if (occ.kind !== 'weapon' || !occ.weapon) return null
  const from = occ.weapon

  // 反向索引（`upgradeTo`）刻意不存在資料裡（PLAN-031：雙向欄位失同步無機制可察），
  // 這裡現掃。182 把 × 每頁最多 6 格，成本可以忽略
  let to: Weapon | undefined
  for (const w of ctx.world.weapons.values()) {
    if (w.upgrade?.fromWeaponId === from.id) { to = w; break }
  }
  if (!to) return null

  // ⚠ `withoutSlot()`：母武器會被子武器取代，留著它問會讓兩者互相衝突
  //   （盾／背槽這類「一組只能一件」的規則會誤報）——同 `weaponChoices()` 的處理
  return {
    from, to,
    ref: mountRefFor(to, ref),
    weightDelta: to.weight - from.weight,
    rejection: canEquipWeapon(withoutSlot(ctx, ref), to, ref),
  }
}

// ─── 一鍵裝上（專武快速裝備，使用者要求 2026-08-27）───────────────────────────
//
// 「選完機甲後，專武天賦旁邊加一個按鈕，讓使用者快速將專武裝備上。」——使用者逐字。
//
// 天賦條會說「裝上〈XX〉可強化 2 個天賦」，而玩家看到那句話之後要做的事是：
// 找到那把武器該去的槽 → 開挑選器 → 在 180 把裡找到它。這一支把中間那兩步收掉。
//
// ⚠ **不挑「最好的」槽，只挑「裝得上的第一格」**：哪一手拿哪一把是玩家的偏好，
//   站上沒有立場替他決定。真正要保證的是**這顆按鈕不會失敗** —— 按下去要嘛裝上，
//   要嘛按鈕根本不出現（附上原因）。
//
// ⚠ 空格優先，與 `planModuleFill()` 同一條：一鍵的破壞力要盡量小。

/** 一個可以裝的位置。UI 一格一顆按鈕。 */
export interface WeaponAutoEquipOption {
  /**
   * 要裝去哪一格。**已經過 `mountRefFor()`**（雙手武器回 `dualHand` 座標），
   * 呼叫端直接丟給 `equipWeapon` 即可 —— 挑選器那條路徑也是先 `mountRefFor()` 再 dispatch，
   * 兩條路徑送進 reducer 的形狀必須一致，否則雙手武器會被當成只佔單邊那一格。
   */
  ref: WeaponSlotRef
  /** 「左手」「備用右手」——`slotLabel(ref)`，先算好省得呼叫端再 import 一次 */
  label: string
  /** 這一格原本裝著什麼（會被換掉），給按鈕的 title 用 */
  displaces: string | null
}

/** `planWeaponAutoEquip()` 的結果。`options` 非空 ＝ 裝得上；否則 `rejection` 說明為什麼不行。 */
export interface WeaponAutoEquipPlan {
  weapon: Weapon
  /**
   * **所有**裝得上的位置，空格優先（使用者要求 2026-08-27：「如果還有手能裝，
   * 就給使用者點左右手」）。第一版只回第一格，那等於替玩家決定了慣用手。
   *
   * ⚠ **盾牌自動只剩一個選項**，不必特判：`canEquipWeapon()` 的 `SHIELD_LIMIT`
   *   會擋掉同一組的第二面盾，所以裝上左手之後右手那個選項自己就消失了。
   *   在這裡另寫一條「盾牌只能一面」的規則，就是把同一條規則寫兩次 ——
   *   而第二份會在規則改動時過期。
   *
   * ⚠ **雙手武器只會有一個選項**：左右手都指向同一個 `dualHand` 座標，
   *   按 `slotKey()` 去重（不去重會出現兩顆做同一件事的按鈕）。
   */
  options: WeaponAutoEquipOption[]
  /** `options` 為空時的原因。挑「最接近成功」的那一條 —— 全部都是 structural 就取第一條 */
  rejection: Rejection | null
  /**
   * 這把**已經至少裝了一把**。
   *
   * ⚠ 「已經裝了」**不代表 `options` 是空的**（使用者裁決 2026-08-27）：玩家可能想
   *   雙手都拿同一把專武、或左手拿著再往肩上掛一把。已經拿著它的那一格會從選項裡
   *   拿掉（那一格沒事可做），其餘位置照給。
   *   第一版一發現裝過就把整顆按鈕收掉，等於替玩家否決了雙持。
   *
   * ⚠ **盾牌不必特判**：`SHIELD_LIMIT` 會讓第二面盾在 `canEquipWeapon()` 就被擋下，
   *   於是「左手已有這面盾」時右手那個選項自己消失、`options` 變空、按鈕自己不見。
   *
   * ⚠ 與「做不到」（`rejection` 有值）**是兩件事，不可靠 `options` 為空合併判斷**：
   *   兩者都會讓選項是空的，但一個該安靜、一個該說話。第一版沒有這個欄位，
   *   結果「輕型機沒有肩槽」被靜默當成「已經裝好了」——按鈕不見、原因也不見。
   */
  alreadyEquipped: boolean
}

/**
 * 「把這把武器裝到第一個裝得上的槽」。**唯讀，不改任何東西。**
 *
 * ⚠ 已經裝著這把武器時回 `ref: null` ＋ `rejection: null` —— 兩者都空的意思是
 *   「不必做任何事」，與「做不到」（有 rejection）分得開。呼叫端據此決定不畫按鈕。
 */
export function planWeaponAutoEquip(ctx: LoadoutContext, weapon: Weapon): WeaponAutoEquipPlan {
  const occupantEmpty: WeaponSlotRef[] = []
  const taken: WeaponSlotRef[] = []

  let alreadyEquipped = false

  for (const ref of enumerateSlots(ctx.capacity)) {
    // 槽型不合的連問都不必問（背部武器不會裝進手部），省掉一堆必然的 SLOT_MISMATCH。
    // ⚠ 這一圈掃的是**所有**槽型相符的位置 —— 雙手、雙肩、背部都在內，
    //   而不是只有手（使用者逐字：「位置可能是背後、肩膀、雙手」）。
    const mount = mountRefFor(weapon, ref)
    if (weapon.equipSlot !== mount.slot) continue
    const occ = slotOccupant(ctx, ref)
    // 這一格已經拿著它 ⇒ 這一格沒事可做，但**別的位置照給**（見 `alreadyEquipped` 的註解）
    if (occ.kind === 'weapon' && occ.weapon?.id === weapon.id) { alreadyEquipped = true; continue }
    ;(occ.kind === 'empty' ? occupantEmpty : taken).push(ref)
  }

  // 這台機甲根本沒有這種槽（輕型機沒有肩槽）——**要說出來**，不是回一個空計畫。
  // `canEquipWeapon()` 走不到這一條，因為上面的槽型過濾已經把候選清成零筆。
  if (occupantEmpty.length === 0 && taken.length === 0) {
    return {
      weapon, options: [], alreadyEquipped,
      // 已經裝滿了它自己（雙手都是同一把）⇒ 安靜收掉，不是「這台沒有這種槽」
      rejection: alreadyEquipped
        ? null
        : reject('NO_SLOT', `這台機甲沒有${OWN_SLOT_LABEL[weapon.equipSlot] ?? weapon.equipSlot}槽位`),
    }
  }

  const options: WeaponAutoEquipOption[] = []
  const seen = new Set<SlotKey>()
  let firstRejection: Rejection | null = null

  for (const ref of [...occupantEmpty, ...taken]) {
    // ⚠ 用 `withoutSlot()` 問：那一格現在裝的東西會被換掉，留著它會讓這把武器
    //   與**即將被自己取代的那一件**互相衝突（同 `weaponChoices()` 的處理）
    const r = canEquipWeapon(withoutSlot(ctx, ref), weapon, ref)
    if (r !== null) {
      // situational（重量不夠這類「改別的就能解」）優先報，它比 structural 有行動空間
      if (!firstRejection || (firstRejection.tier === 'structural' && r.tier === 'situational')) {
        firstRejection = r
      }
      continue
    }
    const mount = mountRefFor(weapon, ref)
    const key = slotKey(mount)
    if (seen.has(key)) continue          // 雙手武器：左右手指向同一格（見 `options` 的註解）
    seen.add(key)
    const occ = slotOccupant(ctx, ref)
    options.push({
      ref: mount,
      label: slotLabel(mount),
      displaces: occ.kind === 'weapon' ? occ.weapon?.name ?? null : null,
    })
  }

  return {
    weapon, options, alreadyEquipped,
    rejection:
      // 有選項就不必報原因 —— 那條原因是「某一格不行」，而玩家已經有能走的路了
      options.length > 0 ? null
      // 已經裝著它、其餘位置又都不行：多數情況該安靜（盾只能一面、位置本來就用完了），
      // **唯獨超重要說**。那是玩家改得動的事，而「想雙持卻沒看到按鈕」時，
      // 「再裝一把會超重」正是他缺的那一句。其餘一律不出聲，免得每一套配裝底下
      // 都掛著一行與他當下無關的說明。
      : alreadyEquipped ? (firstRejection?.code === 'OVERWEIGHT' ? firstRejection : null)
      : firstRejection,
  }
}

// ─── 一鍵裝滿（使用者要求 2026-08-27）─────────────────────────────────────────
//
// 「模組是否有辦法設計一個直接四顆套用的操作方式？」——使用者逐字。
//
// 同族疊等級是模組這一層的主要玩法（裝一顆通用Ⅱ 是 Lv2、兩顆才 Lv4），而現況要點四次：
// 四部位卡 → 面板 → 挑一顆 → 返回 → 換一格 → 再挑同一顆…。整套操作的形狀
// 與玩家腦中的「我要這顆模組滿級」完全對不上。
//
// ── 為什麼是「裝到滿級」而不是「無腦塞滿四格」──────────────────────────────
// 實測資料說了算（2026-08-27 全庫）：
//
//     機甲接口只有三種組合：S 級 64 台四格全 Ⅱ型／A 級 16 台是 Ⅰ Ⅱ Ⅱ Ⅰ／B 級 10 台無接口
//     候選池 186 顆的「補滿需要幾格」：4 格 105 顆・2 格 31 顆・8 格（補不滿）50 顆
//
// 於是「一律四格」在兩個常見情況下都是錯的：
//   · 通用 S 級模組（31 顆，＋2 級／顆）**兩格就滿 Lv4**，塞四格白費兩格 ——
//     而站上自己的超限提醒正是在勸玩家別這樣做。做一顆專門製造超限的按鈕自相矛盾。
//   · A 級機甲的軀幹與腿部是 Ⅰ型接口（只收 A 級模組），一顆 S 級模組
//     **最多只裝得上雙臂兩格**。承諾「四顆」到那裡會直接跳票。
//
// 所以這一支回答的是「這顆模組在這台機甲上，最多能到幾級、要動哪幾格」，
// 而按鈕的字面一律由本計畫產生（「裝滿 4 格」／「再補 1 格」），不寫死「四顆」。
//
// ── 優先動空格 ────────────────────────────────────────────────────────────
// 要覆蓋別人時先挑空的那幾格：一鍵操作的破壞力要盡量小。真的動到了別顆，
// 被換掉的一律進 toast 並可 [復原]（與 `equipModule` 的 displaced 同一條）。

/** `planModuleFill()` 的結果。**呼叫端不自己算**——按鈕的字與 reducer 的動作同源。 */
export interface ModuleFillPlan {
  mod: Module
  /** 要裝上去的格，依 `MechPartPosition` 宣告順序（空格優先，見檔頭） */
  targets: MechPartPosition[]
  /** 會被換掉的模組（`targets` 的子集），給 toast 用 */
  displaced: { position: MechPartPosition; moduleId: string }[]
  /** 這一族目前的生效等級（還沒動之前） */
  levelBefore: number
  /** 執行後的生效等級 */
  levelAfter: number
  cap: number
  /** 接口裝不下這顆的格數（Ⅰ型接口 ＋ S 級模組，或整台沒有接口） */
  blockedSlots: number
  /** 已經滿級（或沒有格可動）＝ 這顆按鈕不該出現 */
  noop: boolean
}

/**
 * 「把這顆模組裝到滿級」的計畫。**唯讀，不改任何東西。**
 *
 * ⚠ 已經裝著**同族**的格子一律不動：它們已經在貢獻等級了，重裝一次只是把
 *   Ⅰ 換成 Ⅱ 這種邊際情況，而那會讓「一鍵」變成一個玩家預測不到的重排。
 */
export function planModuleFill(ctx: LoadoutContext, mod: Module): ModuleFillPlan {
  const cap = moduleMaxLevel(mod)
  const add = moduleAddLevel(mod)
  const family = moduleFamilyKey(mod)
  const stacks = moduleStacks(ctx.modules, (id) => ctx.world.modules.get(id))
  const stack = stacks.get(family) ?? null
  const levelBefore = stack?.level ?? 0

  const open: MechPartPosition[] = []      // 空格
  const occupied: MechPartPosition[] = []  // 裝了別族的格
  let blockedSlots = 0

  for (const position of Object.values(MechPartPosition)) {
    if (canEquipModule(ctx, mod, { kind: 'module', position }) !== null) { blockedSlots++; continue }
    const cur = ctx.modules[position]
    const curMod = cur ? ctx.world.modules.get(cur) : undefined
    // 已經是同族 → 它已經在貢獻等級，不動它
    if (curMod && moduleFamilyKey(curMod) === family) continue
    if (cur) occupied.push(position)
    else open.push(position)
  }

  const targets: MechPartPosition[] = []
  const displaced: ModuleFillPlan['displaced'] = []
  let sum = stack?.sum ?? 0
  for (const position of [...open, ...occupied]) {
    if (sum >= cap) break
    targets.push(position)
    const cur = ctx.modules[position]
    if (cur) displaced.push({ position, moduleId: cur })
    sum += add
  }

  return {
    mod, targets, displaced, levelBefore,
    levelAfter: Math.min(sum, cap),
    cap, blockedSlots,
    noop: targets.length === 0,
  }
}

/** 這個背包能不能裝。合法回 `null`。 */
export function canEquipBackpack(ctx: LoadoutContext, backpack: Backpack): Rejection | null {
  if (!ctx.pilot) return reject('NO_PILOT', '請先選擇機師')
  if (!ctx.mech || !ctx.chassis) return reject('NO_MECH', '請先選擇機甲')
  if (ctx.lock) return reject('FORM_LOCKED', `${ctx.lock.formName}無法攜帶背包`)

  const backRef: WeaponSlotRef = { bank: 'main', slot: WeaponEquipSlot.BACK }
  const occ = ctx.occupied.get(slotKey(backRef))
  if (occ) {
    const src = ctx.world.weapons.get(occ.mount.weaponId)
    return reject('SLOT_OCCUPIED', `背槽已由固定武裝${src ? `「${src.name}」` : ''}佔用`)
  }

  // 正向邏輯：[] ＝ 無限制；有值則必須包含本機甲的裝甲類型。
  // ⚠ 背包這一欄是**英文**（'Light'/'Medium'/'Heavy'），要走 fromAssemblableArmorType()——
  //   餵給 toArmorType() 會全部回 null，症狀是 35 個「僅輕型可裝」的背包完全不受限。
  const allowed = (backpack.assemblableArmorType ?? [])
    .map(fromAssemblableArmorType)
    .filter((a): a is ArmorType => a !== null)
  if (allowed.length > 0 && !allowed.includes(toArmorType(ctx.chassis.armorType) as ArmorType)) {
    return reject('BACKPACK_ARMOR_TYPE', `僅${allowed.join('／')}機甲可裝備`)
  }

  const backWeapon = ctx.set.mounts.find((m) => m.slot === WeaponEquipSlot.BACK)
  if (backWeapon) {
    const w = ctx.world.weapons.get(backWeapon.weaponId)
    return rejectSituational('BACK_SLOT_TAKEN', `背槽已裝${w?.name ?? '背部武器'}`, {
      label: `卸下${w?.name ?? '背部武器'}並裝上`,
      action: { type: 'unequip', ref: backRef },
    })
  }

  return overweightRejection(ctx, { ref: backRef, weight: backpack.weight, backpackId: backpack.id }, backpack.name)
}

/**
 * 超重判定 ＋ 解法。
 *
 * ⚠ 判定的是**裝上之後**的總重，且走 `loadoutBudget()` 同一支函式 —— 舊版在每個挑選器
 *   各寫一次 `w.weight <= remainingOutput`，於是選背包時扣武器重、選武器時不扣背包重，
 *   跳著選會得到兩份不同的清單（bug ③）。
 */
function overweightRejection(
  ctx: LoadoutContext,
  add: NonNullable<BudgetHypothesis['add']>,
  incomingName: string,
): Rejection | null {
  const after = loadoutBudget(ctx, { add })
  if (!after.over) return null

  const need = -after.remaining
  const suffix = `（超出 ${need.toLocaleString()}）`
  const relief = bestRelief(ctx, add, need)
  if (!relief) {
    // 卸光也裝不下：這時候唯一誠實的解法就是「這台機甲載不動它」，不要給一個按了沒用的按鈕
    return rejectSituational('OVERWEIGHT', `${incomingName}超出這台機甲的可用出力${suffix}`, {
      label: '清空這套配裝再試',
      action: { type: 'unequip', ref: add.ref },
    })
  }
  return rejectSituational('OVERWEIGHT', `裝上${incomingName}會超出可用出力${suffix}`, {
    label: `卸下 ${slotLabel(relief.ref)} ${relief.name} 可裝`,
    action: relief.action,
  })
}

interface Relief { ref: WeaponSlotRef; name: string; action: ResolutionAction }

/**
 * 找出「卸掉它就裝得下」的一件已裝備物。
 *
 * ⚠ 用「卸掉之後總重下降多少」排序，不用該件的 `weight` —— 手部取**較重組**，
 *   卸掉較輕那一組的武器省下的是 0。用 weight 排序會產生一個按了畫面毫無變化的按鈕。
 * 夠用的裡面挑**最輕**（動最少）；一件都不夠時回 null 由呼叫端改口。
 */
function bestRelief(ctx: LoadoutContext, add: NonNullable<BudgetHypothesis['add']>, need: number): Relief | null {
  const cands: { saved: number; relief: Relief }[] = []
  const savedBy = (remove: Pick<WeaponSlotRef, 'bank' | 'slot' | 'side'>) =>
    loadoutBudget(ctx, { add }).weight.total - loadoutBudget(ctx, { add, remove: [remove] }).weight.total

  for (const m of ctx.set.mounts) {
    if (slotsOverlap(m, add.ref)) continue          // 本來就會被取代的不算解法
    const w = ctx.world.weapons.get(m.weaponId)
    if (!w) continue
    const ref: WeaponSlotRef = { bank: m.bank, slot: m.slot, side: m.side }
    cands.push({ saved: savedBy(ref), relief: { ref, name: w.name, action: { type: 'unequip', ref } } })
  }
  if (ctx.backpack && add.ref.slot !== WeaponEquipSlot.BACK) {
    const ref: WeaponSlotRef = { bank: 'main', slot: WeaponEquipSlot.BACK }
    cands.push({
      saved: savedBy(ref),
      relief: { ref, name: ctx.backpack.name, action: { type: 'unequipBackpack' } },
    })
  }

  const enough = cands.filter((c) => c.saved >= need).sort((a, b) => a.saved - b.saved)
  return enough[0]?.relief ?? null
}

// ─── validateLoadout：整套的問題清單 ────────────────────────────────────────

export interface LoadoutProblem {
  code: RejectionCode
  reason: string
  /** 有槽位的問題才有，UI 用來閃該格 */
  ref?: WeaponSlotRef
}

/**
 * 整套配裝的問題清單。空陣列 ＝ 這套現在合法。
 *
 * ⚠ **超重是問題但不是阻擋**（決策三）：擋了就會與「不自動移除超重武器」一起把使用者卡在
 *   既不能改也不能存的死狀態，而「等機甲升級／換強襲者背包就能裝」是真實的規劃用途。
 */
export function validateLoadout(ctx: LoadoutContext): LoadoutProblem[] {
  const problems: LoadoutProblem[] = []
  if (!ctx.pilot) problems.push({ code: 'NO_PILOT', reason: '尚未選擇機師' })
  if (!ctx.mech) { problems.push({ code: 'NO_MECH', reason: '尚未選擇機甲' }); return problems }
  if (ctx.pilot && !licenseAllows(ctx.pilot.license, ctx.mech.armorType)) {
    problems.push({
      code: 'LICENSE',
      reason: `${ctx.pilot.name}的${ctx.pilot.license}執照無法駕駛${ctx.mech.armorType}機甲`,
    })
  }
  if (ctx.lock) return problems     // 全鎖形態：整套由資料 derive，玩家沒有可犯的錯

  for (const m of ctx.set.mounts) {
    const ref: WeaponSlotRef = { bank: m.bank, slot: m.slot, side: m.side }
    const w = ctx.world.weapons.get(m.weaponId)
    if (!w) { problems.push({ code: 'SLOT_MISMATCH', reason: `${slotLabel(ref)}的武器資料已不存在`, ref }); continue }
    const r = canEquipWeapon(withoutSlot(ctx, ref), w, ref)
    // 超重已由整套判一次，不逐格重覆報
    if (r && r.code !== 'OVERWEIGHT') problems.push({ code: r.code, reason: `${slotLabel(ref)}：${r.reason}`, ref })
  }
  if (ctx.backpack) {
    const bare: LoadoutContext = { ...ctx, set: { ...ctx.set, backpackId: undefined }, backpack: null }
    const r = canEquipBackpack(bare, ctx.backpack)
    if (r && r.code !== 'OVERWEIGHT') problems.push({ code: r.code, reason: `背包：${r.reason}` })
  }

  const budget = loadoutBudget(ctx)
  if (budget.over) {
    problems.push({
      code: 'OVERWEIGHT',
      reason: `總重 ${budget.weight.total.toLocaleString()} 超出可用出力 ${budget.output.total.toLocaleString()}（超出 ${(-budget.remaining).toLocaleString()}）`,
    })
  }
  return problems
}

/** 檢查「已經裝著的東西」時，要先把它自己拿掉再問，否則它會與自己衝突。 */
function withoutSlot(ctx: LoadoutContext, ref: WeaponSlotRef): LoadoutContext {
  return { ...ctx, set: { ...ctx.set, mounts: ctx.set.mounts.filter((m) => !slotsOverlap(m, ref)) } }
}

// ─── 挑選器清單：唯一的來源 ────────────────────────────────────────────────

/** 挑選器的一列：東西本身 ＋ 它為什麼（不）能選。`rejection` 為 null ＝ 可直接裝上。 */
export interface PickerEntry<T> {
  item: T
  rejection: Rejection | null
}

/**
 * 品質由高到低的名次。查無 ＝ 排最後（而不是排最前）—— 認不得的值不該插隊。
 *
 * ⚠ 武器與背包**共用同一組值域**（`WeaponRarity`；背包的 `rarity` 註解逐字寫著
 *   「與武器共用」），所以只需要這一張表。
 */
const RARITY_RANK: Record<string, number> = { SS: 0, 'S+': 1, S: 2, A: 3, B: 4 }
const rarityRank = (r?: string) => (r !== undefined && r in RARITY_RANK ? RARITY_RANK[r] : 99)

/**
 * 排序：可裝的在前，其中**品質由高到低**，同品質再依重量由輕到重；
 * 情境性拒絕次之，結構性拒絕最後。
 *
 * ⚠ 品質是主鍵而不是重量（PLAN-052-I 驗收後調整）：玩家挑武器的第一個問題是
 *   「我最好的那幾把是哪些」，不是「哪一把最輕」。純按重量排會把一堆 B 品質的
 *   輕武器頂到最上面，等於每次都要捲過整份低階清單才看得到堪用的。
 *   重量退成同品質內的次鍵 —— 那時它才是有意義的比較（同一級裡誰比較省出力）。
 *
 * ⚠ 不做「按名稱排序」：玩家在挑選器裡問的是「我現在裝得上什麼」，
 *   而不是「這把武器的注音排第幾」。可裝的沉底就等於要捲三頁才看得到第一個能選的。
 */
function pickerOrder<T extends { weight: number; rarity?: string }>(
  a: PickerEntry<T>, b: PickerEntry<T>,
): number {
  const rank = (e: PickerEntry<T>) =>
    e.rejection === null ? 0 : e.rejection.tier === 'situational' ? 1 : 2
  return rank(a) - rank(b)
    || rarityRank(a.item.rarity) - rarityRank(b.item.rarity)
    || a.item.weight - b.item.weight
}

/**
 * 某一格的武器清單。**已濾掉 `omitted`** —— 那些不是拒絕，是槽的定義
 * （把 180 把武器裡的 160 把「槽位不符」列進來，清單會長到沒人捲得完）。
 *
 * 回傳空陣列代表**這一格結構上沒有東西可裝**（例：戰術形態的手部 —— 戰術類武器
 * 全庫只有肩 22 與背 22，手部一把都沒有）。呼叫端該整格說明原因，不是給一個空清單。
 */
export function weaponChoices(ctx: LoadoutContext, ref: WeaponSlotRef): PickerEntry<Weapon>[] {
  const out: PickerEntry<Weapon>[] = []
  // 掃描時把「這一格現在裝的那件」先拿掉，否則它會與自己衝突（顯示成背槽已佔用）
  const bare = withoutSlot(ctx, ref)
  for (const w of ctx.world.weapons.values()) {
    const r = canEquipWeapon(bare, w, ref)
    if (r && r.tier === 'omitted') continue
    if (r && r.tier === 'blocked') return []      // 整個挑選器不該開，見 PickerShell 的降級
    out.push({ item: w, rejection: r })
  }
  return out.sort(pickerOrder)
}

/** 背包清單。規則同 `weaponChoices()`。 */
export function backpackChoices(ctx: LoadoutContext): PickerEntry<Backpack>[] {
  const out: PickerEntry<Backpack>[] = []
  const bare: LoadoutContext = { ...ctx, set: { ...ctx.set, backpackId: undefined }, backpack: null }
  for (const b of ctx.world.backpacks.values()) {
    const r = canEquipBackpack(bare, b)
    if (r && r.tier === 'omitted') continue
    if (r && r.tier === 'blocked') return []
    out.push({ item: b, rejection: r })
  }
  return out.sort(pickerOrder)
}

/**
 * 某一把武器的元件清單。規則同 `weaponChoices()`：濾掉 omitted、
 * blocked 早退回空陣列（整個面板該降級說明，而不是給一個空清單）。
 *
 * ⚠ **structural 的不濾掉**（052-I 已定的原則）：「我的元件呢」比多幾列雜訊更難處理——
 *   玩家找不到一個他知道存在的東西時，會以為是站上缺資料，而不會想到是自己這把武器不相容。
 *
 * ⚠ 排序**不沿用 `pickerOrder()`**：那一支的次鍵是重量，而元件沒有重量欄位。
 *   改成「可裝的在前 → 觸發機率等級高的在前 → 品質高的在前 → 名稱」——
 *   Lv 是玩家挑元件時唯一看得到的強弱訊號（機率表待建檔，見計畫書不在範圍內）。
 */
export function componentChoices(ctx: LoadoutContext, ref: WeaponSlotRef): PickerEntry<Component>[] {
  const out: PickerEntry<Component>[] = []
  for (const c of ctx.world.components.values()) {
    const r = canEquipComponent(ctx, c, ref)
    if (r && r.tier === 'omitted') continue
    if (r && r.tier === 'blocked') return []
    out.push({ item: c, rejection: r })
  }
  const rank = (e: PickerEntry<Component>) =>
    e.rejection === null ? 0 : e.rejection.tier === 'situational' ? 1 : 2
  return out.sort((a, b) =>
    rank(a) - rank(b)
    || (b.item.probabilityLevel ?? 0) - (a.item.probabilityLevel ?? 0)
    || rarityRank(a.item.rarity) - rarityRank(b.item.rarity)
    || a.item.name.localeCompare(b.item.name, 'zh-Hant'))
}

/**
 * 某個模組接口的候選清單（PLAN-052-G C-3）。
 *
 * ⚠ **來源是 `moduleCandidates()` 而不是整個 `world.modules`**：241 筆裡有 55 筆
 *   玩家根本拿不到（專屬 24 ／ 副模組 11 ／ 廢案 1 ／ 綁機甲的特性模組），
 *   把它們列進來再標「不可自由裝配」，等於在 186 筆的清單裡摻進三成永遠選不了的雜訊。
 *   這與元件那邊「裝不上的留在清單裡」不同調 —— 那裡的拒絕是**這把武器**的限制
 *   （換一把就能裝，所以要看得見）；這裡的是**這顆模組根本不存在於玩家的倉庫**。
 *
 * `blocked` 一律回空陣列：整個面板該降級說明（B 品質沒有接口），不是給一個空清單。
 *
 * 排序：可裝的在前 → 槽位（特性／8級／通用）→ 品質高到低 → 名稱。
 * 槽位當主鍵是因為面板的分類晶片就是照它分的，兩者一致才不會「按鈕排一種、結果排另一種」。
 */
export function moduleChoices(ctx: LoadoutContext, ref: ModuleSlotRef): PickerEntry<Module>[] {
  const out: PickerEntry<Module>[] = []
  for (const m of moduleCandidates(ctx.world.modules.values())) {
    const r = canEquipModule(ctx, m, ref)
    if (r && r.tier === 'omitted') continue
    if (r && r.tier === 'blocked') return []
    out.push({ item: m, rejection: r })
  }
  const rank = (e: PickerEntry<Module>) =>
    e.rejection === null ? 0 : e.rejection.tier === 'situational' ? 1 : 2
  return out.sort((a, b) =>
    rank(a) - rank(b)
    || compareModuleBySlot(a.item.slot, b.item.slot)
    || rarityRank(a.item.rarity) - rarityRank(b.item.rarity)
    || a.item.name.localeCompare(b.item.name, 'zh-Hant'))
}

// ─── 部件混搭：四個部位各自換來源機甲（PLAN-052-G Phase D）──────────────────
//
// 總綱決策七：**同裝甲類型**、Σ 四部位、換基底機甲即清空。
// 規則本身只有一行（`source.armorType === base.armorType`），
// 但那一行帶掉了一整串本來會很難的問題：不能跨型 ⇒ 四部位必定同型 ⇒
// 「混搭後裝甲類型由誰決定」自動消失，雙肩槽與執照判定完全不受影響。
//
// ⚠ **本站不做擁有限制**（總綱 Open Question ④ 的預設答案）：來源池是全庫同型機甲，
//   不問玩家有沒有那台。模擬器的用途是「試配」，擋在這裡等於要玩家先把倉庫輸入一遍。

/**
 * 這一格可不可以換成 `source` 的同位部件。可以回 `null`。
 *
 * ⚠ 「換成自己」不是拒絕 —— 那是**還原成原廠**，由 reducer 的 `resetPart` 表達
 *   （見 `swapPart` 的註解：與原廠相同時刪掉鍵而不是寫入自己的 mechId）。
 */
export function canSwapPart(
  ctx: LoadoutContext,
  source: Mech,
  position: MechPartPosition,
): Rejection | null {
  if (!ctx.mech || !ctx.chassis) return reject('NO_MECH', '請先選擇機甲')

  // ① 同裝甲類型 —— 決策七的那一行
  if (source.armorType !== ctx.mech.armorType) {
    // ⚠ 兩型都要寫出來。`ArmorType` 的值是 輕型／**中甲**／重型（官方命名本來就不齊），
    //   只說「不相容」等於沒說 —— 玩家看不出來是自己這台的問題還是那台的問題。
    return reject(
      'PART_INCOMPATIBLE',
      `不能跨裝甲類型混搭：${source.name}是${source.armorType}，這台是${ctx.mech.armorType}`,
    )
  }

  // ② 來源機甲沒有這個部位（或還是 legacy 的耐久數字）
  const part = partOf(source.parts, position)
  if (!part) return reject('PART_DATA_INCOMPLETE', `${source.name}的${partLabel(position)}資料未建檔`)

  // ③ 佔位機甲：四部位全 0（新機甲一律先建檔再補數值）
  //
  //    ⚠ 判準看**整台**而不是這一個部位：單一部位的重量 0 是可能的真值
  //      （純封鎖型固定武裝那幾件就是 0），而「整台四部位加起來是 0」才是佔位。
  //    ⚠ 2026-08-28 直讀正式庫：**今天 0 台命中**（90 台的四部位重量全部 > 0）。
  //      留著是因為佔位慣例保證它會再出現 —— 列成一組重量 0 的「免費部件」
  //      會讓玩家配出一台不存在的機體，而且看起來像 bug 而不是資料狀態。
  if (chassisWeight(source.parts) === 0) {
    return reject('PART_DATA_INCOMPLETE', `${source.name}的官方數值尚未公布`)
  }

  return null
}

/**
 * 某一個部位的來源機甲清單（PLAN-052-G D-2）。
 *
 * 池子是**全庫同裝甲類型**：輕型 27 ／ 中甲 36 ／ 重型 27（含自己）。
 * 一頁列得完，不必分頁；每個部位都帶 icon（352／360 有圖）。
 *
 * ⚠ **基底機甲自己留在清單裡**，而且排第一 —— 它是「還原成原廠」的入口。
 *   把它濾掉的話，換錯之後就只剩「整台重選一次」這條路。
 *
 * ⚠ 與 `moduleChoices()` 一樣濾掉 omitted、blocked 早退空陣列；
 *   structural（裝甲類型不符／數值未公布）**也不列** —— 它們不是「這一格的限制」，
 *   而是「這台機甲根本不該出現在這個池子裡」。被濾掉幾筆由挑選器的 hint 交代。
 */
export function partChoices(ctx: LoadoutContext, position: MechPartPosition): PickerEntry<Mech>[] {
  const out: PickerEntry<Mech>[] = []
  for (const m of ctx.world.mechs.values()) {
    const r = canSwapPart(ctx, m, position)
    if (r && r.tier === 'blocked') return []
    if (r) continue                       // structural：不列（見檔頭）
    out.push({ item: m, rejection: null })
  }
  // 原廠排第一，其餘依重量輕到重（混搭的第一動機就是減重）、再依名稱
  const baseId = ctx.mech?.id
  return out.sort((a, b) =>
    (a.item.id === baseId ? -1 : 0) - (b.item.id === baseId ? -1 : 0)
    || (partOf(a.item.parts, position)?.weight ?? 0) - (partOf(b.item.parts, position)?.weight ?? 0)
    || a.item.name.localeCompare(b.item.name, 'zh-Hant'))
}

/** 這一格今天的來源機甲 id（沒換過＝基底機甲本人）。 */
export function partSourceId(ctx: LoadoutContext, position: MechPartPosition): string | null {
  return ctx.chassis?.parts[position].sourceMechId ?? null
}

/**
 * 這一格在**結構上**有沒有東西可裝（不看重量、不看誰佔著）。
 *
 * 專供槽位圖判斷「要不要整格說明原因」用，所以刻意寫成一次早退的掃描而不是走 `weaponChoices()`——
 * 後者對每一把武器都要算一次預算，而槽位圖每次 render 要問 7 格。
 *
 * 回 false 的實例：戰術形態的手部 —— 戰術類武器全庫只有肩 22 與背 22，手部一把都沒有。
 * 那一格會顯示「戰術形態沒有可裝在手部的武器」，而不是一個點不下去的空 `[+]`。
 */
export function slotHasCandidates(ctx: LoadoutContext, ref: WeaponSlotRef): boolean {
  if (!slotExists(ctx.capacity, ref)) return false
  const allow = ctx.form?.restrict.kind === 'weaponType' ? (ctx.form.restrict.allow as readonly string[]) : null
  const armor = toArmorType(ctx.chassis?.armorType)
  for (const w of ctx.world.weapons.values()) {
    if (w.isFixedArmament) continue
    // 與 canEquipWeapon() 同一條換算：手部格也接受雙手武器（它佔的是左右兩格）。
    // 少了這行，一台只剩雙手武器可選的機甲會被畫成「沒有可裝的武器」。
    const mount = mountRefFor(w, ref)
    if (w.equipSlot !== mount.slot) continue
    if (!slotExists(ctx.capacity, mount)) continue
    if (allow && !allow.includes(w.type)) continue
    const need = restrictedTo(w.mechRestriction)
    if (need && armor !== need) continue
    return true
  }
  return false
}

/**
 * 有沒有任何背包裝得上這台機甲（不看重量、不看背槽被誰佔著）。
 *
 * ⚠ 背槽的「有沒有東西可裝」**不能只問武器**：22 把背部武器 100% 限中甲、且全是戰術類，
 *   所以先鋒形態的中甲、以及任何輕型／重型機甲，武器候選都是 0 ——
 *   只問 `slotHasCandidates()` 會把背槽畫成 ▨ 無槽，而 181 個背包全都裝在那一格。
 */
export function backpackHasCandidates(ctx: LoadoutContext): boolean {
  const armor = toArmorType(ctx.chassis?.armorType)
  for (const b of ctx.world.backpacks.values()) {
    const allowed = (b.assemblableArmorType ?? []).map(fromAssemblableArmorType).filter(Boolean)
    if (allowed.length === 0 || (armor && allowed.includes(armor))) return true
  }
  return false
}

/** 結構性拒絕的分組計數（摺疊列用）：`[['形態限定', 90], ['機種限定', 6]]`。 */
export function structuralCounts<T>(entries: readonly PickerEntry<T>[]): [RejectionCode, number][] {
  const counts = new Map<RejectionCode, number>()
  for (const e of entries) {
    if (e.rejection?.tier !== 'structural') continue
    counts.set(e.rejection.code, (counts.get(e.rejection.code) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

// ─── 機甲挑選器的過濾 ───────────────────────────────────────────────────────

/** 裝甲類型 → 駕駛它所需的執照（一對一，不是「以上」）。用於「需要中型執照」這句話。 */
const REQUIRED_LICENSE: Record<string, string> = {
  [ArmorType.LIGHT]:  MechLicense.LIGHT,
  [ArmorType.MEDIUM]: MechLicense.MEDIUM,
  [ArmorType.HEAVY]:  MechLicense.HEAVY,
}

/**
 * 這位機師能不能駕駛這台機甲。
 *
 * ⚠ 一律走 `licenseAllows()`，**禁止**在頁面裡寫 `license === '中甲'` —— 那是 bug ①：
 *   執照是「輕型／中型／重型」，裝甲是「輕型／中甲／重型」，只有中階不同名，
 *   於是那條分支恆為 false，37/89 位機師（含海莉絲）看得到他們駕駛不了的重型機甲。
 *   tsc 當時抓不到，因為兩邊都推導成 string；052-A 已把兩者都收成 enum。
 *
 * ⚠ 2026-08-25：執照是**一對一**的（重型執照＝只能開重型），不是階梯式包含。
 *   原本 `licenseAllows()` 讓重型執照全開，於是重型機師照樣選得到輕型／中甲機甲。
 */
export function canSelectMech(pilot: Pilot | null, mech: Mech): Rejection | null {
  if (!pilot) return null
  if (licenseAllows(pilot.license, mech.armorType)) return null
  return reject('LICENSE', `需要${REQUIRED_LICENSE[mech.armorType] ?? mech.armorType}執照`)
}
