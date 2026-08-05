// 背包技能解析層（PLAN-043 Phase D）
//
// `Backpack.skillIds[]` 存的是 `bpskill_移動強化@1` 這種「id + 可選等級」的引用字串。
// 前台要顯示的則是「套用該級覆寫之後」的樣子——階名、該級正文、該級數值。
// 這層負責把兩者接起來，讓 BackpacksPage / 模擬器 / 未來的引用層都走同一份解析邏輯。
//
// 純函式、無 React / Firestore 依賴，可單測（npm test）。

import type {
  Backpack, BackpackSkillDoc, DescriptionRefs, SkillEffect,
} from '../types'
import { parseBuffRef } from './buffRef.ts'

/** 解析後的單一掛載技能：已套用指定等級的覆寫，呼叫端直接拿來渲染。 */
export interface ResolvedBackpackSkill {
  /** 原始元素字串（含 @N）。React key 與除錯用；**不可**拿去比對 doc.id */
  raw: string
  /** 裸技能 id（已拆掉 @N） */
  id: string
  /** 指定的等級；未指定 = 用技能頂層欄位 */
  level?: number
  /** 技能本體（未套用等級覆寫的原始 doc，供需要看全貌的呼叫端） */
  doc: BackpackSkillDoc
  /** 顯示名。有階名時是「移動強化Ⅰ」，否則退回技能原名 */
  name: string
  description: string
  descriptionRefs?: DescriptionRefs
  icon?: string
  effects: SkillEffect[]
  buffIds: string[]
  /** 來源標籤，格式對齊 entityRefs 的 BACKPACK_SKILLS spec（模擬器 BuffSource.origin 用） */
  origin: string
}

/** 由技能陣列建 id→doc 對照表。 */
export const buildBackpackSkillMap = (
  skills: BackpackSkillDoc[] | undefined,
): Map<string, BackpackSkillDoc> => new Map((skills ?? []).map((s) => [s.id, s]))

/**
 * 解析背包掛載的技能。
 *
 * ── 等級覆寫語意（與 PLAN-024 的 BuffLevel 一致）──────────────────────────────
 * 各欄位一律 `該級的值 ?? 技能頂層的值`：填了就覆寫、沒填就沿用父層。
 * 這與 entityRefs 的 `refsFallback: []`（未填時前台回退父層）是同一個約定，
 * 兩邊若不一致，會出現「掃描器認為某處有引用、前台卻顯示父層文字」的錯位。
 *
 * ── 查不到的 id 一律略過 ─────────────────────────────────────────────────────
 * 沿用 resolvePilotSkills 的優雅降級：技能被刪或 id 打錯時前台少顯示一塊，
 * 而不是整頁炸掉。後台的挑選器則會把同樣的情況標成紅字「⚠ 找不到此技能」——
 * 該被看見的是維護者，不是使用者。
 */
export function resolveBackpackSkills(
  bp: Pick<Backpack, 'skillIds'> | null | undefined,
  skillMap: Map<string, BackpackSkillDoc>,
): ResolvedBackpackSkill[] {
  const out: ResolvedBackpackSkill[] = []
  for (const raw of bp?.skillIds ?? []) {
    if (!raw) continue
    const { buffId: id, level } = parseBuffRef(raw)   // 泛用的 `id@N` 拆解，非 buff 專用
    const doc = skillMap.get(id)
    if (!doc) continue                                // 優雅降級（見上）
    const lv = level != null ? doc.levels?.find((l) => l.level === level) : undefined
    out.push({
      raw,
      id,
      level,
      doc,
      name: lv?.name ?? doc.name,
      description: lv?.description ?? doc.description,
      descriptionRefs: lv?.descriptionRefs ?? doc.descriptionRefs,
      icon: lv?.icon ?? doc.icon,
      effects: lv?.effects ?? doc.effects ?? [],
      buffIds: lv?.buffIds ?? doc.buffIds ?? [],
      origin: lv ? `背包技能:${doc.name} Lv${lv.level}` : `背包技能:${doc.name}`,
    })
  }
  return out
}

/**
 * 背包是否有任何可顯示的技能。
 *
 * 刻意提供這支而非讓呼叫端寫 `bp.skillIds?.length`——那個長度只代表「掛了幾個 id」，
 * 不代表解析得到。id 全部斷鏈時長度仍 > 0，gate 會開、然後渲染出一塊空白區。
 */
export const hasBackpackSkills = (
  bp: Pick<Backpack, 'skillIds'> | null | undefined,
  skillMap: Map<string, BackpackSkillDoc>,
): boolean => resolveBackpackSkills(bp, skillMap).length > 0
