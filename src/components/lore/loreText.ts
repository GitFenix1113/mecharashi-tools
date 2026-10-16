// PLAN-042-A C-3：故事館正文的純文字工具。
//
// 本檔**只放純函式**：不 import React、不碰 DOM、不讀 `import.meta.env`。
// 理由與 `assets.ts:1-8` 同——`node --test` 直接載入本檔跑 `loreText.test.ts`，
// 模組層級取 `import.meta.env` 會讓整個檔案一 import 就拋 TypeError。

import type { LoreChapter } from '../../types'

/**
 * 前台看得到的章節（PLAN-042-E D-5）：濾掉草稿章，順序不變。
 *
 * **前台唯一的過濾點**——章節目錄、‹ › 換章、章節網址解析、館首頁與名冊的章節數全部走這裡，
 * 不要各自寫 `.filter((c) => !c.draft)`：漏一處就是「目錄看不到、網址卻點得進去」或「卡片寫 3 章、點進去只有 2 章」。
 * `undefined`（Worker 回來的舊文件缺欄位）→ 空陣列。
 */
export function publishedChapters(chapters: readonly LoreChapter[] | undefined): LoreChapter[] {
  return (chapters ?? []).filter((c) => !c.draft)
}

/**
 * 逐段切分正文。
 *
 * lore 實測只用單一 `\n` 分段、且 0 個空段；仍做 trim + filter，
 * 以防後台編輯器輸入 `\n\n` 或行尾殘留空白時多印出空的 `<p>`。
 */
export function splitParagraphs(text: string | undefined): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/** 引文體的起首記號。34 篇扉頁裡以這四種其中之一開頭者一律套 blockquote 語彙。 */
const QUOTE_OPENERS = ['「', '『', '"', '“']

/**
 * 引文體判定：trimStart 後的首字是 `「` `『` `"` `“` 之一。
 *
 * 用途是決定「這一段要不要包 blockquote」，不是要判斷整段是否為完整引文——
 * 故只看首字，不檢查有沒有對應的收尾引號（原文常見跨段引文，收尾在下一段）。
 */
export function isQuoteStyle(text: string | undefined): boolean {
  if (!text) return false
  const head = text.trimStart().charAt(0)
  return QUOTE_OPENERS.includes(head)
}

/**
 * 引文開頭段的首字放大（2026-10-16）：起首引號照舊懸掛，放大的是**引號後的第一個字**。
 *
 * 一般段落用 CSS `::first-letter` 就夠了，引文段不行：引號包在懸掛用的 inline-block 裡，
 * `::first-letter` 拿不到後面的字（實測 116 章裡 67 章、89 篇扉頁裡 34 篇以引號開頭，首字放大全部消失）。
 *
 * 引號後緊接的不是文字或數字（`「⋯⋯`、`「『`）→ `null`，維持只有懸掛引號：
 * 把標點一起放大太重，只放大標點後的字又會被 float 排到標點前面。
 * 用 `Array.from` 切字，擴充區漢字（代理對）不會被切成兩半。
 */
export function quoteDropCap(text: string): { open: string; cap: string; rest: string } | null {
  if (!isQuoteStyle(text)) return null
  const [open, cap, ...rest] = Array.from(text.trimStart())
  if (!cap || !/[\p{L}\p{N}]/u.test(cap)) return null
  return { open, cap, rest: rest.join('') }
}

/**
 * 每份引文的開頭段（2026-10-16）：第一段，以及每一行行內署名之後的第一段——首字放大就落在這些段落。
 * 一章引了兩份資料（淬鋒·凱登 PART 2），第二份的開頭也該像新的一篇那樣起頭。署名行本身不算。
 */
export function sectionStarts(paragraphs: readonly string[]): boolean[] {
  return paragraphs.map((p, i) => inlineSource(p) === null && (i === 0 || inlineSource(paragraphs[i - 1]) !== null))
}

/** 句末標點。中文正文實測只用得到這三個，不納入 ASCII 句點（會被小數點誤判）。 */
const SENTENCE_END = /[。！？]/
/** 句末標點後面若緊跟收尾引號／括號，一併帶走，免得切出「…話說完了。」少一個 `」`。 */
const TRAILING_CLOSERS = /^[」』"”）)]+/

/**
 * 取首句，給館首頁卡片與機師詳情頁的摘要用。
 *
 * 找第一個 `。！？` 切（含標點本身）；整段找不到句末標點時截 `max` 字並補 `…`。
 * `undefined` / 空白 → `''`（呼叫端可以直接 `{firstSentence(x) || '尚未建檔'}`）。
 */
export function firstSentence(text: string | undefined, max = 60): string {
  const t = text?.trim()
  if (!t) return ''
  const m = SENTENCE_END.exec(t)
  if (m) {
    const cut = m.index + 1
    const closers = TRAILING_CLOSERS.exec(t.slice(cut))
    return t.slice(0, cut + (closers ? closers[0].length : 0))
  }
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * 署名記號。原文的破折號寫法沒有統一：34 筆署名裡混著 OCR 壞掉的 `--` 與 `一一`，
 * 草稿入庫時已把 `frontSource` 正規化成 `——`，但**正文那一份沒有動**。
 */
const SOURCE_MARKS = /(——|一一|--|──|–)/g
/** 尾段長度上限。超過就當作「這個破折號是正文的一部分」，不切。 */
const MAX_SOURCE_TAIL = 40

/**
 * 若正文尾端就是署名，切掉它（署名改由 `.lore-source` 單獨排版）。
 *
 * PLAN-042-E 起**不在渲染路徑上**：搬遷（B-2）時已用它把署名從 `pilotLore.intro` 切乾淨，
 * 前台直接讀乾淨的簡介，不必每次渲染都重猜一次。留著是給搬遷與對帳腳本（B-2／B-3）用，
 * G-2 封存腳本之後就沒有呼叫端了，屆時連同測試一起刪。
 *
 * ⚠ **不可用 `text.endsWith(source)`**：34 筆中有 2 筆（尼爾、黑障）正文裡是 `--` / `一一`，
 *   而 `source` 已正規化成 `——` ⇒ `endsWith` 為 false、`replace()` 原樣回傳，
 *   症狀只是「這兩位的扉頁把署名重複印了一次」，不丟錯也沒有 console 訊息（地雷 M-17）。
 *   故改為找**最後一個**破折號記號切，並用 `MAX_SOURCE_TAIL` 擋掉正文中段的破折號。
 *
 * `source` 為 `undefined`（這篇根本沒登記署名）時原樣回傳——沒有署名就沒有東西該被切掉。
 */
export function stripTrailingSource(text: string | undefined, source: string | undefined): string {
  if (!text) return ''
  if (!source?.trim()) return text

  SOURCE_MARKS.lastIndex = 0
  let cut = -1
  let m: RegExpExecArray | null
  while ((m = SOURCE_MARKS.exec(text)) !== null) cut = m.index

  // 找不到記號、或記號就在開頭（切完會變空字串）、或尾段太長（那是正文不是署名）→ 不切。
  if (cut <= 0) return text
  if (text.length - cut > MAX_SOURCE_TAIL) return text
  return text.slice(0, cut).trimEnd()
}

// ── PLAN-042-D D-5：渲染端保守正規化 ─────────────────────────────────────────
//
// 逸聞章節多半是 OCR 貼進來的：固定寬度的硬換行（「本質是什／麼。」被切成兩段）與半形標點。
// **正解是資料端清理**（PLAN-042-D H-4，站長之後走 data-patch），清完之後這裡應該是 no-op；
// 在那之前渲染端先做「不會誤傷」的那一半——所以規則刻意保守：
//   · 只合併**長行**（≥ SOFT_WRAP_MIN 字）且行尾不是句末標點的換行。OCR 斷行的位置是排版寬度（實測 38 字上下），
//     短行多半是刻意的（日記的「6月21日」、署名），寬鬆版會把它們併進正文（模擬頁實際發生過）。
//   · 半形 `, ? ! ; :` 只在**前後有中文**時轉全形——「12,520」「Mk.II」這種不能動。
// 編輯台之後貼上時也可以用同一組函式（H-4 清理時順手接上）。

/** OCR 斷行的最短長度。實測卡蜜拉 4 章的斷行落在 37–40 字；正常段落的「短行」都在 20 字以內。 */
const SOFT_WRAP_MIN = 30
/** 行尾是這些字元就視為「句子結束」，不合併 */
const LINE_END = /[。！？」』…：）)】～—!?．.]$/
const CJK = '\u3400-\u9fff\u3000-\u303f\uff00-\uffef'
const HALF_TO_FULL: Record<string, string> = { ',': '，', '?': '？', '!': '！', ';': '；', ':': '：' }
// 前後的空白一併吃掉（OCR 常在標點兩側多一格）：全形標點本身就帶留白
const PUNCT_AFTER_CJK = new RegExp(`(?<=[${CJK}])\\s*([,?!;:])\\s*`, 'g')
const PUNCT_BEFORE_CJK = new RegExp(`\\s*([,?!;:])\\s*(?=[${CJK}])`, 'g')

/** 半形標點在中文語境轉全形；英數之間的（12,520、Mk.II）不動。 */
export function fullwidthLorePunctuation(text: string): string {
  return text
    .replace(PUNCT_AFTER_CJK, (_, p: string) => HALF_TO_FULL[p] ?? p)
    .replace(PUNCT_BEFORE_CJK, (_, p: string) => HALF_TO_FULL[p] ?? p)
}

/**
 * 閱讀用的段落：`splitParagraphs` ＋ 長行 OCR 斷行合併 ＋ 中文語境半形標點轉全形。
 * 扉頁簡介（pilotLore.intro，原官方 API 的完整段落）跑這個也是 no-op——它們的每一段都以句末標點結尾。
 */
export function readableParagraphs(text: string | undefined): string[] {
  const out: string[] = []
  for (const line of splitParagraphs(text)) {
    const prev = out[out.length - 1]
    // 行內署名永遠自成一段：不併進上一段，也不讓下一行併進來（署名常以 》 結尾，不在 LINE_END 裡）
    const softWrap = prev !== undefined && prev.length >= SOFT_WRAP_MIN && !LINE_END.test(prev)
      && inlineSource(prev) === null && inlineSource(line) === null
    if (softWrap) out[out.length - 1] = prev + line
    else out.push(line)
  }
  return out.map(fullwidthLorePunctuation)
}

/**
 * 行內署名（2026-10-15）：一章引了兩份以上的資料、各有出處時（淬鋒·凱登 PART 2：維斯珀爾內部通訊＋海莉絲研究日誌），
 * **中間那份**的出處在正文裡另起一行、以 `——` 開頭，前台比照章末署名排版（`.lore-source`）。
 * 最後一份照舊寫在 `LoreChapter.source`——章末署名的位置與既有各章一致。
 *
 * 判定刻意從嚴，免得把以破折號起頭的正文句子（「——就在這時，警報響了。」）排成署名：
 *   · 只認 `——`。OCR 的 `一一` 不認：「一一列舉」是正常中文，而這一行是編輯親手打的、不是 OCR 貼上的
 *   · 破折號之後 1～`MAX_SOURCE_TAIL` 字，且不含句末標點 `。！？`
 *
 * 是署名 → 回傳去掉破折號的署名文字（與 `source` 欄位同寫法，橫線由 CSS 畫）；不是 → `null`。
 */
export function inlineSource(line: string): string | null {
  const m = /^\s*——\s*(.+?)\s*$/.exec(line)
  if (!m) return null
  const tail = m[1]
  if (tail.length > MAX_SOURCE_TAIL || SENTENCE_END.test(tail)) return null
  return tail
}

/**
 * 署名開頭的破折號統一成 `——`（OCR 常把它認成「一一」「--」）。只換開頭那一組記號，
 * 不碰後面的字——「一一一份調任申請書」是「一一」＋「一份…」，第三個「一」是正文。
 */
export function normalizeLoreSource(source: string | undefined): string {
  const s = source?.trim() ?? ''
  if (!s) return ''
  return s.replace(/^(——|一一|--|──|–)\s*/, '——')
}
