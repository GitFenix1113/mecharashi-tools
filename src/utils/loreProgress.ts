// PLAN-042-E D-3：故事館編輯台的進度總覽。
//
// **全部從資料推導，不存任何狀態欄位**（決策五）：「有沒有簡介、檔案幾欄、章節數、草稿數、外觀命名數、徽章」
// 都是看資料本身就知道的事。PLAN-041「0/5 定律」的教訓——選填的狀態欄位最後沒人會填，
// 填了也會跟資料本身漂移。
//
// 本檔**只放純函式**（不 import React、不讀 import.meta.env）：`node --test` 直接載入。

import { dossierFieldCount } from './loreDossier.ts'
import { normalizeFactionLogos } from './factionLogos.ts'
import type { LoreDoc } from '../types'

/** 一位機師的故事資料完成度 */
export interface LoreProgress {
  hasIntro: boolean
  /** 人物檔案有內容的欄位數（性別／身高／血型＋自訂欄位，不含陣營） */
  dossierFields: number
  /** 章節數（含草稿） */
  chapters: number
  drafts: number
  /** 外觀總數（build 時的清單，含 DB 隱藏的） */
  skinsTotal: number
  /** 已處理的外觀：有名稱，或刻意隱藏（隱藏的不需要命名） */
  skinsDone: number
  hasLogo: boolean
}

/** 篩選鈕：列出「還缺什麼」的機師 */
export type LoreGap = 'noIntro' | 'noDossier' | 'hasDraft' | 'skinUnnamed' | 'noLogo'

export const LORE_GAP_LABEL: Record<LoreGap, string> = {
  noIntro: '缺簡介',
  noDossier: '缺檔案',
  hasDraft: '有草稿章',
  skinUnnamed: '外觀未命名',
  noLogo: '缺陣營徽章',
}

/**
 * @param doc       這位的 pilotLore 文件（還沒建 → undefined）
 * @param skinKeys  這位在 build 清單裡的所有外觀鍵（pilotSkinCatalog），不是 DB 的
 */
export function loreProgressOf(doc: LoreDoc | undefined, skinKeys: readonly string[]): LoreProgress {
  const chapters = doc?.chapters ?? []
  const settings = new Map((doc?.skins ?? []).map((s) => [s.key, s]))
  const skinsDone = skinKeys.filter((k) => {
    const s = settings.get(k)
    return !!s && (s.hidden === true || !!s.name?.trim())
  }).length
  return {
    hasIntro: !!doc?.intro?.trim(),
    dossierFields: dossierFieldCount(doc?.dossier),
    chapters: chapters.length,
    drafts: chapters.filter((c) => c.draft).length,
    skinsTotal: skinKeys.length,
    skinsDone,
    hasLogo: normalizeFactionLogos(doc?.factionLogos).length > 0,
  }
}

export function hasLoreGap(p: LoreProgress, gap: LoreGap): boolean {
  switch (gap) {
    case 'noIntro': return !p.hasIntro
    case 'noDossier': return p.dossierFields === 0
    case 'hasDraft': return p.drafts > 0
    case 'skinUnnamed': return p.skinsDone < p.skinsTotal
    case 'noLogo': return !p.hasLogo
  }
}

/** 全站完成度（頁首統計）。分母各自不同：外觀以「套」計，其餘以「位」計。 */
export interface LoreProgressSummary {
  pilots: number
  intro: number
  dossier: number
  /** 有至少一章（非草稿）的機師數 */
  withChapters: number
  chapters: number
  drafts: number
  skinsDone: number
  skinsTotal: number
  logos: number
}

export function summarizeLoreProgress(list: readonly LoreProgress[]): LoreProgressSummary {
  const sum: LoreProgressSummary = {
    pilots: list.length, intro: 0, dossier: 0, withChapters: 0, chapters: 0, drafts: 0, skinsDone: 0, skinsTotal: 0, logos: 0,
  }
  for (const p of list) {
    if (p.hasIntro) sum.intro++
    if (p.dossierFields > 0) sum.dossier++
    if (p.chapters - p.drafts > 0) sum.withChapters++
    sum.chapters += p.chapters
    sum.drafts += p.drafts
    sum.skinsDone += p.skinsDone
    sum.skinsTotal += p.skinsTotal
    if (p.hasLogo) sum.logos++
  }
  return sum
}
