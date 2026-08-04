import { Link } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { FallbackImage } from '../FallbackImage'
import { ModuleBoundPart } from './ModuleBoundPart'
import { imageCandidates } from '../../utils/assets'
import type { ModuleAdopter } from '../../hooks/useModuleAdopters'

/** 縮圖載不到時的退路：機甲名文字 chip。留白等於讓「誰在用」憑空消失，比改版前更糟。 */
function NameChip({ name }: { name: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded border border-border bg-bg-dark text-[13px] text-accent-cyan">
      {name}
    </span>
  )
}

/**
 * 採用此模組的機甲縮圖列（PLAN-044 Phase C）。
 *
 * 圖片一律走 FallbackImage + imageCandidates，自動處理 portrait 缺檔與 PNG→WebP 漂移；
 * 不可改回自己寫 <img src>，那正是先前 57 筆機甲長期破圖的原因。
 */
export function ModuleAdopters({
  adopters,
  boundPart,
  className = '',
}: {
  adopters: ModuleAdopter[]
  /** 一併顯示綁定部位（接在縮圖列尾端） */
  boundPart?: string[] | string | null
  className?: string
}) {
  if (adopters.length === 0) return null

  const stop = (e: MouseEvent) => e.stopPropagation()

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      <span className="text-[14px] text-text-dim shrink-0">採用</span>
      {adopters.map((a) => {
        const chip = <NameChip name={a.name} />
        return (
          <Link
            key={a.id}
            to={`/mechs/${a.id}`}
            title={a.name}
            onClick={stop}
            className="no-underline leading-none"
          >
            {a.mech ? (
              <FallbackImage
                candidates={imageCandidates(a.mech.portrait, `images/mechs/${a.mech.name}.webp`)}
                alt={a.name}
                className="w-9 h-9 rounded-lg object-cover bg-bg-dark border border-border hover:border-accent-cyan transition-colors"
                fallback={chip}
              />
            ) : (
              chip
            )}
          </Link>
        )
      })}
      <ModuleBoundPart boundPart={boundPart} variant="inline" />
    </div>
  )
}
