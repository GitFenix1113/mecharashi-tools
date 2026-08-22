// PLAN-038 Phase B：社群連結預覽的純函式測試。
//
// 這三個函式決定了「誰會拿到改寫過的 HTML」與「卡片裡放什麼」，
// 判錯的後果分別是「真人訪客拿到爬蟲回應」與「卡片沒有圖」，都是上線才會發現的那種。
// 執行：node --test workers/src/socialPreview.test.ts（已納入 npm test）

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isSocialCrawler,
  parseEntityPath,
  buildOgMeta,
  isDerivedPreviewImage,
  DEFAULT_OG_IMAGE,
} from './socialPreview.ts'

test('isSocialCrawler：認得社群爬蟲', () => {
  const bots = [
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'facebookexternalhit/1.1;line-poker/1.0',
    'Mozilla/5.0 (compatible; TwitterBot/1.0)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'TelegramBot (like TwitterBot)',
  ]
  for (const ua of bots) assert.equal(isSocialCrawler(ua), true, ua)
})

test('isSocialCrawler：一般瀏覽器與空值一律不算（誤判＝真人拿到爬蟲回應）', () => {
  const humans = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
    '',
  ]
  for (const ua of humans) assert.equal(isSocialCrawler(ua), false, ua)
  assert.equal(isSocialCrawler(null), false)
})

test('parseEntityPath：三種詳情頁才吃，其餘放行', () => {
  assert.deepEqual(parseEntityPath('/pilots/pilot_001_葉夫根尼'), {
    collection: 'pilots',
    id: 'pilot_001_葉夫根尼',
  })
  // 實際連結是 percent-encoded 的（中文 doc id）
  assert.deepEqual(parseEntityPath('/mechs/' + encodeURIComponent('mech_001_都卜勒')), {
    collection: 'mechs',
    id: 'mech_001_都卜勒',
  })
  assert.deepEqual(parseEntityPath('/weapons/weapon_001_碎鋼者/'), {
    collection: 'weapons',
    id: 'weapon_001_碎鋼者',
  })

  for (const p of [
    '/pilots', // 列表頁
    '/pilots/', // 尾斜線但沒有 id
    '/pilots/a/b', // 多一層
    '/backpacks/x', // 沒有詳情頁的集合
    '/simulator',
    '/',
  ]) {
    assert.equal(parseEntityPath(p), null, p)
  }
})

test('parseEntityPath：畸形輸入不會流進 Firestore 查詢', () => {
  assert.equal(parseEntityPath('/pilots/%E4%B8'), null) // 壞掉的 percent-encoding
  assert.equal(parseEntityPath('/pilots/' + 'x'.repeat(300)), null)
})

test('buildOgMeta：webp 立繪要改指預先轉好的 JPEG（LINE 等預覽器不吃 webp）', () => {
  const pilot = buildOgMeta('pilots', { name: '曜', portrait: '/images/pilots/曜/half.webp' })
  assert.equal(
    pilot?.image,
    'https://mecharashi.wiki/images/og/entities/pilots/' + encodeURIComponent('曜') + '/half.jpg',
  )
  assert.equal(isDerivedPreviewImage(pilot.image), true)

  // png 本來就吃得到，不可以動它
  const weapon = buildOgMeta('weapons', { name: '碎鋼者', icon: '/images/weapons/Icon_weapon_1.png' })
  assert.equal(weapon?.image, 'https://mecharashi.wiki/images/weapons/Icon_weapon_1.png')
  assert.equal(isDerivedPreviewImage(weapon.image), false)

  // 預設圖與外部絕對網址都不是推導來的，不該被探測
  assert.equal(isDerivedPreviewImage(DEFAULT_OG_IMAGE), false)
})

test('buildOgMeta（pilots）：用 portrait，中文路徑要 encode 成絕對網址', () => {
  const meta = buildOgMeta('pilots', {
    name: '葉夫根尼',
    fullName: '葉夫根尼·伊萬諾維奇·高曼',
    rarity: 'S',
    class: '守護者',
    faction: '灰燼之子',
    portrait: '/images/pilots/葉夫根尼/half.webp',
  })
  assert.ok(meta)
  assert.equal(meta.title, '葉夫根尼 · S 守護者')
  assert.match(meta.description, /灰燼之子/)
  assert.equal(
    meta.image,
    'https://mecharashi.wiki/images/og/entities/pilots/' + encodeURIComponent('葉夫根尼') + '/half.jpg',
  )
})

test('buildOgMeta：圖片欄位缺值一律 fallback 到預設圖，不可讓 og:image 消失', () => {
  const pilot = buildOgMeta('pilots', { name: '無圖機師', rarity: 'A', class: '突擊者' })
  assert.equal(pilot?.image, DEFAULT_OG_IMAGE)

  const weapon = buildOgMeta('weapons', { name: '無圖武器', rarity: 'B', type: '射擊' })
  assert.equal(weapon?.image, DEFAULT_OG_IMAGE)

  // 機甲：portrait 缺 → 退到 halfPortrait，兩者都缺才用預設圖
  const mech = buildOgMeta('mechs', {
    name: '都卜勒',
    quality: 'S',
    halfPortrait: '/images/mechs/都卜勒/half.png',
  })
  assert.equal(mech?.image, 'https://mecharashi.wiki/images/mechs/' + encodeURIComponent('都卜勒') + '/half.png')  // png 不轉
})

test('buildOgMeta：沒有 name 就不做卡片（退回站名卡）', () => {
  assert.equal(buildOgMeta('pilots', {}), null)
  assert.equal(buildOgMeta('mechs', { name: '   ' }), null)
})

test('buildOgMeta：外部絕對網址原樣保留，描述會截斷', () => {
  const meta = buildOgMeta('pilots', {
    name: '測試',
    portrait: 'https://media.zlongame.com/x/Pilot_1010.png',
  })
  assert.equal(meta?.image, 'https://media.zlongame.com/x/Pilot_1010.png')

  const long = buildOgMeta('weapons', { name: '碎鋼者', rarity: 'A', type: '格鬥', description: '長'.repeat(300) })
  assert.ok((long?.description.length ?? 0) <= 110)
  assert.match(long?.description ?? '', /…$/)
})
