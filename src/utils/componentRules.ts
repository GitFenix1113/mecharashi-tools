// 元件的族與互斥判準 —— PLAN-052-D Phase A / A-1
//
// ── 為什麼互斥鍵由名稱推導，而不是 Firestore 的一個欄位 ─────────────────────
// 判準**就是名稱**：「觸元件W-憑逸」與「觸元件-憑逸」是同一顆元件的兩個變體，
// 而它們之所以是同一族，除了名字之外沒有第二個依據。落一個 `familyKey` 欄位
// 只是把同一件事寫第二遍 —— 官方哪天改了元件名，資料上的 familyKey 不會跟著動，
// 兩份於是靜默不同步，而症狀是「兩顆同族的元件突然可以一起裝了」。
//
// 代價是本檔必須跟著官方的命名規則走，所以配一組 CI 守門測試（A-2）：
// 208 筆全部推得出族、族數恰為 56、觸元件的族與 `condition` 文字雙射。
// 任何一條掛掉都代表官方改了命名規則 —— 那時該修的是這支函式，不是資料。
//
// ── ⚠ 絕對不可用 `conditionType` 當互斥鍵 ────────────────────────────────
// 實測 106 個觸元件裡 `always` 佔 103 筆。拿它當互斥鍵，玩家永遠只能裝一顆觸元件。
//
// 純函式、無 React／Firestore 依賴，可單測（npm test）。

import type { Component } from '../types/component.ts'

/** 名稱前綴。與 `Component.componentType` 是同一件事的兩種寫法，實測 208/208 相符。 */
const KIND_PREFIX = { 觸元件: 'Condition', 應元件: 'Function' } as const

export type ComponentKind = typeof KIND_PREFIX[keyof typeof KIND_PREFIX]

/**
 * 元件名稱的三段結構：`觸元件W-憑逸` ＝ 前綴（觸／應）＋ 選配的 W ＋ 連字號 ＋ 後綴。
 *
 * 實測 208/208 筆全部吻合，0 例外。
 */
const NAME_RE = /^(觸元件|應元件)(W?)-(.+)$/

export interface ComponentName {
  kind: ComponentKind
  /** W 變體：同效果但觸發機率等級更高，且**只能裝在雙手／背部武器**上 */
  wType: boolean
  /** 族名，如 `憑逸` */
  suffix: string
}

/**
 * 拆解元件名稱。不合命名規則時回 `null`（不拋例外）——
 * 官方新增一顆命名破格的元件時，該壞掉的是守門測試，不是玩家正在看的頁面。
 */
export function parseComponentName(name: string): ComponentName | null {
  const m = NAME_RE.exec(name.trim())
  if (!m) return null
  return { kind: KIND_PREFIX[m[1] as keyof typeof KIND_PREFIX], wType: m[2] === 'W', suffix: m[3] }
}

/**
 * 互斥鍵。**全站判斷「兩顆元件是不是同一族」的唯一入口。**
 *
 * ⚠ **鍵帶觸／應前綴**（`Condition:憑逸`）而不是只有後綴。實測觸與應**沒有**共用
 *   任何一個後綴（0 筆），所以今天不帶也不會錯 —— 但官方哪天出一顆與既有觸元件同名的
 *   應元件時，不帶前綴的版本會把兩族靜默併成一族，而那時玩家會發現自己少了一個槽
 *   可以用，卻找不到原因。多帶一段字串的成本，遠低於那個 bug 的除錯成本。
 *
 * ⚠ **跨 W／Normal 變體**：`觸元件W-憑逸` 與 `觸元件-憑逸` 回同一個鍵（總綱決策五逐字：
 *   「憑逸W 和 憑逸 不能兩顆都裝」）。也**跨 S／A／B 三個品質階** —— 那三筆是同名的
 *   三個 doc，效果只差 BUFF 階級（Ⅴ／Ⅳ／Ⅲ），本來就是同一顆元件的三個版本。
 *
 * 推不出來時回 `null`：呼叫端一律把 `null` 視為「不與任何東西互斥」，
 * 而不是「與所有 null 互斥」—— 命名破格是資料問題，不該讓玩家裝不上東西。
 */
export function componentFamilyKey(comp: Pick<Component, 'name'>): string | null {
  const parsed = parseComponentName(comp.name)
  return parsed ? `${parsed.kind}:${parsed.suffix}` : null
}

/**
 * 兩顆元件是否同族。`null` 族（命名破格）**永不互斥**，見 `componentFamilyKey()`。
 *
 * 同一顆元件（同 doc id）不算「同族衝突」——那是「已經裝了」，由呼叫端另行處理，
 * 兩者的文案完全不同（「已裝上」vs「同族已裝觸元件W-憑逸」）。
 */
export function isSameFamily(a: Pick<Component, 'name'>, b: Pick<Component, 'name'>): boolean {
  const ka = componentFamilyKey(a)
  return ka !== null && ka === componentFamilyKey(b)
}

/**
 * W 型元件只能裝在**雙手／背部**武器上（總綱決策五③）。
 *
 * 實測 W 型 80 筆，而符合條件的武器有 49 把（雙手 40 ＋ 背部 22 之中
 * `componentLimit > 0` 者）。判準用 `equipSlot` 而不是品質或重量 ——
 * 官方的規則是「大型武器才裝得下 W 型元件」，而槽位就是它的代理。
 */
export const isWTypeComponent = (comp: Pick<Component, 'componentsWType'>): boolean =>
  comp.componentsWType === 'W'
