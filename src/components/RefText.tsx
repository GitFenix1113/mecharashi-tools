import React from 'react'
import type { ReactNode } from 'react'
import type { DescriptionRefs, GameBuff } from '../types'
import { RefChip } from './RefChip'
import { highlightNumbers } from '../utils/moduleStats'
import { useNumRefLookup } from '../hooks/useNumRefLookup'
import { parseNumRefs, resolveNumValue, NUM_ATTRS, hasNumRef } from '../utils/numRefs'

type NumRefLookup = (refId: string) => GameBuff | undefined

/** 單一 <refId.attr> 數值引用：顯示綁定 buff 屬性的真值（淡底線 + title）；查無 / 未載入降級為暗色 ?。 */
function NumRefValue({ refId, attr, lookup }: { refId: string; attr: string; lookup: NumRefLookup }) {
  const value = resolveNumValue(refId, attr, lookup)
  if (value === undefined) {
    return <span className="text-text-dim" title={`數值引用未解析（${refId}.${attr}）`}>?</span>
  }
  const label = NUM_ATTRS[attr]?.label ?? attr
  const name = lookup(refId)?.name ?? refId
  return (
    <span
      className="underline decoration-dotted decoration-text-dim/60 underline-offset-2"
      title={`= ${name}・${label}`}
    >
      {value}
    </span>
  )
}

/** 一段非 [xxx] 文字：抽出 <refId.attr> 數值引用解析為真值，其餘片段保留既有數字高亮。 */
function renderNumRefSegments(text: string, lookup: NumRefLookup, keyPrefix: number): ReactNode {
  const segs = parseNumRefs(text)
  if (segs.length === 1 && segs[0].type === 'text') return highlightNumbers(text)
  return segs.map((seg, k) =>
    seg.type === 'text' ? (
      <React.Fragment key={`${keyPrefix}-${k}`}>{highlightNumbers(seg.value)}</React.Fragment>
    ) : (
      <NumRefValue key={`${keyPrefix}-${k}`} refId={seg.refId} attr={seg.attr} lookup={lookup} />
    ),
  )
}

/**
 * PLAN-019 Layer 1 — 引用層渲染器（PLAN-022 起並解析 <refId.attr> 數值引用）。
 *
 * 將描述文字中的 [xxx] 標記 tokenize：
 *  · 命中 descriptionRefs[xxx] → 渲染為 RefChip（hover 預覽 / click 釘選）
 *  · 未命中 → 原樣顯示 [xxx]（優雅降級，不報錯）
 * 非括號片段中的 <refId.attr> 數值引用解析為 buff 屬性真值（如 <buff_凝勢I.maxStack> → 5），
 * 其餘文字保留既有數字高亮（highlightNumbers）。
 */
export function RefText({ text, refs }: { text?: string; refs?: DescriptionRefs }) {
  const lookup = useNumRefLookup(!!text && hasNumRef(text))
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
        return <React.Fragment key={i}>{renderNumRefSegments(part, lookup, i)}</React.Fragment>
      })}
    </>
  )
}
