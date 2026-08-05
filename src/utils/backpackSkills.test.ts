// PLAN-043 Phase D：背包技能解析層單元測試
//
// 這層的兩個易錯點都在此鎖住：
//   ① `@N` 的等級覆寫必須逐欄位 `?? 父層`，不是「有 level 就整包換掉」——
//      整包換掉會讓沒填該級描述的技能顯示成空白。
//   ② 查不到的 id 必須略過而非產出半殘條目，否則前台會渲染出 undefined。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveBackpackSkills, buildBackpackSkillMap, hasBackpackSkills,
} from './backpackSkills.ts'
import type { BackpackSkillDoc } from '../types'

const SKILL = {
  id: 'bpskill_移動強化',
  name: '移動強化',
  skillType: '被動技能',
  description: '父層描述',
  descriptionRefs: { 過熱: { refType: 'buff', refId: 'buff_過熱' } },
  icon: '/images/skills/背包技能/base.png',
  effects: [{ stat: 'dmg', value: 5, scope: 'self', condition: null }],
  buffIds: ['buff_父'],
  levels: [
    // Lv1 只填階名 → 其餘全部沿用父層（最容易寫錯的一格）
    { level: 1, name: '移動強化Ⅰ' },
    {
      level: 2, name: '移動強化Ⅱ',
      description: '第二級描述',
      descriptionRefs: { 隱形: { refType: 'buff', refId: 'buff_隱形' } },
      icon: '/images/skills/背包技能/lv2.png',
      effects: [{ stat: 'dmg', value: 10, scope: 'self', condition: null }],
      buffIds: ['buff_二'],
    },
  ],
} as unknown as BackpackSkillDoc

const MAP = buildBackpackSkillMap([SKILL])

test('無 @N 時使用技能頂層欄位', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化'] }, MAP)
  assert.equal(r.level, undefined)
  assert.equal(r.name, '移動強化')
  assert.equal(r.description, '父層描述')
  assert.deepEqual(r.buffIds, ['buff_父'])
  assert.equal(r.origin, '背包技能:移動強化')
})

test('@1 只填階名 → 其餘欄位逐一沿用父層（不可整包換掉）', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化@1'] }, MAP)
  assert.equal(r.level, 1)
  assert.equal(r.name, '移動強化Ⅰ', '階名應取該級的')
  assert.equal(r.description, '父層描述', '該級未填 → 沿用父層，不可變空字串')
  assert.equal(r.icon, '/images/skills/背包技能/base.png')
  assert.deepEqual(r.effects, SKILL.effects)
  assert.deepEqual(r.buffIds, ['buff_父'])
  assert.deepEqual(r.descriptionRefs, SKILL.descriptionRefs)
  assert.equal(r.origin, '背包技能:移動強化 Lv1')
})

test('@2 全部填滿 → 每個欄位都取該級的', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化@2'] }, MAP)
  assert.equal(r.name, '移動強化Ⅱ')
  assert.equal(r.description, '第二級描述')
  assert.equal(r.icon, '/images/skills/背包技能/lv2.png')
  assert.deepEqual(r.effects, [{ stat: 'dmg', value: 10, scope: 'self', condition: null }])
  assert.deepEqual(r.buffIds, ['buff_二'])
  assert.deepEqual(r.descriptionRefs, { 隱形: { refType: 'buff', refId: 'buff_隱形' } })
})

test('指定了不存在的等級 → 退回頂層欄位，但保留 level 供除錯', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化@9'] }, MAP)
  assert.equal(r.level, 9)
  assert.equal(r.name, '移動強化', '查無該級 → 顯示技能原名而非空白')
  assert.equal(r.description, '父層描述')
})

test('查不到的 id 略過，不產出半殘條目', () => {
  const r = resolveBackpackSkills({ skillIds: ['bpskill_不存在', 'bpskill_移動強化@1'] }, MAP)
  assert.equal(r.length, 1)
  assert.equal(r[0].id, 'bpskill_移動強化')
})

test('raw 保留原始字串（含 @N），id 是拆解後的裸值', () => {
  const [r] = resolveBackpackSkills({ skillIds: ['bpskill_移動強化@2'] }, MAP)
  assert.equal(r.raw, 'bpskill_移動強化@2')
  assert.equal(r.id, 'bpskill_移動強化')
})

test('空 / undefined / 空字串元素皆安全', () => {
  assert.deepEqual(resolveBackpackSkills(null, MAP), [])
  assert.deepEqual(resolveBackpackSkills(undefined, MAP), [])
  assert.deepEqual(resolveBackpackSkills({ skillIds: [] }, MAP), [])
  assert.deepEqual(resolveBackpackSkills({ skillIds: ['', ''] as string[] }, MAP), [])
})

test('hasBackpackSkills 看的是「解析得到幾個」而非 skillIds.length', () => {
  // 全部斷鏈時長度仍 > 0；若 gate 用 length 判斷會開出一塊空白區
  assert.equal(hasBackpackSkills({ skillIds: ['bpskill_不存在'] }, MAP), false)
  assert.equal(hasBackpackSkills({ skillIds: ['bpskill_移動強化'] }, MAP), true)
  assert.equal(hasBackpackSkills({ skillIds: [] }, MAP), false)
})

test('多個技能保序', () => {
  const second = { ...SKILL, id: 'bpskill_第二', name: '第二', levels: undefined } as unknown as BackpackSkillDoc
  const map = buildBackpackSkillMap([SKILL, second])
  const r = resolveBackpackSkills({ skillIds: ['bpskill_第二', 'bpskill_移動強化@1'] }, map)
  assert.deepEqual(r.map((x) => x.name), ['第二', '移動強化Ⅰ'])
})
