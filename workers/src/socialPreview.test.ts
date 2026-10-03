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

// ── 機師故事館（PLAN-042-A）────────────────────────────────────────────────────
//
// 上面那條「三種詳情頁才吃」的 `/pilots/a/b → null` 是**故意留著**的回歸網：
// 若有人為了讓故事館的三段／四段路徑一起命中而把圖鑑側的正則放寬成「選填第三段」，
// 那條斷言會紅。看到它紅時要改的是這裡，不是那條斷言。

test('parseEntityPath（故事館）：三段路徑不帶 part 鍵，四段才帶', () => {
  // ⚠ 用 deepEqual 而非只看欄位：`part` 必須**整個鍵不存在**。
  //   選填 capture group 未命中時 m[3] 執行期是 undefined，而 decodeURIComponent(undefined)
  //   不丟錯、回傳字串 'undefined' —— 漏了防護就會靜默帶上一個假章節。
  assert.deepEqual(parseEntityPath('/lore/pilots/pilot_049_海莉絲'), {
    collection: 'pilots',
    id: 'pilot_049_海莉絲',
    lore: true,
  })
  assert.deepEqual(parseEntityPath('/lore/pilots/pilot_049_海莉絲/part-2'), {
    collection: 'pilots',
    id: 'pilot_049_海莉絲',
    lore: true,
    part: 'part-2',
  })
  // 尾斜線兩種形狀都要吃（分享出去的連結不一定帶）
  assert.deepEqual(parseEntityPath('/lore/pilots/x/'), { collection: 'pilots', id: 'x', lore: true })
  assert.deepEqual(parseEntityPath('/lore/pilots/x/part-1/'), {
    collection: 'pilots',
    id: 'x',
    lore: true,
    part: 'part-1',
  })
})

test('parseEntityPath（故事館）：percent-encoded 中文 id 的四段路徑', () => {
  const path = '/lore/pilots/' + encodeURIComponent('pilot_001_葉夫根尼') + '/part-3'
  assert.deepEqual(parseEntityPath(path), {
    collection: 'pilots',
    id: 'pilot_001_葉夫根尼',
    lore: true,
    part: 'part-3',
  })
})

test('parseEntityPath（故事館）：非故事館詳情頁的 /lore/* 一律放行', () => {
  for (const p of [
    '/lore', // 館首頁
    '/lore/', // 尾斜線但沒有集合段
    '/lore/pilots', // 缺 id
    '/lore/pilots/', // 尾斜線但沒有 id
    '/lore/pilots/x/part-1/extra', // 多一層
    '/lore/mechs/x', // 故事館只有機師
  ]) {
    assert.equal(parseEntityPath(p), null, p)
  }
  // 畸形輸入的防護在 id 與 part 兩段都要生效
  assert.equal(parseEntityPath('/lore/pilots/%E4%B8'), null)
  assert.equal(parseEntityPath('/lore/pilots/x/%E4%B8'), null)
  assert.equal(parseEntityPath('/lore/pilots/x/' + 'y'.repeat(300)), null)
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

test('buildOgMeta（故事館）：換 title 與 description，og:image 沿用同一張立繪', () => {
  const doc = {
    name: '葉夫根尼',
    rarity: 'S',
    class: '守護者',
    faction: '灰燼之子',
    lore: '灰燼之子的老兵，在冬季的廢墟裡撿回了自己的名字。',
    portrait: '/images/pilots/葉夫根尼/half.webp',
  }
  const meta = buildOgMeta('pilots', doc, { lore: true })
  assert.ok(meta)
  assert.equal(meta.title, '葉夫根尼 的故事')
  assert.match(meta.description, /灰燼之子的老兵/)
  // 圖片與圖鑑側完全一致（不另開美術維護線）
  assert.equal(meta.image, buildOgMeta('pilots', doc)?.image)

  // lore 欄位是空的 → 退回可辨識的館名描述，不可讓 description 變空字串
  const noLore = buildOgMeta('pilots', { name: '賽拉' }, { lore: true })
  assert.equal(noLore?.title, '賽拉 的故事')
  assert.equal(noLore?.description, '賽拉｜機師故事館')
  assert.equal(noLore?.image, DEFAULT_OG_IMAGE)
})

test('buildOgMeta：不傳 opts（或 lore 為 false）時與既有輸出逐字一致', () => {
  const doc = {
    name: '葉夫根尼',
    rarity: 'S',
    class: '守護者',
    faction: '灰燼之子',
    lore: '這段文字只有故事館分支會用到',
    portrait: '/images/pilots/葉夫根尼/half.webp',
  }
  assert.deepEqual(buildOgMeta('pilots', doc, {}), buildOgMeta('pilots', doc))
  assert.deepEqual(buildOgMeta('pilots', doc, { lore: false }), buildOgMeta('pilots', doc))
  // 回歸：圖鑑側的機師卡標題不得被 lore 分支影響
  assert.equal(buildOgMeta('pilots', doc)?.title, '葉夫根尼 · S 守護者')
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

// ── PLAN-054：og:image 以官方原檔為先、舊立繪當後備 ─────────────────────────────

test('buildOgMeta（pilots）：有 gameId／artKey 就用官方原檔頭像，舊 portrait 退成後備', () => {
  // 維娜是例外：資料夾用 gameId（10103144）、檔名用 artKey（Pilot_13019A），兩者不互推
  const meta = buildOgMeta('pilots', {
    name: '維娜',
    gameId: '10103144',
    artKey: 'Pilot_13019A',
    portrait: '/images/pilots/維娜/half.webp',
  })
  assert.ok(meta)
  assert.equal(meta.image, 'https://mecharashi.wiki/images/og/entities/game/pilots/10103144/Pilot_13019A_half.jpg')
  assert.equal(isDerivedPreviewImage(meta.image), true)
  assert.deepEqual(meta.fallbackImages, [
    'https://mecharashi.wiki/images/og/entities/pilots/' + encodeURIComponent('維娜') + '/half.jpg',
  ])
  // 故事館分享卡同一套
  const lore = buildOgMeta('pilots', { name: '維娜', gameId: '10103144', artKey: 'Pilot_13019A' }, { lore: true })
  assert.equal(lore?.image, meta.image)
  assert.equal(lore?.fallbackImages, undefined)
})

test('buildOgMeta（pilots）：只有 gameId 沒有 artKey → 不硬拼（artKey 不由 gameId 推導），照舊用 portrait', () => {
  const meta = buildOgMeta('pilots', { name: '維娜', gameId: '10103144', portrait: '/images/pilots/維娜/half.webp' })
  assert.equal(meta?.image, 'https://mecharashi.wiki/images/og/entities/pilots/' + encodeURIComponent('維娜') + '/half.jpg')
  assert.equal(meta?.fallbackImages, undefined)
})

test('buildOgMeta（mechs）：官方原檔立繪 → portrait → halfPortrait', () => {
  const meta = buildOgMeta('mechs', {
    name: '都卜勒',
    gameId: '1011',
    portrait: '/images/mechs/都卜勒/portrait.webp',
    halfPortrait: '/images/mechs/都卜勒/half.png',
  })
  assert.ok(meta)
  assert.equal(meta.image, 'https://mecharashi.wiki/images/og/entities/game/mechs/1011/Icon_mecha_wap1011.jpg')
  assert.deepEqual(meta.fallbackImages, [
    'https://mecharashi.wiki/images/og/entities/mechs/' + encodeURIComponent('都卜勒') + '/portrait.jpg',
    'https://mecharashi.wiki/images/mechs/' + encodeURIComponent('都卜勒') + '/half.png',
  ])
})
