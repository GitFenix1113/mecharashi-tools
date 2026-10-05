// PLAN-055 B-2：圖示「誰在用」反查
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIconUsage, usageKey, usageSearchText } from './iconUsage.ts'
import type { IconUsageSource } from './iconUsage.ts'

// 最小樣本：只填反查會讀到的欄位（其餘欄位與反查無關，以型別斷言略過）
const src = {
  pilots: [
    {
      id: 'pilot_038_艾達', name: '艾達', skills: ['skill_崩穹斬'],
      talents: [{ name: '凝勢', icon: 'Icon_skill_talent_1124', iconLocal: '/images/skills/Icon_skill_talent_1124.png' }],
      neuralDrive: [{ name: 'α', levels: [{ level: 1, abilityId: 'nd_運動戰2' }] }],
    },
    { id: 'pilot_004_威廉', name: '威廉', skills: ['skill_崩穹斬'], talents: [], neuralDrive: [{ name: 'α', levels: [{ level: 1, abilityId: 'nd_運動戰2' }] }] },
  ],
  weapons: [
    { id: 'weapon_x', name: 'HMG-29C', skills: [{ skillId: 'skill_崩穹斬', activation: 'carry' }] },
    { id: 'weapon_y', name: '舊武器', skills: [{ name: '內嵌技', icon: 'https://cdn.example/Icon_skill_passive_5010.png', iconLocal: '', type: '被動技能', activation: 'carry', description: '' }] },
  ],
  pilotSkills: [
    { id: 'skill_崩穹斬', name: '崩穹斬', icon: '', iconLocal: '/images/skills/主動技能/Icon_skill_main_1106.png' },
    { id: 'skill_侵攻', name: '侵攻', icon: '', iconLocal: '/images/skills/Icon_skill_main_1043.png' },   // 舊編號 → 1141
    { id: 'SKILL_碎障强擊', name: '碎障强擊', icon: '', iconLocal: '/images/skills/主動技能/Icon_skill_main_凱登01.png' },
  ],
  neuralDriveAbilities: [{ id: 'nd_運動戰2', name: '運動戰2', icon: 'Icon_skill_passive_5010', iconLocal: '/images/skills/Icon_skill_passive_5010.png' }],
  modules: [{ id: 'mod_1001', name: '猛擊裝置', icon: '/images/modules/Icon_entry_10031.png' }],
  backpackSkills: [{ id: 'bp_1', name: '威能者驅動', icon: '/images/skills/背包技能/Icon_skill_passive_5155.png', levels: [{ level: 2, icon: '/images/skills/被動技能/Icon_skill_passive_5155.png' }] }],
  forms: [{ id: 'form_海莉絲_先鋒', name: '先鋒形態', pilotId: 'pilot_038_艾達', icon: '/images/pilot_forms/Icon_skill_passive_5288.png' }],
  buffs: [{ id: 'BUFF_凝勢', name: '凝勢', icon: 'Icon_buff_4012' }],
} as unknown as IconUsageSource

const usage = buildIconUsage(src)

test('技能：反查出持有的機師與武器', () => {
  const u = usage.get('Icon_skill_main_1106')
  assert.equal(u?.length, 1)
  assert.equal(u?.[0].name, '崩穹斬')
  assert.equal(u?.[0].owner, '艾達、威廉、HMG-29C')
})

test('舊編號算到現行編號那張圖上', () => {
  assert.equal(usage.get('Icon_skill_main_1141')?.[0].name, '侵攻')
  assert.equal(usage.get('Icon_skill_main_1043'), undefined)
})

test('同一張圖被神經驅動與內嵌武器技能共用：兩種都列', () => {
  const kinds = usage.get('Icon_skill_passive_5010')?.map((u) => u.kind).sort()
  assert.deepEqual(kinds, ['武器技能', '神經驅動'])
  assert.equal(usage.get('Icon_skill_passive_5010')?.find((u) => u.kind === '神經驅動')?.owner, '艾達、威廉')
})

test('背包技能頂層與各級指向同一張圖只算一次', () => {
  assert.equal(usage.get('Icon_skill_passive_5155')?.length, 1)
})

test('模組、形態、天賦、BUFF 都有', () => {
  assert.equal(usage.get('Icon_entry_10031')?.[0].kind, '模組')
  assert.equal(usage.get('Icon_skill_passive_5288')?.[0].owner, '艾達')
  assert.equal(usage.get('Icon_skill_talent_1124')?.[0].kind, '天賦')
  assert.equal(usage.get('Icon_buff_4012')?.[0].kind, 'BUFF')
})

test('中文佔位名不列入', () => {
  assert.equal([...usage.keys()].some((k) => /[一-鿿]/.test(k)), false)
  assert.equal(usageKey('/images/skills/主動技能/Icon_skill_main_凱登01.png'), undefined)
})

test('搜尋文字含名稱與持有者', () => {
  const t = usageSearchText(usage.get('Icon_skill_main_1106'))
  assert.ok(t.includes('崩穹斬') && t.includes('hmg-29c'))
})
