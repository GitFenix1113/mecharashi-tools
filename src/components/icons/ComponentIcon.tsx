import { assetUrl } from '../../utils/assets'
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
      {comp.iconLocal && (
        <img
          src={assetUrl(comp.iconLocal)}
          alt=""
          className="absolute object-contain"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-51%, -52%) rotate(16deg)',
            width: '48%',
            height: '48%',
          }}
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
      )}
    </div>
  )
}
