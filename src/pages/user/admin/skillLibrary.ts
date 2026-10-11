// 技能庫（pilotSkills 集合）的後台共用小工具：技能管理分頁、武器技能分頁、武器編輯器三處共用。
// 獨立成 .ts 而不放在 SkillAdmin.tsx：元件檔只匯出元件，Vite 的 Fast Refresh 才不會整頁重載
// （eslint react-refresh/only-export-components）。

import type { PilotSkillDoc } from '../../../types'
import { SkillType } from '../../../types/enums'
import { docExists } from '../../../lib/firestoreApi'
import { idPrefixCasings } from '../../../utils/idSlug'

/** 新技能的預設值。`domain` 給「武器技能」分頁與武器編輯器用（未填＝機師技能，PLAN-032） */
export function makeDefaultSkill(id: string, name = '', domain?: PilotSkillDoc['domain']): PilotSkillDoc {
  return {
    id,
    name,
    type: SkillType.PASSIVE,
    description: '',
    descriptionRefs: {},
    icon: '',
    effects: [],
    buffIds: [],
    manual: true,
    ...(domain && { domain }),
  }
}

/**
 * 伺服器端撞 ID 檢查：回傳已存在的那份文件 id（沒撞到回 undefined）。
 *
 * PLAN-032 M0：**大小寫兩種前綴都要查**。技能庫現況是 `SKILL_` 大寫 134 筆 /
 * `skill_` 小寫 512 筆的混血（歷史遺留），而 makeEntityId 只產得出小寫形式——
 * 只查小寫等於對那 134 筆完全無防呆，`SKILL_故障植入` 存在時仍會放行建出
 * `skill_故障植入`，變成同名兩份。Firestore 文件 ID 區分大小寫，這兩筆是真的兩份文件。
 * （in-memory 那道 findEntityClash 本來就不分大小寫，這裡是補齊伺服器端。）
 */
export async function findServerSkillClash(id: string): Promise<string | undefined> {
  const hits = await Promise.all(
    idPrefixCasings(id).map(async (cand) => (await docExists('pilotSkills', cand)) ? cand : null),
  )
  return hits.find((h): h is string => !!h)
}
