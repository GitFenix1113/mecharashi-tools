import React from 'react'
import { RefChip } from '../refs/RefChip'
import { displayKeyword } from '../../utils/refKey'
import type { DescriptionRefs } from '../../types'

/**
 * 故事館專用的輕量引用渲染器（PLAN-042-A 決策 A）。
 *
 * 與 <RefText> 的唯一差別：**不套 highlightNumbers、不解析 <refId.attr>**。
 * moduleStats.tsx:81-86 的 highlightNumbers 對所有非 [xxx] 文字無條件包
 * <span class="text-accent-red font-bold">，且沒有任何 prop 可關；lore 散文裡
 * 「0.5秒」「11小隊」「X.C.96年」「12,520,00」都會變成紅色粗體（最後一個還會被
 * 逗號切成三段各自變紅）。而 lore 實際 0 篇含 [xxx]——RefText 在故事館只有傷害。
 * 覆寫 --color-accent-red 也救不了：font-bold 不受色票影響。
 *
 * [xxx] 的解析規則與 RefText.tsx:80-93 **逐字對齊**，之後兩邊要一起改。
 *
 * ⚠ 刻意**不**包 NdOverrideContext.Provider：那會讓 [凝勢] 顯示成遊戲裡看不到的抬升階名。
 */
export function LoreRichText({ text, refs }: { text?: string; refs?: DescriptionRefs }) {
  if (!text) return null
  const parts = text.split(/(\[[^\]]+\])/g)
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[([^\]]+)\]$/.exec(part)
        if (!m) return <React.Fragment key={i}>{part}</React.Fragment>
        const entity = refs?.[m[1]]
        if (entity) return <RefChip key={i} inner={m[1]} entity={entity} />
        // 未指派 → 原樣顯示（優雅降級、不 console.warn）。帶消歧後綴時剝掉，
        // 否則「填了後綴卻忘了指派」會把 [駐陣|skill] 這種內部語法漏到前台。
        const disp = displayKeyword(m[1])
        return <span key={i}>{disp === m[1] ? part : `[${disp}]`}</span>
      })}
    </>
  )
}
