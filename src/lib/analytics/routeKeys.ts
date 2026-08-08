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
  '*',
]

/** 不納入統計的樣板前綴：後台不是使用者行為，量它只會污染頁面熱度排行。 */
const UNTRACKED_PREFIXES = ['/admin']

/** 該樣板是否納入統計。 */
export function isTracked(pattern: string): boolean {
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
 * 詳情頁樣板 → entity 類別。用來把「哪一個機師／機甲被查」記進 analyticsEntity。
 *
 * 只列**高基數且值得排行**的四類。研究所、模擬器那種沒有 :id 的頁面不在此列。
 */
export const ENTITY_ROUTES: Record<string, string> = {
  '/pilots/:id':  'pilots',
  '/mechs/:id':   'mechs',
  '/weapons/:id': 'weapons',
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
