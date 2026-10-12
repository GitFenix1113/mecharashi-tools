// BUFF 描述的顯示解析（PLAN-058 決策四）
//
// 分級 BUFF 的**各級描述是正本**；頂層 `description` 是選填的「通用說明」——
// 只在引用**沒指定等級**（或指到的那級沒有描述）時才派上用場。
//
// 先前的寫法是「該級描述 || 詞條說明 || 頂層描述」，於是頂層留空的 30 筆分級 BUFF，
// 被沒帶等級的引用點開時是一張**空白**浮窗（鋒勢 ×11、傷害降低 ×1）。
// 補一句通用說明治標不治本——它會重複各級內容、又是一個會漂移的副本。
// 這裡改成：沒指定等級就把各級列出來，通用說明有寫才放在最上面。
//
// 純函式、無 React 依賴；EntityRefView 與 FormCard 共用，兩處不再各寫一套優先序。

import type { GameBuff, BuffLevel } from '../types/buff.ts'
import type { DescriptionRefs } from '../types/common.ts'
import { pickLevel } from './ndOverrides.ts'

export interface BuffLevelLine {
  level: number
  /** 該級顯示名；與 BUFF 本名相同時省略（貝爾莎的幹勁那種「無階名」家族不必重複一次） */
  name?: string
  description: string
  descriptionRefs?: DescriptionRefs
}

export interface BuffDescriptionView {
  /** 主描述：指定等級時是該級，否則是詞條說明或通用說明；可能為空字串 */
  description: string
  descriptionRefs?: DescriptionRefs
  /** 未指定等級時列出的各級（依 level 排序、只收有描述的級）。指定了等級就是空陣列 */
  levelLines: BuffLevelLine[]
}

/** 只需要詞條的這兩欄；不 import GlossaryTerm 型別，免得 helper 綁住整個詞條模型 */
interface TermText {
  description?: string
  descriptionRefs?: DescriptionRefs
}

/**
 * 某一級的引用表，**未自填或為空物件時回退頂層**。
 *
 * 與模組的 `levelRefs()`、背包技能的 `??` 回退一致。BUFF 原本不回退，
 * 和後台 RefPicker 的 `siblingTexts` 註解（「各級未自填 refs 時回退到這份」）互相矛盾：
 * 後台判定「不是殘留」的引用，前台其實沒有在用。
 */
export function buffLevelRefs(buff: Pick<GameBuff, 'descriptionRefs'>, level?: BuffLevel): DescriptionRefs | undefined {
  const refs = level?.descriptionRefs
  return refs && Object.keys(refs).length > 0 ? refs : buff.descriptionRefs
}

/**
 * 指定（或未指定）等級時，這顆 BUFF 該顯示什麼。
 *
 * 優先序：
 *   1. 指定的那一級有描述 → 只顯示該級。
 *   2. 否則主描述＝詞條說明（有 termRef 且詞條有字）→ 通用說明；並列出各級。
 *
 * ⚠ 詞條存在但說明是空的時候，主描述退回頂層，**引用表也一起退回頂層**。
 *   舊寫法只看「有沒有詞條」來選引用表，會把頂層正文配上詞條的引用表。
 */
export function buffDescriptionView(
  buff: Pick<GameBuff, 'name' | 'description' | 'descriptionRefs' | 'levels'>,
  level: number | undefined,
  term?: TermText,
): BuffDescriptionView {
  const lv = pickLevel(buff.levels, level)
  if (lv?.description) {
    return { description: lv.description, descriptionRefs: buffLevelRefs(buff, lv), levelLines: [] }
  }

  const general = term?.description
    ? { description: term.description, descriptionRefs: term.descriptionRefs }
    : { description: buff.description ?? '', descriptionRefs: buff.descriptionRefs }

  const levelLines = [...(buff.levels ?? [])]
    .filter((l) => !!l.description)
    .sort((a, b) => a.level - b.level)
    .map((l) => ({
      level: l.level,
      name: l.name && l.name !== buff.name ? l.name : undefined,
      description: l.description!,
      descriptionRefs: buffLevelRefs(buff, l),
    }))

  return { ...general, levelLines }
}

/** 分級 BUFF 的通用說明是否寫了數字（軟警示用：數字屬於各級，寫在通用說明裡遲早和各級對不上） */
export function generalTextHasNumber(text: string | undefined): boolean {
  // 去掉 [xxx] 引用與 <id.attr> 數值 token 再看：「[凝勢Ⅲ]」「<buff_x.lv2.maxStack>」裡的字不算正文數字
  const plain = (text ?? '').replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '')
  return /[0-9０-９]/.test(plain)
}
