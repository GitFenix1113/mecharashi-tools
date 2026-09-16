// PLAN-042-A C-3：故事館正文的純文字工具。
//
// 本檔**只放純函式**：不 import React、不碰 DOM、不讀 `import.meta.env`。
// 理由與 `assets.ts:1-8` 同——`node --test` 直接載入本檔跑 `loreText.test.ts`，
// 模組層級取 `import.meta.env` 會讓整個檔案一 import 就拋 TypeError。

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
 * 若正文尾端就是署名，切掉它（署名改由 `<LoreSourceLine>` 單獨排版）。
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
