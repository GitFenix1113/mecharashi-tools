import type { ResolvedWeaponSkill } from '../../utils/weaponSkills'
import { gameIconCandidates } from '../../utils/gameIcons'
import { ACTIVATION_CONFIG } from '../badges/WeaponBadges'
import { RefBriefSection, RefBriefRow } from './RefBriefList'

/**
 * 武器引用浮窗的技能清單（2026-10-11 起取代原本的武器故事）。
 *
 * 與機甲卡列模組、機師卡列天賦同一個決定：引用武器時想知道的是「這把有什麼技能」，不是故事。
 * 主要用途是武器詳情頁的「同類專武」——滑過去就能比較同種類其他專武的技能。
 *
 * hover 也給**全文、不截三行**：專武 51 把全是 3～4 技，最長的糖衣毀滅者 4 技合計 242 字，
 * 300px 寬的浮窗全文約 480px 高，1366×768 的 70vh 也裝得下。截掉就得再點開才比得了，違背用途。
 */
export function RefWeaponSkills({ skills, rarity, loading }: {
  skills: ResolvedWeaponSkill[]
  rarity: string
  /** 技能庫（pilotSkills）還沒到——引用格式的技能此時解析不出來，不能當成「沒有技能」 */
  loading: boolean
}) {
  // A／B 與多數 S 武器在遊戲裡本來就沒有技能；SS／S+ 全都有，空的只會是還沒建檔（佔位慣例）
  const emptyText = rarity === 'SS' || rarity === 'S+' ? '技能未建檔' : '此武器沒有技能'
  return (
    <RefBriefSection title="武器技能" loading={loading} empty={skills.length === 0} emptyText={emptyText}>
      {skills.map((s, i) => {
        const act = ACTIVATION_CONFIG[s.activation]
        return (
          <RefBriefRow
            key={`${s.name}:${i}`}
            icons={gameIconCandidates(s.icon, s.iconLocal)}
            name={s.name}
            badges={act && (
              <span className={`px-1.5 py-px rounded text-[11px] border ${act.className}`}>{act.label}</span>
            )}
            text={s.description}
            refs={s.descriptionRefs}
            clamp={false}
          />
        )
      })}
    </RefBriefSection>
  )
}
