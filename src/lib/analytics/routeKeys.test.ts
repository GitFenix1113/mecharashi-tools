// 路由覆蓋測試（PLAN-046 決策九）
//
// 這支測試存在的唯一理由：把統計最糟的失敗模式從**靜默**變成**吵鬧**。
//
// 沒有它的話，新增一個頁面卻忘了同步 ROUTE_PATTERNS，症狀是該頁的統計永遠是 0，
// 而且你要等幾週後看報表覺得「這頁怎麼都沒人」才會發現 —— 那時已經損失了幾週資料，
// 而且中間可能已經拿錯誤的數字下過決策。
//
// 現在：漏登記 → npm test 直接紅並指名是哪條路由 → pre-push hook 擋下 → 不可能上線。
// 這正是 PLAN-043 事故（Worker 名單與前端不同步，本機全綠、上線才炸）的預防措施。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ENTITY_ROUTES,
  ROUTE_LABELS,
  ROUTE_PATTERNS,
  entityHits,
  isSafeEntityId,
  isTracked,
  loreChapterId,
  splitLoreChapterId,
  toPageKey,
} from './routeKeys.ts'

/**
 * 從 App.tsx 抽出所有路由樣板（含巢狀 route 的完整路徑）。
 *
 * 為什麼不是一行 `matchAll(/path="([^"]+)"/g)`：那樣抽到的是**片段**而不是樣板。
 * PLAN-050 的 /versions 是巢狀 layout route，子 route 寫的是相對路徑 `quick`，
 * 一行版會產出 `/quick` —— 一個不存在的網址。它同時造成兩種錯誤：真正的
 * `/versions/quick` 被判為「App.tsx 有但沒登記」，而登記正確的人被逼著寫進假樣板。
 *
 * 因此改成掃描器：追蹤 <Route> 的巢狀層級，把父路徑接上子路徑。
 * 標籤的結尾**不能**用正則找 —— `element={<PilotsPage />}` 裡就有 `>`，
 * 只能逐字掃到「大括號深度為 0 且不在字串內」的那個 `>`。
 */
function extractPatternsFromApp(): Set<string> {
  const src = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')
  const out = new Set<string>()
  const stack: string[] = [] // 目前所在的父路徑（依 <Route> 巢狀層級）

  const join = (parent: string, path: string): string => {
    if (path === '*' || path.startsWith('/')) return path
    return `${parent === '/' ? '' : parent}/${path}`
  }

  for (let i = 0; i < src.length; i++) {
    if (src.startsWith('</Route>', i)) {
      stack.pop()
      i += '</Route>'.length - 1
      continue
    }
    if (!src.startsWith('<Route', i)) continue

    // 掃到標籤結束的 `>`：略過字串內容與 element={...} 這類含 `>` 的屬性運算式
    let j = i + '<Route'.length
    let depth = 0
    let quote: string | null = null
    for (; j < src.length; j++) {
      const c = src[j]
      if (quote !== null) {
        if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'") quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }

    const tag = src.slice(i, j)
    const selfClosing = tag.trimEnd().endsWith('/')
    const parent = stack.length > 0 ? stack[stack.length - 1] : '/'
    const pathAttr = /\bpath="([^"]+)"/.exec(tag)?.[1]
    const full = pathAttr === undefined ? parent : join(parent, pathAttr)

    // <Route index> 代表父路徑本身；`/`（Layout 外殼）不是一個頁面，只由 index route 補進來
    if (/\bindex\b/.test(tag) || (pathAttr !== undefined && full !== '/')) out.add(full)

    if (!selfClosing) stack.push(full)
    i = j
  }

  return out
}

test('ROUTE_PATTERNS 與 App.tsx 的路由完全一致', () => {
  const fromApp = extractPatternsFromApp()
  const declared = new Set(ROUTE_PATTERNS)

  const missing = [...fromApp].filter((p) => !declared.has(p))
  const stale = [...declared].filter((p) => !fromApp.has(p))

  assert.deepEqual(
    missing,
    [],
    `App.tsx 有這些路由但 routeKeys.ts 沒登記（統計會漏掉它們）：${missing.join(', ')}`,
  )
  assert.deepEqual(
    stale,
    [],
    `routeKeys.ts 登記了 App.tsx 已不存在的路由：${stale.join(', ')}`,
  )
})

test('每個納入統計的路由都有中文標籤', () => {
  const missing = ROUTE_PATTERNS.filter((p) => isTracked(p)).filter(
    (p) => !ROUTE_LABELS[toPageKey(p)],
  )
  assert.deepEqual(
    missing,
    [],
    `這些路由缺少 ROUTE_LABELS（報表會顯示英文 key）：${missing
      .map((p) => `${p} → ${toPageKey(p)}`)
      .join(', ')}`,
  )
})

test('產出的 key 一律符合 Worker 端的格式防護', () => {
  // Worker 用 /^[a-z][a-z0-9_]{0,39}$/ 做無名單防護（決策八）。
  // 前端若產出不合格的 key，Worker 會靜默丟棄該筆 —— 又是一種靜默失敗，故在此鎖死。
  const re = /^[a-z][a-z0-9_]{0,39}$/
  for (const p of ROUTE_PATTERNS) {
    const key = toPageKey(p)
    assert.ok(re.test(key), `${p} 產出的 key「${key}」不符合 Worker 格式防護`)
  }
})

test('動態片段折成 detail，不同實體共用同一個 key', () => {
  assert.equal(toPageKey('/pilots/:id'), 'pilots_detail')
  assert.equal(toPageKey('/mechs/:id'), 'mechs_detail')
  // 若這裡改成用實際網址，byRoute 會長出上百個鍵並撐爆日文件
  assert.equal(toPageKey('/'), 'home')
  assert.equal(toPageKey('*'), 'notfound')
  assert.equal(toPageKey('/guides/component-drops'), 'guides_component_drops')
})

test('後台路由不納入統計', () => {
  assert.equal(isTracked('/admin'), false)
  assert.equal(isTracked('/admin/system-log'), false)
  assert.equal(isTracked('/pilots'), true)
  // 前綴比對必須以路徑分隔為界，不可把 /administrator 這類路徑誤排除
  assert.equal(isTracked('/administrator'), true)
})

test('只做轉址的 index route 不納入統計，但其下層照常計數', () => {
  // /versions 是 <Navigate to="quick" replace />，使用者停不到那個網址上。
  // 記它會多算一筆幽靈瀏覽，並讓「三個檢視各佔多少」（PLAN-050 A-6）失真。
  assert.equal(isTracked('/versions'), false)
  assert.equal(isTracked('/versions/quick'), true)
  assert.equal(isTracked('/versions/grayops'), true)
  assert.equal(isTracked('/versions/timeline'), true)
  assert.equal(isTracked('/versions/timeline/:version'), true)
})

test('ENTITY_ROUTES 的樣板都真實存在於路由表', () => {
  for (const pattern of Object.keys(ENTITY_ROUTES)) {
    assert.ok(
      ROUTE_PATTERNS.includes(pattern),
      `ENTITY_ROUTES 指向不存在的路由樣板：${pattern}`,
    )
  }
})

test('ENTITY_ROUTES 的樣板確實帶著 entityHits 寫死讀取的參數（:id，記章節的還要 :part）', () => {
  // entityHits 讀 params.id／params.part。App.tsx 若把參數改名（例如 :pilotId），
  // ROUTE_PATTERNS 與 ENTITY_ROUTES 跟著改了樣板、上面幾條測試照樣全綠，
  // 但 entityHits 從此一筆都不記 —— 這條把那種靜默失效變成紅燈。
  for (const [pattern, types] of Object.entries(ENTITY_ROUTES)) {
    const params = pattern.split('/').filter((seg) => seg.startsWith(':'))
    assert.ok(params.includes(':id'), `${pattern} 沒有 :id 參數`)
    if (types.includes('loreParts')) assert.ok(params.includes(':part'), `${pattern} 記 loreParts 卻沒有 :part 參數`)
  }
})

test('ENTITY_ROUTES 用到的類別都在 Worker 的 ENTITY_TYPES 裡（前後端兩份列舉綁在一起）', () => {
  // Worker 不認得的類別會被 parseCollectBody 靜默丟掉，本機 build、test、dev 全綠（PLAN-043 同款）。
  // 這條只保證**程式碼**一致；Worker 仍要先手動部署，前端才能上線（PLAN-062 決策四）。
  const src = readFileSync(new URL('../../../workers/src/collect.ts', import.meta.url), 'utf8')
  const m = src.match(/const ENTITY_TYPES = new Set\(\[([^\]]*)\]\)/)
  assert.ok(m, '在 workers/src/collect.ts 找不到 ENTITY_TYPES 的定義（改了寫法就要一併更新這條測試）')
  const workerTypes = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
  for (const types of Object.values(ENTITY_ROUTES)) {
    for (const t of types) assert.ok(workerTypes.has(t), `Worker 的 ENTITY_TYPES 沒有「${t}」，這個類別的資料會被靜默丟掉`)
  }
})

test('entityHits：圖鑑與故事館分開記（PLAN-062），故事館不再進 pilots', () => {
  assert.deepEqual(entityHits('/pilots/:id', { id: 'pilot_049_海莉絲' }), [
    { type: 'pilots', id: 'pilot_049_海莉絲' },
  ])
  assert.deepEqual(entityHits('/lore/pilots/:id', { id: 'pilot_049_海莉絲' }), [
    { type: 'lorePilots', id: 'pilot_049_海莉絲' },
  ])
  assert.deepEqual(entityHits('/lore/pilots/:id/:part', { id: 'pilot_049_海莉絲', part: 'part-2' }), [
    { type: 'lorePilots', id: 'pilot_049_海莉絲' },
    { type: 'loreParts', id: 'pilot_049_海莉絲--part-2' },
  ])
})

test('entityHits：沒有 id、不在名單上的樣板、不安全的 id 一律不記', () => {
  assert.deepEqual(entityHits('/research', {}), [])
  assert.deepEqual(entityHits('/pilots/:id', {}), [])
  assert.deepEqual(entityHits('/pilots/:id', { id: 'a`b' }), [])
  // 章節 key 被手打成逃逸字元時，只丟章節、機師照記（扉頁那一筆本身是合法的）
  assert.deepEqual(entityHits('/lore/pilots/:id/:part', { id: 'x', part: 'a.b' }), [{ type: 'lorePilots', id: 'x' }])
  assert.deepEqual(entityHits('/lore/pilots/:id/:part', { id: 'x' }), [{ type: 'lorePilots', id: 'x' }])
})

test('loreChapterId／splitLoreChapterId 互為反函式，拆解取最後一個 --', () => {
  assert.equal(loreChapterId('pilot_049_海莉絲', 'part-2'), 'pilot_049_海莉絲--part-2')
  assert.deepEqual(splitLoreChapterId('pilot_049_海莉絲--part-2'), { pilotId: 'pilot_049_海莉絲', partKey: 'part-2' })
  // 機師 id 自己含 -- 時，仍以最後一個為準（章節 key 是 part-N，不含 --）
  assert.deepEqual(splitLoreChapterId('a--b--part-1'), { pilotId: 'a--b', partKey: 'part-1' })
  assert.equal(splitLoreChapterId('part-1'), null)
  assert.equal(splitLoreChapterId('--part-1'), null)
  assert.equal(splitLoreChapterId('pilot--'), null)
})

test('故事館 URL 形狀：Worker 的 LORE_RE 與 ROUTE_PATTERNS 綁在一起（改一邊必須改另一邊）', () => {
  // 為什麼要一條「讀原始碼字串」的絆線：/lore/pilots/:id[/:part] 這個形狀同時被
  // App.tsx、routeKeys.ts、PilotLorePage 與 workers/src/socialPreview.ts 各寫一次，
  // 而上面那條「ROUTE_PATTERNS 與 App.tsx 一致」只保護**前端檔內**一致。
  // Worker 那條正則單獨漂掉不會有任何本機訊號——build、test、dev 全綠，
  // 只有社群貼連結時 OG 圖悄悄退回 og/default.jpg（2026-08-22 踩過同款）。
  const src = readFileSync(new URL('../../../workers/src/socialPreview.ts', import.meta.url), 'utf8')
  assert.ok(
    src.includes(String.raw`/^\/lore\/(pilots)\/([^/]+)(?:\/([^/]+))?\/?$/`),
    'workers/src/socialPreview.ts 的 LORE_RE 與 ROUTE_PATTERNS 的 /lore/pilots/:id[/:part] 不一致',
  )
  for (const p of ['/lore', '/lore/pilots/:id', '/lore/pilots/:id/:part']) {
    assert.ok(ROUTE_PATTERNS.includes(p), `ROUTE_PATTERNS 缺 ${p}`)
  }
})

test('isSafeEntityId 放行中文 id、擋掉能逃出反引號的字元', () => {
  // 本專案的文件 ID 含中文（idSlug.ts 的 slugify 刻意保留 CJK），
  // 因此 Firestore 欄位路徑必須反引號包裹 —— 就必須確保 id 逃不出去。
  assert.equal(isSafeEntityId('艾達'), true)
  assert.equal(isSafeEntityId('pilot_1010'), true)
  assert.equal(isSafeEntityId('rainbow-mech'), true)

  assert.equal(isSafeEntityId('a`b'), false, '反引號會逃出欄位路徑引號')
  assert.equal(isSafeEntityId('a\\b'), false, '反斜線是跳脫字元')
  assert.equal(isSafeEntityId('a.b'), false, '點會被解析成欄位路徑分隔')
  assert.equal(isSafeEntityId('a/b'), false)
  assert.equal(isSafeEntityId(''), false)
  assert.equal(isSafeEntityId('x'.repeat(61)), false, '長度上限')
})
