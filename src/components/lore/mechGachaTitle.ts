// 機甲卡池名稱的建議（PLAN-042-B）：卷宗「卡池」卡的標題存在 mechLore.gachaTitle，由站長在後台填；
// 這裡從版本活動裡找「這台的機甲卡池」給後台當一鍵建議——公告管線（PLAN-048）解析到新卡池後，
// 站長不必自己翻公告。純函式（不碰 React／Firestore），node --test 直接載入。

import type { PatchVersion } from '../../data/patchVersions/types.ts'

export interface GachaTitleSuggestion {
  title: string
  /** 開池日 YYYY/MM/DD（同名多次開池取最早那次） */
  date: string
  /** 哪一服的活動：台版公告的名稱才是站上要的譯名 */
  server: 'tw' | 'cn'
  version: string
}

/**
 * 這台機甲的卡池名稱候選：台服在前、同服依開池日新到舊；同名（含只差結尾驚嘆號）只留一筆。
 * 比對用機甲的中文名（活動的 `mechs` 存的就是名字），前後空白不算。
 */
export function gachaTitleSuggestions(mechName: string | undefined, versions: readonly PatchVersion[]): GachaTitleSuggestion[] {
  const name = mechName?.trim()
  if (!name) return []
  const found = new Map<string, GachaTitleSuggestion>()
  for (const v of versions) {
    for (const half of [v.upper, v.lower]) {
      if (!half) continue
      for (const [server, list] of [['tw', half.twActivities], ['cn', half.cnActivities]] as const) {
        for (const act of list ?? []) {
          const title = act.name?.trim()
          if (act.type !== 'specificMechBanner' || !title || !act.mechs?.some((m) => m.trim() === name)) continue
          const key = `${server}|${title.replace(/[！!]+$/, '')}`
          const prev = found.get(key)
          if (!prev || act.startDate < prev.date) found.set(key, { title, date: act.startDate, server, version: v.version })
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => (a.server === b.server ? b.date.localeCompare(a.date) : a.server === 'tw' ? -1 : 1))
}
