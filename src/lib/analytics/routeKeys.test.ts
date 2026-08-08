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
  isSafeEntityId,
  isTracked,
  toPageKey,
} from './routeKeys.ts'

/** 從 App.tsx 抽出所有路由樣板（含 index 路由）。 */
function extractPatternsFromApp(): Set<string> {
  const src = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')
  // 刻意用簡單的全域比對：App.tsx 裡除了 <Route> 之外沒有其他 path="..." 屬性。
  // 若日後真的出現，這支測試會以「多出不明樣板」的形式失敗 —— 那也是我們要的訊號。
  const raw = [...src.matchAll(/\bpath="([^"]+)"/g)].map((m) => m[1])
  const out = new Set<string>()
  // <Route index> 對應根路徑
  if (/<Route\s+index\b/.test(src)) out.add('/')
  for (const p of raw) {
    if (p === '/') continue // Layout 外殼本身不是一個頁面
    out.add(p === '*' ? '*' : `/${p}`)
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

test('ENTITY_ROUTES 的樣板都真實存在於路由表', () => {
  for (const pattern of Object.keys(ENTITY_ROUTES)) {
    assert.ok(
      ROUTE_PATTERNS.includes(pattern),
      `ENTITY_ROUTES 指向不存在的路由樣板：${pattern}`,
    )
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
