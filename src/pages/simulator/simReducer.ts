// 配裝狀態機 —— PLAN-052-B Phase A / A-1
//
// ── 為什麼所有級聯都塞進一支 reconcile() ────────────────────────────────────
// 需求逐字是「選完機師才知道要篩選什麼機甲、選完機甲才知道哪個槽被限制住」——
// 也就是說**每一個動作都可能讓別的地方失效**。散在各個 handler 的寫法會變成
// N×N 條「換 A 時記得檢查 B」，而漏掉的那一條是靜默的（畫面上留著一件裝不上的裝備）。
//
// 這裡只有一條規則：**任何動作之後都跑同一支 reconcile()**。
// 動作本身只做「把東西放進去／拿出來」這件結構性的事，合法性一律事後統一掃。
//
// ── 復原 ────────────────────────────────────────────────────────────────────
// 每次級聯移除推一筆 undo（**只留最近 1 筆**）：多層 undo 在這種「邊試邊改」的介面裡
// 幾乎沒有人用，卻要求使用者理解一個堆疊。toast 上的 [復原] 還原**整批**，不是逐件。
// 第二層保險是頁面把 draft 寫進 localStorage（見 LoadoutPage 的 useLoadoutDraftCache）。
//
// 純函式、無 React 依賴，可單測（npm test）。

import type { EquipSet, LoadoutDraft, LoadoutMount, MountSetup } from '../../types/loadout'
import type { ModuleSlotRef, WeaponSlotRef } from '../../types/slots'
import { MechPartPosition, WeaponEquipSlot } from '../../types/enums.ts'
import { equipSetKeys, DEFAULT_EQUIP_SET_KEY } from '../../utils/forms.ts'
import { licenseAllows } from '../../utils/normalizeArmorType.ts'
import { slotLabel } from '../../utils/mechSlots.ts'
import { partLabel } from '../../utils/moduleSlots.ts'
import { MECH_PART_ORDER } from '../../utils/chassisStats.ts'
import {
  buildContext, canEquipWeapon, canEquipBackpack, canEquipComponent, canEquipModule, canSwapPart, loadoutBudget,
  planModuleFill, slotsOverlap,
  type LoadoutContext, type LoadoutWorld, type ResolutionAction,
} from '../../utils/loadoutRules.ts'
import { ND_RULES, isGammaZone, zonePower } from '../../utils/ndOverrides.ts'
import { sanitizeLoadoutName, sanitizeLoadoutNote } from '../../utils/loadoutName.ts'
import { keepCarriableSkills } from '../../utils/carriedSkills.ts'
import { CARRIED_SKILL_SLOTS } from '../../types/loadout.ts'

// ─── 動作 ───────────────────────────────────────────────────────────────────

/**
 * ⚠ `unequip` / `unequipBackpack` 的形狀與 `loadoutRules` 的 `ResolutionAction` **必須一致**：
 *   拒絕訊息上的解法按鈕會直接把那個 action 派進來。型別上用聯集納入，
 *   而不是各寫一份 —— 兩份會在改名時靜默不同步。
 */
export type LoadoutAction =
  | ResolutionAction
  | { type: 'selectPilot'; pilotId: string }
  | { type: 'selectMech'; mechId: string }
  | { type: 'clearMech' }
  | { type: 'setActiveSet'; key: string }
  | { type: 'equipWeapon'; ref: WeaponSlotRef; weaponId: string }
  | { type: 'equipBackpack'; backpackId: string }
  /**
   * 清空**這一套的裝備**：目前分頁的武器與背包（連同掛在武器上的元件）。
   * 機師、機甲、模組、算力、方案名稱一律留著 —— 它們不是「裝備」。
   */
  | { type: 'clearSet' }
  /**
   * 全部清空：**連機師與機甲一起丟掉**，回到剛進頁面的狀態。
   *
   * ⚠ 與 `clearSet` 是底部同一列相鄰的兩顆按鈕，長得一樣、差別只在「連人帶機」
   *   還是「只有裝備」—— 所以兩者都走 `commitClear()`，一定跳 toast 且附 [復原]。
   *   按錯的代價是整套配裝，而這是唯一救得回來的路。
   */
  | { type: 'clearAll' }
  | { type: 'autoUnloadToFit' }
  /** 設定整份神經驅動算力配置（分區名 → Lv）。面板一次送整份，不逐區增減 —— γ 上限是**跨區**的 */
  | { type: 'setNdLevels'; levels: Record<string, number> }
  /** 設定方案名稱。收原始輸入，清洗由 reducer 負責（見 sanitizeLoadoutName 的檔頭） */
  | { type: 'setName'; name: string }
  /** 設定方案備註（PLAN-052-L C-2）。同 setName：收原始輸入，清洗由 reducer 負責 */
  | { type: 'setNote'; note: string }
  /**
   * 把一個技能放進第 `index` 格（PLAN-052-L D-4）。
   *
   * ⚠ `index` 可以等於目前的長度（＝放進第一個空格），但**不可以跳過空格**：
   *   `carried` 是緊湊陣列（見 `LoadoutSkills.carried`），reducer 會把超出長度的
   *   index 收斂成 append。挖洞的話那個洞會在 `JSON.stringify` 之後變成 `null`，
   *   而下游會拿 `null` 去查技能。
   *
   * ⚠ 同一個技能已經在別格時**是搬移不是複製**：遊戲裡帶兩個一樣的技能沒有意義，
   *   而重複的 id 會讓「移除」變成一個位置不確定的動作。
   */
  | { type: 'equipSkill'; index: number; skillId: string }
  /** 拿掉一個攜帶技能（PLAN-052-L D-4）。**用 id 不用 index**：拿掉之後陣列會往前收， */
  | { type: 'unequipSkill'; skillId: string }
  | { type: 'undo' }
  | { type: 'dismissNotice' }
  /**
   * 把一顆元件掛到某一把武器上（PLAN-052-D B-1）。`ref` 是**武器自己的座標**
   * （雙手武器 ＝ `dualHand`，不是它蓋住的兩格之一）。
   *
   * ⚠ 卸下用的是 `ResolutionAction` 裡的 `unequipComponent` —— 拒絕訊息上的解法按鈕
   *   會直接派它進來，兩邊共用同一個形狀（見本 union 開頭的註解）。
   */
  | { type: 'equipComponent'; ref: WeaponSlotRef; componentId: string }
  /**
   * 把一顆模組裝進某個接口（PLAN-052-G C-1）。`ref` 是**模組座標**（`{ kind:'module', position }`），
   * 不是武器格 —— 兩者由 `SlotRef` 的 kind 分開（決策五）。
   *
   * ⚠ 卸下用的是 `ResolutionAction` 裡的 `unequipModule` —— 拒絕訊息上的解法按鈕
   *   會直接派它進來，兩邊共用同一個形狀（見本 union 開頭的註解）。
   */
  | { type: 'equipModule'; ref: ModuleSlotRef; moduleId: string }
  /**
   * 部件混搭（PLAN-052-G D-1）：把某個部位換成 `sourceMechId` 的同位部件。
   *
   * ⚠ **與選定機甲相同時走 `resetPart` 而不是寫入自己的 mechId** —— 這個 reducer 會替你
   *   收掉，但呼叫端也不該假裝它們是兩件不同的事。理由是分享碼：`§PARTS` 是變長段，
   *   寫入自己的 id 會讓**每一份**分享碼都多帶四個永遠不變的號碼。
   */
  | { type: 'swapPart'; position: MechPartPosition; sourceMechId: string }
  /** 把某個部位還原為**選定機甲**的同位部件（刪掉那個鍵）。 */
  | { type: 'resetPart'; position: MechPartPosition }
  /**
   * **四個部位一次全部換成同一台**（使用者要求 2026-08-29）。
   *
   * 換完軀幹之後想「其餘三格也跟著走」是最常見的下一步，而逐格點四次要開四個面板。
   * 傳基底機甲 ＝ 整台還原為選定機甲（與 `swapPart` 同一條收斂）。
   *
   * ⚠ **任一格不合法就整批不做**：半套的結果比什麼都沒發生更難解釋
   *   （畫面會變成「我按了套用，但只換了兩格，而且沒有人告訴我為什麼」）。
   */
  | { type: 'applyChassisOf'; sourceMechId: string }
  /**
   * 一鍵裝滿（使用者要求 2026-08-27）：把這顆模組裝到**這一族滿級**為止。
   *
   * ⚠ 動幾格、動哪幾格一律由 `planModuleFill()` 決定，**這裡不重算** ——
   *   按鈕上印的字與實際動作各算一次，就是兩者對不起來的開始
   *   （按鈕寫「裝滿 4 格」卻只裝了 2 格，而畫面不會說任何話）。
   */
  | { type: 'fillModule'; moduleId: string }
  /** 由外部載入一份草稿（ProfilePage 的舊存檔、未來的分享碼）。一樣要過 reconcile */
  | { type: 'loadDraft'; draft: LoadoutDraft }

// ─── 狀態 ───────────────────────────────────────────────────────────────────

/**
 * 被級聯移除的一件裝備。UI 用它組 toast，也用它做 [復原]。
 *
 * ⚠ `component` 這一種**非開不可**（PLAN-052-D 決策九），與算力的處理刻意相反：
 *   算力被 reconcile 修正時，面板上的方格會就地變樣、玩家看得到，所以它不進 removed；
 *   **元件不會** —— 它藏在「點開武器列再鑽進面板」兩層之後。換一把武器就靜默丟掉
 *   四顆元件而不吭一聲，是這一層最容易長出來的客服問題。
 */
export interface RemovedItem {
  kind: 'weapon' | 'backpack' | 'component' | 'module' | 'part'
  id: string
  /** 顯示名。查不到資料時退回 id —— 那代表資料斷鏈，該被看見而不是靜默留白 */
  name: string
  /**
   * 它原本在哪一格。
   *
   * ⚠ 元件填的是**純槽位標籤**（「右手」）而不是「右手 叢林之災」：
   *   `flashOf()` 拿這個字串去讓槽位圖閃橙，混進武器名就再也對不上任何一格。
   *   掛在哪一把由 `why` 講（「叢林之災已換成熔火」）。
   */
  where?: string
  /** 為什麼被移除（中文，已填入具體對象） */
  why: string
}

/**
 * 一次級聯的完整回饋。`seq` 由狀態自己遞增 —— **不可用 Date.now()**：
 * 同一毫秒內兩次級聯會撞 key，而且測試裡不可重現。
 */
export interface CascadeNotice {
  seq: number
  title: string
  removed: RemovedItem[]
  /** 額外說明（如出力變化）。與 removed 分開，因為它不是「被移除的東西」 */
  notes: string[]
  /** 這些格要閃橙 600ms */
  flash: string[]
  /**
   * [復原] 可不可按。
   *
   * ⚠ 清空類動作（`clearSet` / `clearAll`）**提供**復原（見 `commitClear`）：
   *   兩顆按鈕相鄰、都不會二次確認，沒有復原的話按錯就只能憑記憶重配一次。
   *   `loadDraft` 仍然不提供 —— 貼碼與書架都還在原地，再來一次即可。
   */
  undoable: boolean
}

export interface SimState {
  draft: LoadoutDraft
  /** 最近一次級聯前的草稿快照。只留 1 筆，見檔頭 */
  undo: LoadoutDraft | null
  notice: CascadeNotice | null
  seq: number
}

export const INITIAL_SIM_STATE: SimState = {
  draft: { activeSetKey: DEFAULT_EQUIP_SET_KEY, sets: {} },
  undo: null,
  notice: null,
  seq: 0,
}

// ─── 小工具 ─────────────────────────────────────────────────────────────────

const emptySet = (): EquipSet => ({ mounts: [] })

function setOf(draft: LoadoutDraft, key: string): EquipSet {
  return draft.sets[key] ?? emptySet()
}

function withSet(draft: LoadoutDraft, key: string, set: EquipSet): LoadoutDraft {
  return { ...draft, sets: { ...draft.sets, [key]: set } }
}

/** 掛在這一筆 mount 上的元件 doc id（觸在前、應在後）。 */
function mountedIds(m: LoadoutMount): string[] {
  return [...(m.setup?.triggerComponentIds ?? []), ...(m.setup?.effectComponentIds ?? [])]
}

/**
 * 換掉一筆 mount 的元件設定。
 *
 * ⚠ **兩條清單都空時整個 `setup` 欄位不存在**，不留 `{}` 也不留空陣列 ——
 *   同 `backpackId` / `ndLevels`：三態（有值／空／不存在）撞上 `stripUndefined`
 *   （firestoreCore.ts）會變成「一旦填了就再也清不掉」。
 */
function withSetup(m: LoadoutMount, trigger: readonly string[], effect: readonly string[]): LoadoutMount {
  const next: LoadoutMount = { ...m }
  if (trigger.length === 0 && effect.length === 0) {
    delete next.setup
    return next
  }
  const setup: MountSetup = {}
  if (trigger.length) setup.triggerComponentIds = [...trigger]
  if (effect.length) setup.effectComponentIds = [...effect]
  next.setup = setup
  return next
}

/** 加一顆元件。已經在清單裡時原樣回傳 —— 呼叫端負責判斷那是不是錯誤。 */
function addComponent(m: LoadoutMount, id: string, isCondition: boolean): LoadoutMount {
  const trigger = m.setup?.triggerComponentIds ?? []
  const effect = m.setup?.effectComponentIds ?? []
  if (trigger.includes(id) || effect.includes(id)) return m
  return isCondition ? withSetup(m, [...trigger, id], effect) : withSetup(m, trigger, [...effect, id])
}

/** 拿掉一顆元件。不在清單裡時原樣回傳。 */
function removeComponent(m: LoadoutMount, id: string): LoadoutMount {
  const trigger = m.setup?.triggerComponentIds ?? []
  const effect = m.setup?.effectComponentIds ?? []
  if (!trigger.includes(id) && !effect.includes(id)) return m
  return withSetup(m, trigger.filter((x) => x !== id), effect.filter((x) => x !== id))
}

/** 把 mount 攤成人類看得懂的「左肩 熔火」。 */
function mountWhere(m: Pick<LoadoutMount, 'bank' | 'slot' | 'side'>): string {
  return slotLabel({ bank: m.bank, slot: m.slot, side: m.side })
}

// ─── 模組接口（PLAN-052-G C-1）──────────────────────────────────────────────

/**
 * 把某個接口設成某顆模組。
 *
 * ⚠ **未裝時欄位不存在，不存 `null`**（`stripUndefined` 的老坑，同 `backpackId` / `ndLevels`）：
 *   三態（有值／null／undefined）撞上 Firestore 的 `stripUndefined` 會變成
 *   「一旦填了就再也清不掉」——052-E 的雲端存檔存的就是這份 `LoadoutDraft`。
 */
function withModule(draft: LoadoutDraft, position: MechPartPosition, moduleId: string): LoadoutDraft {
  return { ...draft, modules: { ...draft.modules, [position]: moduleId } }
}

/** 清掉某個接口。清完整份都空了就把 `modules` 欄位本身拿掉（理由同 `withoutNdLevels`）。 */
function withoutModule(draft: LoadoutDraft, position: MechPartPosition): LoadoutDraft {
  if (!draft.modules?.[position]) return draft
  const modules = { ...draft.modules }
  delete modules[position]
  return withModules(draft, modules)
}

/** 換掉某個部位的來源機甲。 */
function withPart(draft: LoadoutDraft, position: MechPartPosition, sourceMechId: string): LoadoutDraft {
  return { ...draft, parts: { ...draft.parts, [position]: sourceMechId } }
}

/** 把某個部位還原成選定機甲。清完整份都空了就把 `parts` 欄位本身拿掉（理由同 `withModules`）。 */
function withoutPart(draft: LoadoutDraft, position: MechPartPosition): LoadoutDraft {
  if (!draft.parts?.[position]) return draft
  const parts = { ...draft.parts }
  delete parts[position]
  if (Object.keys(parts).length > 0) return { ...draft, parts }
  const rest = { ...draft }
  delete rest.parts
  return rest
}

/** 換掉整份 `modules`；空了就移除欄位本身。 */
function withModules(draft: LoadoutDraft, modules: Partial<Record<MechPartPosition, string>>): LoadoutDraft {
  if (Object.keys(modules).length > 0) return { ...draft, modules }
  if (!('modules' in draft)) return draft
  const rest = { ...draft }
  delete rest.modules
  return rest
}

// ─── reconcile：唯一的級聯 ──────────────────────────────────────────────────

/**
 * 把一份草稿掃成合法狀態，並回報被移除了什麼。**所有動作的最後一步都是它。**
 *
 * 掃描順序刻意由外而內 —— 外層的決定會讓內層整片失效，反過來則不會：
 *   機師執照 → 機甲 → 分頁鍵 → 背包 → 各槽武器
 *
 * ⚠ **超重不在這裡處理**（決策三）：超重是問題但不是非法，reconcile 不動它。
 *   自動卸載只有玩家主動按 [自動卸至符合] 才會發生。
 */
export function reconcile(draft: LoadoutDraft, world: LoadoutWorld): { draft: LoadoutDraft; removed: RemovedItem[] } {
  const removed: RemovedItem[] = []
  let next = draft

  // ── 機甲：執照容不下就整台移除（連帶所有 sets）──
  const pilot = next.pilotId ? world.pilots.get(next.pilotId) : null
  const mech = next.mechId ? world.mechs.get(next.mechId) : null
  if (next.mechId && !mech) {
    removed.push({ kind: 'weapon', id: next.mechId, name: next.mechId, why: '機甲資料已不存在' })
    next = { ...next, mechId: undefined, sets: {} }
  } else if (pilot && mech && !licenseAllows(pilot.license, mech.armorType)) {
    removed.push({ kind: 'weapon', id: mech.id, name: mech.name, why: `${pilot.license}執照無法駕駛${mech.armorType}機甲` })
    next = { ...next, mechId: undefined, sets: {} }
  }
  if (!next.mechId && Object.keys(next.sets).length > 0) next = { ...next, sets: {} }

  // ── 分頁鍵：一律取自 equipSetKeys()，換機師時舊 formId 會整批失效 ──
  //
  // ⚠ **載入 gate**（PLAN-052-F D-1）：`forms` 還沒到齊時整段跳過。
  //   這一段是「不在 keys 裡的分頁一律丟掉」，而 `equipSetKeys()` 在 forms 為空時
  //   對海莉絲**也**只回 `['default']` —— 於是一份帶著三個形態分頁的外來草稿
  //   （分享碼／localStorage 草稿／052-E 的雲端存檔）會被**整批靜默刪掉**：
  //   不進 `removed`（丟棄發生在鍵的過濾、不在逐件掃描），因此不跳 toast、不留 [復原]，
  //   玩家看到的是「貼了碼，三套只剩一套」而畫面一個字都不說。
  //
  //   今天 `LoadoutPage` 的還原守衛（`if (pending && !loading)`）擋得住這條路，
  //   但那是**另一個檔案裡的時序**，而 `reconcile()` 每個動作都會跑。
  //   同一種「集合比草稿晚到」的坑，元件（052-D 決策六）與模組（052-G 決策六）
  //   各自都在這支函式裡留了一行 gate，本行是形態的那一份。
  //
  //   gate 的判準是 `world.forms.length === 0` ＝「這個集合根本沒進來」，
  //   不是「這位機師沒有形態」—— 全庫恆有 6 筆，空陣列只可能是未載入。
  //   代價是最多多留一份等下一次 reconcile 掃掉，遠小於靜默刪掉玩家三套配裝。
  const formsLoaded = world.forms.length > 0
  let keys: string[]
  if (!next.pilotId) {
    keys = [DEFAULT_EQUIP_SET_KEY]
  } else if (formsLoaded) {
    keys = equipSetKeys(next.pilotId, world.forms)
  } else {
    // gate 觸發：草稿裡有什麼分頁就掃什麼，一個都不丟
    keys = Object.keys(next.sets).length > 0 ? Object.keys(next.sets) : [DEFAULT_EQUIP_SET_KEY]
  }
  if (formsLoaded || !next.pilotId) {
    const sets: Record<string, EquipSet> = {}
    for (const key of keys) if (next.sets[key]) sets[key] = next.sets[key]
    if (Object.keys(sets).length !== Object.keys(next.sets).length) next = { ...next, sets }
    if (!keys.includes(next.activeSetKey)) next = { ...next, activeSetKey: keys[0] }
  }

  // ── 逐套掃裝備 ──
  for (const key of keys) {
    const before = setOf(next, key)
    if (before.mounts.length === 0 && !before.backpackId) continue

    // 背包先掃：它決定備用槽存不存在，掃武器時要看的是掃完背包之後的容量
    let ctx = buildContext(next, key, world)
    let cur = before
    if (ctx.backpack) {
      const r = canEquipBackpack({ ...ctx, set: { ...cur, backpackId: undefined }, backpack: null }, ctx.backpack)
      if (r && r.code !== 'OVERWEIGHT' && r.code !== 'BACK_SLOT_TAKEN') {
        removed.push({ kind: 'backpack', id: ctx.backpack.id, name: ctx.backpack.name, why: r.reason })
        cur = { ...cur, backpackId: undefined }
        next = withSet(next, key, cur)
        ctx = buildContext(next, key, world)
      }
    }

    // 武器：逐格問 canEquipWeapon（把它自己先拿掉，否則它會與自己衝突）
    const kept: LoadoutMount[] = []
    for (const m of cur.mounts) {
      const ref: WeaponSlotRef = { bank: m.bank, slot: m.slot, side: m.side }
      const w = world.weapons.get(m.weaponId)
      if (!w) {
        removed.push({ kind: 'weapon', id: m.weaponId, name: m.weaponId, where: mountWhere(m), why: '武器資料已不存在' })
        continue
      }
      const probe = { ...ctx, set: { ...cur, mounts: cur.mounts.filter((x) => !slotsOverlap(x, ref)) } }
      const r = canEquipWeapon(probe, w, ref)
      if (r && r.code !== 'OVERWEIGHT') {
        removed.push({ kind: 'weapon', id: w.id, name: w.name, where: mountWhere(m), why: r.reason })
        continue
      }
      kept.push(m)
    }
    if (kept.length !== cur.mounts.length) next = withSet(next, key, { ...cur, mounts: kept })

    // ── 元件：逐把武器把 setup 重新裝一次（PLAN-052-D B-2）──
    const comp = reconcileSetups(next, key, world)
    next = comp.draft
    removed.push(...comp.removed)
  }

  // ── 部件混搭：掃成「這台基底機甲拼得出來」的合法配置（PLAN-052-G D-1）──
  //
  // ⚠ **一定要排在模組之前**：換掉的部件會帶來不同的模組接口
  //   （Ⅰ型只收 A 級、B 級根本沒有接口），先掃部件、再拿定案後的接口去驗模組。
  //   反過來的症狀是「模組驗的是上一個部件的接口」——一次動作差一拍，畫面上完全看不出來。
  const prts = reconcileParts(next, world)
  next = prts.draft
  removed.push(...prts.removed)

  // ── 模組接口：掃成「這台機甲的這四格裝得下」的合法配置（PLAN-052-G C-1）──
  const mods = reconcileModules(next, world)
  next = mods.draft
  removed.push(...mods.removed)

  // ── 算力配置：掃成對得上目前機師的合法配置（PLAN-052-I D-2）──
  next = reconcileNdLevels(next, world)

  // ── 攜帶技能：掃成「目前這位機師帶得動」的配置（PLAN-052-L D-3）──
  next = reconcileSkills(next, world)

  // ── 方案名稱：外部來源（舊存檔／分享碼／localStorage 手改）一樣要過清洗（PLAN-052-I E-1）──
  //    setName 已經清過一次，這裡是給「不經 setName 進來的那些路徑」的第二道。
  const cleanName = sanitizeLoadoutName(next.name)
  if (cleanName !== next.name) {
    next = cleanName === undefined ? withoutName(next) : { ...next, name: cleanName }
  }

  // ── 方案備註：同上的第二道（PLAN-052-L C-2）──
  //    ⚠ 這一道比名稱那一道**更不能省**：備註是別人的自由文字（分享碼帶進來的），
  //      而它會被原樣印在公開的匯出圖上。
  const cleanNote = sanitizeLoadoutNote(next.note)
  if (cleanNote !== next.note) {
    next = cleanNote === undefined ? withoutNote(next) : { ...next, note: cleanNote }
  }

  return { draft: next, removed }
}

/**
 * 把一套配裝裡每一把武器的元件設定掃成合法狀態（PLAN-052-D B-2）。
 *
 * 作法是**清空後逐顆重裝**，而不是逐條寫「哪些情況要拿掉」——
 * 重裝走的是 `canEquipComponent()`，於是五條規則自動全套適用、順序也與玩家手動裝時一致。
 * 與 reconcile 掃武器時「把它自己先拿掉再問」是同一個手法。
 *
 * ⚠ **`components` 尚未載入時整段跳過**（計畫書決策六，本計畫最危險的一條）。
 *   `reconcile()` 對武器的作法是「查不到就刪」，元件**絕對不可**照抄：載入是非同步的，
 *   而草稿會在集合到齊之前就被 `loadDraft` 灌進來（分享碼、localStorage 書架、
 *   052-E 的雲端存檔都走那條）。照抄的症狀是**貼一次分享碼、元件就被靜默清空一次**，
 *   而畫面上什麼都不會說 —— 連 toast 都不會跳，因為那在它眼裡是一次成功的級聯。
 *   空 Map 的意思是「還沒載入」，不是「這個世界沒有元件」。
 *
 * ⚠ 換武器**不經過這裡**：`placeWeapon()` 建立新 mount 時本來就不帶 setup，
 *   元件自動清空（計畫書決策四）。那條路上的 toast 由 `equipWeapon` 的 displaced 負責。
 */
function reconcileSetups(
  draft: LoadoutDraft, key: string, world: LoadoutWorld,
): { draft: LoadoutDraft; removed: RemovedItem[] } {
  if (world.components.size === 0) return { draft, removed: [] }

  const cur = setOf(draft, key)
  if (!cur.mounts.some((m) => m.setup)) return { draft, removed: [] }

  const removed: RemovedItem[] = []
  const baseCtx = buildContext(draft, key, world)
  let mounts = cur.mounts
  let changed = false

  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i]
    const ids = [
      ...(m.setup?.triggerComponentIds ?? []),
      ...(m.setup?.effectComponentIds ?? []),
    ]
    if (ids.length === 0) continue

    const ref: WeaponSlotRef = { bank: m.bank, slot: m.slot, side: m.side }
    const where = slotLabel(ref)
    const weaponName = world.weapons.get(m.weaponId)?.name ?? m.weaponId
    let acc = withSetup(m, [], [])

    for (const id of ids) {
      const c = world.components.get(id)
      if (!c) {
        removed.push({ kind: 'component', id, name: id, where, why: '元件資料已不存在' })
        continue
      }
      // 壞掉的外部來源可能把同一顆掛兩次；`canEquipComponent` 對已裝的那顆是放行的
      // （面板要畫得出「已裝上」），所以重複要在這裡自己擋
      if (mountedIds(acc).includes(id)) {
        removed.push({ kind: 'component', id, name: c.name, where, why: `${weaponName}重複掛載了同一顆元件` })
        continue
      }
      const probe: LoadoutContext = {
        ...baseCtx,
        set: { ...cur, mounts: mounts.map((x, j) => (j === i ? acc : x)) },
      }
      const r = canEquipComponent(probe, c, ref)
      if (r) {
        removed.push({ kind: 'component', id, name: c.name, where, why: `${weaponName}：${r.reason}` })
        continue
      }
      acc = addComponent(acc, c.id, c.componentType === 'Condition')
    }

    if (mountedIds(acc).length !== ids.length) {
      mounts = mounts.map((x, j) => (j === i ? acc : x))
      changed = true
    }
  }

  return changed ? { draft: withSet(draft, key, { ...cur, mounts }), removed } : { draft, removed }
}

/**
 * 把 `draft.modules` 掃成合法狀態（PLAN-052-G C-1）。
 *
 * ── ⚠ 這一段是本計畫最危險的地方（計畫書決策六，052-D 的同一條教訓）──────────
 * **`modules` 尚未載入時整段跳過。** `reconcile()` 對武器的作法是「查不到就刪」，
 * 模組**絕對不可**照抄：載入是非同步的，而草稿會在集合到齊之前就被 `loadDraft`
 * 灌進來（分享碼、localStorage 書架、052-E 的雲端存檔都走那條）。
 * 照抄的症狀是**貼一次分享碼、四顆模組就被靜默清空一次**，而畫面上什麼都不會說 ——
 * 連 toast 都不會跳，因為那在它眼裡是一次成功的級聯。
 * 空 Map 的意思是「還沒載入」，不是「這個世界沒有模組」。
 *
 * ── 為什麼是「逐格驗證」而不是「換機甲一律清空」──────────────────────────
 * 進度表 C-1 原寫「換機甲清 `draft.modules`」，本實作改成**過 `canEquipModule()` 逐格驗證**，
 * 理由與同一支 `reconcile()` 對武器的處置逐字相同（見 `selectMech` 的註解：
 * 「直接清空會讓『試試看換一台』這個最常見的動作變成每次都要重配一輪」）：
 *   · 模組**不綁機甲**（候選池的判準就是 `boundMechId == null`），一顆 S 級模組在
 *     另一台 S 級機甲的同一個 Ⅱ 型接口上仍然完全合法 —— 清掉它是本站替玩家做的
 *     一個他沒下過的決定。
 *   · 真的不合法時（換到 A 級機甲的 Ⅰ 型接口、換到 B 級沒有接口的機甲、機甲被移除）
 *     驗證自然會清掉，而且**帶著原因進 toast**。
 * 那一列真正在意的是「不可以靜默丟掉」，而不是清空的範圍 —— 這裡兩者都滿足，
 * 且保留得更多。`draft.parts`（部件混搭）則是另一回事：那是**別台機甲的部件**，
 * 換基底機甲時必須清空，屬 Phase D。
 *
 * ⚠ 沒有機甲時直接清空整份：接口是機甲的，機甲不在，四格就不存在。
 *   這一條**不受載入 gate 保護也是對的** —— 它不需要認得任何一顆模組。
 */
/**
 * 部件混搭的級聯（PLAN-052-G D-1）。
 *
 * `draft.parts` 是**部位 → 來源機甲 id**，而且**只記與選定機甲不同的那幾格**
 * （與選定機甲相同時刪鍵而不是寫入自己的 mechId —— 後者會讓每一份分享碼都多帶四個
 * 永遠不變的號碼，而 `§PARTS` 是變長段）。
 *
 * ⚠ **換基底機甲必須清掉不合法的部件。** `loadout.ts` 的欄位註解逐字預告過這條：
 *   「換了機甲卻留著舊機甲的部件是靜默的錯，而且會讓 `resolveChassis()` 算出一台
 *   不存在的機體」。換**裝甲類型**時尤其要清 —— 否則會混出跨型機體，
 *   而決策七的整條推論（雙肩槽與執照判定不受影響）就地失效。
 *
 * ⚠ 但不是「換機甲就整批清空」：同裝甲類型換一台時，那些部件**仍然合法**
 *   （規則只有一行 `source.armorType === base.armorType`）。清掉它是本站替玩家
 *   做了一個他沒下過的決定 —— 與武器、模組在同一支函式裡的處置逐字同一條理由。
 *
 * ⚠ **載入 gate**（與元件 052-D 決策六、模組 052-G 決策六、形態 052-F D-1 同一條）：
 *   `world.mechs` 是空的代表**集合還沒載入**，不是「這個世界沒有機甲」。
 *   照著「查不到就刪」做，症狀是貼一次分享碼、混搭的部件就被靜默清空一次。
 *   判準是集合本身為空，而不是「這一台查不到」—— 後者是真的斷鏈，該被清掉並說明。
 */
function reconcileParts(
  draft: LoadoutDraft, world: LoadoutWorld,
): { draft: LoadoutDraft; removed: RemovedItem[] } {
  const cur = draft.parts
  if (!cur || Object.keys(cur).length === 0) return { draft, removed: [] }

  // 載入 gate：集合根本沒進來 ⇒ 這一輪什麼都不判
  if (world.mechs.size === 0) return { draft, removed: [] }

  const base = draft.mechId ? world.mechs.get(draft.mechId) : null

  // 沒有基底機甲 ⇒ 沒有東西可以被換。與 `sets`／`modules` 在機甲被移除時一起清是同一條理由。
  if (!base) {
    const removed: RemovedItem[] = MECH_PART_ORDER
      .filter((pos) => cur[pos])
      .map((pos) => ({
        kind: 'part' as const,
        id: cur[pos]!,
        name: world.mechs.get(cur[pos]!)?.name ?? cur[pos]!,
        where: partLabel(pos),
        why: '沒有機甲就沒有可以替換的部位',
      }))
    return { draft: withoutParts(draft), removed }
  }

  const removed: RemovedItem[] = []
  const kept: Partial<Record<MechPartPosition, string>> = {}
  for (const pos of MECH_PART_ORDER) {
    const srcId = cur[pos]
    if (!srcId) continue

    // 與選定機甲相同 ⇒ **不是移除**，是把鍵收掉（語意完全相同，只是不佔分享碼的位元）
    if (srcId === base.id) continue

    const src = world.mechs.get(srcId)
    if (!src) {
      removed.push({ kind: 'part', id: srcId, name: srcId, where: partLabel(pos), why: '來源機甲資料已不存在' })
      continue
    }
    const r = canSwapPart(buildContext({ ...draft, parts: {} }, draft.activeSetKey, world), src, pos)
    if (r) {
      removed.push({ kind: 'part', id: srcId, name: src.name, where: partLabel(pos), why: r.reason })
      continue
    }
    kept[pos] = srcId
  }

  if (removed.length === 0 && Object.keys(kept).length === Object.keys(cur).length) {
    return { draft, removed: [] }
  }
  return {
    draft: Object.keys(kept).length ? { ...draft, parts: kept } : withoutParts(draft),
    removed,
  }
}

/** 刪掉 `parts` 這個鍵本身（不是設成空物件 —— 空物件會被 codec 編成一段空的 §PARTS）。 */
function withoutParts(draft: LoadoutDraft): LoadoutDraft {
  if (!('parts' in draft)) return draft
  const rest = { ...draft }
  delete rest.parts
  return rest
}

function reconcileModules(
  draft: LoadoutDraft, world: LoadoutWorld,
): { draft: LoadoutDraft; removed: RemovedItem[] } {
  const cur = draft.modules
  if (!cur || Object.keys(cur).length === 0) return { draft, removed: [] }

  // 沒有機甲 ⇒ 沒有接口。與 `sets` 在機甲被移除時一起清掉是同一條理由。
  if (!draft.mechId || !world.mechs.get(draft.mechId)) {
    const removed: RemovedItem[] = MECH_PART_ORDER
      .filter((pos) => cur[pos])
      .map((pos) => ({
        kind: 'module' as const,
        id: cur[pos]!,
        name: world.modules.get(cur[pos]!)?.name ?? cur[pos]!,
        where: partLabel(pos),
        why: '沒有機甲就沒有模組接口',
      }))
    return { draft: withModules(draft, {}), removed }
  }

  // ⚠ 載入 gate —— 見本函式的檔頭。這一行拿掉的症狀是靜默的。
  if (world.modules.size === 0) return { draft, removed: [] }

  const removed: RemovedItem[] = []
  const kept: Partial<Record<MechPartPosition, string>> = {}
  // 逐格驗證時 ctx 只建一次：模組彼此不互斥（沒有同族互斥、沒有容量帳，
  // 而「這格已裝別顆」自 C-9 起也不再是拒絕），一格的去留不影響另一格能不能裝。
  // 這與武器那邊「裝上去會改變容量、所以要把自己先拿掉再問」不同。
  const baseCtx = buildContext(withModules(draft, {}), draft.activeSetKey, world)

  for (const position of MECH_PART_ORDER) {
    const id = cur[position]
    if (!id) continue
    const mod = world.modules.get(id)
    if (!mod) {
      removed.push({ kind: 'module', id, name: id, where: partLabel(position), why: '模組資料已不存在' })
      continue
    }
    const r = canEquipModule(baseCtx, mod, { kind: 'module', position })
    if (r) {
      removed.push({ kind: 'module', id, name: mod.name, where: partLabel(position), why: r.reason })
      continue
    }
    kept[position] = id
  }

  if (removed.length === 0) return { draft, removed }
  return { draft: withModules(draft, kept), removed }
}

/**
 * 把 `draft.ndLevels` 掃成「對得上目前這位機師」的合法配置。
 *
 * 三道處理，一律**不進 `removed`**：算力被修正時面板上的方格會就地變樣，玩家看得到；
 * 而 `RemovedItem` 只有 weapon / backpack 兩種 kind，為了算力開第三種只會讓每個讀
 * removed 的地方都要多記得一個分支（而漏掉的症狀是靜默的）。
 *
 *   ① 鍵不屬於這位機師的分區 → 丟掉那一鍵（換機師的殘留、資料改版後分區改名）
 *   ② **非 γ 區（α／β）→ 丟掉那一鍵**（PLAN-052-M：它們鎖死在滿級、不開放調整）
 *   ③ Lv 超出該區的級數或為負 → clamp 進 `[0, levels.length]`
 *   ④ γ 區合計超過 `gammaPairCap` → **整份丟掉**，退回 `defaultNdLevels()`
 *
 * ⚠ ② 會**改寫舊分享碼的語意**：一串帶著 `α:1` 的舊碼貼進來之後，α 會回到滿級。
 *   這是刻意的 —— 鎖死之後那一鍵玩家自己再也改不回來，留著它等於製造一個
 *   「面板上看得到、但誰都動不了」的狀態。丟掉之後 `defaultNdLevels()` 給滿級，
 *   而實測 178 個 α／β 分區零個帶 `buffUpgrades` ⇒ 預設本來就是滿級，值不會亂跳。
 *
 * ⚠ ④ 讀的必須是**玩家投入**的 Lv，**不是**生效值（`effectiveNdLevels()`）。
 *   模組加成不花 γ 預算，所以生效算力可以到 26 —— 拿生效值去比 23 的話，
 *   一套完全合法的配裝會被這條閘門**靜默洗回預設值**。加成因此一律不落盤（PLAN-052-M）。
 *
 * 為什麼 ③ 是整份原子退場而不是逐區降級：降級得挑「降哪一區」，而任何挑法都是本站
 * 替玩家做的一個他沒下過的決定（降錯邊 = 他精心配的那一區被砍）。整份退回預設值則是
 * 一個**看得出來**的狀態 —— 兩條 Lv 條同時跳回預設，而不是其中一條莫名少一格。
 * 這與 ndOverrides 建表時「一族有一階不合格就整族退場」是同一條理由。
 *
 * ⚠ 門檻與上限一律問 `ndOverrides.ts`，本檔不寫死 23 —— 官方開放超頻時只改那邊。
 */
function reconcileNdLevels(draft: LoadoutDraft, world: LoadoutWorld): LoadoutDraft {
  const cur = draft.ndLevels
  if (!cur) return draft

  const drives = (draft.pilotId ? world.pilots.get(draft.pilotId)?.neuralDrive : undefined) ?? []
  if (drives.length === 0) return withoutNdLevels(draft)

  const clean: Record<string, number> = {}
  for (const d of drives) {
    // ② α／β 不開放調整 ⇒ 那一鍵一律不留（見上方 ⚠）
    if (!isGammaZone(d.name)) continue
    const raw = cur[d.name]
    if (raw == null || !Number.isFinite(raw)) continue
    const lv = Math.max(0, Math.min(Math.trunc(raw), d.levels?.length ?? 0))
    clean[d.name] = lv
  }
  if (Object.keys(clean).length === 0) return withoutNdLevels(draft)

  const gammaSum = drives
    .filter((d) => isGammaZone(d.name))
    .reduce((n, d) => n + zonePower(d, clean[d.name] ?? 0), 0)
  if (gammaSum > ND_RULES.gammaPairCap) return withoutNdLevels(draft)

  // identity 穩定：沒有實際變動就回原物件，避免每次 reconcile 都讓 draft 變成新參考
  const same = Object.keys(cur).length === Object.keys(clean).length
    && Object.entries(clean).every(([k, v]) => cur[k] === v)
  return same ? draft : { ...draft, ndLevels: clean }
}

/**
 * 移除 `ndLevels` 欄位本身，**不是設成 `undefined`**。
 *
 * 「未設定」在本模型裡的表示法是「欄位不存在」（見 LoadoutDraft 的註解）：設成 `undefined`
 * 會在 `JSON.stringify` 進 localStorage 時消失、卻在記憶體裡留著一個 `in` 判定為真的鍵，
 * 於是「有沒有設定過」會在重新整理前後給出兩種答案。
 */
function sameNdLevels(a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/**
 * 把攜帶技能掃成「目前這位機師帶得動」的配置（PLAN-052-L D-3）。
 *
 * ⚠ **`pilotSkills` 還沒載入時整段跳過**（本計畫最危險的一條，與元件／模組逐字相同）。
 *   `reconcile()` 對武器的作法是「查不到就刪」，技能**絕對不可**照抄：載入是非同步的，
 *   而草稿會在集合到齊之前就被 `loadDraft` 灌進來（分享碼、localStorage 書架、
 *   雲端存檔都走那條）。照抄的症狀是**貼一次分享碼、三個技能就被靜默清空一次**，
 *   而畫面上什麼都不會說 —— 連 toast 都不會跳，因為那在它眼裡是一次成功的級聯。
 *
 *   ⚠ 這一份比元件／模組更容易踩到：`pilotSkills` **不在** `LOADOUT_STAGE_KEYS` 裡
 *     （見 `useFirestore.ts`），所以「還沒載入」是常態而不是開頁的一瞬間。
 *
 * ⚠ **`mod`（科研「改」技能）一律不動。** 它不在 `pilot.skills` 裡（那是另一條科研線
 *   給的），拿候選池去驗它一定驗不過 ⇒ 每跑一次 reconcile 就清掉一次。
 *   站上今天沒有這份資料、也沒有 UI，但分享碼**只進不出**：別的 client（或未來的我們）
 *   寫進去的值必須原樣留著。
 *
 * ⚠ **不進 `removed`、不跳 toast**（與算力同一條、與元件相反）：技能面板就在中欄、
 *   換機師時整片會就地換掉，玩家看得到。元件之所以要 toast，是因為它藏在
 *   「點開武器列再鑽進面板」兩層之後。
 */
function reconcileSkills(draft: LoadoutDraft, world: LoadoutWorld): LoadoutDraft {
  const cur = draft.skills
  if (!cur) return draft
  if (world.pilotSkills.size === 0) return draft        // ← 載入 gate，見上方 ⚠

  const pilot = draft.pilotId ? world.pilots.get(draft.pilotId) ?? null : null
  const carried = keepCarriableSkills(cur.carried ?? [], pilot, world.pilotSkills)
    .slice(0, CARRIED_SKILL_SLOTS)

  if (carried.length === 0 && !cur.mod) return withoutSkills(draft)
  // identity 穩定：沒有實際變動就回原物件，避免每次 reconcile 都讓 draft 變成新參考
  const same = carried.length === (cur.carried?.length ?? 0)
    && carried.every((id, i) => cur.carried?.[i] === id)
  return same ? draft : { ...draft, skills: { ...cur, carried } }
}

/** 移除 `skills` 欄位本身（理由同 `withoutNdLevels`：未設定＝欄位不存在）。 */
function withoutSkills(draft: LoadoutDraft): LoadoutDraft {
  if (!('skills' in draft)) return draft
  const rest = { ...draft }
  delete rest.skills
  return rest
}

/**
 * 把一個技能放進第 `index` 格。**純結構操作**，合法性由 `reconcile()` 事後統一掃。
 *
 * 三條規則（畫面上是**三個固定的格子**，所以是「格」的語意不是「清單」的語意）：
 *   · 那一格已經有東西 → **取代**它。
 *   · `index` 超出目前長度 → 放進第一個空格（append）。緊湊陣列不挖洞：挖出來的洞
 *     會在 `JSON.stringify`（localStorage 草稿／雲端存檔）之後變成 `null`，
 *     而下游會拿 `null` 去查技能。
 *   · 這個技能已經在別格 → 與目標格**對調**，不是複製。
 *
 * ⚠ 不可以寫成「先拿掉再插入」：那在滿三格時會把最後一格擠掉
 *   （`[甲,乙,丙]` 放丁進第 2 格會變成 `[甲,丁,乙]`，丙 無聲消失），
 *   而玩家看到的是「我換了第 2 格，第 3 格自己不見了」。
 */
function withCarriedSkill(draft: LoadoutDraft, index: number, skillId: string): LoadoutDraft {
  const cur = draft.skills?.carried ?? []
  // 目標格：夾在 [0, 目前長度] 之間，且不超過三格
  const at = Math.min(Math.max(index, 0), Math.min(cur.length, CARRIED_SKILL_SLOTS - 1))
  const next = [...cur]
  const from = next.indexOf(skillId)
  if (at < next.length) {
    // 對調（`from < 0` 時就是單純取代 —— 舊的那一格沒有人要搬回去）
    if (from >= 0) next[from] = next[at]
    next[at] = skillId
  } else if (from >= 0) {
    // 已經在格子裡，而目標是「空格」⇒ 搬到最後
    next.splice(from, 1)
    next.push(skillId)
  } else {
    next.push(skillId)
  }
  return { ...draft, skills: { ...draft.skills, carried: next.slice(0, CARRIED_SKILL_SLOTS) } }
}

/**
 * 兩份草稿的攜帶技能是不是一樣（逐格比對，不比參考）。
 *
 * ⚠ 比參考恆為「有變動」：上面每個 case 的 spread 必然產生新物件。同 `sameNdLevels`。
 */
function sameCarried(a: LoadoutDraft, b: LoadoutDraft): boolean {
  const x = a.skills?.carried ?? [], y = b.skills?.carried ?? []
  return x.length === y.length && x.every((id, i) => y[i] === id)
}

/** 移除 `name` 欄位本身（理由同 `withoutNdLevels`：未設定＝欄位不存在）。 */
function withoutName(draft: LoadoutDraft): LoadoutDraft {
  if (!('name' in draft)) return draft
  const rest = { ...draft }
  delete rest.name
  return rest
}

/** 移除 `note` 欄位本身（同 `withoutName`）。 */
function withoutNote(draft: LoadoutDraft): LoadoutDraft {
  if (!('note' in draft)) return draft
  const rest = { ...draft }
  delete rest.note
  return rest
}

function withoutNdLevels(draft: LoadoutDraft): LoadoutDraft {
  if (!('ndLevels' in draft)) return draft
  const rest = { ...draft }
  delete rest.ndLevels           // `delete` 而不是設 undefined —— 見上方註解
  return rest
}

// ─── 結構性放置（動作層）────────────────────────────────────────────────────

/**
 * 把一把武器放進某一格。純結構操作 —— 只處理「誰被誰取代」，不判合法性。
 *
 * 三條取代規則（全部來自槽位的幾何，不是遊戲規則）：
 *   · 同一格已有東西 → 取代
 *   · 裝雙手武器 → 同 bank 的左右手都被取代
 *   · 裝單手武器 → 同 bank 原本的雙手武器被取代
 *   · 裝背部武器 → 背包被卸下（背槽只有一格）
 */
function placeWeapon(set: EquipSet, ref: WeaponSlotRef, weaponId: string): { set: EquipSet; displaced: LoadoutMount[]; backpackOff: boolean } {
  const displaced = set.mounts.filter((m) => slotsOverlap(m, ref))
  const mounts = set.mounts.filter((m) => !slotsOverlap(m, ref))
  mounts.push({ weaponId, bank: ref.bank, slot: ref.slot, side: ref.side })
  const backpackOff = ref.slot === WeaponEquipSlot.BACK && !!set.backpackId
  return {
    set: { ...set, mounts, ...(backpackOff ? { backpackId: undefined } : {}) },
    displaced,
    backpackOff,
  }
}

/** 卸下某一格（背槽的 ref 同時卸掉背包）。 */
function clearSlot(set: EquipSet, ref: WeaponSlotRef): { set: EquipSet; displaced: LoadoutMount[]; backpackOff: boolean } {
  const displaced = set.mounts.filter((m) => slotsOverlap(m, ref))
  const backpackOff = ref.slot === WeaponEquipSlot.BACK && !!set.backpackId
  return {
    set: {
      ...set,
      mounts: set.mounts.filter((m) => !slotsOverlap(m, ref)),
      ...(backpackOff ? { backpackId: undefined } : {}),
    },
    displaced,
    backpackOff,
  }
}

// ─── reducer ────────────────────────────────────────────────────────────────

/**
 * 一次狀態轉移。`world` 由呼叫端注入（`useReducer` 用 `useMemo` 綁一次），
 * 讓 reducer 保持純函式、可單測。
 */
export function simReduce(state: SimState, action: LoadoutAction, world: LoadoutWorld): SimState {
  switch (action.type) {
    case 'dismissNotice':
      return state.notice ? { ...state, notice: null } : state

    case 'undo':
      // 復原本身不再產生 notice，也不可再被復原 —— 兩層以上的來回只會讓人搞不清現在在哪
      return state.undo ? { ...state, draft: state.undo, undo: null, notice: null } : state

    case 'loadDraft': {
      const { draft, removed } = reconcile(action.draft, world)
      return commit(state, state.draft, draft, removed, '載入配裝', [], [], false)
    }

    case 'selectPilot': {
      if (state.draft.pilotId === action.pilotId) return state
      // ⚠ 換機師時**明確重置算力**，不倚賴 reconcile 的鍵過濾：兩位機師可以都有 γ1／γ2，
      //    但兩條 Lv 條的 minSum 階梯逐機師不同 —— 沿用舊 Lv 會得到一個「級數對得上、
      //    算力值卻是另一位機師的」配置，而那正好是過濾器看不出來的那一種。
      const base: LoadoutDraft = { ...withoutNdLevels(state.draft), pilotId: action.pilotId }
      const { draft, removed } = reconcile(base, world)
      const name = world.pilots.get(action.pilotId)?.name ?? action.pilotId
      return commit(state, state.draft, draft, removed, `已切換至 ${name}`, [], flashOf(removed), true)
    }

    case 'selectMech': {
      if (state.draft.mechId === action.mechId) return state
      // 換機甲時**保留**各套裝備，由 reconcile 逐槽驗證 —— 直接清空會讓「試試看換一台」
      // 這個最常見的動作變成每次都要重配一輪
      const base: LoadoutDraft = { ...state.draft, mechId: action.mechId }
      const { draft, removed } = reconcile(base, world)
      const name = world.mechs.get(action.mechId)?.name ?? action.mechId
      return commit(state, state.draft, draft, removed, `已切換至 ${name}`, outputNote(state, draft, world), flashOf(removed), true)
    }

    case 'clearMech': {
      const { draft, removed } = reconcile({ ...state.draft, mechId: undefined, sets: {} }, world)
      return commit(state, state.draft, draft, removed, '已移除機甲', [], [], true)
    }

    // 切分頁：**只換一個字串**，不動任何一套裝備、不跑 reconcile、不留 undo 紀錄。
    //
    // ⚠ key 一定要驗過再收（PLAN-052-F B-2）。UI 那一側（`LoadoutPage`）在渲染時
    //   已經把不合法的 activeSetKey 退回 `setKeys[0]`，但那只修了**畫面**——
    //   `equipWeapon` 之類的動作讀的是 `state.draft.activeSetKey` 本人。
    //   兩邊各修各的，症狀會是「畫面停在先鋒分頁，裝上的武器卻寫進一個不存在的鍵」：
    //   沒有錯誤訊息、裝備看起來憑空消失，而 reconcile 下次會把那個幽靈鍵整包掃掉。
    //   收在這裡，是因為這裡是唯一的寫入點。
    case 'setActiveSet': {
      const keys = state.draft.pilotId
        ? equipSetKeys(state.draft.pilotId, world.forms)
        : [DEFAULT_EQUIP_SET_KEY]
      if (!keys.includes(action.key)) return state
      return state.draft.activeSetKey === action.key
        ? state
        : { ...state, draft: { ...state.draft, activeSetKey: action.key }, notice: null }
    }

    case 'equipWeapon': {
      const key = state.draft.activeSetKey
      const w = world.weapons.get(action.weaponId)
      if (!w) return state
      const { set, displaced, backpackOff } = placeWeapon(setOf(state.draft, key), action.ref, action.weaponId)
      const base = withSet(state.draft, key, set)
      const { draft, removed } = reconcile(base, world)
      const all = [...displacedItems(displaced, world, `已由${w.name}取代`), ...backpackItem(state, key, world, backpackOff), ...removed]
      return commit(state, state.draft, draft, all, `已裝上 ${w.name}`, outputNote(state, draft, world), [slotLabel(action.ref)], true)
    }

    case 'unequip': {
      const key = state.draft.activeSetKey
      const { set, displaced, backpackOff } = clearSlot(setOf(state.draft, key), action.ref)
      if (displaced.length === 0 && !backpackOff) return state
      const base = withSet(state.draft, key, set)
      const { draft, removed } = reconcile(base, world)
      const all = [...displacedItems(displaced, world, '已卸下'), ...backpackItem(state, key, world, backpackOff), ...removed]
      return commit(state, state.draft, draft, all, '已卸下裝備', outputNote(state, draft, world), [], true)
    }

    case 'unequipBackpack': {
      const key = state.draft.activeSetKey
      const cur = setOf(state.draft, key)
      if (!cur.backpackId) return state
      const base = withSet(state.draft, key, { ...cur, backpackId: undefined })
      const { draft, removed } = reconcile(base, world)
      const all = [...backpackItem(state, key, world, true), ...removed]
      return commit(state, state.draft, draft, all, '已卸下背包', outputNote(state, draft, world), [], true)
    }

    case 'equipBackpack': {
      const key = state.draft.activeSetKey
      const bp = world.backpacks.get(action.backpackId)
      if (!bp) return state
      const cur = setOf(state.draft, key)
      // 背槽擇一：裝背包 ⇒ 背部武器自動卸下
      const backMounts = cur.mounts.filter((m) => m.slot === WeaponEquipSlot.BACK)
      const base = withSet(state.draft, key, {
        ...cur,
        mounts: cur.mounts.filter((m) => m.slot !== WeaponEquipSlot.BACK),
        backpackId: action.backpackId,
      })
      const { draft, removed } = reconcile(base, world)
      const all = [...displacedItems(backMounts, world, `背槽已由${bp.name}佔用`), ...removed]
      return commit(state, state.draft, draft, all, `已裝上 ${bp.name}`, outputNote(state, draft, world), [], true)
    }

    case 'equipComponent': {
      const key = state.draft.activeSetKey
      const c = world.components.get(action.componentId)
      if (!c) return state
      const cur = setOf(state.draft, key)
      const i = cur.mounts.findIndex((m) => slotsOverlap(m, action.ref))
      if (i < 0) return state                       // 這一格沒有武器（元件掛在武器上）
      const next = addComponent(cur.mounts[i], c.id, c.componentType === 'Condition')
      if (next === cur.mounts[i]) return state      // 已經裝著這一顆
      const base = withSet(state.draft, key, { ...cur, mounts: cur.mounts.map((m, j) => (j === i ? next : m)) })
      const { draft, removed } = reconcile(base, world)
      // 元件不佔重量 ⇒ 不必報出力變化（`outputNote` 恆為空，呼叫它只是白算一次）
      return commit(state, state.draft, draft, removed, `已裝上 ${c.name}`, [], [slotLabel(action.ref)], true)
    }

    case 'unequipComponent': {
      const key = state.draft.activeSetKey
      const cur = setOf(state.draft, key)
      const i = cur.mounts.findIndex((m) => slotsOverlap(m, action.ref))
      if (i < 0) return state
      const next = removeComponent(cur.mounts[i], action.componentId)
      if (next === cur.mounts[i]) return state      // 本來就沒裝
      const base = withSet(state.draft, key, { ...cur, mounts: cur.mounts.map((m, j) => (j === i ? next : m)) })
      const { draft, removed } = reconcile(base, world)
      const name = world.components.get(action.componentId)?.name ?? action.componentId
      return commit(state, state.draft, draft, removed, `已卸下 ${name}`, [], [slotLabel(action.ref)], true)
    }

    case 'equipModule': {
      const mod = world.modules.get(action.moduleId)
      if (!mod) return state
      const { position } = action.ref
      if (state.draft.modules?.[position] === action.moduleId) return state   // 已經裝著這一顆
      // 覆蓋前先記下被換掉的那一顆 —— 面板上「裝上」是一步，而它同時卸下了另一顆，
      // 不說的話玩家會以為兩顆都在（與 equipWeapon 的 displaced 同一條理由）。
      const prev = state.draft.modules?.[position]
      const base = withModule(state.draft, position, action.moduleId)
      const { draft, removed } = reconcile(base, world)
      const displaced: RemovedItem[] = prev && prev !== action.moduleId
        ? [{
            kind: 'module', id: prev,
            name: world.modules.get(prev)?.name ?? prev,
            where: partLabel(position),
            why: `已由${mod.name}取代`,
          }]
        : []
      // 模組不佔重量 ⇒ 不必報出力變化（`outputNote` 恆為空，呼叫它只是白算一次）
      return commit(state, state.draft, draft, [...displaced, ...removed], `已裝上 ${mod.name}`, [], [], true)
    }

    case 'fillModule': {
      const mod = world.modules.get(action.moduleId)
      if (!mod) return state
      // ⚠ 模組掛在**機甲**上、不隨形態變動（052-F 已定），但 `buildContext` 仍要
      //   一個分頁鍵才組得出情境——用目前這一頁的即可，模組那一段的結果與它無關。
      const ctx = buildContext(state.draft, state.draft.activeSetKey, world)
      const plan = planModuleFill(ctx, mod)
      if (plan.noop) return state

      let base = state.draft
      for (const position of plan.targets) base = withModule(base, position, action.moduleId)
      const { draft, removed } = reconcile(base, world)

      // 被換掉的那幾顆逐件列出來 —— 一鍵動了好幾格，不逐件報等於讓玩家自己去比對
      // 前後畫面找出少了什麼（與 equipModule 的 displaced 同一條，只是這裡可能有多筆）
      const displaced: RemovedItem[] = plan.displaced.map(({ position, moduleId }) => ({
        kind: 'module', id: moduleId,
        name: world.modules.get(moduleId)?.name ?? moduleId,
        where: partLabel(position),
        why: `已由${mod.name}取代`,
      }))
      const where = plan.targets.map(partLabel).join('、')
      return commit(
        state, state.draft, draft, [...displaced, ...removed],
        `${where}裝上 ${mod.name} → Lv${plan.levelAfter}/${plan.cap}`,
        [], [], true,
      )
    }

    case 'swapPart': {
      const src = world.mechs.get(action.sourceMechId)
      if (!src) return state
      const { position } = action
      const ctx = buildContext(state.draft, state.draft.activeSetKey, world)
      // 規則層是唯一判準 —— UI 已經只列合法來源，但分享碼與書架不經過 UI
      if (canSwapPart(ctx, src, position)) return state

      // 「換回選定機甲」與「換成別台」在資料上是兩種寫法，但對玩家是同一個動作：
      // 挑選器裡基底機甲就排在第一個。收在這裡，呼叫端不必自己判斷該派哪一個 action。
      const base = src.id === state.draft.mechId
        ? withoutPart(state.draft, position)
        : withPart(state.draft, position, action.sourceMechId)
      if (base === state.draft) return state
      const { draft, removed } = reconcile(base, world)
      const label = partLabel(position)
      // ⚠ 換部件會動到重量與出力（Σ 四部位、只有軀幹有出力）⇒ 要報出力變化，
      //   與 equipWeapon 同一條理由；模組那邊不報是因為模組不佔重量。
      return commit(
        state, state.draft, draft, removed,
        src.id === state.draft.mechId ? `${label}已還原為選定機甲` : `${label}已換成 ${src.name} 的`,
        outputNote(state, draft, world), [label], true,
      )
    }

    case 'applyChassisOf': {
      const src = world.mechs.get(action.sourceMechId)
      if (!src) return state
      const ctx = buildContext(state.draft, state.draft.activeSetKey, world)
      // 規則層是唯一判準（同 swapPart）。⚠ 先全部驗完再動手 —— 驗一格換一格會做出半套。
      for (const pos of MECH_PART_ORDER) if (canSwapPart(ctx, src, pos)) return state

      const isBase = src.id === state.draft.mechId
      const base = isBase
        ? withoutParts(state.draft)
        : { ...state.draft, parts: Object.fromEntries(MECH_PART_ORDER.map((p) => [p, src.id])) }
      if (base === state.draft) return state
      const { draft, removed } = reconcile(base, world)
      // 四格全閃：這個動作動的是整台，只閃軀幹會讓人以為只換了一格
      const labels = MECH_PART_ORDER.map(partLabel)
      return commit(
        state, state.draft, draft, removed,
        isBase ? '四個部位已全部還原為選定機甲' : `四個部位已全部套用 ${src.name} 的`,
        outputNote(state, draft, world), labels, true,
      )
    }

    case 'resetPart': {
      const srcId = state.draft.parts?.[action.position]
      if (!srcId) return state
      const base = withoutPart(state.draft, action.position)
      const { draft, removed } = reconcile(base, world)
      const label = partLabel(action.position)
      return commit(state, state.draft, draft, removed, `${label}已還原為選定機甲`, outputNote(state, draft, world), [label], true)
    }

    case 'unequipModule': {
      const { position } = action.ref
      const id = state.draft.modules?.[position]
      if (!id) return state
      const base = withoutModule(state.draft, position)
      const { draft, removed } = reconcile(base, world)
      const name = world.modules.get(id)?.name ?? id
      return commit(state, state.draft, draft, removed, `已卸下 ${name}`, [], [], true)
    }

    case 'clearSet': {
      const key = state.draft.activeSetKey
      const cur = setOf(state.draft, key)
      if (cur.mounts.length === 0 && !cur.backpackId) return state
      // 只動這一個分頁：海莉絲三個形態各有一套裝備，站在「突擊」按下去卻連
      // 「先鋒」一起清掉，是玩家在畫面上看不到的損失（那一頁要切過去才看得見）。
      const base = withSet(state.draft, key, emptySet())
      return commitClear(state, base, '已清空裝備', '武器與背包（連同掛在上面的元件）都卸下了；機師、機甲、模組與算力留著')
    }

    case 'clearAll': {
      // 已經是空的就什麼都不做 —— 跳一則「已全部清空」卻什麼都沒變，比沒有回饋更糟
      if (isEmptyDraft(state.draft)) return state
      // 不跑 reconcile：連機師與機甲都沒了，沒有任何東西需要驗證
      return commitClear(
        state,
        { activeSetKey: DEFAULT_EQUIP_SET_KEY, sets: {} },
        '已全部清空',
        '機師、機甲、裝備、模組、算力與方案名稱都清掉了',
      )
    }

    case 'setNdLevels': {
      // 一樣過 reconcile（clamp ＋ γ 上限）—— 面板自己也擋，但分享碼與草稿還原不經過面板
      const { draft } = reconcile({ ...state.draft, ndLevels: action.levels }, world)
      // 逐鍵比對而不是比參考：上一行的 spread 必然產生新物件，比參考恆為「有變動」
      if (sameNdLevels(state.draft.ndLevels, draft.ndLevels)) return state
      // 算力不動裝備，不需要 toast 也不需要 undo：Lv 條就在眼前，點回去就是復原
      return { ...state, draft, notice: null }
    }

    case 'setName': {
      const clean = sanitizeLoadoutName(action.name)
      if (clean === state.draft.name) return state
      // 命名不動裝備、不跳 toast、不進 undo：字就在輸入框裡，改回去就是復原
      const draft = clean === undefined ? withoutName(state.draft) : { ...state.draft, name: clean }
      return { ...state, draft, notice: null }
    }

    case 'setNote': {
      const clean = sanitizeLoadoutNote(action.note)
      if (clean === state.draft.note) return state
      // 理由同 `setName`：不動裝備、不跳 toast、不進 undo
      const draft = clean === undefined ? withoutNote(state.draft) : { ...state.draft, note: clean }
      return { ...state, draft, notice: null }
    }

    case 'equipSkill': {
      // 一樣過 reconcile（候選池成員檢查 ＋ 裁到三格）—— 面板自己也擋，
      // 但分享碼與草稿還原不經過面板
      const { draft } = reconcile(withCarriedSkill(state.draft, action.index, action.skillId), world)
      if (sameCarried(state.draft, draft)) return state
      // 技能不動裝備，不需要 toast 也不需要 undo：三個格子就在眼前，點回去就是復原
      return { ...state, draft, notice: null }
    }

    case 'unequipSkill': {
      const cur = state.draft.skills?.carried ?? []
      if (!cur.includes(action.skillId)) return state
      const carried = cur.filter((id) => id !== action.skillId)
      const base: LoadoutDraft = { ...state.draft, skills: { ...state.draft.skills, carried } }
      const { draft } = reconcile(base, world)
      return { ...state, draft, notice: null }
    }

    case 'autoUnloadToFit': {
      // ⚠ 只有玩家**主動按下**才會走到這裡（決策三）：自動卸載不可由超重本身觸發，
      //    否則玩家會發現自己剛裝上的東西無聲消失。
      const key = state.draft.activeSetKey
      const { set, removed } = unloadToFit(state.draft, key, world)
      if (removed.length === 0) return state
      const base = withSet(state.draft, key, set)
      const { draft } = reconcile(base, world)
      return commit(state, state.draft, draft, removed, '已卸至符合出力', outputNote(state, draft, world), [], true)
    }

    default:
      return state
  }
}

/** 產生新狀態並帶上一筆回饋。沒有任何移除時不跳 toast（每個動作都跳就等於沒有提示）。 */
function commit(
  state: SimState,
  before: LoadoutDraft,
  draft: LoadoutDraft,
  removed: RemovedItem[],
  title: string,
  notes: string[],
  flash: string[],
  undoable: boolean,
): SimState {
  const seq = state.seq + 1
  const worthShowing = removed.length > 0 || notes.length > 0
  return {
    draft,
    undo: removed.length > 0 && undoable ? before : null,
    notice: worthShowing
      ? { seq, title, removed, notes, flash, undoable: undoable && removed.length > 0 }
      : null,
    seq,
  }
}

/**
 * 清空類動作的共用出口（PLAN-052-L）。
 *
 * 為什麼不走 `commit()`：它只在「有東西被級聯移除」時才給 toast 與 [復原]
 * （`worthShowing` / `undoable && removed.length > 0`），而清空是**玩家自己**
 * 按下去的整批刪除，一件 `RemovedItem` 都不會產生 —— 於是原本的「清空」是
 * 靜默且不可復原的。兩顆清空鍵相鄰之後，那個組合會直接吃掉整套配裝。
 *
 * 這裡刻意**不做二次確認**：本頁的安全網一向是事後的 [復原]（見 CascadeToast 檔頭），
 * 多一個「確定嗎？」只會讓常用的那顆（清空裝備）每次都多按一下。
 */
function commitClear(state: SimState, draft: LoadoutDraft, title: string, note: string): SimState {
  const seq = state.seq + 1
  return {
    draft,
    undo: state.draft,
    notice: { seq, title, removed: [], notes: [note], flash: [], undoable: true },
    seq,
  }
}

/**
 * 這份草稿是不是「什麼都還沒選」。給 `clearAll` 與按鈕的 disabled 共用 ——
 * 兩邊各判各的，遲早會出現「按鈕亮著、按下去卻什麼都沒發生」。
 */
export function isEmptyDraft(d: LoadoutDraft): boolean {
  return !d.pilotId && !d.mechId && !d.name && !d.note
    && Object.keys(d.ndLevels ?? {}).length === 0
    && !d.skills?.carried?.length
    && Object.keys(d.parts ?? {}).length === 0
    && Object.keys(d.modules ?? {}).length === 0
    && Object.values(d.sets).every((s) => s.mounts.length === 0 && !s.backpackId)
}

const flashOf = (removed: RemovedItem[]) => removed.map((r) => r.where).filter((x): x is string => !!x)

function displacedItems(mounts: readonly LoadoutMount[], world: LoadoutWorld, why: string): RemovedItem[] {
  return mounts.map((m) => {
    // ⚠ 元件隨 mount 一起走，**不會**各自進 removed（它們不是被級聯判掉的，
    //   而是它們掛著的那把武器整個離開了）。但玩家配了四顆元件、換一把武器就沒了，
    //   而 toast 只說「已由 X 取代」——那一行讀起來像只換掉一把武器。
    //   數量補在 why 裡：一句話講完，不必為此在清單上多列四行。
    const n = mountedIds(m).length
    return {
      kind: 'weapon' as const,
      id: m.weaponId,
      name: world.weapons.get(m.weaponId)?.name ?? m.weaponId,
      where: mountWhere(m),
      why: n > 0 ? `${why}（連同 ${n} 顆元件）` : why,
    }
  })
}

function backpackItem(state: SimState, key: string, world: LoadoutWorld, off: boolean): RemovedItem[] {
  if (!off) return []
  const id = setOf(state.draft, key).backpackId
  if (!id) return []
  return [{ kind: 'backpack', id, name: world.backpacks.get(id)?.name ?? id, why: '背槽只有一格' }]
}

/**
 * 出力變化的說明。換背包時「−300 出力」是玩家最容易漏看、卻最影響後續判斷的一件事，
 * 所以與被移除的東西並列在同一則 toast 上，而不是等他自己去看重量條。
 */
function outputNote(state: SimState, after: LoadoutDraft, world: LoadoutWorld): string[] {
  const key = after.activeSetKey
  const a = loadoutBudget(buildContext(state.draft, state.draft.activeSetKey, world)).output.total
  const b = loadoutBudget(buildContext(after, key, world)).output.total
  if (a === b) return []
  const delta = b - a
  return [`可用出力 ${a.toLocaleString()} → ${b.toLocaleString()}（${delta > 0 ? '+' : ''}${delta.toLocaleString()}）`]
}

/**
 * 卸到不超重為止：**由重到輕**卸，且每一步都重算 —— 手部取較重組，卸掉較輕那一組
 * 的武器省下的是 0，不重算就會出現「卸了三把還是超重」。
 */
function unloadToFit(draft: LoadoutDraft, key: string, world: LoadoutWorld): { set: EquipSet; removed: RemovedItem[] } {
  let cur = setOf(draft, key)
  const removed: RemovedItem[] = []
  for (let guard = 0; guard < 16; guard++) {
    const ctx = buildContext(withSet(draft, key, cur), key, world)
    const budget = loadoutBudget(ctx)
    if (!budget.over) break

    const total = budget.weight.total
    const cands: { m?: LoadoutMount; ref: WeaponSlotRef; saved: number }[] = cur.mounts.map((m) => {
      const ref: WeaponSlotRef = { bank: m.bank, slot: m.slot, side: m.side }
      return { m, ref, saved: total - loadoutBudget(ctx, { remove: [ref] }).weight.total }
    })
    if (cur.backpackId) {
      const ref: WeaponSlotRef = { bank: 'main', slot: WeaponEquipSlot.BACK }
      cands.push({ ref, saved: total - loadoutBudget(ctx, { remove: [ref] }).weight.total })
    }
    const best = cands.filter((c) => c.saved > 0).sort((a, b) => b.saved - a.saved)[0]
    if (!best) break     // 卸光也裝不下（機體本身就超出出力）—— 停手，別空轉

    if (best.m) {
      removed.push({
        kind: 'weapon',
        id: best.m.weaponId,
        name: world.weapons.get(best.m.weaponId)?.name ?? best.m.weaponId,
        where: mountWhere(best.m),
        why: '自動卸至符合出力',
      })
      cur = { ...cur, mounts: cur.mounts.filter((x) => x !== best.m) }
    } else {
      const id = cur.backpackId!
      removed.push({ kind: 'backpack', id, name: world.backpacks.get(id)?.name ?? id, why: '自動卸至符合出力' })
      cur = { ...cur, backpackId: undefined }
    }
  }
  return { set: cur, removed }
}
