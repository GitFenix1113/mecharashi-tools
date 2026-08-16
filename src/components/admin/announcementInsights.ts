import type { PatchVersion, TimedActivity } from '../../data/patchVersions/types.ts'

// PLAN-048 Phase 2：「規則待擴充」彙總
//
// 解析器不可能一次寫對所有句型 —— 官方寫法逐年漂移是實測過的事實
// （「本期機師征招『X』」2024/2025 出現 0 次、2026 才 1 次）。
// 與其每次都逐篇翻公告找漏，不如把「沒看懂的東西」依**出現次數**排好：
// 碰到第 8 次的句型值得加規則，只碰過 1 次的多半是特例，手動處理更划算。

/** 待補資料的一筆：藏起來但還沒補齊的活動 */
export interface PendingFix {
  versionId: string
  version: string
  half: 'upper' | 'lower'
  act: TimedActivity
  /** 缺哪些欄位（給後台一眼看出還差什麼） */
  missing: string[]
}

const FIELD_LABEL: Record<string, string> = {
  weeks: '週數',
  type: '型別',
  name: '名稱',
  startDate: '起始日',
}

export function missingFields(act: TimedActivity): string[] {
  const out: string[] = []
  for (const k of ['name', 'startDate', 'weeks', 'type'] as const) {
    const v = act[k]
    if (v === undefined || v === null || v === '') out.push(FIELD_LABEL[k] ?? k)
  }
  return out
}

/**
 * 掃出所有「藏起來等補資料」的活動。
 *
 * 資料來源就是前台那份 patchVersions（後台頁面本來就載了），零額外讀取 ——
 * 半成品既然存在正式集合裡，就不需要再去 staging 撈一次。
 */
export function collectPendingFixes(versions: (PatchVersion & { id?: string })[]): PendingFix[] {
  const out: PendingFix[] = []
  for (const v of versions) {
    for (const half of ['upper', 'lower'] as const) {
      for (const act of v[half]?.twActivities ?? []) {
        if (act.hidden !== true && act.weeks !== undefined) continue
        out.push({
          versionId: v.id ?? `v${v.version}`,
          version: v.version,
          half,
          act,
          missing: missingFields(act),
        })
      }
    }
  }
  // 新的檔期排前面：舊的多半已經沒人在意了
  return out.sort((a, b) => (b.act.startDate ?? '').localeCompare(a.act.startDate ?? ''))
}

/**
 * 把一行未認領原文正規化成「句型」，讓同一種寫法的不同實例併成一組。
 *
 * 抹掉的是**每則公告必然不同**的部分：日期、數量、括號內的專有名詞，
 * 以及卡池標題那組我們已經知道怎麼拆的文法（`主題名 – S級職業`，見
 * parseAnnouncement.parseHeadingLine）。留下的是句子的骨架。
 *
 * ⚠ 中途換過一次做法：原本試著抽「四字片語」來比對，實測結果是同一句樣板會被
 * 拆成十幾個重疊的窗格（則下一次／下一次獲／一次獲得…），整張榜單被一句話洗版。
 * 而實測語料顯示未認領原文**本來就大量逐字重複**（「【跨域海運】補充說明」52 次、
 * 「【角雕特遣】」29 次），整行比對反而精準。變化太大的句子自然落到 1 次以下，
 * 被 minCount 濾掉 —— 那正確：只出現一次的東西本來就不值得為它加規則。
 */
export function normalizeUnmatched(line: string): string {
  return line
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, '⟨日期⟩')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, '⟨時刻⟩')
    .replace(/【[^】]*】/g, '【⟨名稱⟩】')
    .replace(/[「『][^」』]*[」』]/g, '「⟨名稱⟩」')
    // 卡池標題文法：`星途無終 – S級調構師` / `破陣強襲 – S級輕型機甲`
    .replace(/[^\s，。、；]{2,10}\s*[–—-]\s*[SAB]級[^\s，。、；「『【]{0,8}/g, '⟨卡池標題⟩')
    .replace(/\d+/g, '⟨數⟩')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface UnmatchedGroup {
  /** 正規化後的句型 */
  pattern: string
  /** 出現行數 */
  count: number
  /** 原始樣本（最多 3 筆，供人判斷這句型到底在講什麼） */
  samples: string[]
  /** 出自哪幾則公告 */
  draftIds: string[]
}

/**
 * 依句型彙總未認領原文，出現次數多的排前面。
 *
 * 這就是「等管理員再根據備註擴充」的入口：排最上面的那幾條，
 * 就是下一版解析器最該處理的東西。只出現一次的多半是特例，手動處理更划算。
 */
export function aggregateUnmatched(
  drafts: { id: string; unmatched?: string[] }[],
  { minCount = 2 }: { minCount?: number } = {},
): UnmatchedGroup[] {
  const groups = new Map<string, UnmatchedGroup>()
  for (const d of drafts) {
    for (const line of d.unmatched ?? []) {
      const pattern = normalizeUnmatched(line)
      if (!pattern) continue
      let g = groups.get(pattern)
      if (!g) {
        g = { pattern, count: 0, samples: [], draftIds: [] }
        groups.set(pattern, g)
      }
      g.count++
      if (g.samples.length < 3 && !g.samples.includes(line)) g.samples.push(line)
      if (!g.draftIds.includes(d.id)) g.draftIds.push(d.id)
    }
  }
  return [...groups.values()]
    .filter(g => g.count >= minCount)
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
}

export interface TypeGap {
  label: string
  count: number
}

/**
 * 尚未登錄進 activityTypeRegistry 的型別，依出現次數排序。
 *
 * 計畫書的升級觸發點寫得很明確：**未登錄型別穩定超過 20 種**時，
 * 才值得把 activityTypes 開成獨立集合；在那之前補一列 REGISTRY 就夠了。
 * 這張表就是拿來判斷有沒有到那個門檻的。
 */
export function aggregateUnknownTypes(
  items: { extracted?: { type?: string; typeLabel?: string }; rawTypeLabel?: string }[],
  isKnown: (type: string) => boolean,
): TypeGap[] {
  const counts = new Map<string, number>()
  for (const it of items) {
    const type = it.extracted?.type
    if (type && isKnown(type)) continue
    const label = it.extracted?.typeLabel || type || it.rawTypeLabel
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
