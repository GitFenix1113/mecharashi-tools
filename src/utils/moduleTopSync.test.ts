// PLAN-058 決策二：模組頂層＝LV.MAX 的鏡像，只由程式在存檔時寫入
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這份測試守的是「鏡像是逐欄副本」：頂層描述與數值欄位要和 LV.MAX 一字不差，
// 否則稽核腳本會比對出假的不一致，而維護者又會回頭去手改頂層。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Module, ModuleLevel } from '../types/module.ts'
import { MODULE_STAT_KEYS, moduleTopLevel, syncModuleTopFromMaxLevel } from './moduleRules.ts'

const BASE_STATS = {
  dmg: 0, crit_rate: 0, critDmg: 0, acc_rate: 0, firepower_rate: 0, armor_rate: 0,
  crit_resist_rate: 0, output_bonus: 0, dodge_rate: 0, durable_rate: 0, dmg_resist_rate: 0,
}

const lv = (level: number, description: string, extra: Partial<ModuleLevel> = {}): ModuleLevel =>
  ({ level, description, ...BASE_STATS, ...extra })

const mod = (over: Partial<Module>): Module => ({
  id: 'mod_t', name: 't', slot: '通用模組', boundMechId: null, boundPart: null, rarity: 'S',
  description: '', ...BASE_STATS, ...over,
})

test('moduleTopLevel：以 level 欄位取最大，不靠陣列順序', () => {
  const m = mod({ levels: [lv(2, 'b'), lv(4, 'd'), lv(1, 'a'), lv(3, 'c')] })
  assert.equal(moduleTopLevel(m)?.level, 4)
  assert.equal(moduleTopLevel(mod({ levels: [] })), null)
  assert.equal(moduleTopLevel(mod({})), null)
})

test('鏡像：頂層描述改成 LV.MAX（燎原模組型：頂層與等級各改了一半）', () => {
  const m = mod({
    description: '舊的頂層描述',
    levels: [lv(1, '傷害提升2%'), lv(2, '傷害提升12%；場上每有1格友方[燃燒地形]')],
  })
  const out = syncModuleTopFromMaxLevel(m)
  assert.equal(out.description, '傷害提升12%；場上每有1格友方[燃燒地形]')
  assert.notEqual(out, m, '要回新物件，不可原地改寫表單狀態')
  assert.equal(m.description, '舊的頂層描述')
})

test('鏡像：數值逐欄覆寫 —— 電磁炮模組Ⅱ型的錯欄（頂層填了浮游炮）要被清掉', () => {
  const m = mod({
    dmg_funnel: 10, dmg_tactical: 8,
    levels: [lv(1, 'a', { dmg_railgun: 3 }), lv(4, 'd', { dmg_railgun: 10 })],
  })
  const out = syncModuleTopFromMaxLevel(m)
  assert.equal(out.dmg_railgun, 10)
  assert.equal('dmg_funnel' in out, false, 'LV.MAX 沒有的選填欄位要移除，不是留著舊值')
  assert.equal('dmg_tactical' in out, false)
})

test('鏡像：必填欄位 LV.MAX 沒有時補 0（型別是 number，不能刪）', () => {
  const m = mod({ dmg: 24, levels: [{ level: 1, description: 'x' } as ModuleLevel] })
  const out = syncModuleTopFromMaxLevel(m)
  assert.equal(out.dmg, 0)
  assert.equal(out.critDmg, 0)
})

test('鏡像：descriptionRefs 不動（頂層那份是各等級回退用的共用引用表）', () => {
  const refs = { 燃燒地形: { refType: 'term' as const, refId: 'TERM_燃燒地形' } }
  const m = mod({ descriptionRefs: refs, levels: [lv(1, '[燃燒地形]')] })
  assert.equal(syncModuleTopFromMaxLevel(m).descriptionRefs, refs)
})

test('鏡像：沒有 levels 時原樣回傳（新建中的模組仍以頂層暫存）', () => {
  const m = mod({ description: '先寫在頂層', dmg: 5 })
  assert.equal(syncModuleTopFromMaxLevel(m), m)
})

test('鏡像後再鏡像一次不變（冪等）', () => {
  const m = mod({ levels: [lv(1, 'a', { dmg_blade: 3 }), lv(2, 'b', { dmg_blade: 6, dmg: 1 })] })
  const once = syncModuleTopFromMaxLevel(m)
  assert.deepEqual(syncModuleTopFromMaxLevel(once), once)
})

test('MODULE_STAT_KEYS 涵蓋所有數值欄位，且不含 level／描述', () => {
  assert.equal(MODULE_STAT_KEYS.length, 32)
  for (const k of ['level', 'description', 'descriptionRefs']) {
    assert.equal((MODULE_STAT_KEYS as string[]).includes(k), false, k)
  }
})
