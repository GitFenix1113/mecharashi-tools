// 圖示「誰在用」反查 —— PLAN-055 B-2
//
// 圖庫是扁平的（一張圖一份），所以「這張圖用在哪」不再由資料夾表達，改從資料算出來：
// 比資料夾精確（同一張被動圖可以同時是技能、模組、元件的圖），也不會跟資料脫節。
//
// 值一律經過 keyFromValue＋canonicalIconKey 正規化：裸 key、各種舊路徑、遠端 URL、
// 舊編號都會算到同一張圖上。中文佔位名不是圖庫 key，不列入（C-1 會換成官方 key）。
//
// ⚠ 圖示不等於技能：同一張圖本來就會被多個技能共用（main_1106＝乘勝追擊／崩山／拘敵猛襲），
//   這裡只回答「誰長這樣」，不拿來推導任何關聯。
import type {
  BackpackSkillDoc, Component, GameBuff, MechForm, Module, NeuralDriveAbility, Pilot, PilotSkillDoc, Weapon,
} from '../types'
import { canonicalIconKey, isLibraryKey, keyFromValue } from './gameIcons.ts'

export type IconUserKind = '技能' | '天賦' | '神經驅動' | '模組' | '元件' | '背包技能' | '形態' | 'BUFF' | '武器技能'

export interface IconUser {
  kind: IconUserKind
  /** 文件 id（天賦沒有自己的文件，用機師 id） */
  id: string
  name: string
  /** 持有者（機師／武器名），最多列三個；多的以「等 N」收尾 */
  owner?: string
}

export interface IconUsageSource {
  pilots?: Pilot[]
  pilotSkills?: PilotSkillDoc[]
  neuralDriveAbilities?: NeuralDriveAbility[]
  modules?: Module[]
  components?: Component[]
  backpackSkills?: BackpackSkillDoc[]
  forms?: MechForm[]
  buffs?: GameBuff[]
  weapons?: Weapon[]
}

/** 值 → 圖庫 key（經舊編號別名換算）；不是圖庫 key 回 undefined */
export function usageKey(value: string | null | undefined): string | undefined {
  const k = keyFromValue(value)
  return isLibraryKey(k) ? canonicalIconKey(k) : undefined
}

function ownerLabel(names: string[]): string | undefined {
  const uniq = [...new Set(names.filter(Boolean))]
  if (!uniq.length) return undefined
  return uniq.length > 3 ? `${uniq.slice(0, 3).join('、')} 等 ${uniq.length}` : uniq.join('、')
}

export function buildIconUsage(src: IconUsageSource): Map<string, IconUser[]> {
  const out = new Map<string, IconUser[]>()
  const add = (values: (string | null | undefined)[], user: IconUser) => {
    const keys = new Set(values.map(usageKey).filter((k): k is string => !!k))
    for (const k of keys) {
      const list = out.get(k) ?? []
      if (!list.some((u) => u.kind === user.kind && u.id === user.id)) list.push(user)
      out.set(k, list)
    }
  }

  // 技能的持有者：機師（pilots.skills）與武器（weapons.skills 的引用）
  const skillOwners = new Map<string, string[]>()
  const own = (skillId: string, name: string) => skillOwners.set(skillId, [...(skillOwners.get(skillId) ?? []), name])
  for (const p of src.pilots ?? []) {
    for (const s of p.skills ?? []) {
      if (typeof s === 'string') own(s, p.name)
      else add([s.icon, s.iconLocal], { kind: '技能', id: p.id, name: s.name, owner: p.name })   // 內嵌未遷移者
    }
  }
  for (const w of src.weapons ?? []) {
    for (const s of w.skills ?? []) {
      if ('skillId' in s) own(s.skillId, w.name)
      else add([s.icon, s.iconLocal], { kind: '武器技能', id: w.id, name: s.name, owner: w.name })   // 內嵌未遷移者
    }
  }
  for (const s of src.pilotSkills ?? []) {
    add([s.icon, s.iconLocal], { kind: '技能', id: s.id, name: s.name, owner: ownerLabel(skillOwners.get(s.id) ?? []) })
  }

  // 天賦與神經驅動（能力的持有者＝哪些機師的哪個分區用到它）
  const ndOwners = new Map<string, string[]>()
  for (const p of src.pilots ?? []) {
    for (const t of p.talents ?? []) add([t.icon, t.iconLocal], { kind: '天賦', id: p.id, name: t.name, owner: p.name })
    for (const d of p.neuralDrive ?? []) {
      for (const lv of d.levels ?? []) if (lv.abilityId) ndOwners.set(lv.abilityId, [...(ndOwners.get(lv.abilityId) ?? []), p.name])
    }
  }
  for (const a of src.neuralDriveAbilities ?? []) {
    add([a.icon, a.iconLocal], { kind: '神經驅動', id: a.id, name: a.name, owner: ownerLabel(ndOwners.get(a.id) ?? []) })
  }

  for (const m of src.modules ?? []) add([m.icon], { kind: '模組', id: m.id, name: m.name })
  for (const c of src.components ?? []) add([c.icon, c.iconLocal], { kind: '元件', id: c.id, name: c.name })
  for (const b of src.backpackSkills ?? []) {
    add([b.icon, ...(b.levels ?? []).map((l) => l.icon)], { kind: '背包技能', id: b.id, name: b.name })
  }
  const pilotName = new Map((src.pilots ?? []).map((p) => [p.id, p.name]))
  for (const f of src.forms ?? []) add([f.icon], { kind: '形態', id: f.id, name: f.name, owner: pilotName.get(f.pilotId) })
  for (const b of src.buffs ?? []) add([b.icon, ...(b.levels ?? []).map((l) => l.icon)], { kind: 'BUFF', id: b.id, name: b.name })

  return out
}

/** 搜尋用：這張圖的所有使用者名稱與持有者攤平成一串小寫文字 */
export function usageSearchText(users: IconUser[] | undefined): string {
  return (users ?? []).map((u) => `${u.name} ${u.owner ?? ''}`).join(' ').toLowerCase()
}
