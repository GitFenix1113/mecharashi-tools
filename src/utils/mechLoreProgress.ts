// PLAN-042-B G-1：故事館編輯台「機甲」分頁的進度總覽。規則同 loreProgress.ts（機師版）：
// **全部從資料推導，不存任何狀態欄位**（042-E 決策五；0/5 定律）。本檔只放純函式，`node --test` 直接載入。
//
// 機甲與機師缺的東西不同：沒有人物檔案與陣營徽章，改看型號、廠商、系譜。
// 型號與廠商是卷宗標題區的兩格，缺了前台會顯示「廠商未載」或少一個鋼印，所以單獨列一個篩選。

import type { MechLoreDoc } from '../types'

export interface MechLoreProgress {
  hasIntro: boolean
  hasModel: boolean
  hasMaker: boolean
  /** 這台自己連出去的系譜條數（不含反查） */
  relations: number
  /** 技術檔案（非數值諸元）有內容的列數 */
  specs: number
  chapters: number
  drafts: number
  /** 塗裝總數（build 時的清單，含 DB 隱藏的） */
  skinsTotal: number
  /** 已處理的塗裝：有名稱，或刻意隱藏 */
  skinsDone: number
}

export type MechLoreGap = 'noIntro' | 'noModel' | 'noMaker' | 'hasDraft' | 'skinUnnamed'

export const MECH_LORE_GAP_LABEL: Record<MechLoreGap, string> = {
  noIntro: '缺介紹',
  noModel: '缺型號',
  noMaker: '缺廠商',
  hasDraft: '有草稿章',
  skinUnnamed: '塗裝未命名',
}

/**
 * @param doc       這台的 mechLore 文件（還沒建 → undefined）
 * @param skinKeys  這台在 build 清單裡的所有塗裝代碼（mechSkinCatalog），不是 DB 的
 * @param makerIds  mechMakers 現有的文件 ID：maker 填了但對不到任何一家，前台一樣顯示「廠商未載」，算缺
 */
export function mechLoreProgressOf(doc: MechLoreDoc | undefined, skinKeys: readonly string[], makerIds: ReadonlySet<string>): MechLoreProgress {
  const chapters = doc?.chapters ?? []
  const settings = new Map((doc?.skins ?? []).map((s) => [s.key, s]))
  return {
    hasIntro: !!doc?.intro?.trim(),
    hasModel: !!doc?.modelNo?.trim(),
    hasMaker: !!doc?.maker && makerIds.has(doc.maker),
    relations: doc?.relations?.length ?? 0,
    specs: (doc?.specs ?? []).filter((f) => f.label.trim() && f.value.trim()).length,
    chapters: chapters.length,
    drafts: chapters.filter((c) => c.draft).length,
    skinsTotal: skinKeys.length,
    skinsDone: skinKeys.filter((k) => {
      const s = settings.get(k)
      return !!s && (s.hidden === true || !!s.name?.trim())
    }).length,
  }
}

export function hasMechLoreGap(p: MechLoreProgress, gap: MechLoreGap): boolean {
  switch (gap) {
    case 'noIntro': return !p.hasIntro
    case 'noModel': return !p.hasModel
    case 'noMaker': return !p.hasMaker
    case 'hasDraft': return p.drafts > 0
    case 'skinUnnamed': return p.skinsDone < p.skinsTotal
  }
}

export interface MechLoreProgressSummary {
  mechs: number
  intro: number
  model: number
  maker: number
  /** 至少有一條系譜（自己連出去的）的台數 */
  withRelations: number
  /** 有至少一章（非草稿）的台數 */
  withChapters: number
  chapters: number
  drafts: number
  skinsDone: number
  skinsTotal: number
}

export function summarizeMechLoreProgress(list: readonly MechLoreProgress[]): MechLoreProgressSummary {
  const sum: MechLoreProgressSummary = {
    mechs: list.length, intro: 0, model: 0, maker: 0, withRelations: 0, withChapters: 0, chapters: 0, drafts: 0, skinsDone: 0, skinsTotal: 0,
  }
  for (const p of list) {
    if (p.hasIntro) sum.intro++
    if (p.hasModel) sum.model++
    if (p.hasMaker) sum.maker++
    if (p.relations > 0) sum.withRelations++
    if (p.chapters - p.drafts > 0) sum.withChapters++
    sum.chapters += p.chapters
    sum.drafts += p.drafts
    sum.skinsDone += p.skinsDone
    sum.skinsTotal += p.skinsTotal
  }
  return sum
}
