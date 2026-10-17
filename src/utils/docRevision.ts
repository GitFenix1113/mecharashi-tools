// ── 文件版本號與存檔衝突判定（PLAN-042-H 後續，2026-10-17）──────────────────────
//
// 故事館開放多人協作後，「整份覆寫」的存檔會讓後存者靜默蓋掉先存者。
// 防線是文件內的 `rev`（`LoreDocBase.rev`）：表單整份複製文件，所以表單裡的 rev 就是
// 「我從第幾版改起」；存檔時在交易內和伺服器現值比對，不一致就擋下。
//
// 本檔只放純計算（可單測、無 Firestore 依賴）；交易本身在 lib/api/changeHistory.ts 的 saveWithRevision()。
//
// ── 為什麼基準住在文件裡，而不是「開面板時讀一次伺服器的 updateTime」──────────────
// 面板的內容來自 GameDataContext 的快取，而快取一個 session 只對一次版本號：
// 別人存檔之後，這個分頁照樣拿舊內容開面板。若基準是「開面板當下」讀到的新時間戳，
// 舊內容配新基準 → 比對通過 → 照樣蓋掉別人。基準必須跟著**內容**走，
// 草稿還原（useDraftAutosave）才也擋得住——2026-10-14 克洛伊事件正是舊內容的存檔。

/** 版本號欄位與存檔時間：只由存檔流程寫，不算「使用者改了什麼」 */
export const REVISION_META_KEYS = ['rev', 'updatedAt'] as const

/** 文件的版本號；沒有欄位（功能上線前建的文件）或不存在的文件都是第 0 版 */
export function revOf(d: object | null | undefined): number {
  const r = (d as { rev?: unknown } | null | undefined)?.rev
  return typeof r === 'number' && Number.isInteger(r) && r >= 0 ? r : 0
}

export type RevisionCheck =
  | { ok: true; nextRev: number }
  | { ok: false; baseRev: number; currentRev: number }

/**
 * 表單的基準版本 vs 伺服器現值。
 *
 * 相等才放行，新版本號＝現值 + 1。**不相等一律擋**，包括「現值比基準小」：
 * 那代表文件被刪掉重建、或被腳本改回舊值——不論哪種，表單都不是從現況改起的。
 */
export function checkRevision(baseRev: number, current: object | null): RevisionCheck {
  const currentRev = revOf(current)
  return currentRev === baseRev
    ? { ok: true, nextRev: currentRev + 1 }
    : { ok: false, baseRev, currentRev }
}

/** 拿掉版本號欄位（算 changedFields 用：每次存檔 rev 都會變，列進去只是雜訊） */
export function withoutRevisionMeta<T extends Record<string, unknown>>(d: T): Omit<T, 'rev' | 'updatedAt'> {
  const rest: Record<string, unknown> = { ...d }
  for (const k of REVISION_META_KEYS) delete rest[k]
  return rest as Omit<T, 'rev' | 'updatedAt'>
}

/** 衝突提示用：「第 N 版」的人話。第 0 版是功能上線前的文件，沒有編號可言 */
export function revisionLabel(rev: number): string {
  return rev > 0 ? `第 ${rev} 版` : '未編號的舊版'
}
