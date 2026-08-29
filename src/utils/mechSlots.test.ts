// PLAN-052-A B-2：槽位容量與兩支佔用 derive 的單元測試
//   npm test   →   node --test "src/**/*.test.ts"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mechSlotCapacity, loadoutSlotCapacity, backpackBackupHandSlots, enumerateSlots,
  occupiedSlots, lockedSlots, BACKUP_HAND_SLOTS, BACKUP_EQUIPMENT_BACKPACK_ID,
} from './mechSlots.ts'
import { slotKey } from '../types/slots.ts'

const 輕型 = { armorType: '輕型' }
const 中甲 = { armorType: '中甲' }
const 重型 = { armorType: '重型' }
const 強襲者背包 = { id: BACKUP_EQUIPMENT_BACKPACK_ID, type: 'BackupEquipment' }
const 出力背包Ⅲ = { id: '60100104', type: 'PowerAdd' }

test('肩槽只有中甲有（實測 90/90 無例外：25 把肩部武器 100% 限中甲）', () => {
  assert.equal(mechSlotCapacity(中甲).shoulder, 2)
  assert.equal(mechSlotCapacity(輕型).shoulder, 0)
  assert.equal(mechSlotCapacity(重型).shoulder, 0)
})

test('背槽全機種都有 —— 給 0 會讓 35 個「僅輕型可裝」的背包永遠無處可裝', () => {
  for (const m of [輕型, 中甲, 重型]) assert.equal(mechSlotCapacity(m).back, 1)
  // 背部「武器」22 把雖然 100% 限中甲，但那是 Weapon.mechRestriction 的事，不是容量的事
})

test('手部恆 2 格、備用恆 0（備用由背包給）', () => {
  for (const m of [輕型, 中甲, 重型]) {
    assert.equal(mechSlotCapacity(m).singleHand, 2)
    assert.equal(mechSlotCapacity(m).backupHand, 0)
  }
})

test('90 台快照：三種裝甲類型的容量表完全固定', () => {
  // 實測分布 輕型 27／中甲 36／重型 27，各型內部無例外 → 只需三個快照
  assert.deepEqual(mechSlotCapacity(輕型), { singleHand: 2, shoulder: 0, back: 1, backupHand: 0 })
  assert.deepEqual(mechSlotCapacity(中甲), { singleHand: 2, shoulder: 2, back: 1, backupHand: 0 })
  assert.deepEqual(mechSlotCapacity(重型), { singleHand: 2, shoulder: 0, back: 1, backupHand: 0 })
  // ⚠ '中型' 是 MechLicense 的值、不是 ArmorType —— 混用時不得意外拿到肩槽
  assert.equal(mechSlotCapacity({ armorType: '中型' }).shoulder, 0)
  assert.equal(mechSlotCapacity(null).shoulder, 0)
})

test('備用槽由背包給，且只有強襲者背包給得出來（181 筆中僅此一筆）', () => {
  assert.equal(backpackBackupHandSlots(強襲者背包), BACKUP_HAND_SLOTS)
  assert.equal(backpackBackupHandSlots(出力背包Ⅲ), 0)
  assert.equal(backpackBackupHandSlots(null), 0)
  assert.equal(loadoutSlotCapacity(中甲, 強襲者背包).backupHand, 2)
  assert.equal(loadoutSlotCapacity(中甲, 出力背包Ⅲ).backupHand, 0)
  assert.equal(loadoutSlotCapacity(中甲).backupHand, 0)
})

test('判定走 type 而不是 doc id（換 id 或新增同型背包都不該漏判）', () => {
  // 存成變數再傳：這兩筆刻意多帶 id（本則測的就是「id 不參與判定」），
  // 直接寫成字面值會被 TS 的 excess property check 擋下來
  const 換了id的強襲者背包 = { id: '99999999', type: 'BackupEquipment' }
  const 借了強襲者id的補血背包 = { id: BACKUP_EQUIPMENT_BACKPACK_ID, type: 'Heal' }
  assert.equal(backpackBackupHandSlots(換了id的強襲者背包), 2)
  assert.equal(backpackBackupHandSlots(借了強襲者id的補血背包), 0)
})

test('enumerateSlots：中甲＋強襲者背包 ＝ 7 格，順序固定且鍵互不相同', () => {
  const refs = enumerateSlots(loadoutSlotCapacity(中甲, 強襲者背包))
  assert.deepEqual(refs.map(slotKey), [
    'main:singleHand:left', 'main:singleHand:right',
    'main:shoulder:left', 'main:shoulder:right',
    'main:back',
    'backup:singleHand:left', 'backup:singleHand:right',
  ])
  assert.equal(new Set(refs.map(slotKey)).size, refs.length)
})

test('enumerateSlots 不列 dualHand —— 雙手武器佔的是兩格單手，不是第三格', () => {
  const refs = enumerateSlots(mechSlotCapacity(輕型))
  assert.equal(refs.filter((r) => r.slot === 'dualHand').length, 0)
  assert.deepEqual(refs.map(slotKey), ['main:singleHand:left', 'main:singleHand:right', 'main:back'])
})

// ─── 佔據型 ───────────────────────────────────────────────────────────────

const 帕斯卡 = {
  leftArm:  { fixedArmament: [{ weaponId: 'weapon_衝擊炮', slot: 'shoulder', side: 'left' }] },
  rightArm: { fixedArmament: [{ weaponId: 'weapon_衝擊炮', slot: 'shoulder', side: 'right' }] },
} as never

test('佔據型：同一把衝擊炮掛左右兩肩 ＝ 兩格，不能用 weaponId 當鍵', () => {
  const occ = occupiedSlots(帕斯卡)
  assert.equal(occ.size, 2)                                  // 用 weaponId 當鍵只會得到 1
  assert.equal(occ.get('main:shoulder:left' as never)?.sourcePart, 'leftArm')
  assert.equal(occ.get('main:shoulder:right' as never)?.sourcePart, 'rightArm')
  // 其餘格子照常可換 —— 這就是「佔據型」與「全鎖型」的差別
  assert.equal(occ.has('main:singleHand:left' as never), false)
  assert.equal(occ.has('main:back' as never), false)
})

test('佔據型：side 未填時由部件位置補（左臂 → 左肩、右臂 → 右肩）', () => {
  const 未填side = {
    leftArm:  { fixedArmament: [{ weaponId: 'w1', slot: 'shoulder' }] },
    rightArm: { fixedArmament: [{ weaponId: 'w1', slot: 'shoulder' }] },
  } as never
  const occ = occupiedSlots(未填side)
  assert.equal(occ.size, 2)
  assert.deepEqual([...occ.keys()].sort(), ['main:shoulder:left', 'main:shoulder:right'])
})

test('佔據型：沒有固定武裝 ／ legacy 部位 ／ 空值一律回空 Map，不炸', () => {
  assert.equal(occupiedSlots({ torso: {}, legs: {} } as never).size, 0)
  assert.equal(occupiedSlots({ torso: 3200, legs: 2400 } as never).size, 0)  // MechPartsLegacy
  assert.equal(occupiedSlots(null).size, 0)
  assert.equal(occupiedSlots(undefined).size, 0)
})

test('佔據型：背部固定武裝不吃 side（單格武裝）', () => {
  const occ = occupiedSlots({ torso: { fixedArmament: [{ weaponId: 'w', slot: 'back' }] } } as never)
  assert.deepEqual([...occ.keys()], ['main:back'])
})

// ─── 全鎖型 ───────────────────────────────────────────────────────────────

const 虛粒子 = {
  id: 'form_海莉絲_虛粒子', name: '虛粒子',
  restrict: { kind: 'fixedArmament', weaponIds: ['weapon_176_耀星', 'weapon_177_隕星', 'weapon_178_千星'] },
} as never
const 先鋒 = {
  id: 'form_海莉絲_先鋒', name: '先鋒',
  restrict: { kind: 'weaponType', allow: ['格鬥', '射擊'] },
} as never

test('全鎖型：只有 restrict.kind === fixedArmament 的形態會鎖', () => {
  const lock = lockedSlots(虛粒子)
  assert.equal(lock?.formId, 'form_海莉絲_虛粒子')
  assert.deepEqual(lock?.weaponIds, ['weapon_176_耀星', 'weapon_177_隕星', 'weapon_178_千星'])
  assert.equal(lockedSlots(先鋒), null)
  assert.equal(lockedSlots(null), null)
})

test('全鎖型：C-3 落盤前 mounts 是 undefined，且不得從 weaponIds 反推槽位', () => {
  // 耀星／隕星在手上、千星在**背部** —— 一律猜 singleHand 會把錯的事寫成肯定陳述
  assert.equal(lockedSlots(虛粒子)?.mounts, undefined)
})

test('全鎖型：C-3 升級成 mounts 之後，weaponIds 仍取得到（呼叫端不必改）', () => {
  const 升級後 = {
    id: 'form_海莉絲_虛粒子', name: '虛粒子',
    restrict: { kind: 'fixedArmament', mounts: [
      { weaponId: 'weapon_176_耀星', slot: 'singleHand', side: 'right' },
      { weaponId: 'weapon_177_隕星', slot: 'singleHand', side: 'left' },
      { weaponId: 'weapon_178_千星', slot: 'back' },
    ] },
  } as never
  const lock = lockedSlots(升級後)
  assert.deepEqual(lock?.weaponIds, ['weapon_176_耀星', 'weapon_177_隕星', 'weapon_178_千星'])
  assert.equal(lock?.mounts?.length, 3)
  assert.deepEqual(
    lock?.mounts?.map((m) => slotKey({ bank: 'main', slot: m.slot, side: m.side })),
    ['main:singleHand:right', 'main:singleHand:left', 'main:back'],
  )
})

test('兩支 derive 禁止合併：佔據型只擋幾格、全鎖型擋全部，且來源層級不同', () => {
  // 破曉者-01（機甲資料）：肩槽被佔，但手部與背部仍可自由更換
  const 破曉者 = {
    leftArm:  { fixedArmament: [{ weaponId: 'weapon_嵐質儲能艙', slot: 'shoulder', side: 'left' }] },
    rightArm: { fixedArmament: [{ weaponId: 'weapon_嵐質儲能艙', slot: 'shoulder', side: 'right' }] },
  } as never
  assert.equal(occupiedSlots(破曉者).size, 2)
  assert.equal(occupiedSlots(破曉者).has('main:back' as never), false)   // 佔據型：背部仍可換
  // 全鎖型（形態資料）：鎖的是整套，型別上刻意不長成一份「幾格」的清單
  assert.equal(lockedSlots(虛粒子)?.weaponIds.length, 3)
})
