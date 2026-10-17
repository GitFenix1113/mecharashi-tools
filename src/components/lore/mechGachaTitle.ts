// 卡池名稱的建議（機甲 PLAN-042-B；機師 PLAN-042-A Phase J 起兩館共用）：卷宗「卡池」卡的標題存在
// mechLore／pilotLore 的 gachaTitle，由站長在後台填；這裡從版本活動裡找「這台／這位的專屬卡池」給後台當一鍵建議——
// 公告管線（PLAN-048）解析到新卡池後，站長不必自己翻公告。純函式（不碰 React／Firestore），node --test 直接載入。
// 檔名沿用 mechGachaTitle（機甲先做）；機師呼叫時傳 kind = 'pilot'。

import type { PatchVersion } from '../../data/patchVersions/types.ts'

export interface GachaTitleSuggestion {
  title: string
  /** 開池日 YYYY/MM/DD（同名多次開池取最早那次） */
  date: string
  /** 哪一服的活動：台版公告的名稱才是站上要的譯名 */
  server: 'tw' | 'cn'
  version: string
}

/** 機甲卡池看 `specificMechBanner` 的 `mechs`，機師卡池看 `specificPilotBanner` 的 `pilots`（兩者都存中文名） */
const BANNER = {
  mech: { type: 'specificMechBanner', names: (a: { mechs?: string[] }) => a.mechs },
  pilot: { type: 'specificPilotBanner', names: (a: { pilots?: string[] }) => a.pilots },
} as const

/**
 * 這台機甲（或這位機師，kind = 'pilot'）的卡池名稱候選：台服在前、同服依開池日新到舊；同名（含只差結尾驚嘆號）只留一筆。
 * 比對用中文名（活動的 `mechs`／`pilots` 存的就是名字），前後空白不算。
 */
export function gachaTitleSuggestions(
  subjectName: string | undefined,
  versions: readonly PatchVersion[],
  kind: keyof typeof BANNER = 'mech',
): GachaTitleSuggestion[] {
  const name = subjectName?.trim()
  if (!name) return []
  const banner = BANNER[kind]
  const found = new Map<string, GachaTitleSuggestion>()
  for (const v of versions) {
    for (const half of [v.upper, v.lower]) {
      if (!half) continue
      for (const [server, list] of [['tw', half.twActivities], ['cn', half.cnActivities]] as const) {
        for (const act of list ?? []) {
          const title = act.name?.trim()
          if (act.type !== banner.type || !title || !banner.names(act)?.some((m) => m.trim() === name)) continue
          const key = `${server}|${title.replace(/[！!]+$/, '')}`
          const prev = found.get(key)
          if (!prev || act.startDate < prev.date) found.set(key, { title, date: act.startDate, server, version: v.version })
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => (a.server === b.server ? b.date.localeCompare(a.date) : a.server === 'tw' ? -1 : 1))
}
