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
  // PLAN-041：機師形態
  'forms',
  // PLAN-042-A：機師故事館逸聞章節
  'pilotLore',
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

/**
 * **跳過 localStorage 快取層**的集合（PLAN-042-A A-2）。
 *
 * 這些集合仍走記憶體快取與版本 gate，只是不落 localStorage —— 差別是
 * 「本 session 內免費、關掉分頁後重讀一次」，而不是功能缺失。
 *
 * 為什麼需要這份名單：實測全集合快取展開後已佔 4.2–4.5 MB（UTF-16 計，pilots 一個
 * 就 2.09 MB），逼近 Chrome 約 5 MB 的 origin 上限。而配額超限**不會只讓最後那個
 * 集合寫失敗** —— setItem 一旦開始拋 QuotaExceededError，之後每個集合每次都寫不進去、
 * 每次都得重讀，症狀是全站快取效益一起賠掉，且零錯誤訊息（原本的 catch 是空的）。
 *
 * pilotLore 是全站成長曲線最陡的集合：89 人 × 4 PART × 500 字外推約 534 KB raw，
 * 而它同時是「純欣賞、低流量、一個 session 通常只看幾位」的資料 —— 快取命中率最低、
 * 佔用增幅最大，正是該讓出這 5 MB 的那一個。
 *
 * ⚠ 刻意**不設**通用體積上限：既有最大的 pilots 就有 2.09 MB，任何「合理」的上限
 *   不是誤傷它、就是高到形同虛設。名單是明示的編輯決策，上限則會靜默改變既有集合的行為。
 *   配額真的爆掉時，改由 GameDataContext 的 writeCache 出一行 console 警告（不再靜默）。
 */
export const NO_LOCAL_CACHE_KEYS: readonly CollectionKey[] = ['pilotLore']

/** 該集合是否跳過 localStorage 層。 */
export const skipsLocalCache = (key: CollectionKey): boolean =>
  NO_LOCAL_CACHE_KEYS.includes(key)
