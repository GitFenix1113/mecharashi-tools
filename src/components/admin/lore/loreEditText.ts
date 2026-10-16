// 故事館編輯台的文字工具（PLAN-042-A E-1 寫在 AdminLorePage，PLAN-042-E D-2 拆出來給扉頁簡介共用）。
//
// 本檔**只放純函式**（不 import React）：`node --test` 直接載入 loreEditText.test.ts。

import type { LoreChapter, LoreCommentary, LoreCustomSpeaker } from '../../../types'
import { inlineSource } from '../../lore/loreText.ts'

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
 * 空行（段落分界）與行內署名（`——` 開頭的獨立行，見 `inlineSource()`）一律保留。
 */
export function mergeSoftWraps(text: string): string {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const prev = out[out.length - 1]
    if (prev !== undefined && prev !== '' && line !== '' && !HARD_LINE_END.test(prev)
      && inlineSource(prev) === null && inlineSource(line) === null) {
      out[out.length - 1] = prev + line
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

// ── 引文段卡片（2026-10-15）──────────────────────────────────────────────────
//
// 一章引了多份資料、各有出處時（淬鋒·凱登 PART 2），編輯台把正文切成「引文段」卡片，每張各自一個署名欄。
// **資料格式不變**：卡片只存在編輯台，存檔時序列化回 `body`＋`source`——
//   中間各段 → 正文後接一行 `——署名`（前台的行內署名，`inlineSource()`），最後一段的署名 → `source`。
// 不改成 `sections[]` 欄位的評估見 _local-notes/2026-10/2026-10-15_故事館一章多出處資料結構評估.md；
// 將來真的要轉，`splitSections()` 就是搬遷函式。

/** 編輯台的一張引文段卡片。署名不含開頭的破折號（橫線由前台 CSS 畫）。 */
export interface LoreSectionDraft {
  body: string
  source: string
}

/** 署名開頭使用者順手打的破折號。不含 OCR 的 `一一`：「一一列舉」是正常中文。 */
const SOURCE_DASH = /^(——|──|--)\s*/

const cleanSource = (s: string) => s.trim().replace(SOURCE_DASH, '').trim()

/**
 * `body`＋`source` → 引文段卡片。切點是行內署名行；最後一張的署名＝`source`。
 * 沒有行內署名的章節（絕大多數）切出來就是一張卡片。
 */
export function splitSections(body: string, source: string | undefined): LoreSectionDraft[] {
  const out: LoreSectionDraft[] = []
  let lines: string[] = []
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const s = inlineSource(line)
    if (s === null) { lines.push(line); continue }
    out.push({ body: lines.join('\n').trim(), source: s })
    lines = []
  }
  out.push({ body: lines.join('\n').trim(), source: cleanSource(source ?? '') })
  return out
}

/**
 * 引文段卡片 → `body`＋`source`（`splitSections` 的反函式）。
 *
 * 中間的卡片**沒有署名**時直接接下一段：沒有署名的分界在資料裡不存在，重新開啟會併成一張——
 * 前台的段落照樣分開，看起來一模一樣，所以不擋存檔，只在卡片上提示。
 */
export function joinSections(sections: readonly LoreSectionDraft[]): { body: string; source: string | undefined } {
  const parts: string[] = []
  sections.forEach((s, i) => {
    if (s.body.trim()) parts.push(s.body.trim())
    const src = cleanSource(s.source)
    if (i < sections.length - 1 && src) parts.push(`——${src}`)
  })
  return { body: parts.join('\n'), source: cleanSource(sections[sections.length - 1]?.source ?? '') || undefined }
}

/**
 * 中間卡片的署名能不能被前台認成行內署名。不行的話前台會把那一行當正文印出來，存檔前要擋。
 * 空署名不算問題（見 `joinSections`）。最後一張的署名存進 `source` 欄位，不受這條限制。
 */
export function middleSourceIssue(source: string): string | null {
  const src = cleanSource(source)
  if (!src || inlineSource(`——${src}`) !== null) return null
  return '前台認不出這個署名（限 40 字內、不能有「。！？」），會被當成正文顯示'
}

/** 卡片的編輯狀態快取：連同它序列化出來的 body／source 一起記，用來判斷還能不能沿用。 */
export interface LoreSectionCache {
  body: string
  source: string | undefined
  sections: LoreSectionDraft[]
}

/**
 * 某一章目前該顯示的卡片。快取只在「它序列化出來的結果仍等於章節現值」時沿用——
 * 正文被別的地方改掉（RefPicker 編譯、刪章後同一個 key 被新章撿走）就自動作廢、重新從資料切。
 * 需要快取是因為打字中的狀態不一定能從資料還原（新增的空卡片、署名清空到一半）。
 */
export function chapterSections(chapter: Pick<LoreChapter, 'body' | 'source'>, cache: LoreSectionCache | undefined): LoreSectionDraft[] {
  if (cache && cache.body === chapter.body && (cache.source ?? '') === (chapter.source ?? '')) return cache.sections
  return splitSections(chapter.body, chapter.source)
}

/** 存檔前檢查：所有章節中間卡片的署名問題，回傳「PART 2 引文段 1：…」清單。 */
export function sectionIssues(chapters: readonly LoreChapter[], cache: Readonly<Record<string, LoreSectionCache>>): string[] {
  return chapters.flatMap((ch, i) =>
    chapterSections(ch, cache[ch.key]).slice(0, -1).flatMap((s, j) => {
      const issue = middleSourceIssue(s.source)
      return issue ? [`${ch.label ?? `PART ${i + 1}`} 引文段 ${j + 1}：${issue}`] : []
    }),
  )
}

/** 陣列內 i 與 i+dir 互換；越界原樣回傳（同一個參照）。編輯台的 ▲▼ 共用。 */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list as T[]
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/**
 * 自訂說話者的名稱建議（後台旁白列的 datalist）：掃所有故事館文件裡已經用過的自訂說話者。
 *
 * 用途是**維持寫法一致**——同一位「匿名使用者」在三篇故事裡寫成三種名字，前台就是三個人。
 * 同名合併、頭像取第一個有填的；常用的排前面。不另開 NPC 說話者集合（見 types/lore.ts 的 LoreCustomSpeaker）。
 */
export function customSpeakerPresets(docs: readonly { chapters?: readonly LoreChapter[] }[]): LoreCustomSpeaker[] {
  const seen = new Map<string, { art?: string; n: number }>()
  for (const d of docs) {
    for (const ch of d.chapters ?? []) {
      for (const c of ch.commentary ?? []) {
        const name = c.speaker?.name.trim()
        if (!name) continue
        const e = seen.get(name) ?? { n: 0 }
        e.n++
        if (!e.art && c.speaker?.art) e.art = c.speaker.art
        seen.set(name, e)
      }
    }
  }
  return [...seen]
    .sort(([a, x], [b, y]) => y.n - x.n || a.localeCompare(b, 'zh-Hant'))
    .map(([name, e]) => ({ name, ...(e.art && { art: e.art }) }))
}

/**
 * 存檔前整理旁白：自訂說話者的名稱 trim；名稱與頭像都空 → 拿掉 speaker（等同「未指定說話者」，不留空殼）。
 * 打字中不 trim（會吃掉正要打的空白），所以集中在存檔這一步——與外觀名稱同慣例。
 */
export function normalizeCommentary(items: readonly LoreCommentary[] | undefined): LoreCommentary[] | undefined {
  if (!items?.length) return undefined
  return items.map(({ speaker, ...c }) => {
    const name = speaker?.name.trim() ?? ''
    if (!speaker || (!name && !speaker.art)) return c
    return { ...c, speakerId: '', speaker: { name, ...(speaker.art && { art: speaker.art }) } }
  })
}
