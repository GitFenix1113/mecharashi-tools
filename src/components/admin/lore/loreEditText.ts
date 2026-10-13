// 故事館編輯台的文字工具（PLAN-042-A E-1 寫在 AdminLorePage，PLAN-042-E D-2 拆出來給扉頁簡介共用）。
//
// 本檔**只放純函式**（不 import React）：`node --test` 直接載入 loreEditText.test.ts。

import type { LoreChapter } from '../../../types'

/**
 * 新增章節時自動產生穩定 key。**建立後不可變更**——網址（`/lore/pilots/:id/:part`）
 * 是唯一真相，而 changeHistory 的還原錨點也是靠 key 定位（`by: 'key'`）。
 * 改掉既有 key 會讓已分享的連結與既有快照錨點同時失效，且兩者都不會報錯。
 *
 * 從 `chapters.length + 1` 起跳並跳過已用號碼：刪掉中段某章後再新增，
 * 不會撿回已經被分享出去的舊號碼。
 */
export function makeChapterKey(chapters: readonly Pick<LoreChapter, 'key'>[]): string {
  const used = new Set(chapters.map((c) => c.key))
  for (let n = chapters.length + 1; ; n++) {
    const k = `part-${n}`
    if (!used.has(k)) return k
  }
}

/**
 * OCR 貼上的基本清理：換行正規化、逐行去頭尾空白（含全形空白 U+3000）、
 * 三個以上的連續換行收成一個空行。
 *
 * ⚠ 只做這三件事。斷句、標點修復、錯字都留給人——OCR 的錯法沒有規律，
 *   自動「修正」會製造出看起來對、但與原文不同的正文。
 */
export function cleanOcr(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // U+3000 ＝全形空白（OCR 對遊戲內首行縮排最常見的產出）。
    // 一律寫成逸出序列：字面量會被 ESLint 的 no-irregular-whitespace 擋下，
    // 而且它在 diff 與編輯器裡與半形空白長得一模一樣，改壞了看不出來。
    .map((line) => line.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 視為「這一行已經講完」的句末標點。不在此列的行尾＝OCR 的軟換行。 */
const HARD_LINE_END = /[。」』！？…：]$/

/**
 * 把 OCR 依版面切出來的軟換行接回同一段。
 *
 * **刻意做成明示按鈕而不是自動套用**：遊戲內文本有大量以「——」「…」結尾的短行、
 * 以及刻意的單行分句，接錯了要逐字改回來，比不接更費工。由編輯看過再按。
 * 空行（段落分界）一律保留。
 */
export function mergeSoftWraps(text: string): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const prev = out[out.length - 1]
    if (prev !== undefined && prev !== '' && line !== '' && !HARD_LINE_END.test(prev)) {
      out[out.length - 1] = prev + line
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

/** 陣列內 i 與 i+dir 互換；越界原樣回傳（同一個參照）。編輯台的 ▲▼ 共用。 */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list as T[]
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
