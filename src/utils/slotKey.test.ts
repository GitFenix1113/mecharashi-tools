// PLAN-052-A B-1：slotKey / parseSlotKey 的 round-trip 測試
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這對函式是全站取得槽位鍵的唯一入口。它們錯了不會有人發現 ——
// 鍵是字串，撞鍵的後果是「兩把武器的元件互相覆蓋」這種靜默錯誤，不是例外。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotKey, parseSlotKey, slotAcceptsSide, SLOT_BANKS } from '../types/slots.ts'
import type { SlotRef } from '../types/slots.ts'

/** 一台中甲機甲 ＋ 強襲者背包所能出現的全部格子（main 5 格 ＋ backup 2 格） */
const ALL_REFS: SlotRef[] = [
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
