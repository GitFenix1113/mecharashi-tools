import { useState } from 'react'
import { toPointer } from '../../../lib/sim/verifyCase'

// ─── 通用 JSON 樹（PLAN-065-C C-4）─────────────────────────────────────────────
//
// 完整拆解（L2）的結構不在公開 repo 定義（決策三），所以只能用通用方式呈現：
// 物件／陣列可展開，數字葉節點可「選為比對」——站長自己決定預覽單擊要對哪個數字，存成 JSON Pointer。

interface Props {
  value: unknown
  /** 點數字葉節點時呼叫；省略＝不能選 */
  onPick?: (pointer: string, value: number) => void
  /** 目前選中的 JSON Pointer（高亮用） */
  picked?: string
  /** 預設展開幾層 */
  openDepth?: number
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toPrecision(8).replace(/\.?0+$/, ''))

export function SimJsonTree({ value, onPick, picked, openDepth = 2 }: Props) {
  return (
    <div className="font-mono text-[11.5px] leading-[1.55] overflow-x-auto">
      <Node name={null} value={value} path={[]} depth={0} onPick={onPick} picked={picked} openDepth={openDepth} />
    </div>
  )
}

interface NodeProps extends Omit<Props, 'value'> {
  name: string | null
  value: unknown
  path: (string | number)[]
  depth: number
  openDepth: number
}

function Node({ name, value, path, depth, onPick, picked, openDepth }: NodeProps) {
  const [open, setOpen] = useState(depth < openDepth)
  const label = name === null ? null : <span className="text-accent-cyan">{name}</span>
  const pad = { paddingLeft: depth === 0 ? 0 : 14 }

  if (value !== null && typeof value === 'object') {
    const entries: [string | number, unknown][] = Array.isArray(value)
      ? value.map((v, i) => [i, v])
      : Object.entries(value as Record<string, unknown>)
    const brief = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`
    return (
      <div style={pad}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-left hover:bg-bg-card-hover rounded px-0.5">
          <span className="text-text-dim inline-block w-3">{open ? '▾' : '▸'}</span>
          {label}{label && <span className="text-text-dim">: </span>}
          <span className="text-text-dim">{brief}</span>
        </button>
        {open && entries.map(([k, v]) => (
          <Node key={String(k)} name={String(k)} value={v} path={[...path, k]} depth={depth + 1} onPick={onPick} picked={picked} openDepth={openDepth} />
        ))}
      </div>
    )
  }

  const pointer = toPointer(path)
  const isNum = typeof value === 'number' && Number.isFinite(value)
  const selected = isNum && picked === pointer
  return (
    <div style={pad} className={`flex items-center gap-1 ${selected ? 'bg-accent-yellow/15 rounded' : ''}`}>
      <span className="inline-block w-3" />
      {label}{label && <span className="text-text-dim">: </span>}
      <span className={isNum ? 'text-text-primary' : typeof value === 'string' ? 'text-accent-green' : 'text-text-secondary'}>
        {isNum ? fmtNum(value) : JSON.stringify(value)}
      </span>
      {isNum && onPick && (
        <button
          type="button"
          onClick={() => onPick(pointer, value)}
          className={`ml-1 px-1 rounded border text-[10px] ${selected ? 'border-accent-yellow/60 text-accent-yellow' : 'border-border text-text-dim hover:text-text-primary'}`}
          title="把這個數字當成預覽單擊的比對對象"
        >
          {selected ? '比對中' : '選為比對'}
        </button>
      )}
    </div>
  )
}
