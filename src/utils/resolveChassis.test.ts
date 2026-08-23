// PLAN-052-A B-2：ResolvedChassis derive 的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveChassis } from './chassisStats.ts'

/** 彌造者（mech_052）線上實測值 */
const 彌造者 = {
  id: 'mech_052_彌造者',
  armorType: '中甲',
  parts: {
    torso:    { position: 'torso',    firepower: 1255, weight: 240, output: 3375, interface: 'Ⅱ型接口' },
    leftArm:  { position: 'leftArm',  firepower: 1255, weight: 175, interface: 'Ⅱ型接口' },
    rightArm: { position: 'rightArm', firepower: 1255, weight: 175, interface: 'Ⅱ型接口' },
    legs:     { position: 'legs',     firepower: 1255, weight: 235, interface: 'Ⅱ型接口' },
  },
} as never

/** 另一台中甲，用來測混搭（腿部較重、火力較高） */
const 他機 = {
  id: 'mech_099_他機',
  armorType: '中甲',
  parts: {
    torso:    { position: 'torso',    firepower: 1000, weight: 200, output: 2000, interface: 'Ⅰ型接口' },
    leftArm:  { position: 'leftArm',  firepower: 1000, weight: 200, interface: 'Ⅰ型接口' },
    rightArm: { position: 'rightArm', firepower: 1000, weight: 200, interface: 'Ⅰ型接口' },
    legs:     { position: 'legs',     firepower: 2000, weight: 300, interface: 'Ⅰ型接口' },
  },
} as never

test('未混搭：四個部位都來自基底機甲，三個數值與 chassisStats 一致', () => {
  const c = resolveChassis(彌造者)!
  assert.equal(c.baseMechId, 'mech_052_彌造者')
  assert.equal(c.weight, 825)
  assert.equal(c.output, 3375)
  assert.equal(c.firepower, 5020)
  assert.equal(c.armorType, '中甲')
  for (const pos of ['torso', 'leftArm', 'rightArm', 'legs'] as const) {
    assert.equal(c.parts[pos].sourceMechId, 'mech_052_彌造者')
  }
})

test('混搭：只換腿部 → 重量／火力跟著換，來源標成他機', () => {
  const c = resolveChassis(彌造者, { partOverrides: { legs: 他機 } })!
  assert.equal(c.parts.legs.sourceMechId, 'mech_099_他機')
  assert.equal(c.parts.torso.sourceMechId, 'mech_052_彌造者')
  assert.equal(c.weight, 240 + 175 + 175 + 300)          // 890
  assert.equal(c.firepower, 1255 * 3 + 2000)             // 5765
  assert.equal(c.output, 3375)                           // 出力只看軀幹，換腿不影響
  assert.equal(c.moduleSlots.legs.iface, 'Ⅰ型接口')      // 接口跟著部位走
  assert.equal(c.moduleSlots.torso.iface, 'Ⅱ型接口')
})

test('混搭：換軀幹會換掉出力（出力是軀幹的屬性，不是機甲的）', () => {
  const c = resolveChassis(彌造者, { partOverrides: { torso: 他機 } })!
  assert.equal(c.output, 2000)
  assert.equal(c.parts.torso.sourceMechId, 'mech_099_他機')
})

test('armorType 取自基底機甲（混搭不能跨裝甲類型 ⇒ 無歧義）', () => {
  assert.equal(resolveChassis(彌造者, { partOverrides: { legs: 他機 } })!.armorType, '中甲')
})

test('四部位任一缺席一律回 null —— 不補零值部位', () => {
  // 一台重量 0、火力 0 的假機體會一路流進模擬器，比「這台資料不完整」難查太多
  const 缺腿 = { id: 'x', armorType: '中甲', parts: { ...(彌造者 as never as { parts: object }).parts, legs: undefined } } as never
  assert.equal(resolveChassis(缺腿), null)
  const legacy = { id: 'y', armorType: '中甲', parts: { torso: 3200, leftArm: 1800, rightArm: 1800, legs: 2400 } } as never
  assert.equal(resolveChassis(legacy), null)
  assert.equal(resolveChassis(null), null)
})

test('接口空白 ＝ 未建檔（實測 360 格中 44 格空白），不猜型別', () => {
  const 未建檔 = {
    id: 'z', armorType: '中甲',
    parts: {
      torso:    { firepower: 0, weight: 0, output: 0, interface: '' },
      leftArm:  { firepower: 0, weight: 0, interface: '' },
      rightArm: { firepower: 0, weight: 0, interface: '' },
      legs:     { firepower: 0, weight: 0 },
    },
  } as never
  const c = resolveChassis(未建檔)!
  assert.equal(c.moduleSlots.torso.iface, '')
  assert.equal(c.moduleSlots.legs.iface, '')     // 欄位整個缺席也正規化成空字串
})

test('mech_090_美杜莎MK2 這類佔位解析得出來，但 output 是 0（新機甲，官方數值未公布）', () => {
  const 空殼 = {
    id: 'mech_090_美杜莎MK2', armorType: '中甲',
    parts: {
      torso:    { firepower: 0, weight: 0, output: 0, interface: '' },
      leftArm:  { firepower: 0, weight: 0, interface: '' },
      rightArm: { firepower: 0, weight: 0, interface: '' },
      legs:     { firepower: 0, weight: 0, interface: '' },
    },
  } as never
  const c = resolveChassis(空殼)!
  assert.notEqual(c, null)          // 四部位齊全 → 解析得出來
  assert.equal(c.output, 0)         // 但什麼都裝不下
  assert.equal(c.firepower, 0)
})

test('moduleLevelOf：本輪一律回滿級；查不到回 0（＝不知道，不是零級）', () => {
  const moduleMap = new Map([
    ['mod_4026_2', { levels: [{ level: 1 }, { level: 2 }, { level: 3 }, { level: 4 }] }],
    ['mod_亂序',   { levels: [{ level: 8 }, { level: 1 }] }],
    ['mod_無級',   { levels: [] }],
  ])
  const c = resolveChassis(彌造者, { moduleMap })!
  assert.equal(c.moduleLevelOf('mod_4026_2'), 4)
  assert.equal(c.moduleLevelOf('mod_亂序'), 8)     // 取最高階，不是取陣列最後一個
  assert.equal(c.moduleLevelOf('mod_無級'), 0)
  assert.equal(c.moduleLevelOf('不存在'), 0)
  // 沒傳 moduleMap 時恆回 0（全庫模組等級都從 1 起算，0 不會與真實等級混淆）
  assert.equal(resolveChassis(彌造者)!.moduleLevelOf('mod_4026_2'), 0)
})
