import type { Pilot, PilotSkill, PilotSkillDoc } from '../types'

/**
 * PLAN-004 技能庫抽離 — 過渡期解析工具。
 *
 * pilot.skills 在遷移過程中可能是兩種格式：
 *   - 舊：嵌入的 PilotSkill 物件陣列
 *   - 新：pilotSkills 集合的文件 ID 字串陣列（單一資料源）
 * 本工具把兩種都解析成一致的 PilotSkillDoc 陣列，前端不需在意目前是哪種格式。
 */

/** 由 pilotSkills 集合建立 id→doc 快速查表 */
export function buildSkillMap(pilotSkills: PilotSkillDoc[]): Map<string, PilotSkillDoc> {
  return new Map(pilotSkills.map(s => [s.id, s]))
}

/** 嵌入 PilotSkill（無頂層 id）轉成 PilotSkillDoc 形狀（id 留空，標記為未遷移） */
export function embeddedToDoc(s: PilotSkill): PilotSkillDoc {
  return { id: '', ...s }
}

/** PilotSkillDoc → 嵌入用 PilotSkill（移除頂層 id）；過渡前舊格式儲存用 */
export function docToEmbedded(d: PilotSkillDoc): PilotSkill {
  const { id, ...rest } = d
  void id
  return rest
}

/** 判斷某筆 skills 條目是否已是「ID 字串」（新格式） */
export function isSkillId(entry: string | PilotSkill): entry is string {
  return typeof entry === 'string'
}

/**
 * 解析 pilot.skills → PilotSkillDoc[]。
 * - ID 字串：查 skillMap；查不到則略過（優雅降級，不報錯）
 * - 嵌入物件：原地轉為 doc 形狀
 */
export function resolvePilotSkills(
  skills: Pilot['skills'] | undefined,
  skillMap: Map<string, PilotSkillDoc>,
): PilotSkillDoc[] {
  if (!Array.isArray(skills)) return []
  const out: PilotSkillDoc[] = []
  for (const entry of skills) {
    if (isSkillId(entry)) {
      const doc = skillMap.get(entry)
      if (doc) out.push(doc)
    } else {
      out.push(embeddedToDoc(entry))
    }
  }
  return out
}
