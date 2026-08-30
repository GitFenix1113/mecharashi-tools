// PLAN-052-N B-1：天賦配裝修正的解析層
//   npm test   →   node --test "src/**/*.test.ts"
//
// 資料全部取自線上 pilots 集合（2026-08-30 由 A-3 寫入的 11 條規則），
// 武器重量取自線上 weapons 集合。這裡守的是「規則怎麼套」，
// 整套配裝的總重對帳在 loadoutRules.test.ts（B-4 的維娜 golden case）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Backpack, Pilot, Weapon } from '../types'
import { MAX_POTENTIAL, TALENT_BOOST_POTENTIAL, resolveTalentMods } from './talentLoadoutMods.ts'

// ── 測試替身 ────────────────────────────────────────────────────────────────
const weapon = (kind: string, weight: number, id = `w_${kind}`) =>
  ({ id, kind, weight } as Pick<Weapon, 'id' | 'kind' | 'weight'>)
const backpack = (type: string, weight: number, id = `b_${type}`) =>
  ({ id, type, weight } as Pick<Backpack, 'id' | 'type' | 'weight'>)

const pilotWith = (...mods: unknown[]) => ({
  talents: [{ name: '測試天賦', description: '', descriptionMax: '', loadoutMods: mods }],
} as unknown as Pilot)

// 線上實測值
const 炬塔改Ⅱ = weapon('電磁炮', 1100, 'weapon_131_炬塔_改_')
const 熔火     = weapon('火箭', 1200, 'weapon_044_熔火')
const 修理背包 = backpack('Heal', 900, 'bp_heal')

// ── 沒有規則的機師（89 位裡的 71 位）────────────────────────────────────────

test('無天賦規則 → empty，重量原樣回傳', () => {
  const m = resolveTalentMods(pilotWith())
  assert.equal(m.empty, true)
  assert.equal(m.weaponWeight(炬塔改Ⅱ), 1100)
  assert.equal(m.weaponWeightInfo(炬塔改Ⅱ), null, '沒有修正時回 null，UI 據此不印那一句')
  assert.equal(m.allowsWeapon(炬塔改Ⅱ), false)
})

test('null 機師（還沒選）→ empty，不可拋錯', () => {
  const m = resolveTalentMods(null)
  assert.equal(m.empty, true)
  assert.equal(m.weaponWeight(炬塔改Ⅱ), 1100)
  assert.equal(m.backpackWeight(修理背包), 900)
})

// ── 維娜〈罪業信條〉：解除限制 ＋ flat 減重 ──────────────────────────────────

const 維娜 = pilotWith(
  { kind: 'allowEquip', target: { on: 'weaponKind', kind: '電磁炮' }, since: 'base' },
  { kind: 'stat', target: { on: 'weaponKind', kind: '電磁炮' }, stat: 'weight', mode: 'flat', amount: -360, since: 'base' },
)

test('維娜：電磁炮解除機種限制、負重 1100 → 740', () => {
  const m = resolveTalentMods(維娜)
  assert.equal(m.empty, false)
  assert.equal(m.allowsWeapon(炬塔改Ⅱ), true)
  assert.equal(m.weaponWeight(炬塔改Ⅱ), 740)

  const info = m.weaponWeightInfo(炬塔改Ⅱ)
  assert.equal(info?.base, 1100)
  assert.equal(info?.value, 740)
  assert.equal(info?.reducedBy, 360)
  assert.equal(info?.talentName, '測試天賦', 'UI 要印出是哪個天賦減的')
})

test('維娜：規則只作用在電磁炮，別的武器一律原重', () => {
  const m = resolveTalentMods(維娜)
  assert.equal(m.weaponWeight(熔火), 1200)
  assert.equal(m.allowsWeapon(熔火), false, '解除限制不可外溢到其他種類')
  assert.equal(m.weaponWeightInfo(熔火), null)
})

test('維娜：allowEquip 不影響重量、stat 不影響合法性（兩者是獨立的軸）', () => {
  const onlyAllow = resolveTalentMods(pilotWith(
    { kind: 'allowEquip', target: { on: 'weaponKind', kind: '電磁炮' }, since: 'base' },
  ))
  assert.equal(onlyAllow.allowsWeapon(炬塔改Ⅱ), true)
  assert.equal(onlyAllow.weaponWeight(炬塔改Ⅱ), 1100, 'allowEquip 沒有值，不該動到重量')

  const onlyStat = resolveTalentMods(pilotWith(
    { kind: 'stat', target: { on: 'weaponKind', kind: '電磁炮' }, stat: 'weight', mode: 'flat', amount: -360, since: 'base' },
  ))
  assert.equal(onlyStat.allowsWeapon(炬塔改Ⅱ), false, '減重不等於可以裝')
  assert.equal(onlyStat.weaponWeight(炬塔改Ⅱ), 740)
})

// ── 瑪汀妮〈良藥苦機〉：背包側 ──────────────────────────────────────────────

test('瑪汀妮：修理背包解除限制 ＋ 負重 −300', () => {
  const m = resolveTalentMods(pilotWith(
    { kind: 'allowEquip', target: { on: 'backpackType', type: 'Heal' }, since: 'base' },
    { kind: 'stat', target: { on: 'backpackType', type: 'Heal' }, stat: 'weight', mode: 'flat', amount: -300, since: 'base' },
  ))
  assert.equal(m.allowsBackpack(修理背包), true)
  assert.equal(m.backpackWeight(修理背包), 600)
  assert.equal(m.allowsBackpack(backpack('Ammo', 500)), false, '只解除修理背包')
  assert.equal(m.backpackWeight(backpack('Ammo', 500)), 500)
  assert.equal(m.allowsWeapon(炬塔改Ⅱ), false, '背包規則不可命中武器')
})

// ── 凱莉〈白鸛〉：全庫唯一的百分比 ──────────────────────────────────────────

test('凱莉：狙擊步槍負重 −15%（pct 存小數）', () => {
  const m = resolveTalentMods(pilotWith(
    { kind: 'stat', target: { on: 'weaponKind', kind: '狙擊步槍' }, stat: 'weight', mode: 'pct', amount: -0.15, since: 'base' },
  ))
  assert.equal(m.weaponWeight(weapon('狙擊步槍', 1000)), 850)
  assert.equal(m.weaponWeight(weapon('輕型狙擊步槍', 1000)), 1000,
    '使用者裁決 2026-08-30：按字面只含「狙擊步槍」，輕型是另一個 WeaponKind')
})

// ── 潛能門檻（洛莎／艾琳／里貝卡的減重只在提升後）────────────────────────────

const 洛莎 = pilotWith(
  { kind: 'stat', target: { on: 'weaponKind', kind: '機槍' }, stat: 'weight', mode: 'flat', amount: -80, since: 'max' },
)
const 機槍 = weapon('機槍', 420)

test('since:max —— 潛能未達第 3 階時整條規則不存在', () => {
  for (const p of [0, 1, 2]) {
    assert.equal(resolveTalentMods(洛莎, p).weaponWeight(機槍), 420, `潛能 ${p} 不該減重`)
    assert.equal(resolveTalentMods(洛莎, p).empty, true, `潛能 ${p} 應該連 empty 都成立`)
  }
})

test('since:max —— 潛能 3 起生效，直到滿潛', () => {
  for (const p of [TALENT_BOOST_POTENTIAL, 4, MAX_POTENTIAL]) {
    assert.equal(resolveTalentMods(洛莎, p).weaponWeight(機槍), 340, `潛能 ${p} 應該減 80`)
  }
})

test('未指定潛能 ＝ 滿潛（站上資料本身就是滿潛快照）', () => {
  assert.equal(resolveTalentMods(洛莎).weaponWeight(機槍), 340)
})

test('base 規則不受潛能影響', () => {
  assert.equal(resolveTalentMods(維娜, 0).weaponWeight(炬塔改Ⅱ), 740)
  assert.equal(resolveTalentMods(維娜, 0).allowsWeapon(炬塔改Ⅱ), true)
})

// ── 多條規則的合成（今天 0 筆，但順序必須現在就定死）────────────────────────

test('flat 與 pct 同時命中：pct 一律基於原值，故順序無關', () => {
  const m = resolveTalentMods(pilotWith(
    { kind: 'stat', target: { on: 'weaponKind', kind: '機槍' }, stat: 'weight', mode: 'flat', amount: -80, since: 'base' },
    { kind: 'stat', target: { on: 'weaponKind', kind: '機槍' }, stat: 'weight', mode: 'pct', amount: -0.5, since: 'base' },
  ))
  // 1000 * (1 − 0.5) − 80 = 420；若 pct 基於「加完 flat」會得到 460
  assert.equal(m.weaponWeight(weapon('機槍', 1000)), 420)

  const reversed = resolveTalentMods(pilotWith(
    { kind: 'stat', target: { on: 'weaponKind', kind: '機槍' }, stat: 'weight', mode: 'pct', amount: -0.5, since: 'base' },
    { kind: 'stat', target: { on: 'weaponKind', kind: '機槍' }, stat: 'weight', mode: 'flat', amount: -80, since: 'base' },
  ))
  assert.equal(reversed.weaponWeight(weapon('機槍', 1000)), 420, '寫入順序不可改變結果')
})

test('減到負數要 clamp 成 0 —— 重量不可能是負的', () => {
  const m = resolveTalentMods(pilotWith(
    { kind: 'stat', target: { on: 'weaponKind', kind: '機槍' }, stat: 'weight', mode: 'flat', amount: -999, since: 'base' },
  ))
  assert.equal(m.weaponWeight(weapon('機槍', 420)), 0)
})

// ── 對象與屬性的鑑別 ────────────────────────────────────────────────────────

test('weaponId 對象：只命中那一把', () => {
  const m = resolveTalentMods(pilotWith(
    { kind: 'stat', target: { on: 'weaponId', id: 'weapon_131_炬塔_改_' }, stat: 'weight', mode: 'flat', amount: -100, since: 'base' },
  ))
  assert.equal(m.weaponWeight(炬塔改Ⅱ), 1000)
  assert.equal(m.weaponWeight(weapon('電磁炮', 1100, 'weapon_049_炬塔')), 1100, '同種類但不同 id 不受影響')
})

test('屬性要分開算：改彈量的規則不可動到重量', () => {
  const m = resolveTalentMods(pilotWith(
    { kind: 'stat', target: { on: 'weaponKind', kind: '電磁炮' }, stat: 'ammoCount', mode: 'flat', amount: 2, since: 'base' },
  ))
  assert.equal(m.weaponWeight(炬塔改Ⅱ), 1100, '彈量規則不該讓武器變輕')
  assert.equal(m.weaponStat(炬塔改Ⅱ, 'ammoCount', 3)?.value, 5)
  assert.equal(m.weaponStat(炬塔改Ⅱ, 'maxRange', 5), null, '沒有射程規則就回 null')
})
