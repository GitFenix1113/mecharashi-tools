// PLAN-059 B-3：機甲類型（＝駕照）單一來源
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ArmorType, MechLicense } from '../types/enums.ts'
import { licenseAllows } from '../utils/normalizeArmorType.ts'
import { ALL_MECH_TYPES, MECH_WEIGHT_CLASSES, mechWeightBadgeClass, mechWeightClassOf, mechWeightIconKey, mechWeightShort } from './mechWeightClasses.ts'

const iconFile = (key: string) => new URL(`../../public/images/game/icons/license/${key}.webp`, import.meta.url)

test('5 種寫法都認得，指到同一筆', () => {
  for (const raw of ['中甲', '中型', 'Medium', 'medium', ' 中型 ']) assert.equal(mechWeightClassOf(raw)?.armorType, ArmorType.MEDIUM, raw)
  for (const raw of ['輕型', 'Light', 'light']) assert.equal(mechWeightClassOf(raw)?.armorType, ArmorType.LIGHT, raw)
  for (const raw of ['重型', 'Heavy', 'heavy']) assert.equal(mechWeightClassOf(raw)?.armorType, ArmorType.HEAVY, raw)
})

test('不是一種類型的值回 undefined（不猜）：武器的 none、空值、亂打', () => {
  for (const raw of ['none', '', undefined, null, '中甲機甲', '全機型']) assert.equal(mechWeightClassOf(raw), undefined, String(raw))
})

test('顯示短名：輕甲／中甲／重甲不再出現；認不得就原樣', () => {
  assert.equal(mechWeightShort('中甲'), '中型')
  assert.equal(mechWeightShort('Light'), '輕型')
  assert.equal(mechWeightShort('heavy'), '重型')
  assert.equal(mechWeightShort('怪東西'), '怪東西')
  assert.deepEqual(MECH_WEIGHT_CLASSES.map((m) => m.short), ['輕型', '中型', '重型'])
  assert.deepEqual(MECH_WEIGHT_CLASSES.map((m) => m.full), ['輕型機甲', '中型機甲', '重型機甲'])
})

test('對照與 licenseAllows 一致：同一筆對照 ⟺ 駕照開得動', () => {
  for (const license of Object.values(MechLicense)) {
    for (const armor of Object.values(ArmorType)) {
      assert.equal(mechWeightClassOf(license) === mechWeightClassOf(armor), licenseAllows(license, armor), `${license} × ${armor}`)
    }
  }
})

test('圖示：001 輕、002 中、003 重的 _l／_s，與「全機型」004_l 都在圖庫裡', () => {
  assert.equal(mechWeightIconKey('中甲', 'l'), 'Icon_wanzertype_002_l')
  assert.equal(mechWeightIconKey('Light', 's'), 'Icon_wanzertype_001_s')
  assert.equal(mechWeightIconKey('none', 's'), undefined)
  for (const m of MECH_WEIGHT_CLASSES) {
    for (const size of ['l', 's'] as const) {
      const key = mechWeightIconKey(m.armorType, size)!
      assert.ok(fs.existsSync(iconFile(key)), `缺 ${key}.webp`)
    }
  }
  assert.ok(fs.existsSync(iconFile(`Icon_wanzertype_${ALL_MECH_TYPES.icon}_l`)))
})

test('配色統一青綠紅；認不得給中性樣式', () => {
  assert.deepEqual(MECH_WEIGHT_CLASSES.map((m) => m.text), ['text-accent-cyan', 'text-accent-green', 'text-accent-red'])
  assert.equal(mechWeightBadgeClass('重型'), 'text-accent-red bg-accent-red/10 border-accent-red/40')
  assert.equal(mechWeightBadgeClass('none'), 'text-text-secondary bg-bg-card border-border')
})
