// 引用標記的同名消歧鍵（PLAN-039 A-1）
//
// descriptionRefs 的 key 就是「括號內文字」，故同一段正文裡兩個 [駐陣] 必然指向同一筆
// EntityRef。但新角色的能力正文中，前一個 [駐陣] 是 BUFF、後一個是技能。
//
// 解法：key 允許帶一段消歧後綴 `顯示文字|消歧鍵`，正文寫成
//   「…獲得[駐陣]…施放[駐陣|skill]…」
// 兩者遂成為 descriptionRefs 的兩個相異 key，可各自指派。顯示層一律剝掉後綴，
// 前台看到的仍是 [駐陣]。
//
// ⚠ **分隔符必須是 '|'，絕不能用 '#'**（PLAN-039 決策二）。
//   '#' 是 NUM_ATTRS.maxTriggers 的語法糖 sigil：寫成 [駐陣#2] 會被 detectLeftoverSugar
//   認成「未代入的語法糖」，接著被 compileSugar 替換成 <refId.maxTriggers> —— 正文當場改壞。
//   '|' 與三套既有語法（[xxx] 引用、<refId.attr> 數值 token、$n/%n/#n 語法糖）皆無交集，
//   且不會自然出現在中文遊戲文案裡。
//
// 後綴刻意是**語意**（skill / buff）而非序號：序數識別子正文一改就靜默錯位，
// 這正是 numRefs.ts 開頭「語法糖永不落地」與 entityRefs.ts 地雷 c 反覆拒絕過的東西。
//
// 純函式、無依賴，可單測（npm test）。
//
// **核心不變式：不含 '|' 的 key 一律原樣回傳。** 舊資料全數走與本檔存在前 byte-identical
// 的路徑——包含既有的含 '.' key（如 '凝勢.強化'）。

/** 消歧分隔符。改它會使既有資料的後綴全部失效，等同破壞性變更。 */
export const DISAMBIG_SEP = '|'

export interface RefKeyParts {
  /** 顯示文字（= 前台括號內看到的字）。恆非空，除非輸入本身為空字串。 */
  display: string
  /** 消歧鍵；無後綴時 undefined。 */
  disambig?: string
}

/**
 * 拆解 descriptionRefs 的 key。
 *
 * 只切**第一個** '|'：後綴內若再含 '|' 一併歸入 disambig，避免多重切割產生歧義。
 *
 * 兩種退化輸入刻意歸一化為「無後綴」，使 display 永不為空（空 chip 比露出內部語法更糟）：
 *   · '駐陣|'   → 空後綴無意義，視同 '駐陣'
 *   · '|skill'  → 剝完什麼都不剩，整串當 display
 */
export function splitRefKey(key: string): RefKeyParts {
  const i = key.indexOf(DISAMBIG_SEP)
  if (i <= 0) return { display: key }            // i === -1 無後綴；i === 0 為 '|xxx' 退化輸入
  const display = key.slice(0, i)
  const disambig = key.slice(i + DISAMBIG_SEP.length)
  // 空後綴仍要吃掉分隔符：顯示層不該出現孤懸的 '|'
  return disambig ? { display, disambig } : { display }
}

/** 取 key 的顯示文字（剝除消歧後綴）。顯示層的唯一入口。 */
export function displayKeyword(key: string): string {
  return splitRefKey(key).display
}

/** 組回 descriptionRefs 的 key。與 splitRefKey 互逆；比照 buffRef.ts 的 formatBuffRef。 */
export function formatRefKey(display: string, disambig?: string): string {
  return disambig ? `${display}${DISAMBIG_SEP}${disambig}` : display
}

// ─── 正文掃描（後台 RefPicker 用）────────────────────────────────────────────

/** [xxx] 標記；與 RefText 的 split、numRefs 的 KEYWORD_RE 對齊。 */
const KEYWORD_SRC = '\\[([^\\]]+)\\]'

/**
 * 正文中每個**完整 key** 的出現次數，依首次出現排序（Map 保留插入序）。
 *
 * 計數用完整 key 而非 display：`[駐陣]` 與 `[駐陣|skill]` 各出現一次時
 * 兩者皆為 1，不該再提示「同名重複」——它們已經消歧完畢了。
 */
export function countKeywordOccurrences(text: string): Map<string, number> {
  const out = new Map<string, number>()
  // 每次新建：模組層級的 /g 正則跨呼叫共用 lastIndex，中途 break 會污染下一次掃描
  const re = new RegExp(KEYWORD_SRC, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.set(m[1], (out.get(m[1]) ?? 0) + 1)
  return out
}

/**
 * 把正文中 `[keyword]` 的**第 occurrence 次出現**（1-based）改寫為帶消歧後綴的形式，
 * 其餘出現與其他 keyword 一律不動。找不到該次出現時原樣回傳。
 *
 * **刻意用 indexOf 而非正則**：keyword 是維護者輸入的自由文字，可能含 `.`、`(`、`|`
 * 等正則特殊字元（既有資料就有 `凝勢.強化` 這種 key）。組動態正則就得處理跳脫，
 * 漏一個字元的後果是改錯位置或整段替換失敗——而這兩者都是靜默的。
 */
export function rewriteOccurrence(
  text: string,
  keyword: string,
  occurrence: number,
  disambig: string,
): string {
  const target = `[${keyword}]`
  let n = 0
  let i = 0
  for (;;) {
    const at = text.indexOf(target, i)
    if (at === -1) return text
    if (++n === occurrence) {
      return text.slice(0, at) + `[${formatRefKey(keyword, disambig)}]` + text.slice(at + target.length)
    }
    i = at + target.length
  }
}
