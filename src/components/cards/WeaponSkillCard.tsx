import { WeaponActivationBadge } from '../badges/WeaponBadges'
import { RefText } from '../refs/RefText'
import { SkillIcon } from '../icons/SkillIcon'
import type { ResolvedWeaponSkill } from '../../utils/weaponSkills'

// PLAN-032：收 ResolvedWeaponSkill 而非原始 WeaponSkill——呼叫端一律先跑
// resolveWeaponSkills()，本元件不需要知道那筆技能是內嵌還是引用。
export function WeaponSkillCard({ skill, fusedLabel }: { skill: ResolvedWeaponSkill; fusedLabel?: string }) {
  return (
    <div className={`bg-bg-card border rounded-xl p-4 ${fusedLabel ? 'border-accent-yellow/40' : 'border-border'}`}>
      <div className="flex items-start gap-3">
        <SkillIcon icon={skill.icon} iconLocal={skill.iconLocal} name={skill.name} placeholder="技" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <WeaponActivationBadge activation={skill.activation} />
            <h4 className="font-bold text-sm text-text-primary">{skill.name}</h4>
            {fusedLabel && (
              <span className="px-1.5 py-0.5 rounded text-[11px] text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30">
                {fusedLabel}
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary leading-relaxed">
            <RefText text={skill.description} refs={skill.descriptionRefs} />
          </p>
        </div>
      </div>
    </div>
  )
}
