import type { PatchVersion } from '../../data/patchVersions'
import { resolveBannerSrc } from '../../utils/assets'
import VersionGanttPanel from './VersionGanttPanel'

interface Props {
  version: PatchVersion
  isExpanded: boolean
  /** Server side currently displayed in the Gantt panel. */
  side?: 'tw' | 'cn'
}

export default function VersionExpandedPanel({ version, isExpanded, side = 'tw' }: Props) {
  const bannerSrc = version.bannerImage
    ? resolveBannerSrc(version.bannerImage)
    : null

  return (
    <div
      className="flex-1 min-h-0 flex flex-col overflow-hidden transition-opacity duration-300 ease-in-out"
      style={{ opacity: isExpanded ? 1 : 0 }}
    >
      <div className="relative overflow-hidden flex-1 min-h-0 flex flex-col rounded-xl">

        {/* ── Background layer ── */}
        <div className="absolute inset-0 pointer-events-none select-none">
          <div className="absolute inset-0 bg-gradient-to-br from-bg-card/30 to-bg-card-hover/60" />
          {bannerSrc && (
            <img
              src={bannerSrc}
              alt=""
              className="absolute inset-0 w-full h-full object-cover object-top opacity-80"
              draggable={false}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-bg-dark/20 via-bg-dark/35 to-bg-dark/65" />
        </div>

        <div className="relative z-10 pt-3 pb-3 px-3 flex-1 min-h-0 flex flex-col">
          <VersionGanttPanel version={version} side={side} />
        </div>

      </div>
    </div>
  )
}
