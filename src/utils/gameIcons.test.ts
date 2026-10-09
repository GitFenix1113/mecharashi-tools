// PLAN-055 A-5：圖示讀取端「檔名即 key」
//   npm test   →   node --test "src/**/*.test.ts"
//
// DB 裡的圖示值有四種寫法＋遠端 URL（2026-10-03 正式站備份實測），這裡每一種各取一個真實樣本，
// 確認都會先指到新圖庫、再退回原本的舊路徑——讀取端一切換，舊資料不必先改就有圖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { equipIconSources, gameIconSources, gameIconPath, isLibraryKey } from './gameIcons.ts'

const LIB = (k: string) => `/images/game/icons/skill/${k}.webp`

test('裸 key：只有新圖庫（沒有舊路徑可退）', () => {
  assert.deepEqual(gameIconSources('Icon_skill_passive_5227'), [LIB('Icon_skill_passive_5227')])
})

test('pilotSkills：裸 key＋扁平路徑 → 新圖庫、再退扁平路徑（同一張圖不重複）', () => {
  assert.deepEqual(
    gameIconSources('Icon_skill_main_1106', '/images/skills/Icon_skill_main_1106.png'),
    [LIB('Icon_skill_main_1106'), '/images/skills/Icon_skill_main_1106.png'],
  )
})

test('子資料夾路徑（背包技能／被動技能）都對到同一張新圖庫的圖', () => {
  const a = gameIconSources('/images/skills/背包技能/Icon_skill_passive_5155.png')
  const b = gameIconSources('/images/skills/被動技能/Icon_skill_passive_5155.png')
  assert.equal(a[0], LIB('Icon_skill_passive_5155'))
  assert.equal(b[0], LIB('Icon_skill_passive_5155'))
})

test('模組的完整路徑 → 模組詞條也在技能圖庫', () => {
  assert.deepEqual(
    gameIconSources('/images/modules/Icon_entry_10031.png'),
    [LIB('Icon_entry_10031'), '/images/modules/Icon_entry_10031.png'],
  )
})

test('遠端 URL：取檔名指到新圖庫，但不把第三方網域當後備', () => {
  assert.deepEqual(
    gameIconSources('https://media.zlongame.com/x/Icon_skill_order_1129.png', '/images/skills/Icon_skill_order_1129.png'),
    [LIB('Icon_skill_order_1129'), '/images/skills/Icon_skill_order_1129.png'],
  )
})

test('中文佔位名不是圖庫 key：只走舊路徑', () => {
  const v = '/images/skills/主動技能/Icon_skill_main_凱登01.png'
  assert.deepEqual(gameIconSources('Icon_skill_main_凱登01', v), [v])
})

test('舊編號經別名表解析到現行編號（圖庫只存一份）', () => {
  // 侵攻：DB 存的是官方重新編號前的 main_1043，現行叫 main_1141（畫面逐像素相同）
  assert.deepEqual(
    gameIconSources('Icon_skill_main_1043', '/images/skills/Icon_skill_main_1043.png'),
    [LIB('Icon_skill_main_1141'), '/images/skills/Icon_skill_main_1043.png'],
  )
  // 笑謊者・重點關照：站上當初猜成 passive_1182，實際是 passive_1171
  assert.equal(gameIconPath('Icon_skill_passive_1182'), LIB('Icon_skill_passive_1171'))
})

test('BUFF 字形在 buff 夾', () => {
  assert.equal(gameIconPath('Icon_debuff_stun'), '/images/game/icons/buff/Icon_debuff_stun.webp')
})

test('空值、空字串、undefined 都沒有候選（呼叫端顯示佔位方塊）', () => {
  assert.deepEqual(gameIconSources(undefined, '', '  ', null), [])
})

// ── PLAN-056：武器、背包 ─────────────────────────────────────────────────────────
const W = (k: string) => `/images/game/icons/weapon/${k}.webp`
const B = (k: string) => `/images/game/icons/backpack/${k}.webp`

test('武器、背包自 PLAN-056 起收進圖庫', () => {
  assert.equal(isLibraryKey('Icon_weapon_10100201'), true)
  assert.equal(isLibraryKey('Icon_weapon_影虎嘯'), false)
  assert.equal(gameIconPath('Icon_BackPack_60350101'), B('Icon_BackPack_60350101'))
})

test('武器：gameId 優先；舊 icon 原路徑排在「檔名對到的圖庫」之前', () => {
  // 回填前：只有舊路徑 → 先吃原檔，再退到圖庫
  assert.deepEqual(
    equipIconSources('weapon', { icon: '/images/weapons/Icon_weapon_10100201.png' }),
    ['/images/weapons/Icon_weapon_10100201.png', W('Icon_weapon_10100201')],
  )
  // 笑謊者：舊值存的是猜錯的 10200402（官方那張是灰色版）。回填 gameId 後正確的圖排第一
  assert.deepEqual(
    equipIconSources('weapon', { gameId: '10200501', icon: '/images/weapons/Icon_weapon_10200402.webp' }),
    [W('Icon_weapon_10200501'), '/images/weapons/Icon_weapon_10200402.webp', W('Icon_weapon_10200402')],
  )
  // 中文佔位：只有原檔，沒有圖庫可退
  assert.deepEqual(equipIconSources('weapon', { icon: '/images/weapons/Icon_weapon_影虎嘯.png' }), ['/images/weapons/Icon_weapon_影虎嘯.png'])
  assert.deepEqual(equipIconSources('weapon', null), [])
  assert.deepEqual(equipIconSources('weapon', { gameId: '', icon: '' }), [])
})

test('固定武裝：有給 side 時左右肩圖排第一，沒給就用 gameId', () => {
  const w = { gameId: '90300101', sideGameIds: { left: '90300101', right: '90300102' } }
  assert.deepEqual(equipIconSources('weapon', w, 'right'), [W('Icon_weapon_90300102'), W('Icon_weapon_90300101')])
  assert.deepEqual(equipIconSources('weapon', w, 'left'), [W('Icon_weapon_90300101')])
  assert.deepEqual(equipIconSources('weapon', w), [W('Icon_weapon_90300101')])
})

test('背包：gameId 經大小寫例外表換成官方檔名', () => {
  assert.deepEqual(equipIconSources('backpack', { gameId: '60350101' }), [B('Icon_BackPack_60350101')])
  assert.deepEqual(equipIconSources('backpack', { gameId: '60100101' }), [B('Icon_backpack_60100101')])
})
