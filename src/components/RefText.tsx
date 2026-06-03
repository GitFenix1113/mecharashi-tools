import React from 'react'
import type { DescriptionRefs } from '../types'
import { RefChip } from './RefChip'
import { highlightNumbers } from '../utils/moduleStats'

/**
 * PLAN-019 Layer 1 — 引用層渲染器。
 *
 * 將描述文字中的 [xxx] 標記 tokenize：
 *  · 命中 descriptionRefs[xxx] → 渲染為 RefChip（hover 預覽 / click 釘選）
 *  · 未命中 → 原樣顯示 [xxx]（優雅降級，不報錯）
 * 非括號片段保留既有數字高亮（highlightNumbers）。
 */
export function RefText({ text, refs }: { text?: string; refs?: DescriptionRefs }) {
  if (!text) return null

  const parts = text.split(/(\[[^\]]+\])/g)

  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[([^\]]+)\]$/.exec(part)
        if (m) {
          const entity = refs?.[m[1]]
          if (entity) return <RefChip key={i} inner={m[1]} entity={entity} />
          return <span key={i}>{part}</span>
        }
        return <React.Fragment key={i}>{highlightNumbers(part)}</React.Fragment>
      })}
    </>
  )
}
