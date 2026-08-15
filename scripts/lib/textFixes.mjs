/**
 * OpenCC 簡→繁「過度轉換」修正表（爬蟲共用）
 *
 * ── 問題 ─────────────────────────────────────────────────────────────────────
 * opencc-js 的 cn→tw 轉換會把某些**在簡體中本來就寫作該字**的詞，誤判成簡化字而還原成
 * 另一個字。實測踩到的：官方 API 的「回避模组」被轉成「迴避模組」——OpenCC 認為這裡的
 * 「回」是「迴」的簡化。但遊戲繁中版的正式用字是**「回避」**（模組詳情頁逐字為證）。
 *
 * 後果不只是錯字：爬蟲用名稱比對 Firestore 既有資料時會查不到，於是**另外建一份新文件**。
 * 2026-08-15 就是這樣長出 sub_mod_回避模組 / sub_mod_迴避模組 兩份同樣的副模組，
 * 引用還分裂成 4 台機甲指這份、3 台指那份。
 *
 * ── 為什麼是白名單而不是全域取代 ─────────────────────────────────────────────
 * 「迴」本身是正字，全域把「迴」換成「回」會改壞正確的詞：
 *   modules/mod_2067「荊棘迴路」、pilotSkills/skill_緋焰迴路（circuit）
 *   pilotSkills/skill_嵐循環 的 name「嵐迴圈」（loop）
 * 所以這裡只列**確定錯誤的詞**，逐詞取代。新增條目前請先確認遊戲內的正式寫法。
 *
 * 用法：套在 s2t() 的結果上（名稱與描述文本都要），例：
 *   const nameTW = fixOverConversion(s2t(raw.name))
 */

/** [錯誤寫法, 正確寫法]；只做逐詞取代，不做正則泛化。 */
export const OVER_CONVERSION_FIXES = [
  // 「回避」= 閃避率相關的遊戲術語，官方繁中作「回避」
  ['迴避', '回避'],
]

/** 把已知的 OpenCC 過度轉換詞改回官方寫法。非字串一律原樣回傳。 */
export function fixOverConversion(text) {
  if (typeof text !== 'string' || !text) return text
  let out = text
  for (const [wrong, right] of OVER_CONVERSION_FIXES) {
    if (out.includes(wrong)) out = out.split(wrong).join(right)
  }
  return out
}
