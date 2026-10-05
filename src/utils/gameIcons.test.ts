// PLAN-055 A-5：圖示讀取端「檔名即 key」
//   npm test   →   node --test "src/**/*.test.ts"
//
// DB 裡的圖示值有四種寫法＋遠端 URL（2026-10-03 正式站備份實測），這裡每一種各取一個真實樣本，
// 確認都會先指到新圖庫、再退回原本的舊路徑——讀取端一切換，舊資料不必先改就有圖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gameIconSources, gameIconPath, isLibraryKey } from './gameIcons.ts'

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

test('武器、背包圖示不屬於圖庫（它們本來就一夾一份）', () => {
  assert.equal(isLibraryKey('Icon_weapon_10100201'), false)
  assert.equal(isLibraryKey('Icon_backpack_60100101'), false)
  assert.deepEqual(gameIconSources('/images/weapons/Icon_weapon_10100201.png'), ['/images/weapons/Icon_weapon_10100201.png'])
})
