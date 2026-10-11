import type { ReactNode } from 'react'
import type { DescriptionRefs } from '../../types'
import { splitRefKey } from '../../utils/refKey'

/**
 * PLAN-057 A — 引用標註檢視（RefPicker 頂部）。
 *
 * 把正文原樣顯示，每個 [xxx] 換成可點的彩色膠囊：**顏色＝屬於哪一筆引用（key）**，
 * 右側小字標出引用的等級。起因是珂賽特天賦：初始版的 [鋒勢] 指 Lv1、最大強化版指 Lv2，
 * 前台兩邊都只顯示 [鋒勢]，後台的引用清單又和正文分開——看不出哪一處是哪一筆。
 *
 * 只負責顯示與回報點擊；改指派 / 改 key 的動作在 RefPicker 的引用清單列裡。
 */

/** 目前選取的引用。section / occurrence 由點擊正文膠囊帶入；從清單列選取時只有 key。 */
export interface OccurrenceSel {
  key: string
  /** 正文在 RefPicker `text` 陣列中的索引 */
  section?: number
  /** 該 key 在這一段的第幾次出現（1-based） */
  occurrence?: number
}

/** 非 [xxx] 的文字。<refId.attr> 數值 token 淡化顯示——它在前台會被代成數字，這裡只是對位用。 */
function plainSegment(s: string, keyPrefix: string): ReactNode[] {
  return s.split(/(<[^<>\s]+>)/g).map((seg, i) =>
    /^<[^<>\s]+>$/.test(seg)
      ? <span key={`${keyPrefix}-${i}`} className="font-mono text-[10px] text-text-dim">{seg}</span>
      : seg,
  )
}

export function RefOccurrenceText({
  text,
  section,
  refs,
  colorOf,
  selected,
  onSelect,
}: {
  text: string
  section: number
  refs: DescriptionRefs
  colorOf: (key: string) => string
  selected: OccurrenceSel | null
  onSelect: (sel: OccurrenceSel) => void
}) {
  const out: ReactNode[] = []
  const seen = new Map<string, number>()
  // 每次新建：/g 正則的 lastIndex 不可跨呼叫共用（refKey.countKeywordOccurrences 同理）
  const re = /\[([^\]]+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(...plainSegment(text.slice(last, m.index), `t${last}`))
    const key = m[1]
    const occurrence = (seen.get(key) ?? 0) + 1
    seen.set(key, occurrence)
    const ref = refs[key]
    const keySel = selected?.key === key
    const exact = keySel && selected?.section === section && selected?.occurrence === occurrence
    out.push(
      <button
        key={`k${m.index}`}
        type="button"
        onClick={() => onSelect({ key, section, occurrence })}
        className={`inline-flex items-baseline gap-0.5 mx-px px-1.5 rounded border text-xs leading-5 cursor-pointer hover:brightness-125 ${colorOf(key)} ${ref ? '' : 'border-dashed'} ${
          exact ? 'ring-2 ring-text-primary' : keySel ? 'ring-1 ring-text-primary/50' : ''
        }`}
        title={`key：${key}${ref ? '' : '（未指派）'} — 點擊編輯`}
      >
        {splitRefKey(key).display}
        {ref?.level !== undefined && <span className="text-[10px] font-mono opacity-80">Lv{ref.level}</span>}
        {!ref && <span className="text-[10px] opacity-80">?</span>}
      </button>,
    )
    last = re.lastIndex
  }
  if (last < text.length) out.push(...plainSegment(text.slice(last), `t${last}`))
  return <>{out}</>
}
