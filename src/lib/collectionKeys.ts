// 遊戲資料集合鍵值（單一資料源）
//
// 抽成獨立、**零依賴**的模組（不 import React / Firebase），原因有二：
//   ① 讓 node --test 讀得到 —— GameDataContext.tsx 一 import 就會拉進 React 與 firebase，
//      單元測試載不起來，於是「集合清單有沒有同步」這件事長期無人看守。
//   ② 這份清單被**四個地方**各自複製過，每一份都曾經或正在漂移：
//      · workers/src/index.ts 的 ARRAY_COLLECTIONS（漏了 → 正式站該集合 404，本機全綠）
//      · scripts/bump-data-version.mjs 的 KNOWN_KEYS（漏了 → 整條指令 exit(1)，一個都沒 bump）
//      · src/utils/entityRefs.ts 的 SPECS（漏了 → 級聯刪除靜默漏清）
//      · 各測試檔自建的 scanData helper（漏了 → 斷言全部改測「未完整掃描」分支卻仍是綠的）

/** 以陣列形式儲存的集合（每份文件一個 id）。 */
export const ARRAY_COLLECTION_KEYS = [
  'pilots', 'mechs', 'modules', 'weapons',
  'backpacks', 'backpackSkills', 'components',
  'buffs', 'pilotSkills', 'neuralDriveAbilities', 'glossaryTerms',
] as const

/** 單一文件（singleton）集合；Worker 代理與快取層都走另一條分支。 */
export const SINGLETON_COLLECTION_KEYS = ['globalResearch', 'grayOpsRoster'] as const

export type ArrayCollectionKey = typeof ARRAY_COLLECTION_KEYS[number]
export type SingletonCollectionKey = typeof SINGLETON_COLLECTION_KEYS[number]
export type CollectionKey = ArrayCollectionKey | SingletonCollectionKey

export const ALL_COLLECTION_KEYS: CollectionKey[] = [
  ...ARRAY_COLLECTION_KEYS,
  ...SINGLETON_COLLECTION_KEYS,
]
