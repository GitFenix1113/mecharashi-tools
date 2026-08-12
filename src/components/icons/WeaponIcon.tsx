import { useState } from 'react'
import { assetUrl } from '../../utils/assets'

interface WeaponIconProps {
  icon?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
  isExclusive?: boolean
}

export function WeaponIcon({ icon, name, size = 'md', isExclusive = false }: WeaponIconProps) {
  const [failed, setFailed] = useState(false)
  const dim = size === 'lg' ? 'w-16 h-16' : size === 'md' ? 'w-10 h-10' : 'w-8 h-8'

  if (isExclusive) {
    return (
      <div className={`${dim} relative flex-shrink-0`}>
        <div
          className="w-full h-full rounded-lg overflow-hidden flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #2e1065 0%, #1c1a2e 50%, #451a03 100%)',
            boxShadow: '0 0 0 2px #d97706cc, 0 0 8px 1px #d9770640',
          }}
        >
          {!icon || failed ? (
            <span className="text-amber-200/60 text-[13px]">武</span>
          ) : (
            <img
              src={assetUrl(icon)}
              alt={name}
              className="w-full h-full object-contain"
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </div>
    )
  }

  if (!icon || failed) {
    return (
      <div className={`${dim} rounded-lg bg-bg-dark border border-border flex items-center justify-center flex-shrink-0`}>
        <span className="text-text-dim text-[13px]">武</span>
      </div>
    )
  }

  return (
    <img
      src={assetUrl(icon)}
      alt={name}
      className={`${dim} rounded-lg object-contain bg-bg-dark border border-border flex-shrink-0`}
      onError={() => setFailed(true)}
    />
  )
}
