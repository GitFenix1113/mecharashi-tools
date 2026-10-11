import type { Mech, Pilot } from '../../types'

/**
 * 遊戲 ID 資料夾 → 實體名稱，給 IconPicker 的資料夾下拉加註（`game/pilots/10103174・海莉絲`）。
 * PLAN-054 之後圖片資料夾一律是數字 ID，不加註根本看不出誰是誰。
 */
export function artFolderNames(pilots: readonly Pilot[], mechs: readonly Mech[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of pilots) {
    if (!p.gameId) continue
    out[`game/pilots/${p.gameId}`] = p.name
    out[`pilots/${p.gameId}`] = p.name // 站上原稿 art.webp（PLAN-054 D-2 起也是 gameId 資料夾）
  }
  for (const m of mechs) if (m.gameId) out[`game/mechs/${m.gameId}`] = m.name
  return out
}
