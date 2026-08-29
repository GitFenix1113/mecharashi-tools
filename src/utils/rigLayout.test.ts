// PLAN-052-L B-1：位置化槽位的幾何（rigLayout）
//   npm test   →   node --test "src/**/*.test.ts"
//
// 這一組測的是**列序**與**「整排不存在」的判定**——兩者錯了都不會報錯，
// 只會讓匯出的圖與遊戲整備畫面對不起來，而圖是印刷品、看的人沒辦法點開來對帳。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Backpack, Mech, Pilot, Weapon } from '../types/index.ts'
import {
  ArmorType, BackpackType, MechLicense, MechRestriction, WeaponEquipSlot, WeaponType,
} from '../types/enums.ts'
import { buildWorld, buildContext } from './loadoutRules.ts'
import { rigLayout, rigColumnRefs, rigSlots, type RigBlock } from './rigLayout.ts'

// ─── fixtures ───────────────────────────────────────────────────────────────

const part = (weight: number, output?: number, iface = 'Ⅱ型接口', fixedArmament?: unknown[]) =>
  ({ position: 'torso', durable: 0, armor: 0, firepower: 0, weight, output, interface: iface, fixedArmament }) as never

const weapon = (over: Partial<Weapon> & Pick<Weapon, 'id' | 'name' | 'weight' | 'equipSlot'>): Weapon => ({
  type: WeaponType.Melee, kind: '刀劍', kindCoefficient: 1, attack: 0, accuracy: 0, critValue: 0,
  rangeType: 'manhattan', minRange: 1, maxRange: 1, ammoCount: 0, hitCount: 1, rarity: 'SS',
  mechRestriction: MechRestriction.NONE, isExclusive: false, triggerSlots: 0, effectSlots: 0, componentLimit: 4,
  fixedMod: { planName: '', maxLevel: 0, effects: [] },
  floatingMod: { planName: '', slots: 0, possibleEffects: [] }, skills: [], ...over,
} as Weapon)

// icon 有值是刻意的：匯出圖的每一格都要畫得出圖（實測 182 把武器 100% 有 icon）
const 雙手劍 = weapon({ id: 'w_dual', name: '雙手劍', weight: 800, equipSlot: WeaponEquipSlot.DUAL_HAND, icon: 'Icon_weapon_dual.png' })
const 單手刀 = weapon({ id: 'w_one', name: '單手刀', weight: 300, equipSlot: WeaponEquipSlot.SINGLE_HAND })
/** 純封鎖型固定武裝：重量是**真的 0**，不是「沒有值」 */
const 儲能艙 = weapon({ id: 'w_fix', name: '嵐質儲能艙', weight: 0, equipSlot: WeaponEquipSlot.SHOULDER, type: WeaponType.Special, componentLimit: 0 })

const 中甲機: Mech = {
  id: 'mech_m', name: '中甲機', armorType: ArmorType.MEDIUM,
  firepower: 0, armor: 0, evasion: 0, mobility: 0, weight: 825, output: 5000,
  parts: { torso: part(300, 5000), leftArm: part(175), rightArm: part(175), legs: part(175) },
  moduleFixedIds: [],
} as unknown as Mech

const 輕甲機: Mech = { ...中甲機, id: 'mech_l', name: '輕甲機', armorType: ArmorType.LIGHT }

/** B 品質：四部位接口皆為空字串 ＝ **真的沒有模組接口**（10 台 40 格） */
const B品質機: Mech = {
  ...中甲機, id: 'mech_b', name: 'B品質機',
  parts: { torso: part(300, 5000, ''), leftArm: part(175, undefined, ''), rightArm: part(175, undefined, ''), legs: part(175, undefined, '') },
} as unknown as Mech

/** 右臂焊死一具儲能艙 → 佔住右肩（ARM_SIDE：右臂帶右肩） */
const 固定武裝機: Mech = {
  ...中甲機, id: 'mech_fix', name: '固定武裝機',
  parts: {
    torso: part(300, 5000), leftArm: part(175),
    rightArm: part(175, undefined, 'Ⅱ型接口', [{ weaponId: 儲能艙.id, slot: WeaponEquipSlot.SHOULDER }]),
    legs: part(175),
  },
} as unknown as Mech

const 強襲者背包: Backpack = {
  id: 'bp_backup', name: '強襲者背包', type: BackpackType.BACKUP_EQUIPMENT, weight: 200,
} as unknown as Backpack
const 一般背包: Backpack = {
  id: 'bp_plain', name: '一般背包', type: 'Normal', weight: 150, icon: 'Icon_backpack_plain.png',
} as unknown as Backpack

const 機師: Pilot = { id: 'p1', name: '阿中', license: MechLicense.MEDIUM } as Pilot

const WORLD = buildWorld({
  pilots: [機師],
  mechs: [中甲機, 輕甲機, B品質機, 固定武裝機],
  weapons: [雙手劍, 單手刀, 儲能艙],
  backpacks: [強襲者背包, 一般背包],
  forms: [],
})

const ctxOf = (draft: Parameters<typeof buildContext>[0]) => buildContext(draft, 'default', WORLD)

/** 版面塊的粗略形狀：`row:標籤` / `part:部位` / `columns` */
const shape = (blocks: RigBlock[]) => blocks.map((b) =>
  b.kind === 'row' ? `row:${b.slot.label}` : b.kind === 'part' ? `part:${b.position}` : 'columns')

/** 某一欄由上而下的節點：槽位印標籤、部位卡印部位 */
const column = (blocks: RigBlock[], side: 'left' | 'right') => {
  const cols = blocks.find((b) => b.kind === 'columns')
  assert.ok(cols && cols.kind === 'columns')
  return cols[side].map((n) => (n.kind === 'slot' ? n.slot.label : `part:${n.position}`))
}

// ─── 測試 ───────────────────────────────────────────────────────────────────

test('中甲：列序是 軀幹 → 主列 → 腿部 → 背部（備用槽沒有說明列）', () => {
  const blocks = rigLayout(ctxOf({ pilotId: 機師.id, mechId: 中甲機.id, sets: {} }))
  assert.deepEqual(shape(blocks), ['part:torso', 'columns', 'part:legs', 'row:背部'])
})

test('背部與軀幹／腿部同寬（half）：十字的下端要對得齊上端', () => {
  // 使用者回饋 2026-08-30。整寬時它比正上方那張半寬的腿部卡寬一倍、右半邊只有一個數字
  const blocks = rigLayout(ctxOf({ pilotId: 機師.id, mechId: 中甲機.id, sets: {} }))
  const back = blocks.find((b) => b.kind === 'row' && b.slot.label === '背部')
  assert.ok(back && back.kind === 'row')
  assert.equal(back.half, true)
})

test('「整排不存在」的肩部維持整寬：那一列講的是一整排，不是十字的一端', () => {
  const blocks = rigLayout(ctxOf({ pilotId: 機師.id, mechId: 輕甲機.id, sets: {} }))
  const 肩 = blocks.find((b) => b.kind === 'row' && b.slot.label === '肩部')
  assert.ok(肩 && 肩.kind === 'row')
  assert.equal(肩.half, undefined)
})

test('槽位帶得出裝備圖示 —— 匯出圖靠它才畫得出圖（2026-08-30 前只有字）', () => {
  const blocks = rigLayout(ctxOf({
    pilotId: 機師.id, mechId: 中甲機.id,
    sets: { default: { mounts: [{ weaponId: 雙手劍.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] }, },
  }))
  const hands = rigSlots(blocks).filter((s) => s.label === '左手' || s.label === '右手')
  // 雙手武器兩格都要有圖：遊戲整備畫面也是兩隻手都畫同一把
  assert.deepEqual(hands.map((s) => s.icon), [雙手劍.icon, 雙手劍.icon])
  // 空槽沒有圖 —— 渲染端據此**不佔位**，補一個空框會被讀成「有一件我不認得的裝備」
  const 右肩 = rigSlots(blocks).find((s) => s.label === '右肩')
  assert.equal(右肩?.icon, null)
})

test('中甲：畫面左欄是機體右側，臂卡插在肩與手之間', () => {
  // ⚠ 這一條錯了的症狀是「同一台機體在畫面上與圖上左右相反」，而兩邊都不會報錯
  const blocks = rigLayout(ctxOf({ pilotId: 機師.id, mechId: 中甲機.id, sets: {} }))
  assert.deepEqual(column(blocks, 'left'), ['右肩', 'part:rightArm', '右手'])
  assert.deepEqual(column(blocks, 'right'), ['左肩', 'part:leftArm', '左手'])
})

test('輕甲：無肩槽 → 整寬一列，不是左右兩個一樣的灰格', () => {
  const blocks = rigLayout(ctxOf({ pilotId: 機師.id, mechId: 輕甲機.id, sets: {} }))
  assert.deepEqual(shape(blocks), ['row:肩部', 'part:torso', 'columns', 'part:legs', 'row:背部'])
  const 肩 = blocks[0]
  assert.ok(肩.kind === 'row')
  assert.equal(肩.slot.state, 'absent')
  assert.equal(肩.slot.note, '肩部槽位只有中甲機甲才有')
  // 兩欄裡因此**沒有**肩格，臂卡插點退到最上面
  assert.deepEqual(column(blocks, 'left'), ['part:rightArm', '右手'])
})

test('B 品質（四格無模組接口）：部位卡照出——那是十字的骨架，不是模組面板', () => {
  // 「這台沒有接口」由卡片自己講（無模組接口），把卡片整批拿掉會讓十字塌成一排武器格
  const blocks = rigLayout(ctxOf({ pilotId: 機師.id, mechId: B品質機.id, sets: {} }))
  assert.deepEqual(shape(blocks), ['part:torso', 'columns', 'part:legs', 'row:背部'])
  assert.deepEqual(column(blocks, 'left'), ['右肩', 'part:rightArm', '右手'])
})

test('雙手武器：左右兩格都畫同一把，重量只有其中一格印得出來', () => {
  const blocks = rigLayout(ctxOf({
    pilotId: 機師.id, mechId: 中甲機.id,
    sets: { default: { mounts: [{ weaponId: 雙手劍.id, bank: 'main', slot: WeaponEquipSlot.DUAL_HAND }] } },
  }))
  const hands = rigSlots(blocks).filter((s) => s.label === '左手' || s.label === '右手')
  assert.deepEqual(hands.map((s) => s.name), ['雙手劍', '雙手劍'])
  // primary 落在機體右側（＝畫面左欄）；echo 那一格不印重量，免得 800 被讀成 1600
  const primary = hands.find((s) => s.dual === 'primary')
  const echo = hands.find((s) => s.dual === 'echo')
  assert.equal(primary?.label, '右手')
  assert.equal(primary?.weight, 800)
  assert.equal(echo?.label, '左手')
  assert.equal(echo?.weight, null)
})

test('強襲者背包：備用槽進兩欄，說明列消失；背包本身在背部那一列', () => {
  const blocks = rigLayout(ctxOf({
    pilotId: 機師.id, mechId: 中甲機.id,
    sets: { default: { mounts: [], backpackId: 強襲者背包.id } },
  }))
  assert.deepEqual(shape(blocks), ['part:torso', 'columns', 'part:legs', 'row:背部'])
  assert.deepEqual(column(blocks, 'left'), ['右肩', 'part:rightArm', '右手', '備用右手'])
  const back = rigSlots(blocks).find((s) => s.label === '背部')
  assert.equal(back?.state, 'backpack')
  assert.equal(back?.name, '強襲者背包')
  assert.equal(back?.note, '解鎖備用武器槽')
})

test('一般背包：不解鎖備用槽 → **不出說明列**（使用者裁決 2026-08-30）', () => {
  // 181 個背包只有強襲者解得開備用槽 ⇒ 那一列會出現在幾乎每一張圖上，
  // 去解釋一個這張配裝裡根本不存在的東西。解鎖時備用格本來就畫得出來。
  const blocks = rigLayout(ctxOf({
    pilotId: 機師.id, mechId: 中甲機.id,
    sets: { default: { mounts: [], backpackId: 一般背包.id } },
  }))
  assert.equal(blocks.find((b) => b.kind === 'row' && b.slot.label === '備用槽'), undefined)
  const back = rigSlots(blocks).find((s) => s.label === '背部')
  assert.equal(back?.note, null)
  assert.equal(back?.icon, 一般背包.icon ?? null, '背包也要帶圖示')
})

test('固定武裝：重量 0 要印得出來（那是真的 0，不是「沒有值」）', () => {
  const blocks = rigLayout(ctxOf({ pilotId: 機師.id, mechId: 固定武裝機.id, sets: {} }))
  const 右肩 = rigSlots(blocks).find((s) => s.label === '右肩')
  assert.equal(右肩?.state, 'fixed')
  assert.equal(右肩?.name, '嵐質儲能艙')
  assert.equal(右肩?.note, '機甲固定武裝')
  // ⚠ 0 與 null 不是同一件事：都印成「—」會讓玩家以為這一把也算進總重了
  assert.equal(右肩?.weight, 0)
  const 左肩 = rigSlots(blocks).find((s) => s.label === '左肩')
  assert.equal(左肩?.state, 'empty')
  assert.equal(左肩?.weight, null)
})

test('武器資料斷鏈時退回 doc id，而不是把那一格畫成空槽', () => {
  const blocks = rigLayout(ctxOf({
    pilotId: 機師.id, mechId: 中甲機.id,
    sets: { default: { mounts: [{ weaponId: 'w_已下架', bank: 'main', slot: WeaponEquipSlot.SINGLE_HAND, side: 'left' }] } },
  }))
  const 左手 = rigSlots(blocks).find((s) => s.label === '左手')
  assert.equal(左手?.state, 'weapon')
  assert.equal(左手?.name, 'w_已下架')
  assert.equal(左手?.weight, null)
})

test('rigColumnRefs 收的是**機體側**，翻面是呼叫端的事', () => {
  const cap = { singleHand: 2, shoulder: 2, back: 1, backupHand: 0 }
  assert.deepEqual(rigColumnRefs(cap, 'right').map((r) => r.slot), ['shoulder', 'singleHand'])
  assert.deepEqual(rigColumnRefs(cap, 'right').map((r) => r.side), ['right', 'right'])
  assert.deepEqual(rigColumnRefs({ ...cap, backupHand: 2 }, 'left').map((r) => r.bank), ['main', 'main', 'backup'])
})

test('沒有機甲時不生部位卡（不補零值部位），但槽位骨架仍在', () => {
  const blocks = rigLayout(ctxOf({ pilotId: 機師.id, sets: {} }))
  assert.deepEqual(shape(blocks), ['row:肩部', 'columns', 'row:背部'])
  assert.deepEqual(column(blocks, 'left'), ['右手'])
})
