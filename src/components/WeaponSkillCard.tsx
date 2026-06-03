import { useState } from 'react'
import { WeaponActivationBadge } from './WeaponBadges'
import { RefText } from './RefText'
import { assetUrl } from '../utils/assets'
import type { WeaponSkill } from '../types'

function SkillIcon({ iconLocal, name }: { iconLocal?: string; name: string }) {
  const [err, setErr] = useState(false)
  if (err || !iconLocal) {
    return (
      <div className="w-10 h-10 rounded-lg bg-bg-dark border border-border flex items-center justify-center text-text-dim text-xs flex-shrink-0">
        技
      </div>
    )
  }
  return (
    <img
      src={assetUrl(iconLocal)}
      alt={name}
      className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
      onError={() => setErr(true)}
    />
  )
}

export function WeaponSkillCard({ skill }: { skill: WeaponSkill }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <div className="flex items-start gap-3">
        <SkillIcon iconLocal={skill.iconLocal} name={skill.name} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <WeaponActivationBadge activation={skill.activation} />
            <h4 className="font-bold text-sm text-text-primary">{skill.name}</h4>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">
            <RefText text={skill.description} refs={skill.descriptionRefs} />
          </p>
        </div>
      </div>
    </div>
  )
}
