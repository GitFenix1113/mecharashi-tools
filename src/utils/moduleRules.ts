// 模組的候選池與接口 gate —— PLAN-052-G Phase A / A-3
//
// ── 職責邊界 ────────────────────────────────────────────────────────────────
//   本檔（moduleRules）          ：「哪些模組玩家拿得到」＋「這個接口收不收這一顆」——
//                                  純資料判準，不認識 `LoadoutContext`。
//   loadoutRules 的 canEquipModule：把上面兩條接上情境（已裝了什麼、機甲是哪台），產出拒絕原因。
//   simReducer 的 reconcile()     ：換機甲時的級聯（052-G C-1）。
// 與 `componentRules.ts` ↔ `canEquipComponent()` 的分工逐字相同。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import type { Module, ModuleLevel } from '../types/module.ts'
import type { InnateModuleEntry } from '../types/mech.ts'
import { MechPartPosition, ModuleRarity, ModuleSlot, PartInterface } from '../types/enums.ts'

// ─── 候選池 ─────────────────────────────────────────────────────────────────

/**
 * **明著排除**的模組 id。
 *
 * ⚠ 一個沒有理由的 id 白名單，下一個人不敢動也不敢留 —— 所以每一筆都要寫清楚為什麼。
 *
 * · `mod_2030`「自擬合模組」：官方廢案。全 12 個集合零引用、`source` 是**字串** `'未知'`
 *   而不是陣列（其餘 240 筆都是陣列）、沒有任何拆解來源 ⇒ 玩家無從取得。
 *   不排除的話，挑選器裡會出現一顆裝得上、卻在遊戲裡根本拿不到的幽靈模組。
 *   同時它與 `mod_2041` 同名，排掉之後池內只剩一筆，同名歧義一併消失（計畫書決策九）。
 *
 * ⚠ **用白名單排除、不改資料**：它是 `managedBy: 'auto'`，改了會被下次爬蟲洗回去。
 */
export const EXCLUDED_MODULE_IDS: readonly string[] = ['mod_2030']

const EXCLUDED = new Set(EXCLUDED_MODULE_IDS)

/**
 * 這顆模組玩家能不能自由裝配。**全站判斷「這顆進不進挑選器」的唯一入口。**
 *
 * 三條（計畫書決策一，2026-08-27 全庫實測 241 筆 → 186 筆）：
 *   ① `boundMechId == null` —— 綁機甲的（專屬模組 24 筆＋部分特性模組）只有那台裝得上。
 *      ⚠ 反過來**不**成立：沒綁機甲**不等於**「不是誰的天生模組」。全庫有 112 顆
 *      沒綁機甲的模組同時是某台機甲的 `module4Id` / `module8Id`，而那正是機制本身 ——
 *      特性模組的來源是「拆機甲」（81 筆裡 65 筆），拆掉一台、把它的特性模組裝到自己機上
 *      就是這個玩法。看到 `module4Id` 而覺得這裡漏擋的人，答案在 `source` 欄位裡。
 *   ② 排除 `機甲副模組`（11 筆）—— 它們依 ① 也「沒綁機甲」，但那是機甲天生自帶的那一種，
 *      `source` 為空陣列 ⇒ 玩家無從取得。
 *      ⚠ **不可改用 `available` 判**：值域已漂移（11 筆裡 10 true／1 false），
 *        拿它當唯一 gate 會放進 10 顆裝不到的副模組。
 *   ③ 排除 `EXCLUDED_MODULE_IDS`。
 */
export function isModuleCandidate(m: Pick<Module, 'id' | 'slot' | 'boundMechId'>): boolean {
  return m.boundMechId == null && m.slot !== ModuleSlot.BUILT_IN && !EXCLUDED.has(m.id)
}

/**
 * 候選池。**順序即輸入順序** —— 排序是挑選器的事（052-G C-3），
 * 在這裡排一次、面板再排一次，就會出現「按鈕排一種、結果排另一種」。
 */
export function moduleCandidates<T extends Pick<Module, 'id' | 'slot' | 'boundMechId'>>(
  modules: Iterable<T>,
): T[] {
  const out: T[] = []
  for (const m of modules) if (isModuleCandidate(m)) out.push(m)
  return out
}

// ─── 接口 gate ──────────────────────────────────────────────────────────────

/**
 * 一格接口的三種狀態。把 `MechPart.interface` 這個裸字串收成封閉聯集，
 * 好讓呼叫端被逼著把三種都講清楚 —— 三者的文案完全不同，共用一句話就會含糊，
 * 而留白會被讀成一個我們並不知道的否定陳述。
 *
 * · `PartInterface`  Ⅰ型／Ⅱ型，可以裝東西
 * · `'none'`         **這台機甲沒有模組接口**（空字串，全部是 B 品質的 10 台 40 格）
 * · `'unknown'`      認不得的值 —— 官方新增了接口型別，或資料被打錯
 *
 * ⚠ **空字串不要再渲染成「未建檔」**：那個狀態自 2026-08-27 起已經不存在
 *   （美杜莎MK2 那 4 格已依 S 級規則補齊），見 `mechInterface.ts` 的 `hasModuleInterface()`。
 */
export type InterfaceState = PartInterface | 'none' | 'unknown'

const KNOWN_INTERFACES: readonly string[] = Object.values(PartInterface)

/** 把 `ResolvedChassis.moduleSlots[pos].iface` 收成 `InterfaceState`。 */
export function interfaceState(iface: string | null | undefined): InterfaceState {
  if (!iface) return 'none'
  return KNOWN_INTERFACES.includes(iface) ? (iface as PartInterface) : 'unknown'
}

/**
 * 這個接口收不收這個品質的模組（計畫書決策二）。
 *
 * · Ⅰ型 ⇒ **只收 A 級**（候選池 42 筆）。Ⅰ型今天只存在於 16 台 A 品質機甲的軀幹與腿部。
 * · Ⅱ型 ⇒ A／S 皆可（候選池 186 筆全部）。
 *
 * ⚠ 判準是**模組的 rarity**，不是 slot：特性／8級／通用三種 slot 在兩型接口上都出現得了。
 */
export function interfaceAcceptsRarity(iface: PartInterface, rarity: string): boolean {
  return iface === PartInterface.TYPE_II || rarity === ModuleRarity.A
}

// ─── 讀數值：一律走 levels[]（PLAN-052-G B-1）──────────────────────────────
//
// ⚠ **全站禁止讀 `Module` 頂層那排平坦欄位**（`mod.dmg` / `mod.acc_rate` …）。
//   候選池 186 筆**全部**有 `levels[]`，而頂層全 0 者有 163 筆（2026-08-27 實測）。
//   讀頂層的症狀是「模組裝上去沒有任何效果」—— 而且**不報錯**，因為 0 是一個合法的數字。
//   與 `chassisStats.ts` 禁止讀 `mech.firepower` 是同一條理由：同一件事存了兩份，
//   而只有其中一份是真的。
//
// ⚠ **不可假設 `levels[]` 固定 8 階**：候選池裡 136 筆是 4 階、50 筆是 8 階。
//   寫死 8 的版本會對那 136 筆讀出 `undefined`，接著整條加總變 NaN。

/**
 * 從型別中挑出「數值欄位」。與 `moduleStats.tsx` 共用同一份定義（那邊 re-export 本型別），
 * 靠共用型別，`STAT_META` 的**編譯期窮盡檢查**才守得住這裡新增的欄位 ——
 * 官方哪天多一種武器種類增傷，`npm run build` 會指名缺哪個 key，
 * 而不是靜默地在彙總表少加一項。
 */
type NumericKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never
}[keyof T]

/** 一階模組的所有數值欄位鍵（30 個，不含 `level` 自己）。 */
export type ModuleStatKey = Exclude<NumericKeys<ModuleLevel>, 'level'>

/** 一組模組加成：欄位 → 數值。**只收非零值** —— 見 `moduleStatsAt()`。 */
export type ModuleStats = Partial<Record<ModuleStatKey, number>>

/** 這顆模組有幾階。`0` ＝ 沒有 `levels[]`（該筆已被 `MOD_DATA_INCOMPLETE` 擋在配裝之外）。 */
export const moduleMaxLevel = (mod: Pick<Module, 'levels'>): number => mod.levels?.length ?? 0

/**
 * 取某一階的資料。查無回 `null`。
 *
 * ⚠ 用 `level` **欄位**比對而不是 `levels[level - 1]` 取索引。全庫實測兩者等價
 *   （241 筆的 `levels[i].level` 恆為 `i + 1`，由守門測試釘住），但等價的是**今天的資料**，
 *   而索引寫法在官方哪天塞進一筆缺階的模組時會**靜默錯開一階** —— 那種錯不會報，
 *   只會讓一顆模組的加成看起來比實際少一級。
 */
export function moduleLevelAt(mod: Pick<Module, 'levels'>, level: number): ModuleLevel | null {
  return mod.levels?.find((l) => l.level === level) ?? null
}

/**
 * 某一階的加成，**只含非零欄位**。
 *
 * 濾掉 0 是刻意的：`ModuleLevel` 有 30 個數值欄位而 186 筆裡只有 7 筆的滿級同時碰到
 * 一個以上的欄位（計畫書決策八）。不濾的話，彙總表會變成一張 30 列、其中 29 列是 0 的表，
 * 而「這顆模組加了什麼」那個問題會淹沒在裡面。
 *
 * 查無此階回**空物件**而不是 `null`：呼叫端多半要拿去加總，一個空的加成是恆等元，
 * 而 `null` 逼每個呼叫端各寫一次防呆。
 */
export function moduleStatsAt(mod: Pick<Module, 'levels'>, level: number): ModuleStats {
  const data = moduleLevelAt(mod, level)
  if (!data) return {}
  const out: ModuleStats = {}
  for (const [key, value] of Object.entries(data)) {
    // `level` 是階數不是加成；`description` / `descriptionRefs` 不是數字
    if (key === 'level' || typeof value !== 'number' || value === 0) continue
    out[key as ModuleStatKey] = value
  }
  return out
}

/**
 * Σ 同名欄位（計畫書決策八的加總規則）。
 *
 * ⚠ 加總的是**各自等級上的**值：四個部位的接口品質階不同，同一顆模組在不同部位
 *   會是不同的等級。呼叫端一律先各自 `moduleStatsAt(mod, chassis.moduleLevelOf(mod.id))`
 *   再送進來，不要把滿級值加一加就當答案。
 *
 * ⚠ **不出衍生的戰力／傷害數字**（總綱決策一④已裁決延後）：本層只回「各欄位加了多少」。
 *   把百分比欄位換算成實際傷害需要攻擊力口徑，而那個口徑今天未定。
 */
export function sumModuleStats(all: readonly ModuleStats[]): ModuleStats {
  const out: ModuleStats = {}
  for (const stats of all) {
    for (const [key, value] of Object.entries(stats)) {
      if (typeof value !== 'number') continue
      out[key as ModuleStatKey] = (out[key as ModuleStatKey] ?? 0) + value
    }
  }
  return out
}

// ─── 同族堆疊與等級推導（PLAN-052-G C-7，使用者裁決 2026-08-27）──────────────
//
// ── 機制 ────────────────────────────────────────────────────────────────────
// **同一顆模組可以裝在多個接口上，而那正是升級它的方式。**
// 每裝一顆，那一族的等級 ＋`moduleAddLevel`；上限是該模組 `levels[]` 的階數。
//
//   四顆「刀劍模組Ⅱ」⇒ Σ 2×4 ＝ 8 級，但它只有 4 階 ⇒ **實際生效 Lv4，多的 4 級白費**。
//   兩顆就滿了，另外兩格可以拿去堆別的模組。這就是本檔要提醒玩家的事。
//
// ⚠ **2026-08-28 遊戲內截圖確認，本式不再是推論**（站長為實際玩家，附遊戲畫面）：
//     裝一顆「刀劍模組Ⅱ」→ 該族顯示 `∧ LV.2/4`（進度條 4 格亮 2 格）
//     裝一顆「噴火器模組」（Ⅰ）→ `∧ LV.1/4`（亮 1 格）
//   遊戲自己的模組畫面就是把**同族加總**列成一條、並在預覽替換時標出 ∧／∨ 的增減，
//   與本檔的 `moduleStacks()` ＋ 超限提醒是同一套語意。
//
// ── 為什麼族鍵是「名稱去掉尾端的 Ⅰ／Ⅱ」──────────────────────────────────
// 2026-08-27 全庫實測：候選池 186 筆去階後恰為 **155 族**，其中 31 族有兩名成員、
// 124 族只有一名，**零跨槽位撞名**。31 個雙人族全部是通用模組的
// `校準模組Ⅰ`(A 級／add 1) ／ `校準模組Ⅱ`(S 級／add 2) 這種配對，
// 且**兩者的 `levels[]` 完全相同**（進度表 C-3 早就記過這件事）——
// 它們是同一顆模組的兩個貢獻階，不是兩顆模組。
//
// ⇒ 一顆 Ⅱ ＝ 兩顆 Ⅰ；混裝 Ⅰ＋Ⅱ 也照樣相加（1 ＋ 2 ＝ 3 級）。
//
// ⚠ 族鍵**帶 slot 前綴**。今天不帶也不會錯（零跨槽撞名），但官方哪天出一顆與既有通用模組
//   同名的特性模組時，不帶前綴的版本會把兩族靜默併成一族 —— 與 `componentFamilyKey()`
//   帶觸／應前綴是同一條理由。
//
// ── 天生模組也進同一個池（PLAN-052-K）──────────────────────────────────────
// 「機甲自帶的那一顆」與「玩家插上去的那些」**共用同一個等級條目** ——
// 遊戲內〈機甲整備〉的模組清單就是把兩者列在同一張表、同一種 `LV.x/y` 格式，
// 差別只在天生的那些在四個部位欄位有數字、插槽來的四格全空。
//
//   完整式子： level = min( Σ天生貢獻 ＋ Σ(插槽貢獻 × 部位倍率) , cap )
//
// 天生那一段由 `innateModules.ts` 的 `resolveInnateModules()` 算（滿階時
// 8 級模組每部位 2、特性位與副模組每部位 1），從 `opts.innate` 傳進來；
// 部位倍率來自 `slotMultipliers()`（今天只有破曉者-02〈匯流樞紐〉會把某個部位的
// **插槽**貢獻 ×2）。
//
// ⚠ 兩者分開記在 `sum`／`innateSum` 而不是併成一個數：超限提醒要講的是
//   「你插上去的那幾顆有幾級白費」，把天生的算進去會讓那句話變成在怪玩家。
// ⚠ 不傳 `opts` 時行為與 052-G 完全相同（`innateSum` 恆 0）—— 既有呼叫端不受影響。
//
// ⚠ 這同時是 052-G **E-3「延後」的答案**。當初延後的理由是「全站預設滿階 ⇒ Σ 是常數」，
//   而 052-G Phase D 的部件混搭打破了那個前提：**滿配假設擋掉的是「品質階」這個維度，
//   擋不掉「來源機甲」這個維度** —— 換進來的部件帶的是它原本那台機甲的模組。

const TIER_SUFFIX = /[ⅠⅡ]$/

/**
 * 這顆模組貢獻幾級。欄位缺席時當 1 —— 官方對 `moduleAddLevel` 的定義就是
 * 「預設 1」，而缺席的那幾筆都是舊格式殘留。
 */
export const moduleAddLevel = (mod: Pick<Module, 'moduleAddLevel'>): number =>
  mod.moduleAddLevel ?? 1

/**
 * 同族鍵。**全站判斷「兩顆模組是不是同一顆的兩個階」的唯一入口。**
 *
 * 判準就是名稱（見上方那一段）。落一個 Firestore 欄位只是把同一件事寫第二遍，
 * 而官方改了名，資料上的 familyKey 不會跟著動 —— 與 `componentFamilyKey()` 逐字同一條理由。
 * 代價是它跟著官方的命名規則走，所以配一組 CI 守門測試釘住「155 族、31 個雙人族」。
 */
export const moduleFamilyKey = (mod: Pick<Module, 'name' | 'slot'>): string =>
  `${mod.slot}:${mod.name.trim().replace(TIER_SUFFIX, '')}`

/** 一族模組在這台機體上的堆疊結果。 */
export interface ModuleStack {
  /** 同族任一顆（`levels[]` 相同，讀數值用哪一顆都一樣）。取等級貢獻最高的那顆當代表 */
  mod: Module
  /** 這一族**裝在**哪些接口，依 `MECH_PART_ORDER` 的順序。天生的不算在這裡 */
  positions: MechPartPosition[]
  /** Σ 插槽貢獻（`moduleAddLevel` × 部位倍率，**未封頂**；超限提醒看的就是這個數） */
  sum: number
  /** 這一族的**天生**貢獻來自哪些部位（PLAN-052-K）。沒傳 `opts.innate` 時恆為空 */
  innatePositions: MechPartPosition[]
  /** Σ 天生貢獻（**未封頂**）。沒傳 `opts.innate` 時恆為 0 */
  innateSum: number
  /** 上限 ＝ `levels[].length` */
  cap: number
  /** 實際生效等級 ＝ `min(sum + innateSum, cap)` */
  level: number
  /** 超出上限、**不會生效**的級數。0 ＝ 沒有浪費 */
  overflow: number
}

/** `moduleStacks()` 的選項（PLAN-052-K）。全部省略時行為與 052-G 相同。 */
export interface ModuleStacksOptions {
  /**
   * 部位倍率：該部位的**插槽**貢獻 ×N。來自 `innateModules.ts` 的 `slotMultipliers()`
   * （今天只有破曉者-02〈匯流樞紐〉，軀幹／腿部各一顆，各自 ×2）。
   */
  positionMultiplier?: Partial<Record<MechPartPosition, number>>
  /**
   * 天生模組的逐部位貢獻，來自 `resolveInnateModules()`。
   * 與插槽貢獻**共用同一個等級池**（見上方註解）。
   */
  innate?: Partial<Record<MechPartPosition, readonly InnateModuleEntry[]>>
}

/**
 * 把四個接口上的模組（以及天生模組，若有傳）收成「每一族一筆」。
 *
 * `lookup` 查不到的 id 直接跳過 —— 資料斷鏈由呼叫端各自呈現（面板印紅字、
 * 匯總印 id），這一層只負責算得出來的那些。
 */
export function moduleStacks(
  installed: Readonly<Partial<Record<MechPartPosition, string>>>,
  lookup: (id: string) => Module | undefined,
  opts: ModuleStacksOptions = {},
): Map<string, ModuleStack> {
  const out = new Map<string, ModuleStack>()

  /** 取得（或建立）某一族的那一筆。等級與溢出一律最後統一算，避免兩處各算一次而漂移。 */
  const bucket = (mod: Module): ModuleStack => {
    const key = moduleFamilyKey(mod)
    let st = out.get(key)
    if (!st) {
      st = { mod, positions: [], sum: 0, innatePositions: [], innateSum: 0, cap: moduleMaxLevel(mod), level: 0, overflow: 0 }
      out.set(key, st)
    }
    // 代表取貢獻高的那一顆（Ⅱ 勝過 Ⅰ）—— 只影響顯示用的名稱與圖示，數值兩者相同
    else if (moduleAddLevel(mod) > moduleAddLevel(st.mod)) st.mod = mod
    return st
  }

  // 依 MechPartPosition 的宣告順序走，讓 positions 的順序穩定（UI 與匯出圖共用它）
  for (const position of Object.values(MechPartPosition)) {
    // ① 天生貢獻。先於插槽是刻意的：某些機甲的天生模組同時是候選池裡的模組
    //    （特性模組可以拆機甲取得），先建桶能讓代表模組取到天生的那一顆。
    for (const e of opts.innate?.[position] ?? []) {
      const mod = lookup(e.moduleId)
      if (!mod || e.level <= 0) continue
      const st = bucket(mod)
      st.innateSum += e.level
      if (!st.innatePositions.includes(position)) st.innatePositions.push(position)
    }
    // ② 插槽貢獻 × 部位倍率
    const id = installed[position]
    if (!id) continue
    const mod = lookup(id)
    if (!mod) continue
    const st = bucket(mod)
    st.positions.push(position)
    st.sum += moduleAddLevel(mod) * (opts.positionMultiplier?.[position] ?? 1)
  }

  for (const st of out.values()) {
    const total = st.sum + st.innateSum
    st.level = Math.min(total, st.cap)
    st.overflow = Math.max(0, total - st.cap)
  }
  return out
}

/**
 * 某一顆模組**在目前這套配裝下**的生效等級。查無（沒裝）回 0。
 *
 * ⚠ 接口上的模組一律走這支，**不要走 `ResolvedChassis.moduleLevelOf()`** ——
 *   那一支不知道別的格子裝了什麼，只答得出「這顆模組最高幾階」。
 *   兩者的差別正是本段機制：裝一顆通用Ⅱ 是 Lv2，裝兩顆才是 Lv4。
 */
export function stackLevelOf(stacks: ReadonlyMap<string, ModuleStack>, mod: Pick<Module, 'name' | 'slot'>): number {
  return stacks.get(moduleFamilyKey(mod))?.level ?? 0
}
