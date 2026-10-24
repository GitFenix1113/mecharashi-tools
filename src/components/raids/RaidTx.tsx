import type { ReactNode } from 'react'
import { useRaidEdit } from './raidEdit'

/**
 * 可在後台預覽點擊修改的一段字（PLAN-064 H-3）。text＝這段字的完整內容（用來對譯名），children 省略時就畫 text。
 * 前台沒有編輯 context：原樣輸出。
 */
export function Tx({ text, children }: { text?: string | null; children?: ReactNode }) {
  const edit = useRaidEdit()
  const content = children ?? text
  if (!edit || !text) return <>{content}</>
  const term = edit.resolve(text)
  if (!term) return <>{content}</>
  const open = () => edit.open(term)
  return (
    <span
      role="button"
      tabIndex={0}
      title={`點擊修改（${term.cn}）`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); open() }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); open() } }}
      className="rounded-sm outline outline-1 outline-dashed outline-accent-cyan/50 hover:bg-accent-cyan/15 cursor-text"
    >
      {content}
    </span>
  )
}
