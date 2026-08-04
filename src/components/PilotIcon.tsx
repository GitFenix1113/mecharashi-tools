import type { MouseEventHandler, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FallbackImage } from './FallbackImage'
import { imageCandidates } from '../utils/assets'
import type { PilotBrief } from '../hooks/useFirestore'

type PilotIconSize = 'xs' | 'sm' | 'md'

const DIM: Record<PilotIconSize, string> = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
}

/**
 * 機師頭像（圓形裁切）。
 *
 * 立繪是直式全身圖，這裡用 object-cover + object-top 取上緣，等同於「只露頭」的頭像。
 * 圖片來源依 portraitUrl（官方 CDN）→ portrait（本地）逐層退回，全數失敗才顯示 fallback。
 */
export function PilotIcon({
  pilot,
  size = 'sm',
  className = '',
  fallback,
}: {
  pilot: PilotBrief
  size?: PilotIconSize
  className?: string
  fallback?: ReactNode
}) {
  const candidates = imageCandidates(pilot.portraitUrl, pilot.portrait)
  if (candidates.length === 0) return <>{fallback ?? null}</>

  return (
    <FallbackImage
      candidates={candidates}
      alt={pilot.name}
      loading="lazy"
      className={`${DIM[size]} rounded-full object-cover object-top bg-bg-dark flex-shrink-0 ${className}`}
      fallback={fallback}
    />
  )
}

/**
 * 專屬武器 → 對應機師的連結。以頭像取代原本的機師名稱顯示（PLAN 外的小改版）。
 *
 * 沒有立繪或圖片全數載入失敗時退回顯示名稱文字，避免連結變成看不見的空洞。
 */
export function ExclusivePilotLink({
  pilotId,
  pilot,
  size = 'sm',
  prefix,
  className = '',
  onClick,
}: {
  pilotId: string
  pilot: PilotBrief | undefined
  size?: PilotIconSize
  /** 頭像前的說明文字（如「専武：」）；退回文字模式時一併保留 */
  prefix?: string
  className?: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}) {
  if (!pilot) return null

  const nameText = <span className="text-[13px] text-accent-pink group-hover:underline">{pilot.name}</span>

  return (
    <Link
      to={`/pilots/${pilotId}`}
      onClick={onClick}
      title={`專屬機師：${pilot.name}`}
      className={`group inline-flex items-center gap-1 align-middle ${className}`}
    >
      {prefix && <span className="text-[13px] text-accent-pink">{prefix}</span>}
      <PilotIcon
        pilot={pilot}
        size={size}
        className="ring-1 ring-accent-pink/50 group-hover:ring-accent-pink transition-all"
        fallback={nameText}
      />
    </Link>
  )
}
