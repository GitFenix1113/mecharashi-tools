import { assetUrl } from '../../utils/assets'
import { gameIconCandidates } from '../../utils/gameIcons'
import { FallbackImage } from '../common/FallbackImage'
import type { Component } from '../../types'
import { ComponentsWType } from '../../types/enums'

interface Props {
  comp: Component
  size?: number
}

export function ComponentIcon({ comp, size = 48 }: Props) {
  const isW = comp.componentsWType === ComponentsWType.W
  const outerSrc =
    comp.outerFrameLocal ??
    `/images/components/OuterFrame/statetype_${comp.componentType}${isW ? '_W' : ''}.png`

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <img
        src={assetUrl(outerSrc)}
        alt=""
        className="absolute object-contain"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '80%',
          height: '80%',
        }}
      />
      {/* PLAN-055：技能圖從圖庫取（icon＝官方檔名 key；iconLocal 是舊路徑後備）。外框不是技能圖，維持原路徑 */}
      {(comp.icon || comp.iconLocal) && (
        <FallbackImage
          candidates={gameIconCandidates(comp.icon, comp.iconLocal)}
          alt=""
          className="absolute object-contain"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-51%, -52%) rotate(16deg)',
            width: '48%',
            height: '48%',
          }}
        />
      )}
    </div>
  )
}
