// 攜帶技能候選池 —— PLAN-052-L D-4
//
// 這一支的每一條錯法都是**靜默**的：濾多了，機師的技能欄變成空的而畫面說「沒有可選的
// 技能」；濾少了，玩家會看到一個選了也沒用的格子。兩者都不會報錯，所以規則要被釘住。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Pilot, PilotSkillDoc } from '../types'
import { carriableSkills, keepCarriableSkills } from './carriedSkills.ts'

const skill = (id: string, extra: Partial<PilotSkillDoc> = {}): PilotSkillDoc => ({
  id, name: id.replace(/^skill_/i, ''), type: '被動技能',
  description: '', icon: '', iconLocal: '', effects: [], buffIds: [],
  ...extra,
})

/**
 * 後台 `unitType` 下拉的三個值都出現一次（＝資料裡真正的形狀）：
 * 職業單元 `'6'`（天生自帶）／核心單元 `'0'`／一般技能（沒有這個欄位，706/853 都是這種）。
 */
const NORMAL = [
  skill('skill_協同作戰1', { unitType: '6' }),
  skill('skill_核心的', { unitType: '0' }),
  skill('SKILL_彈道收束', { manual: true }),
  skill('skill_槍林彈雨'),
  skill('skill_一人成軍'),
]

/** 3.3+ 手建機師：**九筆全帶 `manual`**（＝那 7 位的形狀，見下方那條 ⚠ 測試） */
const HANDMADE = [
  skill('skill_構型轉換1', { unitType: '6', manual: true }),
  skill('skill_瀆鋒影芒', { manual: true }),
  skill('skill_映纏', { manual: true }),
  skill('skill_幽弋', { manual: true }),
]

const pilotOf = (docs: PilotSkillDoc[], extra: Partial<Pilot> = {}): Pilot =>
  ({ id: 'p', name: 'P', skills: docs.map((d) => d.id), ...extra } as unknown as Pilot)

const mapOf = (docs: PilotSkillDoc[]) => new Map(docs.map((d) => [d.id, d]))

test('只有職業單元被濾掉，其餘一律進候選池', () => {
  // 使用者裁決逐字：「天生自帶的技能，我們歸類為『職業單元』。
  // 職業單元是不用攜帶的，其他一般技能都是選擇性技能。」
  assert.deepEqual(
    carriableSkills(pilotOf(NORMAL), mapOf(NORMAL)).map((d) => d.id),
    ['skill_核心的', 'SKILL_彈道收束', 'skill_槍林彈雨', 'skill_一人成軍'],
  )
})

test('⚠ 核心單元是一般技能，要進池子（不可以寫成「只留 unitType 0」）', () => {
  // 全庫 853 筆有 706 筆根本沒有這個欄位（後台那顆下拉的預設值就是「一般技能（無）」），
  // 寫成「只留 '0'」會讓每位機師的池子只剩不到兩成。要濾掉的是 '6'。
  const pool = carriableSkills(pilotOf(NORMAL), mapOf(NORMAL))
  assert.ok(pool.some((d) => d.unitType === '0'))
  assert.ok(pool.some((d) => d.unitType === undefined))
})

test('⚠ manual 不是「天生」的判準 —— 它記的是這筆資料誰建的', () => {
  // 3.3+ 那七位機師官網還沒放、整份資料由後台手建，於是九筆技能全帶 manual。
  // 拿它過濾會讓他們的候選池整個歸零，而畫面上只會說「沒有可選的技能」——
  // 一句看起來像資料沒建好、實際上是我們自己濾掉的話。
  const pool = carriableSkills(pilotOf(HANDMADE, { manual: true }), mapOf(HANDMADE))
  assert.deepEqual(pool.map((d) => d.id), ['skill_瀆鋒影芒', 'skill_映纏', 'skill_幽弋'])
  assert.ok(pool.length >= 3, '三格要填得滿')
})

test('職業單元的判準是 unitType 而不是名字 —— 七個職業共用同一組', () => {
  const docs = [skill('skill_狙擊戰1', { unitType: '6' }), skill('skill_一發入魂')]
  assert.deepEqual(
    carriableSkills(pilotOf(docs), mapOf(docs)).map((d) => d.id),
    ['skill_一發入魂'],
  )
})

test('⚠ 技能庫還沒載入（空 Map）＝ 空陣列，不是「這位機師沒有技能」', () => {
  assert.deepEqual(carriableSkills(pilotOf(NORMAL), new Map()), [])
})

test('沒有機師時回空陣列，不 throw', () => {
  assert.deepEqual(carriableSkills(null, mapOf(NORMAL)), [])
  assert.deepEqual(carriableSkills(undefined, new Map()), [])
})

// ─── keepCarriableSkills ────────────────────────────────────────────────────

test('keepCarriableSkills：保序、去重、掃掉不在池子裡的', () => {
  const ids = ['skill_槍林彈雨', 'skill_一人成軍', 'skill_槍林彈雨', 'skill_協同作戰1', 'skill_不存在']
  assert.deepEqual(
    keepCarriableSkills(ids, pilotOf(NORMAL), mapOf(NORMAL)),
    ['skill_槍林彈雨', 'skill_一人成軍'],
    '職業單元與查無此物都要掃掉，順序照原樣',
  )
})

test('⚠ keepCarriableSkills：空 Map 一律原樣回傳 —— 那是「還沒載入」不是「不存在」', () => {
  // 照著武器那套「查不到就刪」做，症狀是貼一次分享碼、技能就被靜默清空一次。
  const ids = ['skill_槍林彈雨', 'skill_誰知道']
  assert.deepEqual(keepCarriableSkills(ids, pilotOf(NORMAL), new Map()), ids)
})

test('keepCarriableSkills：換了機師之後，不屬於他的技能會被掃掉', () => {
  const other = [skill('skill_別人的')]
  const world = mapOf([...NORMAL, ...other])
  assert.deepEqual(
    keepCarriableSkills(['skill_別人的', 'skill_槍林彈雨'], pilotOf(NORMAL), world),
    ['skill_槍林彈雨'],
  )
})
