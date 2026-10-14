// 站名同步守衛 —— PLAN-052-C E-1
//
// 這裡用「讀原始碼文字」而不是 import：被守的兩份**本來就 import 不到** siteMeta
// （`index.html` 給爬蟲讀的原始 HTML、Worker 的獨立 bundle）。手法與
// collectionKeys.test.ts 相同，理由也相同。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SITE_NAME, SITE_NAME_EN, SITE_TITLE, SITE_ORIGIN, SITE_DOMAIN, SITE_SEARCH_NAME, SITE_DOC_TITLE } from './siteMeta.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('index.html 的標題與 og:* 站名與 SITE_NAME 一致', () => {
  const html = read('index.html')
  assert.ok(html.includes(`<title>${SITE_DOC_TITLE}</title>`), `index.html 的 <title> 不是「${SITE_DOC_TITLE}」`)
  assert.ok(
    html.includes(`property="og:site_name" content="${SITE_NAME}"`),
    `index.html 的 og:site_name 不是「${SITE_NAME}」`,
  )
  // 逐標籤比對屬性名：舊寫法只找 content="…"，任何一個標籤對了就整組通過
  for (const [attr, tag] of [['property', 'og:title'], ['name', 'twitter:title']]) {
    assert.ok(
      html.includes(`${attr}="${tag}" content="${SITE_DOC_TITLE}"`),
      `index.html 的 ${tag} 不是「${SITE_DOC_TITLE}」`,
    )
  }
})

test('index.html 的 WebSite 結構化資料與站名一致（PLAN-061）', () => {
  const html = read('index.html')
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  assert.ok(m, 'index.html 缺少 application/ld+json 區塊')
  const data = JSON.parse(m[1]) as { '@type': string; name: string; alternateName: string[]; url: string }
  assert.equal(data['@type'], 'WebSite')
  assert.equal(data.name, SITE_NAME)
  assert.deepEqual(data.alternateName, [SITE_SEARCH_NAME, SITE_NAME_EN])
  assert.equal(data.url, `${SITE_ORIGIN}/`)
})

test('Worker 的 SITE_NAME／SITE_ORIGIN 與前端一致（漏改 → 分享卡片印舊站名）', () => {
  const worker = read('workers/src/socialPreview.ts')
  assert.ok(
    worker.includes(`const SITE_NAME = '${SITE_NAME}'`),
    `workers/src/socialPreview.ts 的 SITE_NAME 與 src/lib/siteMeta.ts 不一致`,
  )
  assert.ok(
    worker.includes(`SITE_ORIGIN = '${SITE_ORIGIN}'`),
    `workers/src/socialPreview.ts 的 SITE_ORIGIN 與 src/lib/siteMeta.ts 不一致`,
  )
})

test('src/ 內不得再出現硬編站名（新檔案要 import siteMeta）', () => {
  const offenders: string[] = []
  const EXEMPT = [
    'lib/siteMeta.ts',              // 常數本體
    'lib/siteMeta.test.ts',         // 本檔
    'data/siteChangelog',           // 履歷是歷史文字，不是站名的使用處
    'pages/documents/DocumentsPage.tsx', // 出現的是檔名「…_規劃書.html」不是站名
  ]
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      const rel = path.relative(path.join(ROOT, 'src'), abs).split(path.sep).join('/')
      if (EXEMPT.some((x) => rel.startsWith(x))) continue
      if (e.isDirectory()) { walk(abs); continue }
      if (!/\.(ts|tsx)$/.test(e.name)) continue
      if (fs.readFileSync(abs, 'utf8').includes(SITE_NAME)) offenders.push(rel)
    }
  }
  walk(path.join(ROOT, 'src'))
  assert.deepEqual(offenders, [], `這些檔案硬編了站名，請改 import { SITE_NAME } from 'src/lib/siteMeta'：${offenders.join('、')}`)
})

test('SITE_TITLE、SITE_DOC_TITLE 與 SITE_DOMAIN 由零件組出，不另外手寫', () => {
  assert.equal(SITE_TITLE, `${SITE_NAME} — ${SITE_NAME_EN}`)
  assert.equal(SITE_DOC_TITLE, `${SITE_SEARCH_NAME}｜${SITE_NAME}`)
  assert.equal(SITE_DOMAIN, 'mecharashi.wiki')
})
