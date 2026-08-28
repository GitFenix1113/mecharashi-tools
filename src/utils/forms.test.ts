// PLAN-052-A C-3：equipSetKeys 的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  equipSetKeys, hasIndependentLoadouts, equipSetLabel, lockedFormCards, DEFAULT_EQUIP_SET_KEY,
} from './forms.ts'

/** 線上 forms 集合的實際 6 筆（2026-08-24），加上 C-3 要落盤的 independentLoadout */
const FORMS = [
  { id: 'form_海莉絲_先鋒', pilotId: 'pilot_海莉絲', name: '先鋒', order: 1,
    independentLoadout: true, restrict: { kind: 'weaponType', allow: ['格鬥', '射擊'] } },
  { id: 'form_海莉絲_突擊', pilotId: 'pilot_海莉絲', name: '突擊', order: 2,
    independentLoadout: true, restrict: { kind: 'weaponType', allow: ['突擊'] } },
  { id: 'form_海莉絲_戰術', pilotId: 'pilot_海莉絲', name: '戰術', order: 3,
    independentLoadout: true, restrict: { kind: 'weaponType', allow: ['戰術'] } },
  { id: 'form_海莉絲_虛粒子', pilotId: 'pilot_海莉絲', name: '虛粒子', order: 4,
    restrict: { kind: 'fixedArmament', mounts: [] } },
  { id: 'form_曜_機兵', pilotId: 'pilot_曜', name: '機兵', order: 1,
    restrict: { kind: 'weaponType', allow: ['突擊', '格鬥', '射擊'] } },
  { id: 'form_曜_巡航', pilotId: 'pilot_曜', name: '巡航', order: 2,
    restrict: { kind: 'fixedArmament', mounts: [] } },
] as never

test('海莉絲 → 3 個分頁（虛粒子不佔分頁：鎖死整套，沒有東西可配）', () => {
  assert.deepEqual(equipSetKeys('pilot_海莉絲', FORMS), [
    'form_海莉絲_先鋒', 'form_海莉絲_突擊', 'form_海莉絲_戰術',
  ])
  assert.equal(hasIndependentLoadouts('pilot_海莉絲', FORMS), true)
})

test('曜 → default（有兩個形態，但共用同一套配裝）', () => {
  assert.deepEqual(equipSetKeys('pilot_曜', FORMS), [DEFAULT_EQUIP_SET_KEY])
  assert.equal(hasIndependentLoadouts('pilot_曜', FORMS), false)
})

test('其餘 87 位機師（無形態）→ default', () => {
  assert.deepEqual(equipSetKeys('pilot_艾達', FORMS), [DEFAULT_EQUIP_SET_KEY])
  assert.deepEqual(equipSetKeys('pilot_艾達', []), [DEFAULT_EQUIP_SET_KEY])
  assert.deepEqual(equipSetKeys('pilot_艾達', null), [DEFAULT_EQUIP_SET_KEY])
})

test('本旗標存在的理由：derive「weaponType 形態數」在曜身上就會靜默壞掉', () => {
  // 曜有一個 weaponType 形態（機兵）—— 用 derive 會開出一個分頁，
  // 但他實際上只有一套配裝。今天恰好只差一個分頁，換成兩個純戰鬥形態的新調構師就是兩個
  const derive = (FORMS as never as { pilotId: string; restrict: { kind: string } }[])
    .filter((f) => f.pilotId === 'pilot_曜' && f.restrict.kind === 'weaponType').length
  assert.equal(derive, 1)                                        // derive 說：開 1 個分頁
  assert.deepEqual(equipSetKeys('pilot_曜', FORMS), ['default']) // 事實：不開分頁
})

test('分頁順序依 order，且身分是 formId 而不是 order', () => {
  // order 只影響顯示順序；用它當身分的話，後台一次重排就讓既存分享碼指向另一個形態
  const 亂序 = [
    { id: 'form_x_c', pilotId: 'p', name: 'C', order: 3, independentLoadout: true, restrict: { kind: 'weaponType', allow: [] } },
    { id: 'form_x_a', pilotId: 'p', name: 'A', order: 1, independentLoadout: true, restrict: { kind: 'weaponType', allow: [] } },
    { id: 'form_x_b', pilotId: 'p', name: 'B', order: 2, independentLoadout: true, restrict: { kind: 'weaponType', allow: [] } },
  ] as never
  assert.deepEqual(equipSetKeys('p', 亂序), ['form_x_a', 'form_x_b', 'form_x_c'])
  // 回傳的是 id，不含任何 order 資訊
  assert.equal(equipSetKeys('p', 亂序).every((k) => k.startsWith('form_')), true)
})

test('independentLoadout 但 kind 是 fixedArmament → 不佔分頁（兩個條件都要成立）', () => {
  const 誤填 = [
    { id: 'form_y_鎖', pilotId: 'p', name: '鎖', order: 1,
      independentLoadout: true, restrict: { kind: 'fixedArmament', mounts: [] } },
  ] as never
  assert.deepEqual(equipSetKeys('p', 誤填), [DEFAULT_EQUIP_SET_KEY])
})

test('只回該機師自己的形態（不會把別人的形態算進來）', () => {
  assert.equal(equipSetKeys('pilot_海莉絲', FORMS).every((k) => k.includes('海莉絲')), true)
})

test('equipSetLabel：default 回 null（單一分頁不該渲染分頁列）', () => {
  assert.equal(equipSetLabel(DEFAULT_EQUIP_SET_KEY, FORMS), null)
  assert.equal(equipSetLabel('form_海莉絲_突擊', FORMS), '突擊')
  assert.equal(equipSetLabel('form_不存在', FORMS), null)
})

// ─── 唯讀形態卡（PLAN-052-F C-1）────────────────────────────────────────────

test('lockedFormCards：海莉絲 → 虛粒子一張（分頁列的另一半）', () => {
  assert.deepEqual(lockedFormCards('pilot_海莉絲', FORMS).map((f) => f.id), ['form_海莉絲_虛粒子'])
})

test('lockedFormCards：曜 → 0 張 —— 判準是「有沒有分頁列」，不是「有沒有 fixedArmament 形態」', () => {
  // 曜同樣有一個 fixedArmament 形態（巡航），但他沒有分頁列。
  // 畫一張孤零零的唯讀卡＝站上多出一個遊戲沒有的東西（使用者裁決 2026-08-28）。
  assert.equal(FORMS.filter((f) => f.pilotId === 'pilot_曜' && f.restrict.kind === 'fixedArmament').length, 1)
  assert.equal(hasIndependentLoadouts('pilot_曜', FORMS), false)
  assert.deepEqual(lockedFormCards('pilot_曜', FORMS), [])
})

test('lockedFormCards：沒有形態的機師 → 0 張', () => {
  assert.deepEqual(lockedFormCards('pilot_艾達', FORMS), [])
  assert.deepEqual(lockedFormCards('pilot_海莉絲', []), [])
  assert.deepEqual(lockedFormCards('pilot_海莉絲', null), [])
})

test('lockedFormCards：只回該機師自己的，且依 order 排序', () => {
  const 多鎖 = [
    { id: 'form_z_可配', pilotId: 'p', name: '可配', order: 1,
      independentLoadout: true, restrict: { kind: 'weaponType', allow: [] } },
    { id: 'form_z_鎖B', pilotId: 'p', name: '鎖B', order: 9, restrict: { kind: 'fixedArmament', mounts: [] } },
    { id: 'form_z_鎖A', pilotId: 'p', name: '鎖A', order: 2, restrict: { kind: 'fixedArmament', mounts: [] } },
    { id: 'form_別人_鎖', pilotId: 'q', name: '別人', order: 1, restrict: { kind: 'fixedArmament', mounts: [] } },
  ] as never
  assert.deepEqual(lockedFormCards('p', 多鎖).map((f) => f.id), ['form_z_鎖A', 'form_z_鎖B'])
})
