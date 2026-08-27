// PLAN-052-A B-1：slotKey / parseSlotKey 的 round-trip 測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這對函式是全站取得槽位鍵的唯一入口。它們錯了不會有人發現 ——
// 鍵是字串，撞鍵的後果是「兩把武器的元件互相覆蓋」這種靜默錯誤，不是例外。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotKey, parseSlotKey, slotAcceptsSide, isModuleSlotRef, SLOT_BANKS } from '../types/slots.ts'
import type { ModuleSlotRef, WeaponSlotRef } from '../types/slots.ts'
import { MechPartPosition } from '../types/enums.ts'

/** 一台中甲機甲 ＋ 強襲者背包所能出現的全部格子（main 5 格 ＋ backup 2 格） */
const ALL_REFS: WeaponSlotRef[] = [
  { bank: 'main',   slot: 'singleHand', side: 'left' },
  { bank: 'main',   slot: 'singleHand', side: 'right' },
  { bank: 'main',   slot: 'dualHand' },
  { bank: 'main',   slot: 'shoulder',   side: 'left' },
  { bank: 'main',   slot: 'shoulder',   side: 'right' },
  { bank: 'main',   slot: 'back' },
  { bank: 'backup', slot: 'singleHand', side: 'left' },
  { bank: 'backup', slot: 'singleHand', side: 'right' },
  { bank: 'backup', slot: 'dualHand' },
]

test('round-trip：每一格 parse(key(ref)) 都回到原 ref', () => {
  for (const ref of ALL_REFS) {
    assert.deepEqual(parseSlotKey(slotKey(ref)), ref, `${JSON.stringify(ref)} 沒有 round-trip`)
  }
})

test('鍵的格式就是 bank:slot:side，有 side 才有第三段', () => {
  assert.equal(slotKey({ bank: 'main', slot: 'singleHand', side: 'left' }), 'main:singleHand:left')
  assert.equal(slotKey({ bank: 'main', slot: 'dualHand' }), 'main:dualHand')
  assert.equal(slotKey({ bank: 'backup', slot: 'singleHand', side: 'right' }), 'backup:singleHand:right')
  assert.equal(slotKey({ bank: 'main', slot: 'back' }), 'main:back')
})

test('本函式存在的理由：少了 bank 這一段，主手左手與備用左手會撞鍵', () => {
  const 主手左 = slotKey({ bank: 'main', slot: 'singleHand', side: 'left' })
  const 備用左 = slotKey({ bank: 'backup', slot: 'singleHand', side: 'left' })
  assert.notEqual(主手左, 備用左)
  // 全部 9 格互不相同（撞鍵 ＝ 兩把武器的元件互相覆蓋，且是靜默的）
  assert.equal(new Set(ALL_REFS.map(slotKey)).size, ALL_REFS.length)
})

test('畸形輸入一律回 null，不拋例外（分享碼與 URL 參數會餵進外部字串）', () => {
  for (const bad of [
    '', 'main', 'main:singleHand:left:extra', 'MAIN:singleHand:left',
    'mane:singleHand:left', 'main:singleHand:middle', 'main::left', ':singleHand:left',
    'main:singleHand:LEFT', 'backup', 'x',
  ]) {
    assert.equal(parseSlotKey(bad), null, `${JSON.stringify(bad)} 應為 null`)
  }
})

test('不校驗 slot 值域：未知的 slot 仍解析得出來（舊分享碼不因改版靜默失效）', () => {
  // WeaponEquipSlot 會隨遊戲改版增值，在這裡擋下只會讓既存分享碼壞掉；
  // 合法性由容量表在消費端自然過濾
  assert.deepEqual(parseSlotKey('main:tail'), { bank: 'main', slot: 'tail' })
})

test('slotAcceptsSide：只有單手與肩部分左右', () => {
  assert.equal(slotAcceptsSide('singleHand'), true)
  assert.equal(slotAcceptsSide('shoulder'), true)
  assert.equal(slotAcceptsSide('dualHand'), false)   // 同時佔據左右臂，沒有「哪一邊」可談
  assert.equal(slotAcceptsSide('back'), false)
})

test('SLOT_BANKS 是 bank 的唯一列舉來源', () => {
  assert.deepEqual([...SLOT_BANKS], ['main', 'backup'])
})

// ─── 模組 kind（PLAN-052-G A-2）─────────────────────────────────────────────
//
// 聯集多一個成員之後，「parseSlotKey(slotKey(ref)) 恆等於 ref 正規形」這條不變式
// 必須對**兩種 kind 都**成立 —— 破了它的症狀與武器側一樣是靜默的：
// 模組面板拿一個解不回來的鍵去查已裝模組，畫面只會顯示「未裝」。

const ALL_MODULE_REFS: ModuleSlotRef[] = [
  { kind: 'module', position: MechPartPosition.TORSO },
  { kind: 'module', position: MechPartPosition.LEFT_ARM },
  { kind: 'module', position: MechPartPosition.RIGHT_ARM },
  { kind: 'module', position: MechPartPosition.LEGS },
]

test('round-trip：四個模組接口 parse(key(ref)) 都回到原 ref', () => {
  for (const ref of ALL_MODULE_REFS) {
    assert.deepEqual(parseSlotKey(slotKey(ref)), ref, `${JSON.stringify(ref)} 沒有 round-trip`)
  }
})

test('模組鍵的格式就是 module:position', () => {
  assert.equal(slotKey({ kind: 'module', position: MechPartPosition.TORSO }), 'module:torso')
  assert.equal(slotKey({ kind: 'module', position: MechPartPosition.LEGS }), 'module:legs')
})

test('模組鍵與武器鍵永不撞號（module 不可能是一個 bank）', () => {
  const keys = [...ALL_REFS, ...ALL_MODULE_REFS].map(slotKey)
  assert.equal(new Set(keys).size, keys.length)
  // 反向也要成立：任何武器鍵都解不成模組 ref，反之亦然
  for (const ref of ALL_REFS) assert.equal(parseSlotKey(slotKey(ref))?.kind, undefined)
  for (const ref of ALL_MODULE_REFS) assert.equal(parseSlotKey(slotKey(ref))?.kind, 'module')
})

test('武器側的正規形不帶 kind：明寫 kind:weapon 也產生同一個鍵', () => {
  // `kind` 選填的代價就是這條：兩種寫法必須是同一格，否則同一把武器會有兩個鍵
  assert.equal(
    slotKey({ kind: 'weapon', bank: 'main', slot: 'singleHand', side: 'left' }),
    slotKey({ bank: 'main', slot: 'singleHand', side: 'left' }),
  )
})

test('模組鍵校驗 position 值域（它不進分享碼，認不得就是打錯了）', () => {
  for (const bad of ['module:torsoo', 'module:', 'module', 'module:torso:left', 'Module:torso', 'module:main']) {
    assert.equal(parseSlotKey(bad), null, `${JSON.stringify(bad)} 應為 null`)
  }
})

test('isModuleSlotRef 是全站唯一的 narrow 入口', () => {
  assert.equal(isModuleSlotRef({ kind: 'module', position: MechPartPosition.TORSO }), true)
  assert.equal(isModuleSlotRef({ bank: 'main', slot: 'back' }), false)
  assert.equal(isModuleSlotRef({ kind: 'weapon', bank: 'main', slot: 'back' }), false)
})
