import type { PatchVersion } from '../../data/patchVersions'
import { resolveBannerSrc } from '../../utils/assets'

interface Props {
  version: PatchVersion
  onExpand: (e: React.MouseEvent<HTMLButtonElement>) => void
}

export default function VersionDot({ version, onExpand }: Props) {
  const isCurrent = version.isTwCurrent
  const isPredicted = !isCurrent && (version.upper.twIsPredicted || version.lower.twIsPredicted)

  const borderClass = isCurrent
    ? 'border-2 border-accent-green shadow-[0_0_10px_rgba(34,197,94,0.35)]'
    : isPredicted
    ? 'border border-dashed border-accent-cyan/70'
    : 'border border-border'

  return (
    <button
      onClick={onExpand}
      className={`
        group relative w-10 h-10 shrink-0 rounded-full overflow-visible
        bg-bg-card-hover transition-transform duration-300 ease-out
        hover:scale-[1.5] z-10 hover:z-20
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange
        ${borderClass}
      `}
      aria-label={`查看 v${version.version} 詳情`}
    >
      {/* Inner circle (clips image) */}
      <span className="absolute inset-0 rounded-full overflow-hidden">
        {version.bannerImage && (
          <img
            src={resolveBannerSrc(version.bannerImage)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            draggable={false}
          />
        )}
        <span className={`
          absolute inset-0 flex items-center justify-center
          text-[7px] font-bold font-[Orbitron,sans-serif] leading-tight text-center px-0.5
          transition-opacity duration-200
          ${version.bannerImage ? 'group-hover:opacity-0' : ''}
          ${isCurrent ? 'text-accent-green' : isPredicted ? 'text-accent-cyan' : 'text-text-dim'}
        `}>
          v{version.version}
        </span>
      </span>

      {/* Current badge */}
      {isCurrent && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-accent-green rounded-full flex items-center justify-center shadow z-10">
          <span className="text-[6px] text-bg-dark font-black leading-none">★</span>
        </span>
      )}
    </button>
  )
}
