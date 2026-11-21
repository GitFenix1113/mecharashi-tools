// ── BUFF 的官方 ID 欄位（可編輯）＋列表小標 ─────────────────────────────────────
// 其他 8 種實體的 gameRef 在後台唯讀（GameRefField.tsx），只有 BUFF 可以改：BUFF 本來就是人工建檔的概念，
// 對不到官方記錄時要能由人補；回填腳本只補空欄、不覆寫這裡填的值（types/gameRef.ts 的 BuffGameRef）。
//
// 輸入框保留使用者打的原字（「123,」打到一半不會被吃掉逗號），表單收到的是解析後的 ID。
// 不是 ID 的片段只警告、存檔時略過；同一個 ID 填在別份 BUFF 上也只提示——兩者都不擋存檔。

import { useState, type ReactNode } from 'react'
import type { BuffGameRef, GameBuff } from '../../types'
import {
  parseBufIds, toBuffGameRef, formatBufIds, isKeywordBufId, otherHolders, buffLinkState,
  type BufIdHolder,
} from '../../utils/buffGameRef'

const holderText = (h: BufIdHolder) => `${h.buffName || h.buffId}${h.level != null ? `（Lv${h.level}）` : ''}`

export function BuffGameRefField({
  label,
  value,
  onChange,
  selfId,
  index,
  hint,
}: {
  label: string
  value: BuffGameRef | undefined
  onChange: (v: BuffGameRef | undefined) => void
  /** 自己這份 BUFF 的文件 ID：重複偵測時排除自己（同一份的不同級共用 ID 是正常的） */
  selfId: string
  /** indexBufIds(全部 BUFF) 的結果：父層算一次、各級共用 */
  index: Map<number, BufIdHolder[]>
  hint?: ReactNode
}) {
  const committed = formatBufIds(value)
  const [text, setText] = useState(committed)
  // 外部換了值（換一份 BUFF、還原草稿）才重設輸入框；自己打字造成的變動解析後會等於 committed，不重設
  const [prevCommitted, setPrevCommitted] = useState(committed)
  if (committed !== prevCommitted) {
    setPrevCommitted(committed)
    if (formatBufIds(toBuffGameRef(parseBufIds(text).ids)) !== committed) setText(committed)
  }

  const { ids, invalid } = parseBufIds(text)
  const dups = otherHolders(ids, index, selfId)

  return (
    <div>
      <label className="text-xs text-text-dim mb-1 block">{label}</label>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(toBuffGameRef(parseBufIds(e.target.value).ids))
        }}
        className="input-field font-mono"
        placeholder="如：7100303, 7100304（不知道就留空）"
        spellCheck={false}
      />
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {ids.map((id) => (
            <span key={id} className="text-[12px] px-1.5 py-0.5 rounded border border-border bg-bg-dark font-mono text-text-secondary">
              {id}
              {isKeywordBufId(id) && <span className="ml-1 font-sans text-text-dim">關鍵字</span>}
            </span>
          ))}
        </div>
      )}
      {invalid.length > 0 && (
        <p className="text-[12px] text-accent-red mt-1">「{invalid.join('」「')}」不是官方 ID（只收數字），存檔時會略過。</p>
      )}
      {dups.length > 0 && (
        <p className="text-[12px] text-accent-yellow mt-1 leading-relaxed">
          ⚠ {dups.map((d) => `${d.id} 也填在 ${d.holders.map(holderText).join('、')}`).join('；')}。
          同一個官方 ID 填在兩份 BUFF 上，傷害模擬會分不清是哪一份——多半是其中一份填錯了。
        </p>
      )}
      {hint && <p className="text-[11px] text-text-dim mt-1 leading-relaxed">{hint}</p>}
    </div>
  )
}

const LINK_BADGE = {
  linked:   { text: '遊戲 ID', cls: 'border-accent-green/40 bg-accent-green/10 text-accent-green' },
  partial:  { text: 'ID 部分', cls: 'border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow' },
  unlinked: { text: 'ID 未連結', cls: 'border-border text-text-dim' },
} as const

/** 列表列的小標。數值放 title（滑過才看）。 */
export function BuffGameRefBadge({ buff }: { buff: GameBuff }) {
  const state = buffLinkState(buff)
  const lines = [
    ...(buff.gameRef?.bufIds?.length ? [`頂層 ${buff.gameRef.bufIds.join('、')}`] : []),
    ...(buff.levels ?? []).map((l) => `Lv${l.level} ${l.gameRef?.bufIds?.join('、') || '（未填）'}`),
  ]
  const title = state === 'unlinked'
    ? '尚未填官方 BUFF ID：傷害模擬不會把它算進去。可在編輯面板補上。'
    : lines.join('\n')
  return (
    <span title={title} className={`text-[12px] px-1.5 py-0.5 rounded border shrink-0 ${LINK_BADGE[state].cls}`}>
      {LINK_BADGE[state].text}
    </span>
  )
}
