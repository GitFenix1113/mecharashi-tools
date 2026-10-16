// 搜尋可見度的覆蓋測試（PLAN-061）
//
// 和 routeKeys.test.ts 同一個目的：新增頁面時「忘了給標題」「忘了決定要不要進 sitemap」
// 都不會有任何症狀——分頁標題退回站名、sitemap 少一頁，誰也看不出來。
// 這裡把它們變成 npm test 的紅燈並指名是哪條路由。
// ROUTE_PATTERNS 與 App.tsx 的一致性已由 routeKeys.test.ts 負責，這裡只對 ROUTE_PATTERNS 檢查。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ROUTE_PATTERNS } from './analytics/routeKeys.ts'
import {
  PAGE_TITLES,
  SITEMAP_EXCLUDED,
  SITEMAP_STATIC_PATHS,
  absoluteUrl,
  buildSitemapXml,
  formatDocTitle,
  routeDocTitle,
} from './seo.ts'
import { SITE_DOC_TITLE, SITE_ORIGIN } from './siteMeta.ts'

test('每條路由都有頁名（PAGE_TITLES）', () => {
  const missing = ROUTE_PATTERNS.filter((p) => !(p in PAGE_TITLES))
  assert.deepEqual(missing, [], `這些路由缺少 PAGE_TITLES（分頁標題會退回站名）：${missing.join(', ')}`)
  const stale = Object.keys(PAGE_TITLES).filter((p) => !ROUTE_PATTERNS.includes(p))
  assert.deepEqual(stale, [], `PAGE_TITLES 登記了不存在的路由：${stale.join(', ')}`)
})

test('每條路由都決定了要不要進 sitemap，而且只決定一次', () => {
  const inStatic = new Set(SITEMAP_STATIC_PATHS)
  const undecided = ROUTE_PATTERNS.filter((p) => !inStatic.has(p) && !(p in SITEMAP_EXCLUDED))
  assert.deepEqual(
    undecided,
    [],
    `這些路由沒有決定要不要進 sitemap（放進 SITEMAP_STATIC_PATHS，或在 SITEMAP_EXCLUDED 寫理由）：${undecided.join(', ')}`,
  )
  const both = SITEMAP_STATIC_PATHS.filter((p) => p in SITEMAP_EXCLUDED)
  assert.deepEqual(both, [], `這些路由同時在 sitemap 與排除名單裡：${both.join(', ')}`)
  const stale = [...SITEMAP_STATIC_PATHS, ...Object.keys(SITEMAP_EXCLUDED)].filter((p) => !ROUTE_PATTERNS.includes(p))
  assert.deepEqual(stale, [], `sitemap 設定裡有不存在的路由：${stale.join(', ')}`)
})

test('sitemap 只收固定網址，不收動態樣板與萬用路由', () => {
  const bad = SITEMAP_STATIC_PATHS.filter((p) => p.includes(':') || p.includes('*'))
  assert.deepEqual(bad, [], `sitemap 不能放樣板：${bad.join(', ')}`)
})

test('頁面標題：頁名在前、站台標題在後；首頁只有站台標題', () => {
  assert.equal(formatDocTitle(null), SITE_DOC_TITLE)
  assert.equal(routeDocTitle('/'), SITE_DOC_TITLE)
  assert.equal(routeDocTitle('/pilots'), `機師圖鑑｜${SITE_DOC_TITLE}`)
  assert.equal(formatDocTitle('海莉絲 機師資料'), `海莉絲 機師資料｜${SITE_DOC_TITLE}`)
  // 每一頁的標題都必須含遊戲名——這是整個 PLAN-061 的目的
  for (const p of ROUTE_PATTERNS) {
    const t = routeDocTitle(p, { version: '3.0', id: 'x', part: 'y', versionId: 'z' })
    assert.ok(t.includes('鋼嵐') && t.includes('Mecharashi'), `${p} 的標題不含遊戲名：${t}`)
  }
})

test('帶參數的頁名會用上參數', () => {
  assert.equal(routeDocTitle('/versions/timeline/:version', { version: '3.0' }), `3.0 版本時間線｜${SITE_DOC_TITLE}`)
  assert.equal(routeDocTitle('/versions/timeline/:version', {}), `版本時間線｜${SITE_DOC_TITLE}`)
})

test('sitemap 網址是絕對網址，中文逐段編碼、XML 特殊字元跳脫', () => {
  assert.equal(absoluteUrl('/'), `${SITE_ORIGIN}/`)
  assert.equal(absoluteUrl('/pilots/pilot_049_海莉絲'), `${SITE_ORIGIN}/pilots/pilot_049_%E6%B5%B7%E8%8E%89%E7%B5%B2`)
  const xml = buildSitemapXml(['/', '/a&b'])
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'))
  assert.ok(xml.includes(`<loc>${SITE_ORIGIN}/</loc>`))
  // encodeURIComponent 會把 & 編成 %26；這裡確認輸出裡沒有裸露的 &
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'sitemap 裡有未跳脫的 &')
  assert.equal(xml.match(/<url>/g)?.length, 2)
})

test('robots.txt 指向 sitemap，且擋掉後台與 PR 預覽', () => {
  const robots = readFileSync(new URL('../../public/robots.txt', import.meta.url), 'utf8')
  assert.ok(robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`), 'robots.txt 沒有指向正式站的 sitemap')
  // 切行要認 CRLF：Windows 上 core.autocrlf=true 會把 checkout 出來的 robots.txt 轉成 CRLF
  const lines = robots.split(/\r?\n/)
  for (const p of ['/admin', '/profile', '/preview/']) {
    assert.ok(lines.includes(`Disallow: ${p}`), `robots.txt 沒有擋 ${p}`)
  }
  // sitemap 裡的頁面不能被 robots.txt 擋掉，否則 Search Console 會回報衝突
  const disallowed = lines.filter((l) => l.startsWith('Disallow: ')).map((l) => l.slice('Disallow: '.length))
  const conflicts = SITEMAP_STATIC_PATHS.filter((p) => disallowed.some((d) => d && p.startsWith(d)))
  assert.deepEqual(conflicts, [], `這些 sitemap 頁面被 robots.txt 擋掉了：${conflicts.join(', ')}`)
})
