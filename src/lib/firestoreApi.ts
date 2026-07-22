// ─── Firestore API barrel ────────────────────────────────────────────────────
// 對外維持單一進入點：`import { getPilots, updatePilot } from '../lib/firestoreApi'` 不變。
// 實際讀寫邏輯已按集合拆分至 ./api/ 下各檔；共用基礎件在 ./api/firestoreCore。
// 新增集合時：在 ./api/ 建對應檔，並於此補一行 re-export。

export * from './api/firestoreCore'   // fetchCollection / fetchDocument / docExists / getCollectionPage / stripUndefined（+ 分頁型別）
export * from './api/versions'        // DataVersions / getDataVersions / bumpDataVersion
export * from './api/pilots'          // getPilots / getPilot / getPilotsByClass / updatePilot
export * from './api/skills'          // getPilotSkills / updatePilotSkill / deletePilotSkill
export * from './api/neuralDriveAbilities' // getNeuralDriveAbilities / updateNeuralDriveAbility
export * from './api/research'        // getGlobalResearch / getPilotResearch / getAllPilotResearch
export * from './api/mechs'           // getMechs / getMech / getMechsByArmorType / updateMech
export * from './api/modules'         // getModules / getAvailableModules / getModulesByMech / updateModule
export * from './api/weapons'         // getWeapons / getWeapon / updateWeapon
export * from './api/backpacks'       // getBackpacks / updateBackpack / getBackpacksPage
export * from './api/components'      // getComponents / updateComponent
export * from './api/buffs'           // getBuffs / updateBuff / deleteBuff
export * from './api/glossary'        // getGlossaryTerms / updateGlossaryTerm / deleteGlossaryTerm
export * from './api/grayOps'         // getGrayOpsRoster / updateGrayOpsRoster
// PLAN-030 變更歷史：後台專用稽核 log。不進 CollectionKey / GameDataContext（見計畫書決策一）
export * from './api/changeHistory'   // logChange / logChangeOrThrow / getChangeHistoryPage
export * from './api/cascadeDelete'    // planCascadeDelete / commitCascadeDelete / cascadeDelete（+ 兩個錯誤型別）
export * from './api/restore'          // planRestore / commitRestore（快照還原，PLAN-030 Phase F）
