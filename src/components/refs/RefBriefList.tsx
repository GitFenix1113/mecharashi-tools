import type { ReactNode } from 'react'
import type { DescriptionRefs } from '../../types'
import { FallbackImage } from '../common/FallbackImage'
import { RefText } from './RefText'

/**
 * 引用浮窗本文的「速查清單」版型：機甲卡列模組、機師卡列天賦，兩者共用。
 *
 * hover 預覽不可互動、捲不動，描述截三行（clamp）；釘選後才給全文。
 * 巢狀 [xxx] 的 drill 範圍由呼叫端（EntityRefView）的 RefScope 提供。
 */

export function RefBriefSection({ title, loading, loadingText, empty, emptyText, children }: {
  title: string
  loading?: boolean
  loadingText?: string
  empty: boolean
  /** 佔位慣例：沒有資料講「未建檔」，不留白（留白會被讀成「這裡本來就沒有」） */
  emptyText: string
  children: ReactNode
}) {
  return (
    <div className="pt-1">
      <div className="text-[11px] text-text-dim tracking-wider mb-2">{title}</div>
      {loading ? (
        <div className="text-text-dim text-xs py-2">{loadingText ?? '載入中…'}</div>
      ) : empty ? (
        <div className="text-text-dim text-xs py-2">{emptyText}</div>
      ) : (
        <ul className="space-y-2.5">{children}</ul>
      )}
    </div>
  )
}

export function RefBriefRow({ icons, name, badges, text, refs, clamp }: {
  /** 圖示候選（gameIconCandidates 的結果）；空陣列或全數載入失敗時留灰底方塊，版面不塌 */
  icons: string[]
  name: string
  /** 名稱右側的標籤（槽位、等級…） */
  badges?: ReactNode
  text: string
  refs?: DescriptionRefs
  clamp: boolean
}) {
  const box = 'w-7 h-7 rounded-md bg-bg-dark border border-border flex-shrink-0'
  return (
    <li className="flex items-start gap-2.5">
      {icons.length > 0 ? (
        <FallbackImage
          candidates={icons}
          alt={name}
          className={`${box} object-cover`}
          fallback={<div className={box} />}
        />
      ) : <div className={box} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-semibold text-text-primary">{name}</span>
          {badges}
        </div>
        <p className={`text-xs text-text-secondary leading-relaxed whitespace-pre-line mt-0.5 ${clamp ? 'line-clamp-3' : ''}`}>
          <RefText text={text} refs={refs} />
        </p>
      </div>
    </li>
  )
}
