// PLAN-052-A D-2：裝甲類型詞彙對齊的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toArmorType, fromAssemblableArmorType, licenseAllows, findMechResearch, findPilotResearch, findWeaponResearch,
} from './normalizeArmorType.ts'
import type { GlobalResearch } from '../types/index.ts'

/** 線上 globalResearch/global 的實際形狀（2026-08-24）：三個欄位都是 Array，鍵用「中型」 */
const GR: GlobalResearch = {
  pilotResearchByClass: [
    { className: '格鬥家', flatBonus: { melee: 2244 }, percentBonus: { melee: 20 } },
    { className: '突擊手', flatBonus: {}, percentBonus: {} },
    { className: '狙擊手', flatBonus: {}, percentBonus: {} },
    { className: '戰術家', flatBonus: {}, percentBonus: {} },
    { className: '守護者', flatBonus: {}, percentBonus: {} },
    { className: '機械師', flatBonus: {}, percentBonus: {} },
    // ⚠ 沒有調構師 —— 這就是線上的實際狀態
  ],
  mechResearchByType: [
    { armorType: '輕型', flatBonus: { torsoHP: 6029 }, percentBonus: { torsoHP: 19 } },
    { armorType: '中型', flatBonus: { torsoHP: 7000 }, percentBonus: { torsoHP: 19 } },  // ⚠ 「中型」不是「中甲」
    { armorType: '重型', flatBonus: { torsoHP: 8000 }, percentBonus: { torsoHP: 19 } },
  ],
  weaponResearchByType: [
    { weaponType: '狙擊步槍', bonus: { attack: 462 } },
    { weaponType: '機槍', bonus: { attack: 300 } },
  ],
}

test('本檔存在的理由：中甲用 naive 比對會靜默拿 0（36/90 台）', () => {
  const mech = { armorType: '中甲' }   // ArmorType.MEDIUM
  // naive 寫法：完全找不到，而且不會有任何錯誤
  const naive = GR.mechResearchByType.find((x) => x.armorType === mech.armorType)
  assert.equal(naive, undefined)
  // 正確寫法
  assert.equal(findMechResearch(GR, mech.armorType)?.flatBonus.torsoHP, 7000)
})

test('toArmorType：兩套詞彙都收斂到 ArmorType，認不得的回 null', () => {
  assert.equal(toArmorType('中型'), '中甲')   // 唯一需要翻譯的一個
  assert.equal(toArmorType('中甲'), '中甲')
  assert.equal(toArmorType('輕型'), '輕型')   // 兩套同名
  assert.equal(toArmorType('重型'), '重型')   // 兩套同名
  assert.equal(toArmorType('超重型'), null)   // 不猜
  assert.equal(toArmorType(''), null)
  assert.equal(toArmorType(null), null)
})

test('licenseAllows：執照與裝甲一對一，不是階梯式包含', () => {
  // ① 原本 SimulatorPage 寫 `license === '中甲'`，執照值域根本沒有「中甲」⇒ 分支恆 false
  //    ⇒ 37 位中型執照的機師看得到全部 90 台，包含駕駛不了的重型
  // ② 2026-08-25：改成一對一 —— 執照是「機師的機種」不是「等級」，
  //    原本的階梯式（重型全開／中型含輕型）讓重型機師照樣選得到輕型機甲
  assert.equal(licenseAllows('中型', '中甲'), true)
  assert.equal(licenseAllows('中型', '重型'), false)
  assert.equal(licenseAllows('中型', '輕型'), false)
  assert.equal(licenseAllows('輕型', '輕型'), true)
  assert.equal(licenseAllows('輕型', '中甲'), false)
  assert.equal(licenseAllows('重型', '重型'), true)
  assert.equal(licenseAllows('重型', '輕型'), false)
  assert.equal(licenseAllows('重型', '中甲'), false)
  // 認不得的值一律不擋（寧可多顯示，不要少）
  assert.equal(licenseAllows('超重型', '重型'), true)
  assert.equal(licenseAllows('重型', '超重型'), true)
  assert.equal(licenseAllows(null, '重型'), true)
})

test('licenseAllows：未知輸入一律放行（寧可多顯示，不要靜默少一台）', () => {
  assert.equal(licenseAllows(null, '重型'), true)
  assert.equal(licenseAllows('', '重型'), true)
  assert.equal(licenseAllows('中型', '未知裝甲'), true)
  assert.equal(licenseAllows('未知執照', '重型'), true)
})

test('findPilotResearch：調構師查不到 → null（不是 0）', () => {
  assert.equal(findPilotResearch(GR, '格鬥家')?.flatBonus.melee, 2244)
  // 表內只有 6 個職業，海莉絲與後續調構師一律 null；呼叫端要當「還沒有資料」不是「加成 0」
  assert.equal(findPilotResearch(GR, '調構師'), null)
  assert.equal(findPilotResearch(GR, null), null)
  assert.equal(findPilotResearch(null, '格鬥家'), null)
})

test('findWeaponResearch：表內只有 5 種，其餘武器種類回 null', () => {
  assert.equal(findWeaponResearch(GR, '狙擊步槍')?.bonus.attack, 462)
  assert.equal(findWeaponResearch(GR, '打樁機'), null)
  assert.equal(findWeaponResearch(GR, undefined), null)
})

test('空表／缺欄位一律優雅降級，不拋例外', () => {
  const empty = { pilotResearchByClass: [], mechResearchByType: [], weaponResearchByType: [] }
  assert.equal(findMechResearch(empty, '中甲'), null)
  assert.equal(findMechResearch(undefined, '中甲'), null)
  assert.equal(findPilotResearch(empty, '格鬥家'), null)
  assert.equal(findWeaponResearch(empty, '機槍'), null)
})

test('科研表若哪天改用「中甲」，查詢仍成立（轉換層對兩種寫法都對）', () => {
  const 改過的 = { mechResearchByType: [{ armorType: '中甲', flatBonus: { torsoHP: 7000 }, percentBonus: {} }] }
  assert.equal(findMechResearch(改過的, '中甲')?.flatBonus.torsoHP, 7000)
  assert.equal(findMechResearch(改過的, '中型')?.flatBonus.torsoHP, 7000)
})

test('fromAssemblableArmorType：背包的英文第四套寫法（Medium → 中甲）', () => {
  // 這是同一個概念的第四套詞彙，而且是唯一的英文版；toArmorType() 認不得它
  assert.equal(fromAssemblableArmorType('Light'), '輕型')
  assert.equal(fromAssemblableArmorType('Medium'), '中甲')
  assert.equal(fromAssemblableArmorType('Heavy'), '重型')
  assert.equal(toArmorType('Light'), null)          // ⚠ 誤用它會讓「僅輕型可裝」的背包全部不擋
  assert.equal(fromAssemblableArmorType('中甲'), null)
  assert.equal(fromAssemblableArmorType(undefined), null)
})
