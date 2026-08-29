// 一筆存檔的失效三態 —— PLAN-052-C（原在 localBuilds.ts）／052-E C-5 搬出
//
// **本機書架與雲端書架共用同一支判定。** 原本它住在 `localBuilds.ts` 裡，因為那時只有
// 本機書架一個呼叫端；雲端書架上線後留在原地，會讓「雲端要不要自己寫一份」變成一個
// 每次都要重新回答的問題 —— 而兩份判定遲早會在同一串代碼上給出不同答案：
// 同一套配裝，在本機分頁顯示「可套用」、在雲端分頁顯示「已失效」。
//
// 零 React、零 Firebase、零 localStorage：只吃代碼與索引，回一個判定。

import type { LoadoutDraft } from '../types/loadout'
import { decodeLoadout, type ShareIndexes, type UnresolvedRef } from '../utils/loadoutCode/codec.ts'

/**
 * 一筆存檔對**現在這一版遊戲資料**還有多少效力。
 *
 *   `ok`        全部裝備都在，照樣套用。
 *   `degraded`  少數裝備查不到（下架、或這個瀏覽器的資料太舊）。**照樣可以套用**，
 *               那幾格會是空的 —— 「少一把武器」遠好過「整套都不給你看」（決策四）。
 *   `broken`    機師或機甲不在了，或代碼本身損毀。**只能檢視、複製、刪除，不可套用**：
 *               沒有機師的配裝套用後只會得到一個空模擬器，而使用者會以為是自己按錯。
 */
export type BuildState = 'ok' | 'degraded' | 'broken'

export interface BuildStatus {
  state: BuildState
  /**
   * 解得開時的草稿。**`state === 'broken'` 時不可以拿去套用**（結構是合法的，
   * 但少了身分）——只用來在卡片上顯示「這原本是什麼」。
   */
  draft?: LoadoutDraft
  /** 查不到的引用全集（含身分）。卡片上印成「已下架裝備 #181」。 */
  missing: UnresolvedRef[]
  /** 其中屬於身分的那些，也就是 `broken` 的理由。文案由 UI 層寫。 */
  missingIdentity: ('pilot' | 'mech')[]
  /** 只有代碼**結構性損毀**時才有（來自解碼器，已是中文且給得出下一步）。 */
  message?: string
}

/**
 * ⚠ **遊戲資料載入完成前不要叫這一支**。索引還不完整時，每一筆都會被算成
 *   「機甲查不到」⇒ 使用者打開書架看到整架存檔全部標紅，是這個功能最糟的第一印象。
 *   呼叫端一律用既有的載入 gate 擋住（052-G 決策六），**不要在這裡自己再寫一份**：
 *   空 Map 與「查不到」在這一層分不出來，那個資訊只有呼叫端有。
 */
export function classifyBuild(code: string, indexes: ShareIndexes): BuildStatus {
  const res = decodeLoadout(code, indexes)
  if (!res.ok) return { state: 'broken', missing: [], missingIdentity: [], message: res.message }

  const missingIdentity = res.unresolved
    .filter((u) => u.kind === 'pilot' || u.kind === 'mech')
    .map((u) => u.kind as 'pilot' | 'mech')

  const state: BuildState =
    missingIdentity.length > 0 ? 'broken'
    : res.unresolved.length > 0 ? 'degraded'
    : 'ok'

  return { state, draft: res.draft, missing: res.unresolved, missingIdentity }
}
