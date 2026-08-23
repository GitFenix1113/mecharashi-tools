// 配裝總重 —— PLAN-052-A Phase A / A-1
//
// ── 這支存在的理由：手部是「取較重組」，不是加總 ─────────────────────────────
// 強襲者背包會給機甲一組「備用武器」槽（左手備用／右手備用）。備用組**不與主手同時上場**，
// 因此官方的重量計算是 `max(Σ主手, Σ備用)` 而不是兩組相加。
// 誤寫成加總的代價：海莉絲先鋒形態會算出 2625（官方 1825），誤差 44% —— 而且是往「裝不下」
// 的方向錯，模擬器會把玩家實際帶得動的配裝判成超重。
//
// ── 計算順序（與 effectiveOutput 的循環）─────────────────────────────────────
// 背包**同時**吃重量（強襲者 150）又給出力（+300），看起來像循環，其實不是：
// 兩邊都只讀「已選定的背包」這一個事實，沒有先後依賴。全站一律
//   `totalWeight(set, chassis) <= effectiveOutput(chassis, set, modules)`
// 兩支各算各的、最後比大小，**不做任何迭代**。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

/**
 * 只取 `weight` 的結構型別。Weapon / Backpack / MechPart / ResolvedChassis 全部結構相容，
 * 呼叫端直接把實體丟進來即可，不需要先 map 成數字、也不需要本檔認識那些型別。
 */
export interface Weighted { weight: number }

/**
 * 一個形態（或無形態機師的 `default`）的裝備組。
 *
 * ⚠ **一定是「某一個形態」的那一套**，不是整份 Build：海莉絲四個形態各有獨立配裝，
 *   把四套混在一起加總會得到一個遊戲中不存在的數字。
 * ⚠ `back` 是**一格**：背包與背部武器互斥（官方只有一個背部掛點），
 *   故型別上就只給一個位置，讓「同時裝背包和炬塔」在編譯期就寫不出來。
 */
export interface LoadoutWeightSet {
  /** 主手組（單手 ×2 或雙手 ×1） */
  mainHand?: readonly Weighted[]
  /** 備用手組（由 `type === 'BackupEquipment'` 的背包給，全庫僅強襲者背包一筆） */
  backupHand?: readonly Weighted[]
  /** 肩部（中甲 2 格，其餘機種 0 格） */
  shoulder?: readonly Weighted[]
  /** 背部：背包 **XOR** 背部武器 */
  back?: Weighted | null
}

/** 總重的逐項拆解。UI 要講出「主手 800／備用 850（採計）」時用這支，不要自己重算一次。 */
export interface WeightBreakdown {
  chassis: number
  mainHand: number
  backupHand: number
  /** 實際計入總重的手部重量 ＝ max(mainHand, backupHand) */
  hands: number
  /** 哪一組被採計。相等時回 'main'（顯示上以主手為準，兩者數字本來就一樣） */
  heavierBank: 'main' | 'backup'
  shoulder: number
  back: number
  total: number
}

const sum = (items: readonly Weighted[] | undefined): number =>
  (items ?? []).reduce((acc, it) => acc + (it?.weight ?? 0), 0)

/**
 * 配裝總重的逐項拆解。
 *
 * ⚠ 重量 0 **不等於**沒佔槽：純封鎖型固定武裝（嵐質儲能艙／多功能彈倉）的 weight 就是 0，
 *   但那一格是實實在在被佔住的。槽位佔用是另一件事，見 PLAN-052-A Phase B 的 occupiedSlots()。
 */
export function weightBreakdown(set: LoadoutWeightSet, chassis: Weighted): WeightBreakdown {
  const mainHand = sum(set.mainHand)
  const backupHand = sum(set.backupHand)
  const shoulder = sum(set.shoulder)
  const back = set.back?.weight ?? 0
  const hands = Math.max(mainHand, backupHand)          // ⚠ 取較重者，不是相加
  const chassisWeight = chassis?.weight ?? 0
  return {
    chassis: chassisWeight,
    mainHand,
    backupHand,
    hands,
    heavierBank: backupHand > mainHand ? 'backup' : 'main',
    shoulder,
    back,
    total: chassisWeight + hands + shoulder + back,
  }
}

/** 配裝總重（＝ weightBreakdown().total）。與 effectiveOutput() 比大小即為可行性判定。 */
export function totalWeight(set: LoadoutWeightSet, chassis: Weighted): number {
  return weightBreakdown(set, chassis).total
}
