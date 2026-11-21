// 版本分段：上半／（中半）／下半
//
// 鋼嵐原則上 3 週一位角色、一個版本兩段（上半＋下半，共 6 週）；週年版本（v4.0）是 9 週、
// 三位角色，所以多一段「中半」。這裡是**唯一**知道「一個版本有哪幾段、順序為何」的地方 ——
// 程式其他地方不要再寫死 `[v.upper, v.lower]`，一律走 `halvesOf`，否則中半會被靜默略過
// （名單、活動、卡池、武裝討伐獎勵全都少一段，而且不會報錯）。
//
// 為什麼是選填的 `middle` 而不是 `halves: PatchHalf[]`：
//   · 既有 Firestore 文件、靜態 fallback 檔、公告審核的 `targetHalf` 全都用 'upper'／'lower'
//     當鍵，選填欄位讓它們一個字都不用改；陣列得遷移全部資料，還會讓「第幾段」在中間插段時錯位。
//   · 「沒有 middle ＝ 兩段」就是現行模式，三段是逐版本開啟的例外。

/** 分段鍵，依時間先後排列。`middle` 只在三段版本才有。 */
export const HALF_KEYS = ['upper', 'middle', 'lower'] as const
export type HalfKey = typeof HALF_KEYS[number]

/** 完整顯示名（「上半」…）。要改稱呼（如「中段」）改這裡即可。 */
export const HALF_LABEL: Record<HalfKey, string> = { upper: '上半', middle: '中半', lower: '下半' }

/** 單字簡稱，接在「v4.0 」後面再補「半」用（「v4.0 中半」）。 */
export const HALF_SHORT: Record<HalfKey, string> = { upper: '上', middle: '中', lower: '下' }

export function isHalfKey(x: unknown): x is HalfKey {
  return typeof x === 'string' && (HALF_KEYS as readonly string[]).includes(x)
}

/** 顯示名；不認得的鍵（舊資料、手打錯字）退回「上半」—— 與既有 `targetHalf ?? 'upper'` 的預設一致。 */
export function halfLabel(key: string | undefined | null): string {
  return HALF_LABEL[isHalfKey(key) ? key : 'upper']
}

/** 任何帶有分段的物件（PatchVersion、腳本或測試裡的精簡型別都適用）。 */
export interface HalvesLike<H> {
  upper?: H
  middle?: H
  lower?: H
}

export interface HalfEntry<H> {
  key: HalfKey
  label: string
  half: H
}

/** 這個版本有中半嗎？（＝是不是三段版本） */
export function hasMiddle(v: HalvesLike<unknown>): boolean {
  return v.middle != null
}

/**
 * 依時間順序列出這個版本**實際存在**的分段：兩段版本回 [上半, 下半]，三段版本回 [上半, 中半, 下半]。
 * 缺席的段（理論上只有 middle）不會出現，所以呼叫端拿到的永遠是可以直接用的半版本。
 */
export function halvesOf<H>(v: HalvesLike<H>): HalfEntry<H>[] {
  const out: HalfEntry<H>[] = []
  for (const key of HALF_KEYS) {
    const half = v[key]
    if (half != null) out.push({ key, label: HALF_LABEL[key], half })
  }
  return out
}

/** 只要半版本本身（迴圈只在乎內容、不在乎是哪一段時用）。 */
export function halfListOf<H>(v: HalvesLike<H>): H[] {
  return halvesOf(v).map(h => h.half)
}

/** 同一版本裡緊接在 `key` 之後的那一段；已經是最後一段（或 key 不存在）回 undefined。 */
export function nextHalfOf<H>(v: HalvesLike<H>, key: HalfKey): HalfEntry<H> | undefined {
  const list = halvesOf(v)
  const i = list.findIndex(h => h.key === key)
  return i >= 0 ? list[i + 1] : undefined
}
