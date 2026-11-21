// ── BUFF 的官方 ID（BuffGameRef）：解析、連結狀態、重複偵測 ──────────────────────
// 型別與放置規則見 types/gameRef.ts 的 BuffGameRef。後台 BUFF 頁的欄位（components/admin/BuffGameRefField.tsx）
// 與列表篩選都用這裡；抽成零依賴的純函式，node --test 才測得到。
//
// 刻意不做「官方 ID 存不存在」的檢查：前台沒有遊戲資料包，也不該有（對照線索只在私有 repo）。
// 打錯一個數字只會讓模擬認不出來，例行對帳（私有 repo）會列出來。

import type { BuffGameRef, GameBuff } from '../types'

/** 900000–900999：官方的「關鍵字記錄」——沒有數值、從不會被掛上，只給說明文字連結用。 */
export const isKeywordBufId = (id: number): boolean => id >= 900000 && id < 901000

/**
 * 輸入框文字 → 官方 ID。分隔字元：逗號、頓號、分號、空白（全形半形都收）。
 * 回傳有效 ID（去重、由小到大）與不是 ID 的片段（呼叫端顯示警告；存檔時略過它們）。
 */
export function parseBufIds(text: string): { ids: number[]; invalid: string[] } {
  const ids = new Set<number>()
  const invalid: string[] = []
  for (const tok of text.split(/[\s,，、;；]+/)) {
    if (!tok) continue
    const n = Number(tok)
    if (/^\d+$/.test(tok) && Number.isSafeInteger(n) && n > 0) ids.add(n)
    else invalid.push(tok)
  }
  return { ids: [...ids].sort((a, b) => a - b), invalid }
}

/** ID 陣列 → BuffGameRef；空陣列＝未連結，回傳 undefined（存檔時整個欄位拿掉，不留空物件）。 */
export const toBuffGameRef = (ids: number[]): BuffGameRef | undefined => (ids.length ? { bufIds: ids } : undefined)

/** BuffGameRef → 輸入框文字 */
export const formatBufIds = (ref: BuffGameRef | undefined): string => (ref?.bufIds ?? []).join(', ')

const hasIds = (ref: BuffGameRef | undefined) => (ref?.bufIds?.length ?? 0) > 0

/**
 * 連結狀態（列表小標與「只看未連結」篩選用）。
 *   無等級：頂層有 ID＝linked，否則 unlinked。
 *   分級：每一級都有 ID＝linked；有些有（或只有頂層的關鍵字記錄）＝partial；全都沒有＝unlinked。
 *   分級 BUFF 的頂層只放關鍵字記錄，所以頂層有沒有不影響 linked。
 */
export type BuffLinkState = 'linked' | 'partial' | 'unlinked'
export function buffLinkState(b: Pick<GameBuff, 'gameRef' | 'levels'>): BuffLinkState {
  const levels = b.levels ?? []
  if (!levels.length) return hasIds(b.gameRef) ? 'linked' : 'unlinked'
  const filled = levels.filter((l) => hasIds(l.gameRef)).length
  if (filled === levels.length) return 'linked'
  return filled > 0 || hasIds(b.gameRef) ? 'partial' : 'unlinked'
}

/** 一個官方 ID 填在哪裡：哪份 BUFF、哪一級（undefined＝頂層） */
export interface BufIdHolder { buffId: string; buffName: string; level?: number }

/** 全部 BUFF → 官方 ID 填在哪裡。同一份 BUFF 的不同級共用一個 ID 是正常的（幹勁、掠食是同一筆帶等級），所以只在跨 BUFF 時才算重複。 */
export function indexBufIds(buffs: readonly GameBuff[]): Map<number, BufIdHolder[]> {
  const out = new Map<number, BufIdHolder[]>()
  const add = (id: number, h: BufIdHolder) => {
    const list = out.get(id)
    if (list) list.push(h)
    else out.set(id, [h])
  }
  for (const b of buffs) {
    for (const id of b.gameRef?.bufIds ?? []) add(id, { buffId: b.id, buffName: b.name })
    for (const l of b.levels ?? []) for (const id of l.gameRef?.bufIds ?? []) add(id, { buffId: b.id, buffName: b.name, level: l.level })
  }
  return out
}

/** 這些 ID 也填在「別的」BUFF 上的（自己這份不算） */
export function otherHolders(ids: readonly number[], index: Map<number, BufIdHolder[]>, selfId: string): { id: number; holders: BufIdHolder[] }[] {
  return ids
    .map((id) => ({ id, holders: (index.get(id) ?? []).filter((h) => h.buffId !== selfId) }))
    .filter((x) => x.holders.length > 0)
}
