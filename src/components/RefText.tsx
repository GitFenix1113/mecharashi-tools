import React, { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { DescriptionRefs, GameBuff } from '../types'
import { RefChip } from './RefChip'
import { highlightNumbers } from '../utils/moduleStats'
import { useNumRefLookup } from '../hooks/useNumRefLookup'
import { parseNumRefs, resolveNumValue, NUM_ATTRS, hasNumRef } from '../utils/numRefs'
import { useNdOverrides } from '../contexts/NdOverrideContext'
import { buildNumLevelOf, type NumLevelOf } from '../utils/ndOverrides'

type NumRefLookup = (refId: string) => GameBuff | undefined

/** 單一 <refId.attr> 數值引用：顯示綁定 buff 屬性的真值（淡底線 + title）；查無 / 未載入降級為暗色 ?。 */
function NumRefValue({
  refId, attr, level, lookup, levelOf,
}: { refId: string; attr: string; level?: number; lookup: NumRefLookup; levelOf: NumLevelOf }) {
  const value = resolveNumValue(refId, attr, lookup, level, levelOf)
  if (value === undefined) {
    return <span className="text-text-dim" title={`數值引用未解析（${refId}${level ? `.lv${level}` : ''}.${attr}）`}>?</span>
  }
  const label = NUM_ATTRS[attr]?.label ?? attr
  const name = lookup(refId)?.name ?? refId
  const dec = levelOf(refId, level)
  // 抬升時 title 必須說得出「從幾階抬到幾階、是哪一區的算力」（地雷六）——
  // 畫面數字與資料庫值不同時，使用者唯一的線索就是這行字。
  const lvNote = dec.lifted
    ? `（Lv${dec.level}，已由 ${dec.zone ?? '神經驅動'} 算力自 Lv${level ?? 1} 提升）`
    : level ? `（Lv${level}）` : ''
  return (
    <span
      className={dec.lifted
        ? 'underline decoration-double decoration-accent-pink/70 underline-offset-2'
        : 'underline decoration-dotted decoration-text-dim/60 underline-offset-2'}
      title={`= ${name}・${label}${lvNote}`}
    >
      {value}
    </span>
  )
}

/** 一段非 [xxx] 文字：抽出 <refId.attr> 數值引用解析為真值，其餘片段保留既有數字高亮。 */
function renderNumRefSegments(text: string, lookup: NumRefLookup, levelOf: NumLevelOf, keyPrefix: number): ReactNode {
  const segs = parseNumRefs(text)
  if (segs.length === 1 && segs[0].type === 'text') return highlightNumbers(text)
  return segs.map((seg, k) =>
    seg.type === 'text' ? (
      <React.Fragment key={`${keyPrefix}-${k}`}>{highlightNumbers(seg.value)}</React.Fragment>
    ) : (
      <NumRefValue
        key={`${keyPrefix}-${k}`}
        refId={seg.refId} attr={seg.attr} level={seg.level}
        lookup={lookup} levelOf={levelOf}
      />
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
 *
 * PLAN-034 F-2：數值 token 的取級與 chip 走**同一個** ND 覆寫表。
 * chip 由 RefChip 各自問 context，token 由這裡建 levelOf 傳下去——兩者的裁決都出自
 * effectiveLevel，故不可能出現「chip 說凝勢Ⅲ、同一行的層數卻是 lv1 的 5」。
 */
export function RefText({ text, refs }: { text?: string; refs?: DescriptionRefs }) {
  const lookup = useNumRefLookup(!!text && hasNumRef(text))
  const ov = useNdOverrides()
  const levelOf = useMemo(() => buildNumLevelOf(refs, ov), [refs, ov])
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
        return <React.Fragment key={i}>{renderNumRefSegments(part, lookup, levelOf, i)}</React.Fragment>
      })}
    </>
  )
}
