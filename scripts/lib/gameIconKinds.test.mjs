// 官方圖示命名規則的雙胞胎守門（PLAN-055）
//
// 同一套規則有兩份：scripts/lib/gameIconKinds.mjs（build 腳本用，要能在 Node 20 跑）
// 與 src/utils/gameIcons.ts（前台用）。這裡逐一比對兩份的解析與路徑——改了一邊沒改另一邊就會掛。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ICON_DIR, ICON_FEATURE_DIM, equipGameIdOf, equipIconKey, iconFamily, iconFeature, iconHandledElsewhere, iconPath, isLibraryKey, keyFromValue, otherIconPaths, parseIconKey } from './gameIconKinds.mjs'
import * as ts from '../../src/utils/gameIcons.ts'

// 每一種官方前綴各取幾個真實檔名（2026-10-04 陸版擷取＋站上舊夾）
const KEYS = [
  'Icon_skill_main_1106', 'Icon_skill_order_3112', 'Icon_skill_passive_5302', 'Icon_skill_talent_9701',
  'Icon_skill_pp_1105', 'Icon_entry_10031', 'Icon_entry_40311', 'Icon_RnD_E_1001', 'Icon_RnD_P_1003',
  'Icon_skill_RnD_P_2002', 'Icon_skill_refactoring_01', 'Icon_commandskill_0001', 'Icon_zoneskill_0003',
  'Icon_roguelike_uniticon_01', 'Icon_coopclimb_attack_001',
  'Icon_buff_1001', 'Icon_buff_1_002', 'Icon_buff_2014', 'Icon_buff_4012', 'Icon_buff_5007', 'Icon_buff_9001',
  'Icon_buff_attack', 'Icon_debuff_nomove',
  // 武器、背包（PLAN-056，2026-10-09 陸版擷取）
  'Icon_weapon_10100201', 'Icon_weapon_10700301A', 'Icon_weapon_10700501_b', 'Icon_weapon_90200101', 'Icon_weapon_4001_1_NY',
  'Icon_weapon_4002_black_1', 'Icon_weapon_2021_1', 'Icon_weapon_40400401',
  'Icon_backpack_60100101', 'Icon_BackPack_60350101',
]
const NOT_KEYS = [
  'Icon_skill_main_凱登01', 'Icon_skill_passive_威能者驅動', 'Icon_weapon_影虎嘯', 'Icon_V_Cannon01', 'Icon_tank01',
  'Icon_pilotclass_001_l', 'Icon_entry', '', 'Pilot_10103174A_half',
]

test('解析：腳本版與前台版一致', () => {
  for (const k of [...KEYS, ...NOT_KEYS]) {
    assert.deepEqual(parseIconKey(k), ts.parseIconKey(k), k)
    assert.equal(isLibraryKey(k), ts.isLibraryKey(k), k)
  }
})

test('路徑：腳本版（相對 public/）與前台版（含開頭斜線）指向同一個檔', () => {
  for (const k of KEYS) assert.equal(`/${iconPath(k)}`, ts.gameIconPath(k), k)
  for (const k of NOT_KEYS) {
    assert.equal(iconPath(k), undefined, k)
    assert.equal(ts.gameIconPath(k), undefined, k)
  }
})

test('武器、背包各一夾；官方文法：種類前綴、群組', () => {
  assert.equal(iconFamily('Icon_weapon_10200401'), 'weapon')
  assert.equal(iconFamily('Icon_BackPack_60350101'), 'backpack')
  assert.equal(iconPath('Icon_BackPack_60350101'), `${ICON_DIR}/backpack/Icon_BackPack_60350101.webp`)
  assert.deepEqual(parseIconKey('Icon_weapon_10200401'), { key: 'Icon_weapon_10200401', family: 'weapon', kind: 'series', category: '102', num: 10200401 })
  assert.equal(parseIconKey('Icon_weapon_10700301A').kind, 'series')        // 斷鋼：字母字尾是本體
  assert.equal(parseIconKey('Icon_weapon_10700501_b').kind, 'variant')      // 外型變化
  assert.equal(parseIconKey('Icon_weapon_90300102').kind, 'linked')         // 破曉者-01 右肩
  assert.equal(parseIconKey('Icon_weapon_90300102').category, '903')
  assert.equal(parseIconKey('Icon_weapon_4002_black_2').kind, 'enemy')
  assert.equal(parseIconKey('Icon_weapon_2021_1').kind, 'other')
  assert.deepEqual(parseIconKey('Icon_BackPack_60350101'), { key: 'Icon_BackPack_60350101', family: 'backpack', kind: 'backpack', category: '035', num: 60350101 })
})

test('gameId ↔ 官方檔名：腳本版與前台版一致（含大小寫例外）', () => {
  for (const [fam, id] of [['weapon', '20300501'], ['weapon', '10700301A'], ['backpack', '60100101'], ['backpack', '60350101'], ['backpack', '60500101']]) {
    assert.equal(equipIconKey(fam, id), ts.equipIconKey(fam, id), `${fam}:${id}`)
  }
  assert.equal(equipIconKey('backpack', '60350101'), 'Icon_BackPack_60350101')
  assert.equal(equipIconKey('weapon', ' 20300501 '), 'Icon_weapon_20300501')
  assert.equal(equipIconKey('weapon', ''), undefined)
  for (const k of ['Icon_weapon_10700301A', 'Icon_BackPack_60350101', 'Icon_skill_main_1106']) assert.equal(equipGameIdOf(k), ts.equipGameIdOf(k), k)
  assert.equal(equipGameIdOf('Icon_BackPack_60350101'), '60350101')
})

test('BUFF 字形一夾、其餘一夾', () => {
  assert.equal(iconFamily('Icon_buff_4012'), 'buff')
  assert.equal(iconFamily('Icon_debuff_stun'), 'buff')
  assert.equal(iconFamily('Icon_entry_10031'), 'skill')
  assert.equal(iconPath('Icon_debuff_stun'), `${ICON_DIR}/buff/Icon_debuff_stun.webp`)
})

test('官方文法：種類、色系、編號', () => {
  assert.deepEqual(parseIconKey('Icon_skill_passive_5302'), { key: 'Icon_skill_passive_5302', family: 'skill', kind: 'passive', color: 5, num: 5302 })
  assert.equal(parseIconKey('Icon_skill_talent_9701').color, 9)    // 聯動：零
  assert.equal(parseIconKey('Icon_skill_pp_1105').color, undefined)  // pp 不吃色系
  assert.equal(parseIconKey('Icon_buff_4012').kind, 'unique')
  assert.equal(parseIconKey('Icon_buff_5007').kind, 'stack')
  assert.equal(parseIconKey('Icon_buff_attack').kind, 'generic')
  assert.equal(parseIconKey('Icon_debuff_nomove').kind, 'debuff')
})

test('以圖搜圖特徵：腳本版與前台版逐位元相同，且會先裁到不透明外框', () => {
  // 20×16 的畫布，中間 8×6 一塊不透明的紅；其餘透明 → 裁外框後整張特徵都是紅
  const w = 20, h = 16, data = new Uint8Array(w * h * 4)
  for (let y = 5; y < 11; y++) for (let x = 6; x < 14; x++) data.set([200, 30, 30, 255], (y * w + x) * 4)
  const a = iconFeature(data, w, h)
  assert.deepEqual([...a], [...ts.iconFeature(data, w, h)])
  assert.equal(a.length, ICON_FEATURE_DIM * ICON_FEATURE_DIM * 3)
  assert.deepEqual([...a.slice(0, 3)], [200, 30, 30])
  // 整張都透明 → 退回整張計算（全黑），不炸
  assert.ok(iconFeature(new Uint8Array(4 * 4 * 4), 4, 4).every((v) => v === 0))
})

test('任何舊寫法都取得到檔名', () => {
  const cases = [
    ['Icon_skill_passive_5227', 'Icon_skill_passive_5227'],
    ['/images/skills/Icon_skill_passive_5227.png', 'Icon_skill_passive_5227'],
    ['/images/skills/背包技能/Icon_skill_passive_5227.png', 'Icon_skill_passive_5227'],
    ['/images/modules/Icon_entry_10031.png', 'Icon_entry_10031'],
    ['/images/skills/被動技能/Icon_skill_passive_1180.webp', 'Icon_skill_passive_1180'],
    ['https://media.zlongame.com/x/skill/Icon_skill_order_1129.png?v=2', 'Icon_skill_order_1129'],
    ['/images/skills/主動技能/Icon_skill_main_凱登01.png', 'Icon_skill_main_凱登01'],
    ['  ', undefined], ['', undefined], [undefined, undefined],
  ]
  for (const [v, k] of cases) {
    assert.equal(keyFromValue(v), k, String(v))
    assert.equal(ts.keyFromValue(v), k, String(v))
  }
})

test('其他圖示（--other-icons）：別的模式收的整個名字都不收，其餘照官方資料夾', () => {
  const p = (folder, file) => `assets/gameproject/runtimeassets/ui/uiimages/uiicons/${folder}_abs/${file.toLowerCase()}.png`
  const row = (folder, name, type = 'Texture2D') => ({ name, type, asset_path: p(folder, name) })
  const rows = [
    row('skilltype', 'Icon_skill_main_1106'),                 // --icons
    row('bufftype', 'Icon_buff_1001', 'Sprite'),              // --icons（BUFF 字形只收 Sprite）
    row('bufftype', 'Icon_buff_1001'),                        //   同名的 Texture2D 也跟著交給 --icons
    row('bufftype', 'Icon_pilotclass_001_s', 'Sprite'),       // BUFF 資料夾裡的別種圖 → 收
    row('wapweapons', 'Icon_weapon_10100201'),                // --equip-icons
    row('wapweapons', 'Icon_Evacuation'),                     // 武器資料夾裡的關卡物件 → 收
    row('mecha', 'Icon_mecha_wap1071'),                       // --wap
    row('skynetwap', 'Icon_mecha_wap1071_SN_Raw'),            // --wap
    row('wapparts', 'Icon_wap1071_2'),                        // --wap
    row('mecha', 'Icon_mecha_Cannon02AG'),                    // 敵方車輛 → 收
    row('itemtype', 'Icon_item_10103174A'),                   // 機師卡 → --id
    row('itemtype', 'Icon_item_13038A'),                      // NPC 的卡（不是 8 碼 gameId）→ 收
    row('itemtype', 'Icon_wap2049_S1'), row('itemtype', 'Icon_wap2049_S1', 'Sprite'),   // 塗裝小圖 → 收，同路徑兩筆
    row('itemroguelike', 'Icon_roguelike_802481'),            // 圖庫命名但 --icons 不收 → 收
    { name: 'Img_main_bg', type: 'Texture2D', asset_path: 'assets/gameproject/runtimeassets/ui/uiimages/uilobbymain_abs/img_main_bg.png' },
  ]
  const out = otherIconPaths(rows)
  assert.deepEqual([...out.keys()].sort(), [
    'icons/bufftype/Icon_pilotclass_001_s', 'icons/itemroguelike/Icon_roguelike_802481', 'icons/itemtype/Icon_item_13038A',
    'icons/itemtype/Icon_wap2049_S1', 'icons/mecha/Icon_mecha_Cannon02AG', 'icons/wapweapons/Icon_Evacuation',
  ])
  assert.equal(out.get('icons/itemtype/Icon_wap2049_S1').length, 2)
  assert.equal(iconHandledElsewhere(row('itemtype', 'Icon_item_10103174A')), true)
  assert.equal(iconHandledElsewhere(row('itemtype', 'Icon_item_1071_1')), false)   // 機甲道具卡不是機師卡
})
