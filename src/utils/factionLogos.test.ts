// PLAN-059 D：陣營徽章的純函式
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  FACTION_LOGO_MAX, factionLogoSuggestions, groupLogoPairs, isFactionLogoKey, isMonoLogo, logoNumber, normalizeFactionLogos,
} from './factionLogos.ts'

test('合法檔名：Icon_logo_<4 碼>_<00|01>', () => {
  assert.equal(isFactionLogoKey('Icon_logo_0025_00'), true)
  assert.equal(isFactionLogoKey('Icon_logo_0025_01'), true)
  for (const bad of ['Icon_logo_0025_02', 'Icon_logo_25_00', 'Icon_logo_0025', '/images/game/icons/camp/Icon_logo_0025_00.webp', '', null, 25]) {
    assert.equal(isFactionLogoKey(bad), false, String(bad))
  }
  assert.equal(isMonoLogo('Icon_logo_0025_00'), true)
  assert.equal(isMonoLogo('Icon_logo_0025_01'), false)
  assert.equal(logoNumber('Icon_logo_0041_01'), '0041')
})

test('normalizeFactionLogos：只留合法、去重、最多 2 個；不是陣列就是空的', () => {
  assert.equal(FACTION_LOGO_MAX, 2)
  assert.deepEqual(normalizeFactionLogos(['Icon_logo_0017_01', 'x', 'Icon_logo_0017_01', 'Icon_logo_0009_00', 'Icon_logo_0001_00']),
    ['Icon_logo_0017_01', 'Icon_logo_0009_00'])
  assert.deepEqual(normalizeFactionLogos(undefined), [])
  assert.deepEqual(normalizeFactionLogos('Icon_logo_0017_01'), [])
})

test('groupLogoPairs：依編號配對單色／彩色，有的編號只有彩色', () => {
  const pairs = groupLogoPairs(['Icon_logo_0008_01', 'Icon_logo_0001_01', 'Icon_logo_0001_00', 'Icon_skill_main_1106'])
  assert.deepEqual(pairs, [
    { num: '0001', mono: 'Icon_logo_0001_00', color: 'Icon_logo_0001_01' },
    { num: '0008', color: 'Icon_logo_0008_01' },
  ])
})

test('圖庫裡的陣營徽章都是合法檔名、NVIDIA 兩張不在裡面', () => {
  const dir = new URL('../../public/images/game/icons/camp/', import.meta.url)
  const keys = fs.readdirSync(dir).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5))
  assert.ok(keys.length >= 65)
  assert.ok(keys.every(isFactionLogoKey))
  assert.ok(!keys.includes('Icon_logo_0028_01') && !keys.includes('Icon_logo_0032_01'))
})

test('同陣營建議：只比對陣營文字完全相同的其他機師，同組合併、人多的排前面', () => {
  const pilots = [
    { id: 'p_me', name: '提費斯', faction: '晨星同盟防衛軍' },
    { id: 'p_a', name: 'A', faction: '晨星同盟防衛軍' },
    { id: 'p_b', name: 'B', faction: ' 晨星同盟防衛軍 ' },
    { id: 'p_c', name: 'C', faction: '晨星同盟防衛軍' },
    { id: 'p_d', name: 'D', faction: '晨星同盟' },          // 文字不同：不猜
    { id: 'p_e', name: 'E', faction: '晨星同盟防衛軍' },     // 還沒選
  ]
  const lore = [
    { id: 'p_me', factionLogos: ['Icon_logo_0007_00'] },     // 自己的不算
    { id: 'p_a', factionLogos: ['Icon_logo_0025_00'] },
    { id: 'p_b', factionLogos: ['Icon_logo_0025_00'] },
    { id: 'p_c', factionLogos: ['Icon_logo_0025_01'] },
    { id: 'p_d', factionLogos: ['Icon_logo_0006_00'] },
  ]
  assert.deepEqual(factionLogoSuggestions('p_me', '晨星同盟防衛軍', pilots, lore), [
    { logos: ['Icon_logo_0025_00'], pilots: ['A', 'B'] },
    { logos: ['Icon_logo_0025_01'], pilots: ['C'] },
  ])
  assert.deepEqual(factionLogoSuggestions('p_me', '', pilots, lore), [])
})
