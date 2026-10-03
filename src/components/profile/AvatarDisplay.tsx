import { useState } from 'react'
import { usePilot } from '../../hooks/useFirestore'
import { assetUrl, pilotPortraitPath } from '../../utils/assets'
import type { UserProfile } from '../../types'

type AvatarProfile = Pick<UserProfile, 'displayName' | 'gameNickname' | 'avatarType' | 'avatarUrl' | 'avatarPilotId' | 'photoURL'>

const SIZE: Record<string, string> = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-12 h-12 text-lg',
  lg: 'w-20 h-20 text-3xl',
}

const COLORS = [
  { bg: 'bg-accent-orange/20', text: 'text-accent-orange', border: 'border-accent-orange/40' },
  { bg: 'bg-accent-green/20',  text: 'text-accent-green',  border: 'border-accent-green/40'  },
  { bg: 'bg-accent-purple/20', text: 'text-accent-purple', border: 'border-accent-purple/40' },
  { bg: 'bg-accent-cyan/20',   text: 'text-accent-cyan',   border: 'border-accent-cyan/40'   },
  { bg: 'bg-accent-yellow/20', text: 'text-accent-yellow', border: 'border-accent-yellow/40' },
  { bg: 'bg-accent-red/20',    text: 'text-accent-red',    border: 'border-accent-red/40'    },
]

function nameColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return COLORS[hash % COLORS.length]
}

interface Props {
  profile: AvatarProfile
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function AvatarDisplay({ profile, size = 'md', className = '' }: Props) {
  const [imgError, setImgError] = useState(false)
  const isPilotMode = profile.avatarType === 'pilot'
  const { data: pilot } = usePilot(isPilotMode ? (profile.avatarPilotId ?? undefined) : undefined)

  const sizeClass = SIZE[size] ?? SIZE.md
  const base = `${sizeClass} rounded-full object-cover shrink-0 ${className}`
  const displayLabel = profile.gameNickname || profile.displayName
  const onError = () => setImgError(true)

  if (!imgError && profile.avatarType === 'upload' && profile.avatarUrl) {
    return (
      <img src={profile.avatarUrl} alt={displayLabel}
        className={`${base} border-2 border-border`}
        onError={onError} draggable={false} />
    )
  }

  const pilotAvatar = pilotPortraitPath(pilot)
  if (!imgError && profile.avatarType === 'pilot' && pilot && pilotAvatar) {
    return (
      <img src={assetUrl(pilotAvatar)} alt={pilot.name}
        className={`${base} border-2 border-border`}
        onError={onError} draggable={false} />
    )
  }

  if (!imgError && profile.photoURL && (profile.avatarType === 'google' || !profile.avatarType)) {
    return (
      <img src={profile.photoURL} alt={displayLabel}
        className={`${base} border-2 border-border`}
        onError={onError} draggable={false} />
    )
  }

  const color = nameColor(displayLabel)
  const initial = (displayLabel?.[0] ?? '?').toUpperCase()

  return (
    <div className={`${base} flex items-center justify-center font-bold border-2 ${color.bg} ${color.text} ${color.border}`}>
      {initial}
    </div>
  )
}
