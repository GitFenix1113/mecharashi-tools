// 機體（底盤）數值 derive 層 —— PLAN-052-A Phase A / A-3
//
// 這一層存在的唯一理由：**機甲的頂層數值欄位不可信**。
// mechs 文件同時存著「頂層 firepower / weight / output」與「parts.* 四部位各自的值」，
// 兩者由不同來源寫入（爬蟲 vs 後台手建），實測（2026-08-23，90 台）結果是：
//
//   firepower：83 台頂層 ＝ **單一部位值**（不是總和）、2 台 ＝ Σ 四部位、5 台 ≈ Σ（手建有捨入誤差）
//   weight   ：頂層 ＝ Σ 四部位（彌造者 825 ＝ 825，無歧義）
//   output   ：頂層 ＝ parts.torso.output（只有軀幹有出力，其餘三部位無此欄位）
//
// 也就是說直接讀 `mech.firepower` 的畫面，對 83/90 台顯示的是**實際火力的 1/4**。
// 全站一律改走本檔，DB 頂層欄位保留不動（爬蟲重抓時不會把修好的值再洗掉）。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type { MechPart } from '../types'
import { ArmorType, MechPartPosition } from '../types/enums.ts'

/** 四部位的正規順序。UI 逐格渲染與本檔的加總一律用它，避免各處自己寫陣列而漏掉部位。 */
export const MECH_PART_ORDER = [
  MechPartPosition.TORSO,
  MechPartPosition.LEFT_ARM,
  MechPartPosition.RIGHT_ARM,
  MechPartPosition.LEGS,
] as const

/**
 * 可加總的四部位輸入。
 *
 * ⚠ 值刻意允許 `number`：v1.4 之前的 `MechPartsLegacy` 把 parts 存成「四個耐久數字」，
 *   線上仍可能殘留。舊格式沒有 firepower / weight 可談，一律當 0 而不是讓 `.firepower`
 *   在 number 上取值成 undefined 再 NaN 傳染整條加總。
 */
export type MechPartsInput = Partial<Record<
  typeof MECH_PART_ORDER[number],
  MechPart | number | null | undefined
>> | null | undefined

/** 取出單一部位物件；legacy 的 number 與缺件一律回 null。 */
function partOf(parts: MechPartsInput, pos: typeof MECH_PART_ORDER[number]): MechPart | null {
  const p = parts?.[pos]
  return p && typeof p !== 'number' ? p : null
}

/** 四部位物件陣列（缺件已濾掉）。呼叫端要逐格渲染時用這支，不要自己解構四個欄位。 */
export function mechParts(parts: MechPartsInput): MechPart[] {
  return MECH_PART_ORDER.map((pos) => partOf(parts, pos)).filter((p): p is MechPart => p !== null)
}

function sumBy(parts: MechPartsInput, key: 'firepower' | 'weight'): number {
  return MECH_PART_ORDER.reduce((sum, pos) => sum + (partOf(parts, pos)?.[key] ?? 0), 0)
}

/**
 * 機體火力 ＝ Σ 四部位火力。
 *
 * ⚠ **全站禁止讀 `mech.firepower`**（見檔頭與 Mech.firepower 的型別註解）。
 *   佐證：品質預覽的四張官方截圖顯示同一品質階下四部位火力完全相同（1040／1108／1186），
 *   而頂層值恰好等於其中一格 —— 爬蟲抓的是「單一部位」欄位而非總和。
 */
export function chassisFirepower(parts: MechPartsInput): number {
  return sumBy(parts, 'firepower')
}

/**
 * 機體重量 ＝ Σ 四部位重量（配裝可用出力的固定支出）。
 * 與頂層 `mech.weight` 實測一致，但仍走 derive —— 混搭部位（Q20）之後頂層值必然失真。
 */
export function chassisWeight(parts: MechPartsInput): number {
  return sumBy(parts, 'weight')
}

/**
 * 機體出力 ＝ `parts.torso.output`（**只有軀幹有出力**，不是四部位加總）。
 *
 * 這是 effectiveOutput() 的 base；背包與模組的加成不在這裡，見 effectiveOutput.ts。
 */
export function chassisOutput(parts: MechPartsInput): number {
  return partOf(parts, MechPartPosition.TORSO)?.output ?? 0
}

// ─── ResolvedChassis：機體數值的唯一入口（PLAN-052-A Phase B / B-2）──────────
//
// Q20 決定允許混搭部位之後，「一台機甲」降級成「四個部位的預設組合」。
// 這一層先把 derive 做出來（混搭 UI 在 052-G），讓後續所有計算從第一天就走對的路徑：
// 呼叫端拿 `ResolvedChassis`，不再直接摸 `mech.parts`，也就不會有人再寫出
// 「這台機甲的重量」這種在混搭之後不成立的假設。

/** 一個已解析的部位：連同它來自哪一台機甲（混搭時四個來源可以都不一樣）。 */
export interface ResolvedPart {
  sourceMechId: string
  part: MechPart
}

export interface ResolvedChassis {
  /** 基底機甲 id（未混搭時四個部位都來自它） */
  baseMechId: string
  parts: Record<typeof MECH_PART_ORDER[number], ResolvedPart>
  /** Σ 四部位重量 */
  weight: number
  /** parts.torso.output（只有軀幹有出力） */
  output: number
  /** Σ 四部位火力 */
  firepower: number
  /**
   * ⚠ 取自**基底機甲**。混搭不能跨裝甲類型（計畫書決策二）⇒ 四個部位必然同型 ⇒ 無歧義。
   *   「只提供同型部位」是挑選器（052-G）的責任，本層不重複把關也不回報衝突。
   */
  armorType: ArmorType
  /**
   * 四個模組槽的接口型別（Ⅰ型／Ⅱ型）。
   *
   * ⚠ 目前是 `string` 而非 enum：實測 360 格中有 44 格空白、4 格是「ⅠⅠ型接口」錯字，
   *   D-1 正規化並收成 `PartInterface` 之後這裡才跟著收。
   *   **空字串 ＝ 接口資料未建檔**，UI 應顯示「未建檔」而不是留白或猜一個型別。
   */
  moduleSlots: Record<typeof MECH_PART_ORDER[number], { iface: string }>
  /**
   * 某個模組在本機體上的等級。本輪一律回**滿級**（PLAN-052 N3：全站數值以滿級計算）。
   *
   * 回 0 ＝ 查無此模組資料（未傳 moduleMap、或 id 打錯）。全庫模組等級都從 1 起算，
   * 故 0 不會與真實等級混淆；呼叫端該把它當「不知道」而不是「零級」。
   */
  moduleLevelOf(moduleId: string): number
}

/** resolveChassis 的選項。 */
export interface ResolveChassisOptions {
  /** 混搭：指定某個部位改用另一台機甲的同名部位（052-G 的 UI 才會用到） */
  partOverrides?: Partial<Record<typeof MECH_PART_ORDER[number], { id: string; parts?: MechPartsInput }>>
  /** 模組 id → 模組資料。只為了 `moduleLevelOf()`；不傳的話該方法恆回 0 */
  moduleMap?: ReadonlyMap<string, { levels?: { level: number }[] }>
}

/**
 * 把一台機甲（可選混搭）解析成 `ResolvedChassis`。
 *
 * 四個部位任一缺席（或還是 legacy 的耐久數字）一律回 `null` —— **不補零值部位**：
 * 一台重量 0、火力 0 的假機體會一路流進模擬器，比「這台資料不完整」難查太多。
 * 實測 90/90 台四部位皆為物件，今天不會走到這條路。
 *
 * ⚠ 另注：`mech_090_美杜莎MK2` 是**刻意的佔位**——管理者先建了文件（manual: true），
 *   但這台是新機甲、官方正式數值尚未公布，所以全部欄位（含軀幹出力）都是 0。
 *   它四部位齊全，所以解析得出來，但 `output` 會是 0 —— 呼叫端要顯示「可用出力」時
 *   應把它當**數值未公布**處理，而不是渲染成一台什麼都裝不下的機甲。
 *   同型佔位日後還會出現（新機甲一律先建檔再補數值），別把它當髒資料修掉。
 */
export function resolveChassis(
  mech: { id: string; armorType: string; parts?: MechPartsInput } | null | undefined,
  opts: ResolveChassisOptions = {},
): ResolvedChassis | null {
  if (!mech) return null
  const resolved = {} as Record<typeof MECH_PART_ORDER[number], ResolvedPart>
  for (const pos of MECH_PART_ORDER) {
    const override = opts.partOverrides?.[pos]
    const source = override ?? mech
    const part = partOf(override ? override.parts : mech.parts, pos)
    if (!part) return null
    resolved[pos] = { sourceMechId: source.id, part }
  }

  const partsView = {
    torso: resolved.torso.part,
    leftArm: resolved.leftArm.part,
    rightArm: resolved.rightArm.part,
    legs: resolved.legs.part,
  }
  const moduleSlots = {} as Record<typeof MECH_PART_ORDER[number], { iface: string }>
  for (const pos of MECH_PART_ORDER) moduleSlots[pos] = { iface: resolved[pos].part.interface ?? '' }

  return {
    baseMechId: mech.id,
    parts: resolved,
    weight: chassisWeight(partsView),
    output: chassisOutput(partsView),
    firepower: chassisFirepower(partsView),
    // 實測 90/90 台的 armorType 都落在 ArmorType 的三個值內；
    // D-1 會把 Mech.armorType 本身收成 enum，屆時這個 cast 可刪
    armorType: mech.armorType as ArmorType,
    moduleSlots,
    moduleLevelOf(moduleId: string): number {
      const levels = opts.moduleMap?.get(moduleId)?.levels ?? []
      return levels.reduce((max, l) => (l.level > max ? l.level : max), 0)
    },
  }
}
