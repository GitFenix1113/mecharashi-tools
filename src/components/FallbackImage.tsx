import { useState } from 'react'
import type { ImgHTMLAttributes, ReactNode } from 'react'

/**
 * 逐層退回的 <img>。
 *
 * candidates 是 utils/assets 的 imageCandidates() 產生的有序候選清單：載入失敗就換下一個，
 * 全部用盡才渲染 fallback（預設什麼都不渲染）。取代原本散在各頁、只能退一層的
 * `onError` + `dataset.fb` 寫法。
 */
type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  candidates: string[]
  /** 候選全數失敗時顯示的內容 */
  fallback?: ReactNode
}

export function FallbackImage({ candidates, fallback = null, ...imgProps }: Props) {
  const key = candidates.join('|')
  // key 一起存進 state：candidates 換人時要把索引歸零，否則切到另一台機甲會沿用上一台的
  // 失敗進度、直接跳過本來會成功的第一個候選。用 render 期間調整 state（React 官方
  // 「prop 改變時調整 state」模式）而非 useEffect，少一輪 render 也不會閃圖。
  const [state, setState] = useState({ key, idx: 0 })
  if (state.key !== key) setState({ key, idx: 0 })

  const idx = state.key === key ? state.idx : 0
  if (idx >= candidates.length) return <>{fallback}</>

  return (
    <img
      {...imgProps}
      src={candidates[idx]}
      onError={() => setState((s) => (s.key === key ? { key, idx: s.idx + 1 } : s))}
    />
  )
}
