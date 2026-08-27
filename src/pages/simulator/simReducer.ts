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
  buildContext, canEquipWeapon, canEquipBackpack, canEquipComponent, canEquipModule, loadoutBudget,
  planModuleFill, slotsOverlap,
  type LoadoutContext, type LoadoutWorld, type ResolutionAction,
} from '../../utils/loadoutRules.ts'
import { ND_RULES, isGammaZone, zonePower } from '../../utils/ndOverrides.ts'
import { sanitizeLoadoutName } from '../../utils/loadoutName.ts'

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
  | { type: 'clearSet' }
  | { type: 'autoUnloadToFit' }
  /** 設定整份神經驅動算力配置（分區名 → Lv）。面板一次送整份，不逐區增減 —— γ 上限是**跨區**的 */
  | { type: 'setNdLevels'; levels: Record<string, number> }
  /** 設定方案名稱。收原始輸入，清洗由 reducer 負責（見 sanitizeLoadoutName 的檔頭） */
  | { type: 'setName'; name: string }
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
  kind: 'weapon' | 'backpack' | 'component' | 'module'
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
  /** [復原] 可不可按。全清空／載入草稿這類動作不提供復原 */
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
  const keys = next.pilotId ? equipSetKeys(next.pilotId, world.forms) : [DEFAULT_EQUIP_SET_KEY]
  const sets: Record<string, EquipSet> = {}
  for (const key of keys) if (next.sets[key]) sets[key] = next.sets[key]
  if (Object.keys(sets).length !== Object.keys(next.sets).length) next = { ...next, sets }
  if (!keys.includes(next.activeSetKey)) next = { ...next, activeSetKey: keys[0] }

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

  // ── 模組接口：掃成「這台機甲的這四格裝得下」的合法配置（PLAN-052-G C-1）──
  const mods = reconcileModules(next, world)
  next = mods.draft
  removed.push(...mods.removed)

  // ── 算力配置：掃成對得上目前機師的合法配置（PLAN-052-I D-2）──
  next = reconcileNdLevels(next, world)

  // ── 方案名稱：外部來源（舊存檔／分享碼／localStorage 手改）一樣要過清洗（PLAN-052-I E-1）──
  //    setName 已經清過一次，這裡是給「不經 setName 進來的那些路徑」的第二道。
  const cleanName = sanitizeLoadoutName(next.name)
  if (cleanName !== next.name) {
    next = cleanName === undefined ? withoutName(next) : { ...next, name: cleanName }
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
 *   ② Lv 超出該區的級數或為負 → clamp 進 `[0, levels.length]`
 *   ③ γ 區合計超過 `gammaPairCap` → **整份丟掉**，退回 `defaultNdLevels()`
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

/** 移除 `name` 欄位本身（理由同 `withoutNdLevels`：未設定＝欄位不存在）。 */
function withoutName(draft: LoadoutDraft): LoadoutDraft {
  if (!('name' in draft)) return draft
  const rest = { ...draft }
  delete rest.name
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

    case 'setActiveSet':
      return state.draft.activeSetKey === action.key
        ? state
        : { ...state, draft: { ...state.draft, activeSetKey: action.key }, notice: null }

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
      const base = withSet(state.draft, key, emptySet())
      return commit(state, state.draft, base, [], '已清空這套配裝', [], [], true)
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
