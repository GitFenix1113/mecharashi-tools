import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { DescriptionRefs } from '../types'
import { RefChip } from './RefChip'
import { useNumRefLookup } from '../hooks/useNumRefLookup'
import { resolveNumRefs, hasNumRef } from '../utils/numRefs'
import { useNdOverrides } from '../contexts/NdOverrideContext'
import { buildNumLevelOf } from '../utils/ndOverrides'

function lcsMatched(a: string[], b: string[]): boolean[] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const matched = new Array(n).fill(false)
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { matched[j - 1] = true; i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return matched
}

/**
 * 差異高亮：以 base 為基準，標出 enhanced 中變動的 token（黃）與數字（紅）。
 * PLAN-019：傳入 refs 時，描述內 [xxx] 群組會渲染為 RefChip（descriptionMax 也吃引用層）。
 */
export function DiffHighlight({ base, enhanced, refs }: { base: string; enhanced: string; refs?: DescriptionRefs }) {
  // PLAN-022：先把 <refId.attr> 數值引用解析為真值再 tokenize —— base 綁凝勢I(5)、變體綁凝勢II(7)，
  // 解析後 5→7 照常被 LCS 標紅；[xxx] 群組不受影響（resolveNumRefs 只動 <...>）。
  const lookup = useNumRefLookup(hasNumRef(base) || hasNumRef(enhanced))
  // PLAN-034 F-2：**必須與 RefText 傳同一份 levelOf**。DiffHighlight 走的是 resolveNumRefs、
  // 沒有 RefText 那條路徑，且它自己直接渲染 RefChip（chip 會被抬升）。只接 RefText 的話，
  // 天賦卡會出現「chip 顯示凝勢Ⅲ、同一行的層數卻是 lv1 的 5」，而且症狀隨「差異高亮：開/關」
  // 切換而變——關掉走 RefText 正確、開著走這裡就錯。四個呼叫點全在天賦卡內、全在覆寫子樹裡。
  const ov = useNdOverrides()
  const levelOf = useMemo(() => buildNumLevelOf(refs, ov), [refs, ov])
  const tokenize = (s: string) =>
    s.match(/\d+(?:\.\d+)?%?|[a-zA-Z]+|[一-鿿]+|[^\w\d一-鿿\s]|\s+/g) ?? []
  const baseTokens = tokenize(resolveNumRefs(base, lookup, '?', levelOf))
  const enhTokens  = tokenize(resolveNumRefs(enhanced, lookup, '?', levelOf))
  const matched    = lcsMatched(baseTokens, enhTokens)

  const out: ReactNode[] = []
  for (let i = 0; i < enhTokens.length;) {
    // 偵測 [ ... ] 群組，若 refs 命中則整段渲染為 RefChip
    if (refs && enhTokens[i] === '[') {
      let j = i + 1
      let inner = ''
      while (j < enhTokens.length && enhTokens[j] !== ']') { inner += enhTokens[j]; j++ }
      if (j < enhTokens.length && refs[inner]) {
        out.push(<RefChip key={i} inner={inner} entity={refs[inner]} />)
        i = j + 1
        continue
      }
    }

    const token = enhTokens[i]
    if (/^\s+$/.test(token)) out.push(<span key={i}>{token}</span>)
    else if (!matched[i]) out.push(<strong key={i} className="text-accent-yellow font-bold">{token}</strong>)
    else if (/^\d+(?:\.\d+)?%?$/.test(token)) out.push(<span key={i} className="text-accent-red font-bold">{token}</span>)
    else out.push(<span key={i}>{token}</span>)
    i++
  }
  return <>{out}</>
}
