// 神經驅動分區的等級與算力門檻規則 —— 2026-08-28
//
// ── 一句話 ──────────────────────────────────────────────────────────────────
// **算力門檻不是逐格資料，是「等級」的函式；等級數則是「分區」的函式。**
//
//     minSum(Lv) = 1 + (Lv - 1) × 3      →  1 / 4 / 7 / 10 / 13 / 16
//     α、β  上限 Lv3                      →  1 / 4 / 7
//     γ 系（γ / γ1 / γ2）上限 Lv6          →  1 / 4 / 7 / 10 / 13 / 16
//
// ── 依據（2026-08-28 全庫普查）──────────────────────────────────────────────
// 89 位機師、346 個分區，分區組成只有兩種：
//
//     α + β + γ1 + γ2   79 位   （S 61 / A 15 / B 3）
//     α + β + γ         10 位   （全部 B 級：阿德里安、蒙福梅、葛裡高利、喬恩、皮普…）
//
// 第二種是「**B 級機師只有一個伽瑪區**」的情形，官方 API 給的分區名就是 `γ`（實質即 γ1）。
// 站上照原樣存 —— TalentNdVariant.zone 等處以分區名鬆耦合引用，改寫成 γ1 會打斷那些引用。
//
// ⚠ **不要拿 rarity 當分區結構的判準**。那 3 位 B 級卻有完整 γ1+γ2 的機師
//   （凱登 / 黛娜 / 格蘭特）是**隨劇情提升品質**的特例，最終品質是 S ——
//   分區結構跟的是**最終品質**，而 `rarity` 欄位存的是現階段品質，兩者在這三位身上不一致。
//   （凱登的 S 型態已另建一筆 `pilot_083_淬鋒凱登`，fullName 同為「凱登·紐曼」。）
//   所以本檔的規則一律以**分區名**為鍵。這三位正是「看 rarity 會判錯」的具體證據。
//
// 各分區的等級數與 minSum 序列：
//
//     分區   等級數   minSum 序列              分區數
//     ────────────────────────────────────────────────
//     α       3       1 / 4 / 7                 89
//     β       3       1 / 4 / 7                 89
//     γ       6       1 / 4 / 7 / 10 / 13 / 16  10
//     γ1      6       1 / 4 / 7 / 10 / 13 / 16  79
//     γ2      6       1 / 4 / 7 / 10 / 13 / 16  79
//
// 普查當下的偏離只有 3 筆，且**全部來自 `manual: true` 手動建檔的機師**：
//     尼爾       α  Lv3 minSum=0    （沒填完）
//     淬鋒·凱登  β  Lv3 minSum=6    （手打錯字）
//     安         γ1 Lv5 minSum=12   （手打錯字）
// 三筆皆已於 2026-08-28 依規則更正（scripts/temp_scripts/fix-nd-minsum-typos.mjs，
// 已 bump pilots 版本），全庫 346 個分區現為零偏離。
// 82 位官方機師（scrape-pilots-v3 來源）本來就零例外 —— 也就是說：**這條規則唯一的
// 偏離來源就是「人在後台一格一格打」**，而那正是本檔要消滅的東西。
//
// ── 為什麼是「帶入 + 守門」而不是「取代資料」───────────────────────────────
// 比照 mechInterface.ts：規則是**觀察**，不是官方保證。minSum 仍存在 Firestore、
// 仍可在後台改 —— 官方哪天出一個破格分區時，改得動、看得見。本檔只負責
// ①新建時帶入正確值 ②既有值偏離時說出來。**資料仍是真相源。**
//
// 官方機師的 minSum 另有 `scripts/check-nd-minsum-drift.mjs` 逐級對帳官方 API；
// 那支對 `manual: true` 的機師是**盲區**（官方清單查無 → 整位略過），本規則正好補上。
//
// ── 刻意不做的事 ────────────────────────────────────────────────────────────
// 插槽（slots）：89/89 機師的每一個分區都恰好 3 格，數量有規則 —— 但**晶片顏色沒有**
// （攻擊／迴避／暴擊逐機師不同，無從推導）。自動帶 3 格就得順便編一組顏色，
// 那是拿「看起來填好了」換掉「還沒填」，比留空更糟。故不做。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

/** Lv1 的算力門檻 */
export const ND_MIN_SUM_BASE = 1
/** 每升一級的算力門檻增量 */
export const ND_MIN_SUM_STEP = 3

/** 分區名 → 等級數上限。前綴比對，故 γ / γ1 / γ2 / 未來的 γ3 一併涵蓋。 */
const ZONE_MAX_LEVEL: ReadonlyArray<readonly [string, number]> = [
  ['α', 3],
  ['β', 3],
  ['γ', 6],
]

/**
 * 第 `level` 級的算力門檻。`level` 從 1 起算。
 *
 * 非正整數回 `null` ——「這不是一個等級」與「這一級的門檻是 0」是兩件事，
 * 而 minSum 0 在覆寫層是**零門檻恆真**（首屏即生效），不能被當成合理的預設值吐出去。
 */
export function ndMinSumForLevel(level: number): number | null {
  if (!Number.isInteger(level) || level < 1) return null
  return ND_MIN_SUM_BASE + (level - 1) * ND_MIN_SUM_STEP
}

/**
 * 這個分區有幾級。
 *
 * 回 `null` ＝ 這個分區名我們沒有規則 —— 呼叫端應**跳過**而不是當成 0 級，
 * 那是「不知道」與「沒有」的差別（官方新增分區系列時會走到這條路）。
 */
export function ndZoneMaxLevel(zoneName: string): number | null {
  const name = (zoneName ?? '').trim()
  if (!name) return null
  return ZONE_MAX_LEVEL.find(([prefix]) => name.startsWith(prefix))?.[1] ?? null
}

/** 這個分區依規則應有的 (level, minSum) 序列。`null` ＝ 沒有這個分區的規則。 */
export function expectedNdLevels(zoneName: string): { level: number; minSum: number }[] | null {
  const max = ndZoneMaxLevel(zoneName)
  if (max === null) return null
  return Array.from({ length: max }, (_, i) => ({ level: i + 1, minSum: ndMinSumForLevel(i + 1) as number }))
}

/** 這一級的 minSum 是否偏離規則。等級本身不合法（≤0）時一律視為偏離。 */
export function isNdMinSumOffRule(level: number, minSum: number | undefined): boolean {
  const want = ndMinSumForLevel(level)
  return want === null || (minSum ?? 0) !== want
}

/** 一個分區的偏離明細（等級數 + 逐級 minSum）。`null` ＝ 沒有規則，不做判斷。 */
export function ndZoneOffRule(
  zoneName: string,
  levels: { level: number; minSum?: number }[],
): { levelCountOff: boolean; expectedCount: number; offIndexes: number[] } | null {
  const expected = expectedNdLevels(zoneName)
  if (!expected) return null
  const offIndexes: number[] = []
  levels.forEach((lv, i) => {
    // 以**陣列順序**而非 lv.level 判定應有的門檻：後台的等級是一列一列加出來的，
    // 中間刪一列會讓 level 欄位本身就錯位 —— 那時該修的是整段序號，不是只修 minSum。
    const want = expected[i]
    if (!want || lv.level !== want.level || (lv.minSum ?? 0) !== want.minSum) offIndexes.push(i)
  })
  return { levelCountOff: levels.length !== expected.length, expectedCount: expected.length, offIndexes }
}
