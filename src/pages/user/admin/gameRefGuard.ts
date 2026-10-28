// ── 存檔時保住 gameRef（PLAN-065-A B-5）──────────────────────────────────────────
// 後台八個實體的存檔都是 setDoc 整份覆寫（writeDoc／saveWithHistory），表單則是從載入的整份
// 文件 `{ ...doc }` 展開來的——正常情況下 gameRef 會原樣帶回去，沒有任何白名單會把它挑掉。
//
// 會出事的是「表單那份比伺服器舊」：
//   · 回填腳本 --write 之前就開著的分頁（GameDataContext 一個 session 只讀一次版本，不會自己刷新）
//   · 還原回填之前留下的草稿（DraftRestoreBar 還原的是整份舊表單）
// 這兩種情況照存，回填結果會被整份洗掉，而且畫面上沒有任何錯誤（同 2026-10-14 舊分頁覆寫事件）。
//
// gameRef 在後台本來就唯讀、唯一寫入者是回填腳本，所以存檔前一律換成**伺服器現值**：
// 多 1 次讀取，換「後台存檔永遠不會動到 gameRef」。讀不到（斷線）就讓整筆存檔失敗——
// 寧可存不進去，也不要用一份不確定的 gameRef 蓋回去。
//
// **必須用 getDocFromServer 而非 getDoc（fetchDocument）。** 正式環境開了 persistentLocalCache，
// 預設來源的 getDoc 在伺服器不可達時會靜默改讀 IndexedDB 快取並正常 resolve——拿到的可能正是
// 回填前那份沒有 gameRef 的舊文件，等於照樣蓋掉（理由同 lib/api/cascadeDelete.ts 的 loadScanData）。
// FromServer 版連不上就直接拒絕，失敗發生在寫入之前。

import { doc, getDocFromServer } from 'firebase/firestore'
import { db } from '../../../lib/firebase'

/** 有 gameRef 欄位的八個集合（types/gameRef.ts）。 */
export type GameRefCollection =
  | 'pilots' | 'mechs' | 'weapons' | 'modules' | 'components' | 'backpacks' | 'pilotSkills' | 'forms'

/**
 * 回傳一份 gameRef 換成伺服器現值的副本（不改傳入的物件）。
 * 伺服器上還沒有這份（新建）→ 原樣回傳；伺服器沒有 gameRef → 設成 undefined，writeDoc 會把它拿掉。
 * 呼叫端存檔與 patchCollectionItem 都要用**回傳值**，快取才會跟伺服器一致。
 */
export async function withServerGameRef<T extends { id: string; gameRef?: unknown }>(
  collectionName: GameRefCollection,
  item: T,
): Promise<T> {
  const snap = await getDocFromServer(doc(db, collectionName, item.id))
  if (!snap.exists()) return item
  return { ...item, gameRef: (snap.data() as { gameRef?: T['gameRef'] }).gameRef }
}
