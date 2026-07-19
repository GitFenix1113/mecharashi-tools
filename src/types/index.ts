// ─── 型別 barrel ─────────────────────────────────────────────────────────────
// 對外維持單一進入點：`import { Pilot, formatWeaponReq } from '@/types'` 不變。
// 實際型別已按領域拆分至同目錄下各檔；新增領域時在此補一行 re-export。
// 注意：enums.ts 與 mechUpgrade.ts 不在此 barrel 內，沿用各自的獨立 import 路徑。

export * from './common'      // 實體引用層：RefType / EntityRef / DescriptionRefs / GlossaryTerm
export * from './buff'        // 技能/Buff 共用：WeaponRequirement / formatWeaponReq / SkillEffect / GameBuff
export * from './pilot'       // 機師：Pilot / PilotSkill(Doc) / PilotTalent / NeuralDrive …
export * from './module'      // 模組：Module / ModuleLevel / ConditionalEffect
export * from './mech'        // 機甲：Mech / MechPart / MechPartsLegacy
export * from './weapon'      // 武器：Weapon / WeaponSkill / *ModEffect
export * from './backpack'    // 背包：Backpack
export * from './component'   // 元件：Component / Condition|FunctionComponent …
export * from './research'    // 科研：GlobalResearch / PilotResearch / *ResearchBonus / UserResearchLevels
export * from './user'        // 用戶/配裝：UserProfile / Build / UserBuild / FloatingModSelection
export * from './grayOps'     // 灰燼行動：GrayOpsRoster / GrayOpsMechEntry
export * from './boss'        // BOSS/關卡：Boss / BossSkill / Stage / StageDropEntry
export * from './changeHistory' // PLAN-030 變更歷史：ChangeHistoryEntry / DeleteSnapshot / ReversePatch
