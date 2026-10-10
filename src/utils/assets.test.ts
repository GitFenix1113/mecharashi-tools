// 圖片路徑 helper 的測試（立繪、機甲原稿）。
//
// PLAN-055 E-1（2026-10-11）：原本開頭的 PLAN-043 A-8 那組 normalizeSkillPath 測試已隨函式一起移除——
// 舊技能資料夾（含「背包技能/」）已刪，技能類圖示一律從圖庫 game/icons/ 以檔名解析，不再有子資料夾可推導。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pilotFullArtPath, pilotKeyArtPath, pilotArtDir, hasPilotArt, mechKeyArtPath } from './assets.ts'

// ─── pilotFullArtPath（PLAN-052-I C-1）──────────────────────────────────────

test('全身立繪：由 half.webp 推導出 full.webp', () => {
  assert.equal(pilotFullArtPath({ portrait: '/images/pilots/曜/half.webp' }), '/images/pilots/曜/full.webp')
})

test('全身立繪：half.png 保留副檔名（阿列娜是全庫唯一的 png）', () => {
  assert.equal(pilotFullArtPath({ portrait: '/images/pilots/阿列娜/half.png' }), '/images/pilots/阿列娜/full.png')
})

test('全身立繪：portrait 空字串／缺欄位一律回 undefined（賽拉沒有立繪資料夾）', () => {
  assert.equal(pilotFullArtPath({ portrait: '' }), undefined)
  assert.equal(pilotFullArtPath({}), undefined)
  assert.equal(pilotFullArtPath(null), undefined)
})

test('全身立繪：不是 half.* 命名時不硬猜路徑', () => {
  assert.equal(pilotFullArtPath({ portrait: '/images/pilots/曜/portrait.webp' }), undefined)
})

test('全身立繪：只換最後一段，資料夾名含 half 不受影響', () => {
  assert.equal(
    pilotFullArtPath({ portrait: '/images/pilots/half人/half.webp' }),
    '/images/pilots/half人/full.webp',
  )
})

// ─── pilotKeyArtPath / hasPilotArt（原稿全身立繪）──────────────────────────

test('原稿立繪：由 portrait 推導出 art.webp', () => {
  assert.equal(pilotKeyArtPath({ portrait: '/images/pilots/亞瑟/half.webp' }), '/images/pilots/亞瑟/art.webp')
})

test('原稿立繪：副檔名固定 webp，不跟著 portrait 的 png 走', () => {
  assert.equal(pilotKeyArtPath({ portrait: '/images/pilots/阿列娜/half.png' }), '/images/pilots/阿列娜/art.webp')
})

test('原稿立繪：portrait 空字串／缺欄位一律回 undefined', () => {
  assert.equal(pilotKeyArtPath({ portrait: '' }), undefined)
  assert.equal(pilotKeyArtPath(null), undefined)
})

test('資料夾名：有 gameId 就是 gameId（PLAN-054 D-2），沒有才取 portrait 路徑 pilots/ 後的那一段', () => {
  assert.equal(pilotArtDir({ gameId: '10103127', portrait: '/images/pilots/亞瑟/half.webp' }), '10103127')
  assert.equal(pilotArtDir({ portrait: '/images/pilots/羅斯瑪麗/half.webp' }), '羅斯瑪麗')
  assert.equal(pilotArtDir({ portrait: 'images/pilots/半人/full.webp' }), '半人')
  assert.equal(pilotArtDir({ portrait: '/images/weapons/foo.png' }), undefined)
})

test('原稿立繪：資料夾改用 gameId（亞瑟 → pilots/10103127/art.webp）', () => {
  assert.equal(pilotKeyArtPath({ gameId: '10103127', portrait: '/images/pilots/亞瑟/half.webp' }), '/images/pilots/10103127/art.webp')
})

test('有無原稿：查索引而不是查名字（索引的鍵是 gameId）', () => {
  // 亞瑟有原稿、曜沒有 —— 差別只在 art.webp
  assert.equal(hasPilotArt({ gameId: '10103127' }), true)
  assert.equal(hasPilotArt({ gameId: '10103173' }), false)
  // 名字資料夾已全數退場：只給舊 portrait 的話查不到（不會誤把名字當成鍵）
  assert.equal(hasPilotArt({ portrait: '/images/pilots/亞瑟/half.webp' }), false)
  assert.equal(hasPilotArt({ portrait: '' }), false)
  assert.equal(hasPilotArt(null), false)
})

test('機甲原稿：只換最後一段檔名，不沿用 portrait 的 png 副檔名', () => {
  assert.equal(mechKeyArtPath({ portrait: '/images/mechs/奔霄/portrait.webp' }), '/images/mechs/奔霄/art.webp')
  assert.equal(mechKeyArtPath({ portrait: '/images/mechs/奔霄/portrait.png' }), '/images/mechs/奔霄/art.webp')
})

test('機甲原稿：portrait 空字串／缺欄位一律回 undefined', () => {
  assert.equal(mechKeyArtPath({ portrait: '' }), undefined)
  assert.equal(mechKeyArtPath(null), undefined)
})
