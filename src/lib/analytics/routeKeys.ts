// ── 頁面 key 推導與顯示標籤（PLAN-046 決策八／九）───────────────────────────
//
// 設計重點有二，都是為了避免「新增頁面後統計靜默失效」這個最糟的失敗模式：
//
// ① **key 由路由樣板自動推導**，不是手維護的對照表。新增頁面時統計自動涵蓋，
//    不需要任何額外動作 —— 忘記不了，因為根本沒有東西要記得做。
//
// ② **Worker 端刻意不放這份名單**。若 Worker 也持有一份「合法 key 清單」，就是原封
//    不動重演 PLAN-043 的雙名單不同步事故（漏一個 key → 正式站壞、本機全綠）。
//    Worker 改用「格式正則 + 數量上限」的無名單防護：它只問「這個 key 會不會造成
//    傷害」，不問「這個 key 合不合法」。不同步的後果因此從**資料遺失**降級成**顯示雜訊**。
//
// ROUTE_PATTERNS 仍需與 App.tsx 一致（matchRoutes 要靠它做樣板比對），但這件事由
// routeKeys.test.ts 用測試釘死：漏登記 → npm test 直接失敗並指名是哪條路由，
// 而 pre-push hook 會擋下 —— 靜默失敗被轉成 build 期錯誤。

/**
 * 全站路由樣板。**必須與 src/App.tsx 的 <Route path> 一致**，由 routeKeys.test.ts 斷言。
 *
 * 用途是餵給 react-router 的 matchRoutes()：本專案用的是元件式路由
 * （<BrowserRouter><Routes>），**不是 data router**，因此 useMatches() 不可用
 * （它只在 RouterProvider 下有效，誤用會直接拋錯）。matchRoutes 接受純物件陣列，
 * 能在不改動路由架構的前提下取得「命中的樣板」而非「實際網址」。
 */
export const ROUTE_PATTERNS: readonly string[] = [
  '/',
  '/pilots',
  '/pilots/:id',
  '/mechs',
  '/mechs/:id',
  '/weapons',
  '/weapons/:id',
  '/backpacks',
  '/modules',
  '/components',
  // 版本情報三分頁（PLAN-050 A-1）。'/versions' 本身只是導向 quick 的 index route，
  // 但樣板存在就要登記 —— 直接輸入網址的人會命中它。
  '/versions',
  '/versions/quick',
  '/versions/grayops',
  '/versions/timeline',
  '/versions/timeline/:version',
  // 機師故事館（PLAN-042-A）。'/lore' 是真的有內容的館首頁（89 張卡片的牆），
  // **不是**只做轉址的 index route —— 因此不進 UNTRACKED_EXACT，照常計數。
  '/lore',
  '/lore/pilots/:id',
  '/lore/pilots/:id/:part',
  '/simulator',
  '/research',
  '/news',
  '/guides',
  '/tools',
  '/documents',
  '/tools/rainbow-planner',
  '/guides/component-drops',
  '/debug/storage',
  '/connectivity',
  '/profile',
  '/admin',
  '/admin/versions',
  '/admin/versions/:versionId',
  '/admin/history',
  '/admin/system-log',
  '/admin/analytics',
  '/admin/announcements',
  '/admin/lore',
  '*',
]

/** 不納入統計的樣板前綴：後台不是使用者行為，量它只會污染頁面熱度排行。 */
const UNTRACKED_PREFIXES = ['/admin']

/**
 * 不納入統計的**完整樣板**（不含其下層）。
 *
 * `/versions` 是只做轉址的 index route（`<Navigate to="quick" replace />`），
 * 使用者永遠停不到那個網址上 —— 記它等於每次都多算一筆幽靈瀏覽，
 * 而且會讓「三個檢視各佔多少」這個 PLAN-050 A-6 唯一要問的問題失真。
 */
const UNTRACKED_EXACT = new Set(['/versions'])

/** 該樣板是否納入統計。 */
export function isTracked(pattern: string): boolean {
  if (UNTRACKED_EXACT.has(pattern)) return false
  return !UNTRACKED_PREFIXES.some((p) => pattern === p || pattern.startsWith(`${p}/`))
}

/**
 * 路由樣板 → 統計 key。
 *
 * 規則：動態片段（:id）一律折成 `detail`，其餘片段原樣串接。
 * 這確保 `/pilots/艾達` 與 `/pilots/露娜` 都記成 `pilots_detail` ——
 * 若用實際網址當 key，byRoute 這個 map 會長出上百個鍵並撐爆日文件。
 * 個別機師的熱度另外存進 analyticsEntity（見 track.ts）。
 *
 * 產出必定滿足 Worker 端的格式防護 `^[a-z][a-z0-9_]{0,39}$`。
 */
export function toPageKey(pattern: string): string {
  if (pattern === '/') return 'home'
  if (pattern === '*' || pattern === '/*') return 'notfound'
  const key = pattern
    .replace(/^\//, '')
    .split('/')
    .map((seg) => (seg.startsWith(':') ? 'detail' : seg))
    .join('_')
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 40)
  // 極端情況（樣板全是非 ASCII）會產出空字串或數字開頭 —— 退回一個必定合法的值，
  // 讓它在報表上顯示為雜訊，而不是讓整包 payload 被 Worker 判為畸形。
  return /^[a-z][a-z0-9_]*$/.test(key) ? key : 'other'
}

/**
 * 後台儀表板用的中文頁名。**新增頁面時這裡 +1 行**，漏了會被測試擋下。
 *
 * 為什麼標籤要被測試強制、而 key 不用：key 漏了不會有事（自動推導），
 * 標籤漏了則報表會顯示 `guides_component_drops` 這種原文，看得懂但難讀。
 * 用測試把「難讀」提前到開發期解決，成本是一行字。
 */
export const ROUTE_LABELS: Record<string, string> = {
  home:                  '首頁',
  pilots:                '機師列表',
  pilots_detail:         '機師詳情',
  mechs:                 '機甲列表',
  mechs_detail:          '機甲詳情',
  weapons:               '武器列表',
  weapons_detail:        '武器詳情',
  backpacks:             '背包圖鑑',
  modules:               '模組圖鑑',
  components:            '元件圖鑑',
  versions_quick:        '版本速覽',
  versions_grayops:      '灰燼行動',
  versions_timeline:     '版本時間線',
  versions_timeline_detail: '版本時間線（單一版本）',
  // 故事館三頁。扉頁與章節頁是同一個元件，但 key 不同 —— 這正是要區分的：
  // 「進來看一眼扉頁」與「真的翻進章節」是兩種完全不同的行為。
  lore:                      '機師故事館',
  lore_pilots_detail:        '機師故事（扉頁）',
  lore_pilots_detail_detail: '機師故事（章節）',
  simulator:             '配裝模擬器',
  research:              '研究所',
  news:                  '最新消息',
  guides:                '攻略',
  tools:                 '工具',
  documents:             '文件',
  tools_rainbow_planner: '彩虹機規劃器',
  guides_component_drops:'元件掉落查詢',
  debug_storage:         '儲存空間診斷',
  connectivity:          '連線診斷',
  profile:               '個人中心',
  notfound:              '404 未找到',
  other:                 '其他',
}

/**
 * 詳情頁樣板 → 要記進 analyticsEntity 的統計類別（可以不只一個）。
 * 用來把「哪一個機師／機甲被查」「哪位機師的故事、哪一章被讀」記進月文件。
 *
 * 只列**高基數且值得排行**的頁面。研究所、模擬器那種沒有 :id 的頁面不在此列。
 *
 * ⚠ 這裡出現的類別必須都在 workers/src/collect.ts 的 ENTITY_TYPES 裡，而且**Worker 要先部署**：
 *   Worker 不認得的類別會被靜默丟棄、統計又不回溯（PLAN-043 同款雙名單不同步陷阱）。
 *
 * 故事館自 PLAN-062 Phase C（2026-10）起與圖鑑**分開統計**（站長裁決）：
 *   · lorePilots — 哪位機師的故事被打開（扉頁與章節都算，同一次造訪內同一位只算一次）
 *   · loreParts  — 哪一章被讀，id 為 `${pilotId}--${partKey}`（見 loreChapterId）
 * 在那之前兩條故事館路徑是併進 'pilots' 的——當時 Worker 只認 {pilots, mechs, weapons, modules}，
 * 開新類別會被已部署的 Worker 丟掉。拆開之後「熱門機師」回到只算圖鑑，
 * 符合它「決定資料要優先補誰」的用途：讀逸聞的人並不需要圖鑑的資料。
 */
export const ENTITY_ROUTES: Record<string, readonly string[]> = {
  '/pilots/:id':  ['pilots'],
  '/mechs/:id':   ['mechs'],
  '/weapons/:id': ['weapons'],
  '/lore/pilots/:id':       ['lorePilots'],
  '/lore/pilots/:id/:part': ['lorePilots', 'loreParts'],
}

/**
 * 故事館章節 id 的分隔符。
 *
 * 章節 key 由後台 makeChapterKey 產生，格式固定為 `part-N`（只有單一 `-`），
 * 所以拆解時取**最後一個** `--` 就不會被機師 id 裡可能出現的 `--` 誤導。
 * `-` 在 isSafeEntityId 的白名單內，組出來的 id 仍可安全放進反引號欄位路徑。
 */
export const LORE_PART_SEP = '--'

/** 組出故事館章節的統計 id，例：`pilot_049_海莉絲--part-2`。 */
export function loreChapterId(pilotId: string, partKey: string): string {
  return `${pilotId}${LORE_PART_SEP}${partKey}`
}

/** loreChapterId 的反函式。格式不符時回 null。 */
export function splitLoreChapterId(chapterId: string): { pilotId: string; partKey: string } | null {
  const i = chapterId.lastIndexOf(LORE_PART_SEP)
  if (i <= 0) return null
  const partKey = chapterId.slice(i + LORE_PART_SEP.length)
  return partKey ? { pilotId: chapterId.slice(0, i), partKey } : null
}

export interface EntityHit {
  type: string
  id: string
}

/**
 * 一次頁面瀏覽要記進哪些統計類別。不安全的 id（逃得出反引號的）一律丟掉。
 *
 * 路由參數名寫死讀 `id` 與 `part`：App.tsx 若把它們改名，這裡會一筆都不記、而且不報錯，
 * 所以 routeKeys.test.ts 另有一條斷言 ENTITY_ROUTES 的樣板確實帶著這兩個參數。
 *
 * @param pattern 命中的**路由樣板**（如 `/lore/pilots/:id/:part`），不是實際網址
 * @param params  路由參數
 */
export function entityHits(pattern: string, params: Record<string, string | undefined>): EntityHit[] {
  const types = ENTITY_ROUTES[pattern]
  const id = params.id
  if (!types || !id) return []
  const hits: EntityHit[] = []
  for (const type of types) {
    const entityId = type === 'loreParts' ? (params.part ? loreChapterId(id, params.part) : '') : id
    if (isSafeEntityId(entityId)) hits.push({ type, id: entityId })
  }
  return hits
}

/**
 * entity id 是否可安全用作 Firestore 欄位路徑片段。
 *
 * ⚠ 本專案的文件 ID **含中文**（src/utils/idSlug.ts 的 slugify 刻意保留 CJK），
 *   因此欄位路徑必須用反引號包裹（`pilots.\`艾達\``）。既然要包裹，就必須確保 id
 *   不可能「逃出」引號 —— 這是 PLAN-046 鐵律②（payload 不得影響欄位路徑）在
 *   entity 這條路徑上的具體落實。
 *
 * 因此採**白名單字元類別**而非黑名單：只放行 slugify 會產出的字元範圍。
 * 反引號、反斜線、點、控制字元全部落在範圍外，逃逸在字面上就不可能發生。
 */
export function isSafeEntityId(id: string): boolean {
  if (!id || id.length > 60) return false
  for (const ch of id) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) return false
    const ok =
      (cp >= 0x4e00 && cp <= 0x9fa5) || // CJK 中文
      (cp >= 0x30 && cp <= 0x39) ||     // 0-9
      (cp >= 0x41 && cp <= 0x5a) ||     // A-Z
      (cp >= 0x61 && cp <= 0x7a) ||     // a-z
      cp === 0x5f ||                    // _
      cp === 0x2d                       // -
    if (!ok) return false
  }
  return true
}
