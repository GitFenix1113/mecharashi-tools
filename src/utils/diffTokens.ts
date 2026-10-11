// 差異高亮的 tokenizer（DiffHighlight 用）
//
// 切法：數字（含小數、%）、英文詞、CJK 連續字、單一標點、空白。
//
// **核心不變式：tokens.join('') === 原字串。** DiffHighlight 逐 token 輸出、[xxx] 群組也是把
// 括號內的 token 接回去再查 refs——任何一個字元被漏切，畫面上就會**靜默少一個字**。
//
// ⚠ 英文詞那條必須含 '_'：'_' 屬於 \w，所以「單一標點」[^\w…] 吃不到它，
//   而 [a-zA-Z]+ 也吃不到 → 該字元直接從輸出消失。2026-10-11 實際踩到：
//   珂賽特天賦的消歧鍵 [鋒勢|buff_2] 被切成「鋒勢|buff2」，refs 查無此 key →
//   「最大強化」區塊的 [鋒勢] 全部退回純文字（初始正文走 RefText，不受影響，
//   所以只看得到半邊壞掉）。
//
// 純函式、無依賴，可單測（npm test）。

const DIFF_TOKEN_RE = /\d+(?:\.\d+)?%?|[a-zA-Z_]+|[一-鿿]+|[^\w\d一-鿿\s]|\s+/g

export function tokenizeForDiff(s: string): string[] {
  return s.match(DIFF_TOKEN_RE) ?? []
}
